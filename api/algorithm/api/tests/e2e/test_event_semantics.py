"""Check event-entry semantics through a real subprocess HTTP service."""

from copy import deepcopy
import json
from pathlib import Path
from statistics import mean

import pytest

HEADERS = {"X-API-Key": "test-key"}
GROUP = "gate/general"


@pytest.fixture
def document():
    return {
        "schema_version": "0.1", "meta": {"document": "opsidio_event_input", "currency": "IDR"},
        "event": {"id": "semantic-case", "date": "2026-11-27",
                  "schedule": {"redemption_open": "16:00", "outer_area_open": "16:00", "doors_open": "17:00",
                               "opening_act": "17:30", "main_act": "18:00", "redemption_close": "19:00",
                               "last_entry": "19:00", "show_end_estimate": "20:00"},
                  "capacity": {"configured_capacity": 100, "no_show_percent_estimate": 0},
                  "ticket_categories": [{"id": "festival_a", "admission": "standing", "sold": 6,
                                         "quota": 100, "price_idr": 1000, "entry_gate": "gate"}],
                  "audience_profile": {"female_percent": 100, "visitors_with_bag_percent": 0,
                                       "visitors_using_locker_percent": 0, "accessible_visitors_percent": 0}},
        "venue": {"layout": {
            "zones": [{"id": "zone_drop_off", "type": "drop_off"},
                      {"id": "zone_forecourt", "type": "holding", "area_m2": 20},
                      {"id": "zone_queue", "type": "queue", "area_m2": 20},
                      {"id": "zone_festival_a", "type": "standing", "area_m2": 20}],
            "service_points": [{"id": "redemption", "opens": "16:00", "closes": "19:00", "max_lanes": 1,
                                "queue_zone": "zone_forecourt", "lanes": [{"group": "general", "count": 1,
                                "steps": ["eticket_scan"], "serves_categories": ["festival_a"]}]}],
            "gates": [{"id": "gate", "opens": "17:00", "closes": "19:00", "max_lanes": 4,
                       "queue_zone": "zone_queue", "leads_to": ["zone_festival_a"], "serves_categories": ["festival_a"],
                       "lanes": [{"group": "general", "count": 1, "steps": ["wristband_check"]}]}],
            "walking_paths": [{"from": "redemption", "to": "gate", "distance_m": 0}],
            "visitor_flow": [{"order": 1, "point": "redemption", "required": True},
                             {"order": 2, "point": "entry_gate_of_category", "required": True}]},
                  "known_problems": []},
        "process_steps": {"steps": [{"id": sid, "applies_to": "all_visitors", "exceptions": [],
                                     "time_per_person_seconds": {"typical": duration, "slow": duration}}
                                    for sid, duration in [("eticket_scan", 0), ("wristband_check", 60)]]},
        "staff": {"meal_allowance_idr_per_person": 10,
                  "shifts": [{"id": "shift", "start": "16:00", "end": "19:00"}],
                  "roles": [{"id": rid, "count": 1, "gender": {"female": 1, "male": 0}, "shift": "shift",
                             "can_do": [sid], "rate_idr_per_shift": 100, "overtime_idr_per_hour": 30,
                             "assignment": [{"point": point, "lane_group": "general", "per_lane": 1, "count": 1}]}
                            for rid, sid, point in [("redemption_staff", "eticket_scan", "redemption"),
                                                    ("gate_staff", "wristband_check", "gate")]]},
        "constraints": {"timing": {"venue_slot_end": "20:00"},
                        "budget": {"staff_cap_idr": 1000, "equipment_cap_idr": 1000},
                        "service_targets": {"gate_wait": {"max_minutes": 20, "for_share_of_visitors_percent": 90}},
                        "equipment": {"items": []}},
        "demand": {"arrival_windows_percent": {"festival_a": {"16:59-17:00": 100}},
                   "gate_join_windows": {"festival_a": "after_redemption"}, "group_size_share_percent": {"1": 100}},
        "sources": {},
    }


def simulate(service, document, method="flow", **settings):
    client, _, _ = service
    created = client.post("/v4/plans", headers=HEADERS, json=document)
    assert created.status_code == 201, created.text
    response = client.post(f"/v4/plans/{created.json()['id']}/simulate", headers=HEADERS,
                           json={"simulation_method": method, **({"replications": 1, "base_seed": 42} if method == "des" else {}), **settings})
    assert response.status_code == 200, response.text
    run = response.json()
    outcomes = run["output"]["entry_outcomes"]
    assert outcomes["attendance_persons"]["mean"] == pytest.approx(
        outcomes["admitted_persons"]["mean"] + outcomes["refused_persons"] + outcomes["still_outside_at_end_persons"], abs=1e-8, rel=1e-10)
    return run


