"""Exercise event admission, child cleanup, and replay through real HTTP."""

import json
import os
import resource
import socket
import sqlite3
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[2]
REFERENCE = ROOT / "tests" / "fixtures" / "event-entry" / "reference-plan.json"
HEADERS = {"X-API-Key": "test-key"}


@contextmanager
def runtime_service(tmp_path, *, cpu_limit=None):
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    database = tmp_path / "runtime.sqlite3"
    env = {
        "PATH": os.environ.get("PATH", ""),
        "PYTHONPATH": str(ROOT / "src"),
        "API_KEY": "test-key",
        "DATABASE_PATH": str(database),
    }
    process = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "algorithm_api.app:app", "--host", "127.0.0.1", "--port", str(port)],
        cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        preexec_fn=None if cpu_limit is None else lambda: resource.setrlimit(resource.RLIMIT_CPU, (cpu_limit, cpu_limit)),
    )
    client = httpx.Client(base_url=f"http://127.0.0.1:{port}", headers=HEADERS, timeout=70)
    try:
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            assert process.poll() is None, "HTTP service exited during startup"
            try:
                if client.get("/health", timeout=1).status_code == 200:
                    break
            except httpx.HTTPError:
                pass
            time.sleep(.05)
        else:
            raise AssertionError("HTTP service did not become ready")
        yield client, process, database
    finally:
        client.close()
        process.terminate()
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=3)


def computation_children(process):
    result = subprocess.run(
        ["ps", "-axo", "pid=,ppid=,command="], capture_output=True, text=True, check=True, timeout=3
    )
    return {
        int(pid)
        for line in result.stdout.splitlines()
        for pid, parent, command in [line.strip().split(None, 2)]
        if int(parent) == process.pid and "multiprocessing.spawn" in command
    }


def wait_for_child(process, pending):
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        children = computation_children(process)
        if children:
            return children
        assert not pending.done(), "Computation finished before a real child was observed"
        time.sleep(.02)
    raise AssertionError("No event computation child appeared")


def assert_children_reaped(children):
    for pid in children:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            continue
        raise AssertionError(f"Computation child {pid} remains alive or unreaped")


def workload():
    document = json.loads(REFERENCE.read_text())
    remaining = 10000
    categories = document["event"]["ticket_categories"]
    for index, category in enumerate(categories):
        category["sold"] = remaining if index == len(categories) - 1 else int(category.get("sold", 0) * 10000 / 3532)
        category["issued"] = 0
        category["quota"] = max(category["quota"], category["sold"])
        remaining -= category["sold"]
    document["event"]["capacity"]["no_show_percent_estimate"] = 0
    return document


def assert_no_success(client, database, plan_id, key):
    response = client.get(f"/v4/plans/{plan_id}/runs")
    assert response.status_code == 200
    assert response.json() == {"data": [], "next_cursor": None}
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT COUNT(*) FROM event_runs").fetchone()[0] == 0
        assert connection.execute("SELECT COUNT(*) FROM event_snapshots").fetchone()[0] == 0
        assert connection.execute("SELECT COUNT(*) FROM event_replays WHERE key=?", (key,)).fetchone()[0] == 0
    assert client.post("/v4/plans", json={}).status_code == 201


def test_contention_timeout_replay(tmp_path):
    with runtime_service(tmp_path) as (client, process, database):
        created = client.post("/v4/plans", json=workload())
        assert created.status_code == 201, created.text
        plan = created.json()
        plan_id = plan["id"]
        corridor = client.post("/v3/plans", json=json.loads((ROOT / "examples" / "corridor-plan.json").read_text()))
        assert corridor.status_code == 201
        key = "deadline-must-not-replay"
        settings = {"simulation_method": "des", "replications": 100, "base_seed": 42}
        with ThreadPoolExecutor(max_workers=1) as pool:
            started = time.monotonic()
            pending = pool.submit(client.post, f"/v4/plans/{plan_id}/simulate", json=settings, headers={"Idempotency-Key": key})
            children = wait_for_child(process, pending)
            mutations = [
                ("POST", f"/v3/plans/{corridor.json()['id']}/simulate", {}),
                ("POST", "/v4/plans", {}),
                ("PATCH", f"/v4/plans/{plan_id}", {}),
                ("DELETE", f"/v4/plans/{plan_id}", None),
                ("POST", f"/v4/plans/{plan_id}/simulate", settings),
            ]
            for method, path, body in mutations:
                before = time.monotonic()
                response = client.request(method, path, json=body, timeout=2)
                assert time.monotonic() - before < 2
                assert response.status_code == 429, response.text
                assert response.headers["Retry-After"] == "1"
                assert response.json()["error"]["code"] == "service_busy"
            for path in ("/health", f"/v3/plans/{corridor.json()['id']}", "/v4/plans", f"/v4/plans/{plan_id}", f"/v4/plans/{plan_id}/runs"):
                assert client.get(path, timeout=2).status_code == 200
            assert client.get(f"/v4/plans/{plan_id}").json() == plan
            response = pending.result(timeout=70 - (time.monotonic() - started))
            elapsed = time.monotonic() - started
        assert response.status_code == 503, f"Required real timeout missing after {elapsed:.3f}s: {response.status_code}"
        assert response.json()["error"]["code"] == "computation_timeout"
        assert 60 <= elapsed < 70
        assert_children_reaped(children)
        assert_no_success(client, database, plan_id, key)


