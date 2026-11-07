"""Project the admission planning fixture to a lossless, partial v0.1 PlanDocument.

This is a format conversion, not an operational compiler or a simulation.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
from datetime import date
from pathlib import Path
from typing import Any

from .bridge import json_bytes

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SOURCE = ROOT / "data/scenarios/coldplay-gbk-demo.json"
DEFAULT_OUTPUT = ROOT / "contracts/examples/coldplay-gbk-plan-draft.json"
SOURCE_TITLES = {
    "promoter": "Promoter event reference",
    "entry_guide": "Published entry guide",
    "venue_map": "Published category routing and venue map",
    "admission_process": "Published admission process",
    "wristband_reporting": "Published wristband instructions",
    "ticket_products": "Published ticket products",
}


def compile_scenario(scenario: dict[str, Any], source_name: str = "data/scenarios/coldplay-gbk-demo.json") -> dict[str, Any]:
    if scenario.get("schema_version") != "opsidio-admission-scenario/0.1":
        raise ValueError("Expected an opsidio-admission-scenario/0.1 planning fixture.")
    original = copy.deepcopy(scenario)
    proposal = scenario["proposal"]
    cohorts = scenario["cohorts"]
    entry_areas = scenario["entry_areas"]
    gate_by_area = {area["id"]: "proposed_gate_" + area["id"] for area in entry_areas}
    if len(gate_by_area) != len(entry_areas):
        raise ValueError("Entry area IDs must be unique.")
    if len({cohort["id"] for cohort in cohorts}) != len(cohorts):
        raise ValueError("Cohort IDs must be unique.")
    total = proposal["expected_attendees"]
    if type(total) is not int or total < 0:
        raise ValueError("Expected attendance must be a nonnegative integer.")
    for cohort in cohorts:
        if type(cohort["expected_attendees"]) is not int or cohort["expected_attendees"] < 0:
            raise ValueError("Every cohort needs a nonnegative integer attendance estimate.")
        if cohort["entry_area_id"] not in gate_by_area:
            raise ValueError("Every cohort must reference a known entry area.")
    if sum(cohort["expected_attendees"] for cohort in cohorts) != total:
        raise ValueError("Cohort attendance must sum exactly to the proposal total.")

    categories: list[dict[str, Any]] = []
    for cohort in cohorts:
        if cohort["viewing_tier"] is None:
            if cohort["id"] != "infinity":
                raise ValueError("An unallocated cohort needs an explicit viewing-tier allocation.")
            allocation = scenario["infinity_demo_allocation"]
            shares = allocation["viewing_tiers"]
            if allocation["arrival_entry_area_id"] != cohort["entry_area_id"]:
                raise ValueError("Infinity's allocation and cohort must name the same arrival entry area.")
            if any(type(count) is not int or count < 0 for count in shares.values()):
                raise ValueError("Infinity allocations must be nonnegative integer counts.")
            if sum(shares.values()) != cohort["expected_attendees"]:
                raise ValueError("Infinity allocations must sum exactly to its cohort count.")
        else:
            shares = {cohort["viewing_tier"]: cohort["expected_attendees"]}
        for tier, count in shares.items():
            if tier != "festival" and tier not in {f"cat{i}" for i in range(1, 9)}:
                raise ValueError(f"Viewing tier {tier!r} has no authored seated/standing mapping.")
            split = cohort["viewing_tier"] is None
            categories.append({
                "id": f"{cohort['id']}_{tier}" if split else cohort["id"],
                "name": f"{cohort['label']} — {tier.upper()}" if split else cohort["label"],
                "admission": "standing" if tier == "festival" else "seated",
                "entry_gate": gate_by_area[cohort["entry_area_id"]],
                "entry_gate_status": "proposed_reference_requires_authored_gate",
                "entry_area_id": cohort["entry_area_id"],
                "cohort_id": cohort["id"],
                "ticket_product_id": cohort["id"],
                "viewing_tier": tier,
                "expected_attendees_estimate": count,
                "count_basis": cohort["count_basis"],
                "attendance_interpretation": "Expected arrivals only; sold/issued tickets and no-show rates are unresolved.",
            })
    if len({category["id"] for category in categories}) != len(categories):
        raise ValueError("Projected category IDs must be unique.")
    if sum(category["expected_attendees_estimate"] for category in categories) != total:
        raise ValueError("Projection must preserve the exact attendance total.")

    clock = proposal["schedule"]
    # Keep every original clock key and add the three canonical required names.
    schedule = {**clock, "basis": "assumed", "outer_area_open": clock["prefunction_open"],
                "doors_open": clock["general_concert_doors"], "main_act": clock["main_act"]}
    unresolved = [
        {"field": "event.capacity", "reason": "Venue/configured capacity, sold/issued ticket totals and no-show rate are not authored. Expected attendance is not a ticket-sales fact."},
        {"field": "event.ticket_categories[*].sold|issued", "reason": "Fictional expected-arrival counts are retained as estimates, not sold or issued inventory."},
        {"field": "event.audience_profile", "reason": "Gender, bag, locker, accessibility and group proportions remain unauthored."},
        {"field": "venue.layout", "reason": "Proposed gate references require real gate records, queue/destination zones, areas, lane counts, opening/closing times, directed walking paths and validated internal routes."},
        {"field": "process_steps", "reason": "Admission functions are recorded, but their operational order, service-time distributions and exception handling require authoring."},
        {"field": "staff", "reason": "Roles, headcounts, assignments, shifts and costs are not authored."},
        {"field": "constraints", "reason": "Service targets, budgets and safe operational limits are not authored."},
        {"field": "demand", "reason": "Expected attendance has no authored arrival curve or group model in this draft; browser ABM results have not been projected."},
    ]
    return {
        "schema_version": "0.1",
        "meta": {
            "document": "opsidio_event_input",
            "example": True,
            "description": "Partial, fictional GBK planning draft projected from the admission scenario. Not ready for DES.",
            "timezone": proposal["timezone"],
            "currency": "IDR",
            "readiness": {"status": "draft_requires_operational_inputs", "simulation_ready": False,
                          "schema_target": "Doni PlanDocument v0.1", "semantic_validation": "not_run"},
            "unresolved": unresolved,
            "projection": {
                "version": "admission-scenario-to-plan/0.1",
                "schedule_mapping": {"outer_area_open": "proposal.schedule.prefunction_open", "doors_open": "proposal.schedule.general_concert_doors", "main_act": "proposal.schedule.main_act"},
                "admission_mapping": "Festival viewing tier is standing; CAT 1–8 are seated. Packages retain their underlying viewing tier.",
                "infinity_rule": "Split the existing 500-person Infinity cohort using its fixed viewing-tier allocation; all splits keep the original arrival entry area.",
                "count_rule": "Preserve expected arrivals as expected_attendees_estimate. Do not infer sold/issued tickets, quota or no-show rates.",
                "source_titles": "Descriptive labels for the fixture's existing source URLs; no additional research was performed.",
            },
            "source_scenario": {"file": source_name, "canonical_sha256": hashlib.sha256(json_bytes(original)).hexdigest(), "snapshot": original},
        },
        "event": {
            "id": scenario["id"],
            "name": scenario["title"],
            "venue": scenario["venue_id"],
            "date": proposal["event_date"],
            "day_of_week": ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")[date.fromisoformat(proposal["event_date"]).weekday()],
            "schedule": schedule,
            "schedule_basis": proposal["schedule_basis"],
            "expected_attendees_estimate": total,
            "attendance_basis": proposal["attendance_basis"],
            "ticket_categories": categories,
            "admission_planning_notes": copy.deepcopy(scenario["admission_process"]),
            "historical_reference": copy.deepcopy(scenario["historical_reference"]),
        },
        "venue": {
            "id": scenario["venue_id"],
            "name": "Stadion Utama Gelora Bung Karno",
            "capacity_validation": proposal["venue_capacity_validation"],
            "proposed_entry_areas": [{**copy.deepcopy(area), "proposed_gate_id": gate_by_area[area["id"]]} for area in entry_areas],
        },
        "sources": {key: {"title": SOURCE_TITLES.get(key, key.replace("_", " ").title()), "url": url} for key, url in scenario["sources"].items()},
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    source = args.source.resolve()
    try:
        source_name = str(source.relative_to(ROOT))
    except ValueError:
        source_name = source.name
    with source.open() as stream:
        plan = compile_scenario(json.load(stream), source_name)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(plan, indent=2, ensure_ascii=False, allow_nan=False) + "\n")
    print(f"Wrote draft: {args.output} ({plan['event']['expected_attendees_estimate']:,} expected attendees; not ready for DES)")


if __name__ == "__main__":
    main()