def row(output, section, collection, key, value):
    return next(item for item in output[section][collection] if item[key] == value)


def gate_wait(output):
    return row(output, "wait_time", "by_lane_group", "lane_group", GROUP)


def add_gate_lane(document, count):
    document["venue"]["layout"]["gates"][0]["lanes"][0]["count"] = count
    role = document["staff"]["roles"][1]
    role["count"] = role["gender"]["female"] = role["assignment"][0]["count"] = count


def normalized(run):
    output = deepcopy(run["output"])
    for field in ("run_id", "plan_id", "created_at"):
        output["run_manifest"].pop(field, None)
    return output


def test_computed_flow(service, document):
    first = simulate(service, document)
    output = first["output"]
    lane = row(output, "max_queue_length", "lane_groups", "lane_group", GROUP)
    assert lane["capacity_per_lane_per_minute"] == pytest.approx(1)
    assert lane["max_persons"]["mean"] == 6
    assert gate_wait(output)["max_minutes"]["mean"] == 5
    assert normalized(simulate(service, document)) == normalized(first)
    curves = row(output, "arrival_and_access", "flow_curves", "lane_group", GROUP)
    assert curves["interval_minutes"] == 1
    times = [int(item["time"][:2]) * 60 + int(item["time"][3:]) for item in curves["series"]]
    assert all(b - a == 1 for a, b in zip(times, times[1:]))
    assert curves["series"][-1]["service_starts"] == 6
    extra_lane = deepcopy(document)
    add_gate_lane(extra_lane, 2)
    assert gate_wait(simulate(service, extra_lane)["output"])["mean_minutes"] < gate_wait(output)["mean_minutes"]
    document["event"]["ticket_categories"][0]["sold"] = 12
    doubled = simulate(service, document)["output"]
    assert gate_wait(doubled)["max_minutes"]["mean"] > gate_wait(output)["max_minutes"]["mean"]
    assert row(doubled, "max_queue_length", "lane_groups", "lane_group", GROUP)["max_persons"]["mean"] > 6


def test_fractional_flow_attendance(service, document):
    document["event"]["ticket_categories"][0]["sold"] = 3
    document["event"]["capacity"]["no_show_percent_estimate"] = 25
    outcomes = simulate(service, document)["output"]["entry_outcomes"]
    assert outcomes["attendance_persons"] == {"mean": 2.25, "p05": 2.25, "p95": 2.25}
    assert outcomes["admitted_persons"]["mean"] == pytest.approx(2.25)


def test_seeded_des_and_fcfs(service, document):
    document["event"]["ticket_categories"][0]["sold"] = 2
    document["demand"]["group_size_share_percent"] = {"2": 100}
    first = simulate(service, document, "des")
    repeated = simulate(service, document, "des")
    assert first["snapshot_hash"] == repeated["snapshot_hash"]
    assert normalized(first) == normalized(repeated)
    wait = gate_wait(first["output"])
    assert wait["mean_minutes"] == pytest.approx(.5)
    assert wait["max_minutes"]["mean"] == pytest.approx(1)
    assert wait["p90_minutes"]["mean"] == pytest.approx(1)
    add_gate_lane(document, 2)
    second = simulate(service, document, "des")
    assert second["output"]["entry_outcomes"]["attendance_persons"] == first["output"]["entry_outcomes"]["attendance_persons"]
    assert gate_wait(second["output"])["max_minutes"]["mean"] == 0


def test_stable_id_tie_breaker_is_visible_in_category_waits(service, document):
    categories = []
    for category_id in ("a_first", "z_second"):
        categories.append({"id": category_id, "admission": "standing", "sold": 1,
                           "quota": 10, "price_idr": 1000, "entry_gate": "gate"})
    document["event"]["ticket_categories"] = categories
    for point in document["venue"]["layout"]["service_points"] + document["venue"]["layout"]["gates"]:
        point["serves_categories"] = ["a_first", "z_second"]
        for lane in point["lanes"]:
            lane["serves_categories"] = ["a_first", "z_second"]
    document["demand"]["arrival_windows_percent"] = {
        "a_first": {"16:59-17:00": 100}, "z_second": {"16:59-17:00": 100}
    }
    document["demand"]["gate_join_windows"] = {"a_first": "after_redemption", "z_second": "after_redemption"}
    output = simulate(service, document, "des")["output"]
    gate_waits = {item["category"]: item["gate_p90_minutes"]["mean"]
                  for item in output["wait_time"]["by_category"]}
    assert gate_waits == {"a_first": 0, "z_second": 1}


