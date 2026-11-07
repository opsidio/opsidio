"""Exercise the corridor workflow only through HTTP and process restart."""
import subprocess
import sys
import time

import httpx


def example():
    return {
        "schema_version": "corridor-1", "name": "Synthetic two-visitor scan", "geometry_revision": "synthetic-corridor-v1",
        "route": {"nodes": [
            {"id": "arrival", "position": {"x": 0, "y": 0, "z": 0}},
            {"id": "scan", "position": {"x": 0, "y": 0, "z": 5}},
            {"id": "admission", "position": {"x": 0, "y": 0, "z": 5}},
        ], "scan_node_id": "scan"},
        "arrivals": {"count": 2, "start_seconds": 0, "end_seconds": 0}, "walking_speed_mps": 1,
        "scan": {"lanes": 1, "physical_slots": 2, "available_staff": 2, "available_scanners": 2,
                 "service_seconds": 10, "staff_cost_per_lane": {"amount": "100.00", "currency": "IDR"},
                 "scanner_cost_per_lane": {"amount": "50.00", "currency": "IDR"}},
        "targets": {"max_peak_scan_queue": 0}, "budget": {"amount": "600.00", "currency": "IDR"}, "horizon_seconds": 30,
    }


def test_lifecycle_security_and_restart(service):
    client, env, port = service
    assert client.get("/health").json() == {"status": "ok"}
    for path, method, payload in [
        ("/v3/plans", "post", example()),
        ("/v3/plans/missing", "get", None),
        ("/v3/plans/missing/simulate", "post", {}),
        ("/v3/runs/missing", "get", None),
        ("/v3/plans/missing/optimize", "post", {}),
        ("/v3/optimizations/missing", "get", None),
    ]:
        response = getattr(client, method)(path, json=payload) if method == "post" else client.get(path)
        assert response.status_code == 401
        response = getattr(client, method)(path, json=payload, headers={"X-API-Key": "wrong-key"}) if method == "post" else client.get(path, headers={"X-API-Key": "wrong-key"})
        assert response.status_code == 401
    assert client.get("/docs").status_code == 404
    headers = {"X-API-Key": "test-key"}
    create_headers = {**headers, "Idempotency-Key": "create-plan"}
    created = client.post("/v3/plans", json=example(), headers=create_headers)
    assert client.post("/v3/plans", json=example(), headers=create_headers).json() == created.json()
    assert created.status_code == 201, created.text
    plan = created.json()
    sim_headers = {**headers, "Idempotency-Key": "simulate-plan"}
    run_response = client.post(f"/v3/plans/{plan['id']}/simulate", json={}, headers=sim_headers)
    run = run_response.json()
    assert client.post(f"/v3/plans/{plan['id']}/simulate", json={}, headers=sim_headers).json() == run
    assert run["output"]["population"]["admitted"] == 2
    assert run["output"]["walking"]["route_distance_m"] == 5
    assert run["output"]["scan"]["peak_queue"] == 1
    assert run["output"]["scan"]["wait_p90_seconds"] == 10
    assert run["output"]["costs"]["total"] == {"amount": "150.00", "currency": "IDR"}
    assert run["output"]["checks"] == {"queue_target_met": False, "budget_met": True, "all_admitted": True}
    assert run["output"]["walking"]["total_observed_seconds"] == 10
    for horizon, admitted in ((15, 1), (25, 2)):
        probe = example(); probe["horizon_seconds"] = horizon
        probe_plan = client.post("/v3/plans", json=probe, headers=headers).json()
        probe_run = client.post(f"/v3/plans/{probe_plan['id']}/simulate", json={}, headers=headers).json()
        assert probe_run["output"]["population"]["admitted"] == admitted
    opt_headers = {**headers, "Idempotency-Key": "optimize-plan"}
    opt_response = client.post(f"/v3/plans/{plan['id']}/optimize", json={}, headers=opt_headers)
    assert client.post(f"/v3/plans/{plan['id']}/optimize", json={}, headers=opt_headers).json() == opt_response.json()
    assert opt_response.status_code == 200, opt_response.text
    opt = opt_response.json()
    assert opt["improved"] is True
    assert opt["candidate_plan_id"]
    assert opt["best_run_id"] != opt["baseline_run_id"]
    best = client.get(f"/v3/runs/{opt['best_run_id']}", headers=headers).json()
    candidate = client.get(f"/v3/plans/{opt['candidate_plan_id']}", headers=headers).json()
    assert candidate["parent_id"] == plan["id"]
    assert candidate["document"]["scan"]["lanes"] == 2
    baseline_doc = plan["document"]
    candidate_doc = candidate["document"]
    candidate_doc["scan"]["lanes"] = baseline_doc["scan"]["lanes"]
    assert candidate_doc == baseline_doc
    assert best["plan_id"] == candidate["id"]
    assert best["snapshot_hash"] == candidate["snapshot_hash"]
    assert run["created_at"].endswith("Z") and len(plan["snapshot_hash"]) == 64
    assert best["output"]["population"]["admitted"] == 2
    assert best["output"]["scan"]["lanes"] == 2
    assert best["output"]["scan"]["peak_queue"] == 0
    assert best["output"]["scan"]["wait_p90_seconds"] == 0
    assert best["output"]["costs"]["total"]["amount"] == "300.00"
    assert best["output"]["checks"] == {"queue_target_met": True, "budget_met": True, "all_admitted": True}
    assert client.get(f"/v3/plans/{plan['id']}", headers=headers).json()["candidate_plans"][0]["id"] == opt["candidate_plan_id"]
    for path in (f"/v3/plans/{plan['id']}", f"/v3/runs/{run['id']}", f"/v3/optimizations/{opt['id']}"):
        assert client.get(path, headers=headers).status_code == 200
    client.close()
    proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "algorithm_api.app:app", "--host", "127.0.0.1", "--port", str(port)], cwd=__import__('pathlib').Path(__file__).resolve().parents[2], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        restarted = httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=10)
        for _ in range(100):
            try:
                if restarted.get("/health").status_code == 200: break
            except httpx.HTTPError: time.sleep(.05)
        assert restarted.get(f"/v3/runs/{run['id']}", headers=headers).status_code == 200
        assert restarted.post("/v3/plans", json=example(), headers=create_headers).json() == plan
        assert restarted.post(f"/v3/plans/{plan['id']}/simulate", json={}, headers=sim_headers).json() == run
        assert restarted.post(f"/v3/plans/{plan['id']}/optimize", json={}, headers=opt_headers).json() == opt
        assert restarted.get(f"/v3/optimizations/{opt['id']}", headers=headers).status_code == 200
        assert restarted.get(f"/v3/plans/{plan['id']}", headers=headers).json()["candidate_plans"][0]["id"] == opt["candidate_plan_id"]
        restarted.close()
    finally:
        proc.terminate()
        proc.wait(timeout=3)


