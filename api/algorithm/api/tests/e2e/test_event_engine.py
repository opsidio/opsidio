import json
from copy import deepcopy
import time
from pathlib import Path

import pytest

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "event-entry" / "reference-plan.json"


def test_flow_and_des_return_computed_reports_over_http(service):
    client, _, _ = service
    headers = {"X-API-Key": "test-key"}
    document = json.loads(FIXTURE.read_text())
    for index, category in enumerate(document["event"]["ticket_categories"]):
        category["sold"] = 2 if index == 0 else 0
        category["issued"] = 0
    document["event"]["capacity"]["no_show_percent_estimate"] = 0
    created = client.post("/v4/plans", headers=headers, json=document)
    assert created.status_code == 201
    plan_id = created.json()["id"]

    for method, settings in (("flow", {"simulation_method": "flow"}), ("des", {"simulation_method": "des", "replications": 1, "base_seed": 42})):
        response = client.post(f"/v4/plans/{plan_id}/simulate", headers=headers, json=settings)
        assert response.status_code == 200, response.text
        run = response.json()
        assert run["simulation_method"] == method
        assert run["snapshot_document"] == document
        assert run["output"]["meta"]["example"] is False
        assert run["output"]["entry_outcomes"]["attendance_persons"]["mean"] == 2
        assert run["output"]["run_manifest"]["quality_checks"][0]["status"] == "pass"
        assert {
            "run_manifest", "scorecard", "known_problem_checks", "time_to_clear",
            "max_queue_length", "wait_time", "staff_utilization", "staffing_cost",
            "peak_density", "bottleneck_report", "entry_outcomes", "support_services",
            "stock_check", "arrival_and_access",
        } <= run["output"].keys()
        if method == "des":
            expected = deepcopy(run["output"])
            for field in ("run_id", "plan_id", "created_at"):
                expected["run_manifest"].pop(field, None)
            repeated = client.post(
                f"/v4/plans/{plan_id}/simulate", headers=headers, json=settings
            )
            assert repeated.status_code == 200
            actual = repeated.json()["output"]
            for field in ("run_id", "plan_id", "created_at"):
                actual["run_manifest"].pop(field, None)
            assert actual == expected


@pytest.mark.parametrize("method,replications", [("flow", 1), ("des", 20)])
def test_reference_workload_flow_and_default_des_fit_deadline(service, method, replications):
    client, _, _ = service
    headers = {"X-API-Key": "test-key"}
    document = json.loads(FIXTURE.read_text())
    holders = sum(item.get("sold", 0) + item.get("issued", 0) for item in document["event"]["ticket_categories"])
    assert holders == 3532
    created = client.post("/v4/plans", headers=headers, json=document)
    assert created.status_code == 201
    plan_id = created.json()["id"]

    started = time.monotonic()
    response = client.post(
        f"/v4/plans/{plan_id}/simulate", headers=headers, json={"simulation_method": method}
    )
    elapsed = time.monotonic() - started
    assert response.status_code == 200, f"{method} took {elapsed:.3f}s: {response.text}"
    assert elapsed <= 60
    run = response.json()
    assert run["resolved_settings"]["replications"] == replications
    assert run["output"]["meta"]["example"] is False
    assert run["output"]["run_manifest"]["quality_checks"][0]["status"] == "pass"