def test_seeded_category_attendance_survives_lane_count_change(service, document):
    category_ids = ("a_first", "z_second")
    document["event"]["ticket_categories"] = [
        {"id": category_id, "admission": "standing", "sold": 100,
         "quota": 200, "price_idr": 1000, "entry_gate": "gate"}
        for category_id in category_ids
    ]
    document["event"]["capacity"]["no_show_percent_estimate"] = 30
    document["demand"]["arrival_windows_percent"] = {
        category_id: {"16:59-17:00": 100} for category_id in category_ids
    }
    document["demand"]["gate_join_windows"] = {
        category_id: "after_redemption" for category_id in category_ids
    }
    for point in document["venue"]["layout"]["service_points"] + document["venue"]["layout"]["gates"]:
        point["serves_categories"] = list(category_ids)
        for lane in point["lanes"]:
            lane["serves_categories"] = list(category_ids)
    first = simulate(service, document, "des")["output"]["entry_outcomes"]["by_category"]
    add_gate_lane(document, 2)
    second = simulate(service, document, "des")["output"]["entry_outcomes"]["by_category"]
    first_attendance = {item["category"]: item["attending_persons"] for item in first}
    second_attendance = {item["category"]: item["attending_persons"] for item in second}
    assert first_attendance == second_attendance


@pytest.mark.parametrize("replications", [0, 101])
def test_des_replication_limits(service, document, replications):
    client, _, _ = service
    plan = client.post("/v4/plans", headers=HEADERS, json=document).json()
    response = client.post(f"/v4/plans/{plan['id']}/simulate", headers=HEADERS,
                           json={"simulation_method": "des", "replications": replications})
    assert response.status_code == 422, response.text
    assert response.json()["error"]["details"]


def test_des_defaults_and_replication_statistics(service, document):
    document["event"]["capacity"]["no_show_percent_estimate"] = 50
    client, _, _ = service
    plan = client.post("/v4/plans", headers=HEADERS, json=document).json()
    default = client.post(f"/v4/plans/{plan['id']}/simulate", headers=HEADERS, json={"simulation_method": "des"})
    assert default.status_code == 200, default.text
    assert default.json()["resolved_settings"] == {"simulation_method": "des", "replications": 20, "base_seed": 20261127}
    samples = [simulate(service, document, "des", base_seed=seed)["output"]["entry_outcomes"]["attendance_persons"]["mean"] for seed in range(42, 46)]
    assert len(set(samples)) > 1
    combined = simulate(service, document, "des", replications=4)["output"]["entry_outcomes"]["attendance_persons"]
    ordered = sorted(samples)
    assert combined == pytest.approx({"mean": mean(samples), "p05": ordered[0] + .15 * (ordered[1] - ordered[0]),
                                      "p95": ordered[2] + .85 * (ordered[3] - ordered[2])})
    assert simulate(service, document, "des", replications=100)["resolved_settings"]["replications"] == 100


@pytest.mark.parametrize("method", ["flow", "des"])
def test_positions_and_resources(service, document, method):
    add_gate_lane(document, 3)
    document["venue"]["layout"]["gates"][0]["lanes"][0]["equipment_per_lane"] = {"handheld_scanner": 1}
    document["constraints"]["equipment"]["items"] = [{"id": "handheld_scanner", "available": 2}]
    output = simulate(service, document, method)["output"]
    lane = row(output, "max_queue_length", "lane_groups", "lane_group", GROUP)
    assert (lane["requested_lanes"], lane["operational_lanes"]) == (3, 2)
    assert output["run_manifest"]["resource_shortfalls"]
    assert output["staffing_cost"]["total_idr"] == 440
    assert row(output, "stock_check", "items", "item", "handheld_scanner")["used"] == 2
    document["constraints"]["equipment"]["items"][0]["available"] = 0
    zero = simulate(service, document, method)["output"]["entry_outcomes"]
    assert zero["admitted_persons"]["mean"] == 0
    assert zero["refused_persons"] == 6