def test_validation_and_idempotency(service):
    import sqlite3
    from datetime import datetime, timezone
    client, env, _ = service
    headers = {"X-API-Key": "test-key", "Idempotency-Key": "create-one"}
    body = example()
    first = client.post("/v3/plans", json=body, headers=headers)
    replay = client.post("/v3/plans", json=body, headers=headers)
    assert first.status_code == 201 and replay.json() == first.json()
    changed = example(); changed["name"] = "Different"
    assert client.post("/v3/plans", json=changed, headers=headers).status_code == 409
    with sqlite3.connect(env["DATABASE_PATH"]) as db:
        expiry = datetime.fromisoformat(db.execute("SELECT expiry FROM replays WHERE key = 'create-one'").fetchone()[0])
    remaining = (expiry - datetime.now(timezone.utc)).total_seconds()
    assert 23 * 3600 < remaining <= 24 * 3600
    assert client.post(f"/v3/plans/{first.json()['id']}/simulate", json={}, headers=headers).status_code == 200
    with sqlite3.connect(env["DATABASE_PATH"]) as db:
        db.execute("UPDATE replays SET expiry = ? WHERE key = 'create-one'", (datetime.now(timezone.utc).isoformat(),))
    assert client.post("/v3/plans", json=changed, headers=headers).status_code == 201
    bad = example(); bad["route"]["scan_node_id"] = "missing"
    assert client.post("/v3/plans", json=bad, headers={"X-API-Key": "test-key"}).status_code == 422


