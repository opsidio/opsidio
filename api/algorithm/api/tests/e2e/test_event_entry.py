import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[2]


def test_event_plan_lifecycle(service):
    client, _, _ = service
    created = client.post("/v4/plans", headers={"X-API-Key": "test-key"}, json={})
    assert created.status_code == 201
    plan = created.json()
    assert plan["document"]["schema_version"] == "0.1"
    assert plan["document"]["meta"]["document"] == "opsidio_event_input"

    fetched = client.get(f"/v4/plans/{plan['id']}", headers={"X-API-Key": "test-key"})
    assert fetched.status_code == 200
    assert fetched.json() == plan


def test_v4_authentication_and_public_health(service):
    client, _, _ = service
    assert client.get("/health").json() == {"status": "ok"}
    response = client.get("/v4/plans")
    assert response.status_code == 401


def test_event_item_edits_keep_ids_and_reject_parent_replacement(service):
    client, _, _ = service
    headers = {"X-API-Key": "test-key"}
    created = client.post("/v4/plans", headers=headers, json={})
    plan_id = created.json()["id"]

    step = client.post(
        f"/v4/plans/{plan_id}/steps",
        headers=headers,
        json={"id": "scan", "name": "Scan", "time_per_person_seconds": {"typical": 10, "slow": 10}},
    )
    assert step.status_code == 201
    changed = client.patch(f"/v4/plans/{plan_id}/steps/scan", headers=headers, json={"id": "other"})
    assert changed.status_code == 422

    replacement = client.patch(
        f"/v4/plans/{plan_id}", headers=headers, json={"process_steps": {"steps": []}}
    )
    assert replacement.status_code == 422


def test_event_plan_survives_process_restart(tmp_path):
    database = tmp_path / "restart.sqlite3"
    env = {
        "PATH": os.environ.get("PATH", ""),
        "DATABASE_PATH": str(database),
        "API_KEY": "test-key",
        "PYTHONPATH": str(ROOT / "src"),
    }

    def start():
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        process = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "algorithm_api.app:app", "--host", "127.0.0.1", "--port", str(port)],
            cwd=ROOT,
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        client = httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=5)
        for _ in range(100):
            if process.poll() is not None:
                raise AssertionError("service exited during startup")
            try:
                if client.get("/health").status_code == 200:
                    return process, client
            except httpx.HTTPError:
                time.sleep(0.05)
        process.terminate()
        raise AssertionError("service did not start")

    process, client = start()
    try:
        created = client.post("/v4/plans", headers={"X-API-Key": "test-key"}, json={})
        assert created.status_code == 201
        plan = created.json()
    finally:
        client.close()
        process.terminate()
        process.wait(timeout=5)

    process, client = start()
    try:
        fetched = client.get(f"/v4/plans/{plan['id']}", headers={"X-API-Key": "test-key"})
        assert fetched.status_code == 200
        assert fetched.json() == plan
    finally:
        client.close()
        process.terminate()
        process.wait(timeout=5)


def test_presets_and_readiness_are_http_resources(service):
    client, _, _ = service
    headers = {"X-API-Key": "test-key"}
    page = client.get("/v4/step-presets?limit=100", headers=headers)
    assert page.status_code == 200
    step_ids = {item["id"] for item in page.json()["data"]}
    assert step_ids == {
        "body_search", "ktp_name_match", "eticket_scan", "wristband_fit",
        "locker_dropoff", "assisted_entry", "help_desk_resolution",
        "wristband_check", "bag_check",
    }

    created = client.post("/v4/plans", headers=headers, json={})
    plan_id = created.json()["id"]
    validation = client.post(f"/v4/plans/{plan_id}/validate", headers=headers, json={})
    assert validation.status_code == 200
    assert validation.json()["valid"] is False

    applied = client.post(
        f"/v4/plans/{plan_id}/apply-step-preset", headers=headers, json={"preset_id": "eticket_scan"}
    )
    assert applied.status_code == 200
    duplicate = client.post(
        f"/v4/plans/{plan_id}/apply-step-preset", headers=headers, json={"preset_id": "eticket_scan"}
    )
    assert duplicate.status_code == 409


def test_v3_and_v4_resources_stay_in_separate_namespaces(service):
    client, _, _ = service
    headers = {"X-API-Key": "test-key"}
    corridor = json.loads((ROOT / "examples" / "corridor-plan.json").read_text())
    v3_plan = client.post("/v3/plans", headers=headers, json=corridor)
    assert v3_plan.status_code == 201
    event_plan = client.post("/v4/plans", headers=headers, json={})
    assert event_plan.status_code == 201

    assert client.get(f"/v4/plans/{v3_plan.json()['id']}", headers=headers).status_code == 404
    assert client.get(f"/v3/plans/{event_plan.json()['id']}", headers=headers).status_code == 404
    assert client.get("/docs").status_code == 404
    assert client.get("/v4/plans", headers=headers).json()["data"] == [event_plan.json()]


def test_simulation_method_is_required_and_extensions_are_rejected(service):
    client, _, _ = service
    headers = {"X-API-Key": "test-key"}
    created = client.post("/v4/plans", headers=headers, json={})
    plan_id = created.json()["id"]

    for settings, field in (({}, "simulation_method"), ({"simulation_method": "abm"}, "simulation_method"),
                            ({"simulation_method": "flow", "spatial": {}}, "spatial"),
                            ({"simulation_method": "flow", "unknown": True}, "unknown")):
        response = client.post(f"/v4/plans/{plan_id}/simulate", headers=headers, json=settings)
        assert response.status_code == 422
        assert field in str(response.json())


def test_unsupported_methods_return_allow_header(service):
    client, _, _ = service
    response = client.request("TRACE", "/v4/plans", headers={"X-API-Key": "test-key"})
    assert response.status_code == 405
    assert response.headers["allow"]