def support_point(document, point, sid):
    layout = document["venue"]["layout"]
    layout["service_points"].append({"id": point, "opens": "16:00", "closes": "19:00", "max_lanes": 1,
                                     "lanes": [{"group": "general", "count": 1, "steps": [sid]}]})
    layout["walking_paths"].extend({"from": origin, "to": point, "distance_m": 60} for origin in ("redemption", "gate"))
    document["process_steps"]["steps"].append({"id": sid, "applies_to": "all_visitors",
                                                "time_per_person_seconds": {"typical": 60, "slow": 60}})
    document["staff"]["roles"].append({"id": point + "_staff", "count": 1, "gender": {"female": 1},
                                        "shift": "shift", "can_do": [sid], "assignment": [
                                            {"point": point, "lane_group": "general", "per_lane": 1, "count": 1}]})
    if point == "help_desk":
        layout["exceptions_go_to"] = point


@pytest.mark.parametrize("method", ["flow", "des"])
@pytest.mark.parametrize("outcome", ["continue", "secondary_check", "step_aside_and_return", "help_desk",
                                     "locker_point", "redirect_to_correct_gate", "back_to_redemption", "refuse_entry"])
def test_exception_paths_and_support(service, document, method, outcome):
    document["event"]["ticket_categories"][0]["sold"] = 1
    document["process_steps"]["steps"][1]["exceptions"] = [
        {"id": "forced", "share_percent": 100, "outcome": outcome, "extra_minutes": 1}]
    if outcome == "help_desk":
        support_point(document, "help_desk", "help_desk_resolution")
    elif outcome == "locker_point":
        support_point(document, "locker_point", "locker_dropoff")
        document["constraints"]["equipment"]["items"] = [{"id": "locker_unit", "available": 1}]
    output = simulate(service, document, method)["output"]
    result = output["entry_outcomes"]
    if outcome in ("continue", "secondary_check"):
        assert result["admitted_persons"]["mean"] == 1
        assert output["wait_time"]["service"]["person_minutes"] == pytest.approx(2)
    elif outcome == "refuse_entry":
        assert result["refused_persons"] == 1
        assert result["refused_by_reason"][0]["reason"] == "forced"
    else:
        assert result["admitted_persons"]["mean"] == 0
        assert result["refused_persons"] + result["still_outside_at_end_persons"] == 1
        if outcome == "help_desk":
            assert output["support_services"]["help_desk"]["resolved_persons"] > 0
        elif outcome == "locker_point":
            assert output["support_services"]["locker"]["demand_persons"] > 0


@pytest.mark.parametrize("method", ["flow", "des"])
def test_closing_shift_and_horizon(service, document, method):
    document["event"]["ticket_categories"][0]["sold"] = 2
    document["demand"]["group_size_share_percent"] = {"2": 100}
    document["venue"]["layout"]["gates"][0]["closes"] = "17:01"
    document["staff"]["shifts"][0]["end"] = "17:00"
    output = simulate(service, document, method)["output"]
    result = output["entry_outcomes"]
    assert result["admitted_persons"]["mean"] == 1
    assert result["refused_persons"] == 1
    assert result["refused_by_reason"][0]["reason"] == "last_entry_passed"
    assert output["staffing_cost"]["overtime"]["hours"] == 1
    assert output["staffing_cost"]["components_idr"]["overtime"] == 30
    assert output["staffing_cost"]["total_idr"] == 250
    document["constraints"]["timing"]["venue_slot_end"] = "17:00"
    unfinished = simulate(service, document, method)["output"]["entry_outcomes"]
    assert unfinished["admitted_persons"]["mean"] == 0
    assert unfinished["still_outside_at_end_persons"] == 2


