import copy
import json
import unittest
from collections import defaultdict

from api.simulation.compile_scenario import DEFAULT_OUTPUT, DEFAULT_SOURCE, compile_scenario


class DraftExporterTests(unittest.TestCase):
    def setUp(self):
        self.scenario = json.loads(DEFAULT_SOURCE.read_text())
        self.plan = compile_scenario(self.scenario)

    def test_preserves_all_original_evidence_losslessly(self):
        self.assertEqual(self.plan["meta"]["source_scenario"]["snapshot"], self.scenario)
        self.plan["meta"]["source_scenario"]["snapshot"]["proposal"]["expected_attendees"] = 1
        self.assertEqual(self.scenario["proposal"]["expected_attendees"], 70000)
        for name, url in self.scenario["sources"].items():
            self.assertEqual(self.plan["sources"][name]["url"], url)
            self.assertTrue(self.plan["sources"][name]["title"])

    def test_allocation_is_exact_and_preserves_cohort_and_product_identity(self):
        categories = self.plan["event"]["ticket_categories"]
        totals = defaultdict(int)
        for item in categories:
            totals[item["cohort_id"]] += item["expected_attendees_estimate"]
            self.assertEqual(item["ticket_product_id"], item["cohort_id"])
            self.assertEqual(item["admission"], "standing" if item["viewing_tier"] == "festival" else "seated")
        self.assertEqual(sum(totals.values()), 70000)
        self.assertEqual(dict(totals), {c["id"]: c["expected_attendees"] for c in self.scenario["cohorts"]})
        infinity = [item for item in categories if item["cohort_id"] == "infinity"]
        self.assertEqual({item["viewing_tier"]: item["expected_attendees_estimate"] for item in infinity}, self.scenario["infinity_demo_allocation"]["viewing_tiers"])
        self.assertEqual({item["entry_area_id"] for item in infinity}, {"plaza_tenggara"})
        self.assertEqual(len(categories), 20)
        self.assertEqual(len({item["id"] for item in categories}), 20)

    def test_canonical_plan_shape_does_not_invent_operations_or_sales(self):
        self.assertEqual(self.plan["schema_version"], "0.1")
        self.assertEqual(self.plan["meta"]["document"], "opsidio_event_input")
        self.assertTrue(self.plan["meta"]["example"])
        self.assertFalse(self.plan["meta"]["readiness"]["simulation_ready"])
        self.assertEqual(self.plan["meta"]["readiness"]["semantic_validation"], "not_run")
        for key in ("process_steps", "staff", "constraints", "demand"):
            self.assertNotIn(key, self.plan)
        self.assertNotIn("layout", self.plan["venue"])
        self.assertNotIn("capacity", self.plan["event"])
        for category in self.plan["event"]["ticket_categories"]:
            for key in ("sold", "issued", "quota", "price_idr"):
                self.assertNotIn(key, category)
        gate_ids = {area["proposed_gate_id"] for area in self.plan["venue"]["proposed_entry_areas"]}
        self.assertEqual({item["entry_gate"] for item in self.plan["event"]["ticket_categories"]}, gate_ids)

    def test_schedule_and_date_keep_fictional_proposal_separate_from_history(self):
        self.assertEqual(self.plan["event"]["date"], "2026-11-14")
        self.assertEqual(self.plan["event"]["day_of_week"], "saturday")
        self.assertEqual(self.plan["event"]["historical_reference"]["event_date"], "2023-11-15")
        clock = self.plan["event"]["schedule"]
        self.assertEqual((clock["outer_area_open"], clock["doors_open"], clock["main_act"]), ("13:00", "17:30", "21:00"))
        for name, value in self.scenario["proposal"]["schedule"].items():
            self.assertEqual(clock[name], value)

    def test_invalid_counts_or_routes_are_not_repaired_silently(self):
        bad_total = copy.deepcopy(self.scenario)
        bad_total["cohorts"][0]["expected_attendees"] += 1
        bad_infinity = copy.deepcopy(self.scenario)
        bad_infinity["infinity_demo_allocation"]["viewing_tiers"]["festival"] += 1
        bad_route = copy.deepcopy(self.scenario)
        bad_route["cohorts"][0]["entry_area_id"] = "missing"
        bad_tier = copy.deepcopy(self.scenario)
        bad_tier["cohorts"][0]["viewing_tier"] = "unmapped"
        for bad in (bad_total, bad_infinity, bad_route, bad_tier):
            with self.assertRaises(ValueError):
                compile_scenario(bad)

    def test_checked_in_draft_matches_exporter(self):
        self.assertEqual(json.loads(DEFAULT_OUTPUT.read_text()), self.plan)


if __name__ == "__main__":
    unittest.main()