def test_horizon_and_arrival_shift(service):
    client, _, _ = service
    headers = {"X-API-Key": "test-key"}
    body = example(); body["horizon_seconds"] = 20
    plan = client.post("/v3/plans", json=body, headers=headers).json()
    sim_headers = {**headers, "Idempotency-Key": "simulate-plan"}
    run_response = client.post(f"/v3/plans/{plan['id']}/simulate", json={}, headers=sim_headers)
    run = run_response.json()
    assert client.post(f"/v3/plans/{plan['id']}/simulate", json={}, headers=sim_headers).json() == run
    assert run["output"]["population"]["admitted"] == 1
    assert run["output"]["population"]["unfinished_by_state"]["scanning"] == 1
    queued = example(); queued["horizon_seconds"] = 12
    queued_plan = client.post("/v3/plans", json=queued, headers=headers).json()
    queued_run = client.post(f"/v3/plans/{queued_plan['id']}/simulate", json={}, headers=headers).json()
    assert queued_run["output"]["population"]["unfinished_by_state"]["queued"] == 1
    for horizon, admitted in ((18, 1), (28, 2)):
        shifted = example(); shifted["arrivals"]["start_seconds"] = 3; shifted["arrivals"]["end_seconds"] = 3
        shifted["horizon_seconds"] = horizon
        plan2 = client.post("/v3/plans", json=shifted, headers=headers).json()
        run2 = client.post(f"/v3/plans/{plan2['id']}/simulate", json={}, headers=headers).json()
        assert run2["output"]["population"]["admitted"] == admitted
        assert run2["output"]["walking"]["total_observed_seconds"] == 10


def test_exact_horizon_and_no_wait_sample(service):
    client, _, _ = service
    headers = {"X-API-Key": "test-key"}
    body = example(); body["arrivals"]["count"] = 1; body["scan"]["service_seconds"] = 0; body["horizon_seconds"] = 5
    plan = client.post("/v3/plans", json=body, headers=headers).json()
    sim_headers = {**headers, "Idempotency-Key": "simulate-plan"}
    run_response = client.post(f"/v3/plans/{plan['id']}/simulate", json={}, headers=sim_headers)
    run = run_response.json()
    assert client.post(f"/v3/plans/{plan['id']}/simulate", json={}, headers=sim_headers).json() == run
    assert run["output"]["population"]["admitted"] == 1
    assert run["output"]["scan"]["wait_p90_seconds"] == 0
    assert run["output"]["scan"]["wait_sample_count"] == 1
    body["horizon_seconds"] = 4
    plan = client.post("/v3/plans", json=body, headers=headers).json()
    sim_headers = {**headers, "Idempotency-Key": "simulate-plan"}
    run_response = client.post(f"/v3/plans/{plan['id']}/simulate", json={}, headers=sim_headers)
    run = run_response.json()
    assert client.post(f"/v3/plans/{plan['id']}/simulate", json={}, headers=sim_headers).json() == run
    assert run["output"]["population"]["unfinished_by_state"]["walking_to_scan"] == 1
    body["route"]["nodes"][1]["position"]["z"] = 5
    body["route"]["nodes"][2]["position"]["z"] = 10
    body["horizon_seconds"] = 1
    body["scan"]["service_seconds"] = 1
    plan = client.post("/v3/plans", json=body, headers=headers).json()
    sim_headers = {**headers, "Idempotency-Key": "simulate-plan"}
    run_response = client.post(f"/v3/plans/{plan['id']}/simulate", json={}, headers=sim_headers)
    run = run_response.json()
    assert client.post(f"/v3/plans/{plan['id']}/simulate", json={}, headers=sim_headers).json() == run
    assert run["output"]["scan"]["wait_p90_seconds"] is None
    assert run["output"]["scan"]["wait_sample_count"] == 0
    assert run["output"]["population"]["unfinished_by_state"]["walking_to_scan"] == 1
    body["route"]["nodes"][1]["position"]["z"] = 1
    body["route"]["nodes"][2]["position"]["z"] = 5
    body["scan"]["service_seconds"] = 0
    body["horizon_seconds"] = 3
    plan = client.post("/v3/plans", json=body, headers=headers).json()
    run = client.post(f"/v3/plans/{plan['id']}/simulate", json={}, headers=headers).json()
    assert run["output"]["population"]["unfinished_by_state"]["walking_to_admission"] == 1