@pytest.mark.parametrize("method", ["flow", "des"])
def test_report_semantics(service, document, method):
    document["event"]["ticket_categories"][0]["sold"] = 10
    document["venue"]["known_problems"] = [{"id": "attendance", "conditions": [
        {"metric": "entry_outcomes.attendance_persons", "operator": "gte", "value": 10}],
        "result_template": "Attendance: {entry_outcomes.attendance_persons}."}]
    output = simulate(service, document, method)["output"]
    assert {"meta", "run_manifest", "scorecard", "known_problem_checks", "time_to_clear", "max_queue_length", "wait_time",
            "staff_utilization", "staffing_cost", "peak_density", "bottleneck_report", "entry_outcomes",
            "support_services", "stock_check", "arrival_and_access", "sources"} <= output.keys()
    assert output["meta"]["example"] is False
    density = row(output, "peak_density", "zones", "zone", "zone_festival_a")
    assert density["peak_persons_per_m2"]["mean"] == pytest.approx(.5)
    assert "Aggregate" in output["peak_density"]["limitation"]
    assert output["staffing_cost"]["components_idr"] == {
        "shift_rates": 200, "overtime": 0, "meal_allowance": 20, "medical_package": 0}
    assert output["staffing_cost"]["gross_ticket_sales_idr"] == 10000
    assert output["known_problem_checks"]["checks"][0]["risk"] == "medium"
    assert output["known_problem_checks"]["checks"][0]["result"] in ("Attendance: 10.", "Attendance: 10.0.")
    assert output["peak_density"]["open_air_exposure"]["with_rain_plan_persons"] is None
    assert "peak_density.open_air_exposure.with_rain_plan_persons" in output["run_manifest"]["uncomputed_fields"]
    assert all(item["moves_to"] is None for item in output["bottleneck_report"]["episodes"])
    if method == "flow":
        assert output["wait_time"]["by_category"][0]["all_queues_p90_minutes"] is None
        check_intervals(output)


def check_intervals(value):
    if isinstance(value, dict):
        if set(value) == {"mean", "p05", "p95"}:
            assert value["mean"] == value["p05"] == value["p95"]
        for child in value.values():
            check_intervals(child)
    elif isinstance(value, list):
        for child in value:
            check_intervals(child)


def ordered_positions(document, first=10, second=180):
    gate = document["venue"]["layout"]["gates"][0]
    gate["lanes"][0]["steps"] = ["wristband_check", "second_check"]
    document["process_steps"]["steps"][1]["time_per_person_seconds"] = {"typical": first, "slow": first}
    document["process_steps"]["steps"].append({"id": "second_check", "applies_to": "all_visitors",
                                                "time_per_person_seconds": {"typical": second, "slow": second}})
    role = document["staff"]["roles"][1]
    role["can_do"].append("second_check")
    role["count"] = role["gender"]["female"] = role["assignment"][0]["per_lane"] = role["assignment"][0]["count"] = 2


def test_ordered_positions_have_one_internal_waiting_place(service, document):
    document["event"]["ticket_categories"][0]["sold"] = 4
    document["demand"]["group_size_share_percent"] = {"4": 100}
    ordered_positions(document)
    output = simulate(service, document, "des")["output"]
    positions = row(output, "max_queue_length", "lane_groups", "lane_group", GROUP)["positions"]
    assert [item["steps"] for item in positions] == [["wristband_check"], ["second_check"]]
    assert [item["servers"] for item in positions] == [1, 1]
    assert gate_wait(output)["max_minutes"]["mean"] == pytest.approx(190 / 60)
    assert output["entry_outcomes"]["admitted_persons"]["mean"] == 4


@pytest.mark.parametrize("method", ["flow", "des"])
def test_inventory_is_shared_between_overlapping_points(service, document, method):
    for point in document["venue"]["layout"]["service_points"] + document["venue"]["layout"]["gates"]:
        point["lanes"][0]["equipment_per_lane"] = {"handheld_scanner": 1}
    document["constraints"]["equipment"]["items"] = [{"id": "handheld_scanner", "available": 1}]
    output = simulate(service, document, method)["output"]
    groups = output["max_queue_length"]["lane_groups"]
    assert sum(item["operational_lanes"] for item in groups) == 1
    assert output["entry_outcomes"]["admitted_persons"]["mean"] == 0
    assert row(output, "stock_check", "items", "item", "handheld_scanner")["used"] == 1


@pytest.mark.parametrize("failure", ["gender", "certification"])
@pytest.mark.parametrize("method", ["flow", "des"])
def test_ineligible_security_cannot_serve(service, document, method, failure):
    step = document["process_steps"]["steps"][1]
    step["id"] = "body_search"
    gate = document["venue"]["layout"]["gates"][0]
    gate["lanes"][0].update(steps=["body_search"], visitor_gender="female")
    role = document["staff"]["roles"][1]
    role.update(can_do=["body_search"], certification="Gada Pratama")
    if failure == "gender":
        role["gender"] = {"female": 0, "male": 1}
    else:
        role.pop("certification")
    output = simulate(service, document, method)["output"]
    assert row(output, "max_queue_length", "lane_groups", "lane_group", GROUP)["operational_lanes"] == 0
    assert output["entry_outcomes"]["admitted_persons"]["mean"] == 0
    assert output["entry_outcomes"]["refused_persons"] == 6


