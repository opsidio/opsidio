"""Opt-in public checks for the approved Phase 2 Railway release."""
import base64
import json
import os
from pathlib import Path

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[2]
CAPTURE = os.environ.get("PHASE2_RELEASE_CAPTURE", "/tmp/phase2-public-capture.json")
PHASE = os.environ.get("PHASE2_RELEASE_PHASE")
ENABLED = os.environ.get("PHASE2_RELEASE_TEST") == "1"


def _client():
    if not os.environ.get("OPSIDIO_URL") or not os.environ.get("OPSIDIO_KEY"):
        pytest.fail("Set OPSIDIO_URL and OPSIDIO_KEY for an enabled public release check")
    return httpx.Client(
        base_url=os.environ["OPSIDIO_URL"].rstrip("/"),
        headers={"X-API-Key": os.environ["OPSIDIO_KEY"]},
        timeout=70,
    )


def _ok(response, status):
    assert response.status_code == status


def _compare_saved_reads(client, state):
    for name, encoded in state["reads"].items():
        response = client.get(state["paths"][name])
        _ok(response, 200)
        assert response.content == base64.b64decode(encoded)


@pytest.mark.skipif(not ENABLED or PHASE != "capture", reason="requires PHASE2_RELEASE_TEST=1 and capture phase")
def test_capture_public_release_workflows():
    headers = {"X-API-Key": os.environ["OPSIDIO_KEY"]}
    client = _client()
    try:
        health = client.get("/health", headers={})
        _ok(health, 200)
        assert health.json() == {"status": "ok"}
        auth = client.get("/v3/plans/pln_missing", headers={"X-API-Key": ""})
        _ok(auth, 401)

        venue_page = client.get("/v4/venue-presets?limit=100")
        step_page = client.get("/v4/step-presets?limit=100")
        _ok(venue_page, 200)
        _ok(step_page, 200)
        assert venue_page.json()["data"] and step_page.json()["data"]

        editable = client.post("/v4/plans", json={})
        _ok(editable, 201)
        editable_id = editable.json()["id"]
        venue_id = venue_page.json()["data"][0]["id"]
        applied_venue = client.post(
            f"/v4/plans/{editable_id}/apply-venue-preset", json={"preset_id": venue_id}
        )
        _ok(applied_venue, 200)
        step_id = step_page.json()["data"][0]["id"]
        applied_step = client.post(
            f"/v4/plans/{editable_id}/apply-step-preset", json={"preset_id": step_id}
        )
        _ok(applied_step, 200)
        readiness = client.post(f"/v4/plans/{editable_id}/validate", json={})
        _ok(readiness, 200)
        created_step = client.post(
            f"/v4/plans/{editable_id}/steps",
            json={"id": "h13-proof", "name": "Release proof", "time_per_person_seconds": {"typical": 30, "slow": 30}},
        )
        _ok(created_step, 201)
        updated_step = client.patch(
            f"/v4/plans/{editable_id}/steps/h13-proof", json={"name": "Updated release proof"}
        )
        _ok(updated_step, 200)
        _ok(client.delete(f"/v4/plans/{editable_id}/steps/h13-proof"), 204)
        created_role = client.post(
            f"/v4/plans/{editable_id}/roles", json={"id": "h13-staff", "name": "Release staff"}
        )
        _ok(created_role, 201)
        _ok(client.patch(f"/v4/plans/{editable_id}/roles/h13-staff", json={"name": "Updated release staff"}), 200)
        _ok(client.delete(f"/v4/plans/{editable_id}/roles/h13-staff"), 204)
        assert client.get(f"/v4/plans/{editable_id}").status_code == 200

        corridor = json.loads((ROOT / "examples" / "corridor-plan.json").read_text())
        corridor_plan = client.post("/v3/plans", headers=headers, json=corridor)
        _ok(corridor_plan, 201)
        corridor_id = corridor_plan.json()["id"]
        corridor_opt = client.post(f"/v3/plans/{corridor_id}/optimize", headers=headers, json={})
        _ok(corridor_opt, 200)
        assert corridor_opt.json()["improved"] is True

        document = json.loads((ROOT / "tests" / "fixtures" / "event-entry" / "reference-plan.json").read_text())
        event_plan = client.post("/v4/plans", json=document)
        _ok(event_plan, 201)
        event_id = event_plan.json()["id"]
        plan_read = client.get(f"/v4/plans/{event_id}")
        _ok(plan_read, 200)
        assert plan_read.json() == event_plan.json()
        assert client.post(f"/v4/plans/{event_id}/validate", json={}).status_code == 200

        flow = client.post(f"/v4/plans/{event_id}/simulate", json={"simulation_method": "flow"})
        _ok(flow, 200)
        des = client.post(f"/v4/plans/{event_id}/simulate", json={"simulation_method": "des"})
        _ok(des, 200)
        assert des.json()["resolved_settings"]["replications"] == 20
        run_id = des.json()["id"]
        run_read = client.get(f"/v4/runs/{run_id}")
        _ok(run_read, 200)
        assert run_read.json() == des.json()

        reads = {
            "v3_plan": ("/v3/plans/pln_47a303dec6254a5d8f29702be09975aa", Path("/tmp/phase2-baseline/plan.json")),
            "v3_run": ("/v3/runs/run_0db7d3fc2ae54495865ae7686fddbff8", Path("/tmp/phase2-baseline/run.json")),
            "v3_optimization": ("/v3/optimizations/opt_dfb11d049c184e5bbcbfa409b4fffeea", Path("/tmp/phase2-baseline/optimization.json")),
            "v4_plan": (f"/v4/plans/{event_id}", None),
            "v4_run": (f"/v4/runs/{run_id}", None),
        }
        saved = {}
        paths = {}
        for name, (path, expected_file) in reads.items():
            response = client.get(path)
            _ok(response, 200)
            if expected_file is not None:
                assert response.content == expected_file.read_bytes()
            paths[name] = path
            saved[name] = base64.b64encode(response.content).decode("ascii")
        Path(CAPTURE).write_text(json.dumps({"paths": paths, "reads": saved}, separators=(",", ":")))
    finally:
        client.close()


@pytest.mark.skipif(not ENABLED or PHASE != "verify", reason="requires PHASE2_RELEASE_TEST=1 and verify phase")
def test_public_reads_survive_same_image_redeployment():
    state = json.loads(Path(CAPTURE).read_text())
    client = _client()
    try:
        health = client.get("/health", headers={})
        _ok(health, 200)
        assert health.json() == {"status": "ok"}
        _compare_saved_reads(client, state)
    finally:
        client.close()