def test_limits_and_invalid_documents(service):
    client, _, _ = service
    headers = {"X-API-Key": "test-key"}
    for mutate in (
        lambda p: p["route"].update(scan_node_id="missing"),
        lambda p: p["route"]["nodes"][1]["position"].update(y=1),
        lambda p: p["route"]["nodes"].append(p["route"]["nodes"][0]),
        lambda p: p.update(schema_version="0.1"),
        lambda p: p["scan"].update(lanes=3),
        lambda p: p["budget"].update(amount="1.00"),
        lambda p: p.update(extra_field=True),
        lambda p: p["scan"].update(staff_cost_per_lane={"amount": "1.0", "currency": "IDR"}),
    ):
        body = example(); mutate(body)
        response = client.post("/v3/plans", json=body, headers=headers)
        assert response.status_code == 422, response.text
        assert "details" in response.json()["error"]
    oversized = client.post("/v3/plans", content=b" " * (1024 * 1024), headers={**headers, "Content-Type": "application/json"})
    assert oversized.status_code == 413
    chunked = client.post("/v3/plans", content=(b" " * 65536 for _ in range(16)), headers={**headers, "Content-Type": "application/json"})
    assert chunked.status_code == 413


def test_exact_five_and_ten_metre_walk(service):
    client, _, _ = service
    headers = {"X-API-Key": "test-key"}
    for distance, horizon in ((5, 5), (10, 10)):
        body = example(); body["arrivals"]["count"] = 1; body["scan"]["service_seconds"] = 0; body["horizon_seconds"] = horizon
        body["route"]["nodes"][2]["position"]["z"] = distance
        plan = client.post("/v3/plans", json=body, headers=headers).json()
        run = client.post(f"/v3/plans/{plan['id']}/simulate", json={}, headers=headers).json()
        assert run["output"]["walking"]["route_distance_m"] == distance
        assert run["output"]["population"]["admitted"] == 1


def test_lane_limits_and_non_improvement(service):
    client, _, _ = service
    headers = {"X-API-Key": "test-key"}
    cases = []
    for capacity in ("physical_slots", "available_staff", "available_scanners"):
        body = example(); body["scan"][capacity] = 1
        cases.append((body, False, []))
    body = example(); body["budget"]["amount"] = "200.00"
    cases.append((body, False, ["excluded_budget"]))
    body = example(); body["arrivals"]["count"] = 1
    cases.append((body, False, []))
    for body, improved, expected_statuses in cases:
        plan_response = client.post("/v3/plans", json=body, headers=headers)
        assert plan_response.status_code == 201, plan_response.text
        plan = plan_response.json()
        result = client.post(f"/v3/plans/{plan['id']}/optimize", json={}, headers=headers)
        assert result.status_code == 200, result.text
        result = result.json()
        assert result["improved"] is improved
        assert result["candidate_plan_id"] is None
        assert result["best_run_id"] == result["baseline_run_id"]
        assert [e["status"] for e in result["evaluations"] if e["status"] != "completed"] == expected_statuses


def test_repeatability_without_replay(service):
    client, _, _ = service
    headers = {"X-API-Key": "test-key"}
    plan = client.post("/v3/plans", json=example(), headers=headers).json()
    left = client.post(f"/v3/plans/{plan['id']}/simulate", json={}, headers=headers).json()
    right = client.post(f"/v3/plans/{plan['id']}/simulate", json={}, headers=headers).json()
    assert left["output"] == right["output"]
    assert left["snapshot_hash"] == right["snapshot_hash"]