def test_invalid_position_capabilities_block_simulation(service, document):
    document["staff"]["roles"][1]["can_do"] = ["eticket_scan"]
    client, _, _ = service
    plan = client.post("/v4/plans", headers=HEADERS, json=document)
    assert plan.status_code == 201, plan.text
    response = client.post(f"/v4/plans/{plan.json()['id']}/simulate", headers=HEADERS,
                           json={"simulation_method": "des"})
    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "plan_invalid"
    assert response.json()["error"]["details"][0]["field"] == "venue.layout.gates[gate].lanes[general]"
    readiness = client.post(f"/v4/plans/{plan.json()['id']}/validate", headers=HEADERS)
    assert readiness.status_code == 200, readiness.text
    assert any(issue["code"] == "no_valid_position_split" for issue in readiness.json()["issues"])


@pytest.mark.parametrize("method", ["flow", "des"])
@pytest.mark.parametrize("resolved", [0, 100])
def test_help_desk_resolution_and_walking(service, document, method, resolved):
    document["event"]["ticket_categories"][0]["sold"] = 1
    document["process_steps"]["steps"][0]["exceptions"] = [
        {"id": "invalid_ticket", "share_percent": 100, "outcome": "help_desk", "extra_minutes": 0}]
    support_point(document, "help_desk", "help_desk_resolution")
    document["process_steps"]["steps"][-1]["results"] = {"resolved_percent": resolved, "refused_percent": 100 - resolved}
    output = simulate(service, document, method)["output"]
    support = output["support_services"]["help_desk"]
    assert support["cases"]["mean"] == 1
    assert support["resolved_persons"] == resolved / 100
    assert support["refused_persons"] == 1 - resolved / 100
    assert output["entry_outcomes"]["admitted_persons"]["mean"] == resolved / 100
    assert output["wait_time"]["walking"]["person_minutes"] == (2 if resolved else 1)
    if not resolved:
        assert output["entry_outcomes"]["refused_by_reason"][0]["reason"] == "invalid_ticket"


@pytest.mark.parametrize("method", ["flow", "des"])
def test_locker_exhaustion_delays_but_conserves_visitors(service, document, method):
    document["event"]["ticket_categories"][0]["sold"] = 2
    document["event"]["audience_profile"]["visitors_using_locker_percent"] = 100
    support_point(document, "locker_point", "locker_dropoff")
    document["constraints"]["equipment"]["items"] = [{"id": "locker_unit", "available": 1}]
    output = simulate(service, document, method)["output"]
    locker = output["support_services"]["locker"]
    assert locker["demand_persons"] == 2
    assert locker["turned_away_persons"]["mean"] == 1
    assert locker["full_at"] is not None
    assert output["entry_outcomes"]["admitted_persons"]["mean"] == 2
    assert row(output, "stock_check", "items", "item", "locker_unit")["used"] == 1
    document["constraints"]["timing"]["venue_slot_end"] = "17:05"
    early = simulate(service, document, method)["output"]["entry_outcomes"]
    assert early["admitted_persons"]["mean"] == 1
    assert early["still_outside_at_end_persons"] == 1
    assert early["unfinished_states"]["item_removal"] == 1


@pytest.mark.parametrize("method", ["flow", "des"])
def test_internal_service_finishes_after_close(service, document, method):
    document["event"]["ticket_categories"][0]["sold"] = 1
    ordered_positions(document, 60, 60)
    document["venue"]["layout"]["gates"][0]["closes"] = "17:01"
    output = simulate(service, document, method)["output"]
    assert output["entry_outcomes"]["admitted_persons"]["mean"] == 1
    assert output["entry_outcomes"]["refused_persons"] == 0
    assert output["wait_time"]["service"]["person_minutes"] == 2


@pytest.mark.parametrize("method", ["flow", "des"])
def test_arrival_at_closing_is_refused(service, document, method):
    document["event"]["ticket_categories"][0]["sold"] = 1
    document["demand"]["arrival_windows_percent"]["festival_a"] = {"17:01-17:02": 100}
    document["venue"]["layout"]["gates"][0]["closes"] = "17:01"
    output = simulate(service, document, method)["output"]
    assert output["entry_outcomes"]["admitted_persons"]["mean"] == 0
    assert output["entry_outcomes"]["refused_persons"] == 1
    assert output["entry_outcomes"]["refused_by_reason"][0]["reason"] == "last_entry_passed"
    assert output["wait_time"]["service"]["person_minutes"] == 0