def test_os_limited_child_crash_leaves_no_success(tmp_path):
    with runtime_service(tmp_path, cpu_limit=2) as (client, process, database):
        created = client.post("/v4/plans", json=workload())
        assert created.status_code == 201, created.text
        plan_id = created.json()["id"]
        key = "crash-must-not-replay"
        with ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(
                client.post, f"/v4/plans/{plan_id}/simulate",
                json={"simulation_method": "des", "replications": 100, "base_seed": 42},
                headers={"Idempotency-Key": key},
            )
            children = wait_for_child(process, pending)
            response = pending.result(timeout=15)
        assert response.status_code == 500, response.text
        assert response.json()["error"]["code"] == "internal_error"
        assert process.poll() is None
        assert_children_reaped(children)
        assert_no_success(client, database, plan_id, key)


def test_canonical_post_replay_scope_expiry_and_deleted_plan(service):
    client, env, _ = service
    headers = {**HEADERS, "Idempotency-Key": "shared-key"}
    body = {"meta": {"description": "Replay acceptance", "example": False}}
    created = client.post("/v4/plans", headers=headers, json=body)
    assert created.status_code == 201, created.text
    replay = client.post(
        "/v4/plans", headers={**headers, "Content-Type": "application/json"},
        content=' { "meta" : { "example": false, "description": "Replay acceptance" } } ',
    )
    assert (replay.status_code, replay.json()) == (created.status_code, created.json())
    conflict = client.post("/v4/plans", headers=headers, json={})
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "idempotency_conflict"
    other = client.post("/v4/plans", headers=HEADERS, json=json.loads(REFERENCE.read_text()))
    assert other.status_code == 201
    first_id, other_id = created.json()["id"], other.json()["id"]
    for plan_id in (first_id, other_id):
        validated = client.post(f"/v4/plans/{plan_id}/validate", headers=headers, json={})
        assert validated.status_code == 200
        assert validated.json()["valid"] == (plan_id == other_id)
        assert client.post(f"/v4/plans/{plan_id}/validate", headers=headers, json={}).json() == validated.json()
    corridor = client.post("/v3/plans", headers=headers, json=json.loads((ROOT / "examples" / "corridor-plan.json").read_text()))
    assert corridor.status_code == 201, corridor.text
    assert client.delete(f"/v4/plans/{first_id}", headers=HEADERS).status_code == 204
    replay = client.post("/v4/plans", headers=headers, json=body)
    assert (replay.status_code, replay.json()) == (201, created.json())
    assert client.get(f"/v4/plans/{first_id}", headers=HEADERS).status_code == 404
    with sqlite3.connect(env["DATABASE_PATH"]) as connection:
        connection.execute(
            "UPDATE event_replays SET expiry=? WHERE operation=? AND target=? AND key=?",
            ("2000-01-01T00:00:00+00:00", "createEventPlan", "", "shared-key"),
        )
    expired = client.post("/v4/plans", headers=headers, json=body)
    assert expired.status_code == 201
    assert expired.json()["id"] != first_id


def test_concurrent_same_key_simulation_commits_one_run(service):
    client, _, _ = service
    document = json.loads(REFERENCE.read_text())
    for index, category in enumerate(document["event"]["ticket_categories"]):
        category["sold"] = 2 if index == 0 else 0
        category["issued"] = 0
    created = client.post("/v4/plans", headers=HEADERS, json=document)
    assert created.status_code == 201
    plan_id = created.json()["id"]
    path = f"/v4/plans/{plan_id}/simulate"
    headers = {**HEADERS, "Idempotency-Key": "concurrent-simulation"}
    settings = {"simulation_method": "des", "replications": 1, "base_seed": 42}
    with ThreadPoolExecutor(max_workers=2) as pool:
        pending = [pool.submit(client.post, path, headers=headers, json=settings) for _ in range(2)]
        responses = [future.result(timeout=10) for future in pending]
    assert any(response.status_code == 200 for response in responses)
    saved = next(response.json() for response in responses if response.status_code == 200)
    for response in responses:
        assert response.status_code in (200, 429), response.text
        if response.status_code == 200:
            assert response.json() == saved
        else:
            assert response.headers["Retry-After"] == "1"
    replay = client.post(path, headers=headers, json=settings)
    assert replay.status_code == 200
    assert replay.json() == saved
    runs = client.get(f"/v4/plans/{plan_id}/runs", headers=HEADERS)
    assert runs.status_code == 200
    assert runs.json() == {"data": [saved], "next_cursor": None}
    changed = client.post(path, headers=headers, json={**settings, "base_seed": 43})
    assert changed.status_code == 409
    assert changed.json()["error"]["code"] == "idempotency_conflict"