def test_contention_and_real_deadlines(tmp_path):
    import os
    import socket
    import threading
    from concurrent.futures import ThreadPoolExecutor
    from pathlib import Path

    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]
    hook = tmp_path / "hook"; hook.mkdir()
    (hook / "sitecustomize.py").write_text('''import os, pathlib, threading, time
count = 0
target = int(os.environ.get("TRACE_TARGET", "0"))
marker = pathlib.Path(os.environ.get("TRACE_MARKER", "/dev/null"))
release = pathlib.Path(os.environ.get("TRACE_RELEASE", "/dev/null"))
def trace(frame, event, arg):
    global count
    if event == "call" and frame.f_code.co_name == "simulate" and frame.f_code.co_filename.endswith("/engine.py"):
        count += 1
        if target and count == target:
            marker.write_text("entered")
            while not release.exists(): time.sleep(.01)
    return trace
threading.settrace(trace)
''')
    db = tmp_path / "timed.sqlite3"
    base_env = {"PATH": os.environ.get("PATH", ""), "DATABASE_PATH": str(db), "API_KEY": "test-key", "PYTHONPATH": f"{hook}:{Path(__file__).resolve().parents[2] / 'src'}", "TRACE_MARKER": str(tmp_path / "entered"), "TRACE_RELEASE": str(tmp_path / "release")}
    headers = {"X-API-Key": "test-key"}

    def launch(target):
        for path in (tmp_path / "entered", tmp_path / "release"):
            path.unlink(missing_ok=True)
        return subprocess.Popen([sys.executable, "-m", "uvicorn", "algorithm_api.app:app", "--host", "127.0.0.1", "--port", str(port)], cwd=Path(__file__).resolve().parents[2], env={**base_env, "TRACE_TARGET": str(target)}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def wait_marker():
        marker = tmp_path / "entered"
        for _ in range(300):
            if marker.exists(): return
            time.sleep(.01)
        raise AssertionError("simulation barrier was not reached")

    proc = launch(1)
    try:
        client = httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=15)
        for _ in range(100):
            try:
                if client.get("/health").status_code == 200: break
            except httpx.HTTPError: time.sleep(.05)
        plan = client.post("/v3/plans", json=example(), headers=headers).json()
        with ThreadPoolExecutor() as pool:
            pending = pool.submit(client.post, f"/v3/plans/{plan['id']}/simulate", json={}, headers=headers)
            wait_marker()
            assert client.get(f"/v3/plans/{plan['id']}", headers=headers).status_code == 200
            busy = client.post(f"/v3/plans/{plan['id']}/simulate", json={}, headers=headers)
            assert busy.status_code == 429 and busy.headers["Retry-After"] == "1"
            time.sleep(2.1)
            (tmp_path / "release").write_text("go")
            assert pending.result(timeout=5).status_code == 503
        client.close()
    finally:
        proc.terminate(); proc.wait(timeout=3)

    proc = launch(2)
    try:
        client = httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=15)
        for _ in range(100):
            try:
                if client.get("/health").status_code == 200: break
            except httpx.HTTPError: time.sleep(.05)
        plan_id = plan["id"]
        with ThreadPoolExecutor() as pool:
            pending = pool.submit(client.post, f"/v3/plans/{plan_id}/optimize", json={}, headers=headers)
            wait_marker()
            assert client.get(f"/v3/plans/{plan_id}", headers=headers).status_code == 200
            time.sleep(2.1)
            (tmp_path / "release").write_text("go")
            result = pending.result(timeout=5)
        assert result.status_code == 200, result.text
        output = result.json()
        assert output["stop_reason"] == "time_limit"
        assert output["improved"] is False and output["candidate_plan_id"] is None
        assert len(output["evaluations"]) == 1
        client.close()
    finally:
        proc.terminate(); proc.wait(timeout=3)


def test_service_completion_matches_next_arrival(service):
    client, _, _ = service
    headers = {"X-API-Key": "test-key"}
    body = example(); body["arrivals"]["end_seconds"] = 20
    plan = client.post("/v3/plans", json=body, headers=headers).json()
    run = client.post(f"/v3/plans/{plan['id']}/simulate", json={}, headers=headers).json()
    assert run["output"]["scan"]["wait_sample_count"] == 2
    assert run["output"]["scan"]["wait_p90_seconds"] == 0
    assert run["output"]["scan"]["peak_queue"] == 0
    assert run["output"]["population"]["admitted"] == 2