@pytest.mark.parametrize("method", ["flow", "des"])
def test_shift_start_holds_service(service, document, method):
    document["event"]["ticket_categories"][0]["sold"] = 1
    document["staff"]["shifts"].append({"id": "late", "start": "17:05", "end": "19:00"})
    document["staff"]["roles"][1]["shift"] = "late"
    output = simulate(service, document, method)["output"]
    assert gate_wait(output)["mean_minutes"] == 5
    assert output["entry_outcomes"]["admitted_persons"]["mean"] == 1


@pytest.mark.parametrize("method", ["flow", "des"])
def test_declared_packages_meals_and_rental_costs(service, document, method):
    document["staff"]["roles"].append({"id": "medical", "count": 2, "gender": {"female": 2},
                                        "shift": "shift", "cost_model": "package", "package_idr": 500,
                                        "meals_included_in_package": True,
                                        "assignment": [{"point": "zone_forecourt", "duty": "medical", "count": 2}]})
    document["constraints"]["equipment"]["items"] = [
        {"id": "handheld_scanner", "available": 1, "committed_cost_idr": 200,
         "extra_rented": 2, "extra_cost_idr_per_unit": 30}]
    output = simulate(service, document, method)["output"]
    assert output["staffing_cost"]["components_idr"] == {
        "shift_rates": 200, "medical_package": 500, "meal_allowance": 20, "overtime": 0}
    assert output["staffing_cost"]["total_idr"] == 720
    assert output["stock_check"]["equipment_cost_idr"] == 260


@pytest.mark.parametrize("method", ["flow", "des"])
def test_repeated_return_is_unfinished_at_horizon(service, document, method):
    document["event"]["ticket_categories"][0]["sold"] = 1
    document["constraints"]["timing"]["venue_slot_end"] = "17:05"
    document["process_steps"]["steps"][1]["exceptions"] = [
        {"id": "retry", "share_percent": 100, "outcome": "step_aside_and_return", "extra_minutes": 1}]
    result = simulate(service, document, method)["output"]["entry_outcomes"]
    assert result["admitted_persons"]["mean"] == result["refused_persons"] == 0
    assert result["still_outside_at_end_persons"] == 1
    assert sum(result["unfinished_states"].values()) == 1


@pytest.mark.parametrize("method", ["flow", "des"])
def test_accessible_priority_escort_and_destination_holding(service, document, method):
    document["event"]["ticket_categories"][0]["sold"] = 1
    document["event"]["audience_profile"]["accessible_visitors_percent"] = 100
    layout = document["venue"]["layout"]
    priority = deepcopy(layout["gates"][0])
    priority.update(id="gate_priority", also_serves="accessible_visitors", leads_to=["zone_inner_concourse", "zone_platform"])
    priority["lanes"][0]["steps"] = ["assisted_entry", "wristband_check"]
    layout["gates"].append(priority)
    layout["zones"].extend([{"id": "zone_inner_concourse", "type": "holding", "area_m2": 20},
                            {"id": "zone_platform", "type": "seating", "area_m2": 20, "wheelchair_places": 1}])
    layout["walking_paths"].append({"from": "redemption", "to": "gate_priority", "distance_m": 0})
    document["process_steps"]["steps"].append({"id": "assisted_entry", "applies_to": "accessible_visitors",
                                                "time_per_person_seconds": {"typical": 60, "slow": 60}})
    normal = deepcopy(document["staff"]["roles"][1])
    normal.update(id="priority_staff")
    normal["assignment"][0]["point"] = "gate_priority"
    escort = deepcopy(normal)
    escort.update(id="escort_staff", can_do=["assisted_entry"], assignment=[{"point": "gate_priority", "duty": "escort", "count": 1}])
    document["staff"]["roles"].extend([normal, escort])
    output = simulate(service, document, method)["output"]
    access = output["support_services"]["accessible_entry"]
    assert access["point"] == "gate_priority"
    assert access["escorted_visitors"] == 1
    assert access["wheelchair_places_needed"]["mean"] == access["wheelchair_places_available"] == 1
    assert output["entry_outcomes"]["admitted_persons"]["mean"] == 1
    assert row(output, "max_queue_length", "zones", "zone", "zone_inner_concourse")["max_persons"]["mean"] == 1
    assert row(output, "max_queue_length", "zones", "zone", "zone_platform")["max_persons"]["mean"] == 1
    assert row(output, "max_queue_length", "lane_groups", "lane_group", "gate_priority/escort")["operational_lanes"] == 1
    assert row(output, "max_queue_length", "lane_groups", "lane_group", GROUP)["max_persons"]["mean"] == 0


def test_wait_hold_walking_and_service_are_distinct(service, document):
    document["event"]["ticket_categories"][0]["sold"] = 1
    document["demand"]["arrival_windows_percent"]["festival_a"] = {"16:00-16:01": 100}
    document["event"]["schedule"]["outer_area_open"] = "16:30"
    document["venue"]["layout"]["walking_paths"][0]["distance_m"] = 60
    wait = simulate(service, document)["output"]["wait_time"]
    assert wait["gate_join_holding"]["person_minutes"] == 30
    assert wait["pre_open_holding"]["p90_minutes"]["mean"] == 29
    assert wait["walking"]["person_minutes"] == 1
    assert wait["service"]["person_minutes"] == 1
    assert all(point["mean_minutes"] == 0 for point in wait["by_point"])


@pytest.mark.parametrize("method", ["flow", "des"])
def test_targets_shortfalls_and_known_problem_selectors(service, document, method):
    document["constraints"]["service_targets"]["gate_wait"]["max_minutes"] = 1
    document["venue"]["known_problems"] = [
        {"id": "selected", "conditions": [{"metric": "wait_time.by_lane_group[lane_group=gate/general].max_minutes",
                                          "operator": "gt", "value": 1}],
         "result_template": "Gate wait: {wait_time.by_lane_group[lane_group=gate/general].max_minutes}."},
        {"id": "aggregate", "conditions": [{"metric": "entry_outcomes.by_category[*].attending_persons",
                                           "aggregate": "sum", "operator": "gte", "value": 6}],
         "result_template": "Attendance: {entry_outcomes.attendance_persons}."},
        {"id": "linked", "linked_checks": ["chk_gate_wait"], "result_template": "Check gate wait."},
    ]
    output = simulate(service, document, method)["output"]
    check = row(output, "scorecard", "checks", "id", "chk_gate_wait")
    assert check["status"] == "missed"
    assert check["result_minutes"]["mean"] == 5
    assert check["shortfall"] == 4
    assert output["scorecard"]["summary"] == "The plan misses 1 of 3 checks: gate wait."
    known = output["known_problem_checks"]["checks"]
    assert [item["risk"] for item in known] == ["medium", "medium", "high"]
    assert known[0]["result"] in ("Gate wait: 5.", "Gate wait: 5.0.")


def test_reference_position_splits_and_extra_servers(service):
    fixture = Path(__file__).resolve().parents[1] / "fixtures/event-entry/reference-plan.json"
    document = json.loads(fixture.read_text())
    for category in document["event"]["ticket_categories"]:
        category["sold"] = 1 if category["id"] == "festival_a" else 0
        category["issued"] = 0
    document["event"]["capacity"]["no_show_percent_estimate"] = 0
    output = simulate(service, document, "des")["output"]
    redemption = row(output, "max_queue_length", "lane_groups", "lane_group", "redemption_tent/general")
    assert [position["steps"] for position in redemption["positions"]] == [["eticket_scan", "ktp_name_match"], ["wristband_fit"]]
    security = row(output, "max_queue_length", "lane_groups", "lane_group", "gate_floor/female")
    assert [position["steps"] for position in security["positions"]] == [["bag_check"], ["body_search"], ["wristband_check"]]
    help_desk = row(output, "max_queue_length", "lane_groups", "lane_group", "help_desk/desk")
    assert help_desk["positions"][0]["steps"] == ["help_desk_resolution"]
    assert help_desk["positions"][0]["servers"] == 2
    escort = row(output, "max_queue_length", "lane_groups", "lane_group", "gate_priority/escort")
    assert escort["operational_lanes"] == 2
    assert escort["positions"][0]["steps"] == ["assisted_entry"]
    rules = {rule["rule"]: rule["status"] for rule in output["scorecard"]["rule_checks"]["rules"]}
    assert rules["rule_breaks"] == rules["rule_no_re_entry"] == "not_tested"
