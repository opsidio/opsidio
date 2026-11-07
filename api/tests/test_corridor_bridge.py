"""Exercise the v3 bridge without contacting the deployed service."""

import copy
import hashlib
import json
import unittest
from unittest.mock import patch

from api.simulation.bridge import BridgeConfig, BridgeError
from api.simulation.corridor import CORRIDOR_API_URL, CorridorBridge

PLAN_ID = "pln_" + "1" * 32
CANDIDATE_ID = "pln_" + "2" * 32
BASELINE_ID = "run_" + "3" * 32
BEST_ID = "run_" + "4" * 32
OPTIMIZATION_ID = "opt_" + "5" * 32
TEST_KEY = "mock-corridor-key"
DOCUMENT = {
    "schema_version": "corridor-1",
    "name": "Plaza Timur · scan sample",
    "geometry_revision": "demo-r8",
    "route": {"scan_node_id": "scan", "nodes": [
        {"id": name, "position": {"x": 0, "y": 0, "z": z}}
        for name, z in [("arrival", 0), ("scan", 5), ("admission", 5)]
    ]},
    "arrivals": {"count": 2, "start_seconds": 0, "end_seconds": 0},
    "walking_speed_mps": 1,
    "scan": {"lanes": 1, "physical_slots": 2, "available_staff": 2, "available_scanners": 2,
             "service_seconds": 10, "staff_cost_per_lane": {"amount": "100.00", "currency": "IDR"},
             "scanner_cost_per_lane": {"amount": "50.00", "currency": "IDR"}},
    "targets": {"max_peak_scan_queue": 0},
    "budget": {"amount": "600.00", "currency": "IDR"},
    "horizon_seconds": 30,
}


def plan_resource(identifier, document, parent_id=None):
    encoded = json.dumps(document, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()
    return {"id": identifier, "document": document, "parent_id": parent_id,
            "snapshot_hash": hashlib.sha256(encoded).hexdigest()}


def run_resource(identifier, plan, *, peak, wait):
    return {
        "id": identifier, "plan_id": plan["id"], "snapshot_hash": plan["snapshot_hash"], "model_id": "corridor_v1",
        "output": {"population": {"total": 2, "admitted": 2, "unfinished": 0}, "walking": {},
                   "scan": {"lanes": plan["document"]["scan"]["lanes"], "peak_queue": peak, "wait_p90_seconds": wait},
                   "costs": {}, "checks": {}},
    }


def response_chain(*, improved=True):
    plan = plan_resource(PLAN_ID, copy.deepcopy(DOCUMENT))
    optimization = {"id": OPTIMIZATION_ID, "plan_id": PLAN_ID, "baseline_run_id": BASELINE_ID,
                    "best_run_id": BEST_ID if improved else BASELINE_ID,
                    "candidate_plan_id": CANDIDATE_ID if improved else None,
                    "improved": improved, "stop_reason": "completed", "evaluations": []}
    baseline = run_resource(BASELINE_ID, plan, peak=1, wait=10)
    if not improved:
        return [plan, optimization, baseline]
    changed = copy.deepcopy(DOCUMENT)
    changed["scan"]["lanes"] = 2
    candidate = plan_resource(CANDIDATE_ID, changed, parent_id=PLAN_ID)
    best = run_resource(BEST_ID, candidate, peak=0, wait=0)
    return [plan, optimization, baseline, candidate, best]


class StubClient:
    def __init__(self, responses):
        self.responses = iter(responses)
        self.calls = []

    def request(self, method, path, body=None, *, idempotency_key=None):
        self.calls.append((method, path, body, idempotency_key))
        response = next(self.responses)
        if isinstance(response, Exception):
            raise response
        return response


class CorridorBridgeTests(unittest.TestCase):
    def bridge(self, client, timeout=20):
        return CorridorBridge(BridgeConfig("https://mock.example.test", TEST_KEY, timeout), client)

    def test_improved_comparison_reads_only_linked_resources_and_retries_idempotently(self):
        first = response_chain()
        client = StubClient(first + response_chain())
        bridge = self.bridge(client)
        result = bridge.optimize({"plan": DOCUMENT})
        self.assertEqual(bridge.optimize({"plan": DOCUMENT}), result)
        self.assertEqual(result, dict(zip(("plan", "optimization", "baseline", "candidate", "best"), first)))
        self.assertEqual([(method, path, body) for method, path, body, _ in client.calls[:5]], [
            ("POST", "/v3/plans", DOCUMENT), ("POST", f"/v3/plans/{PLAN_ID}/optimize", {}),
            ("GET", f"/v3/runs/{BASELINE_ID}", None), ("GET", f"/v3/plans/{CANDIDATE_ID}", None),
            ("GET", f"/v3/runs/{BEST_ID}", None),
        ])
        self.assertTrue(client.calls[0][3])
        self.assertTrue(client.calls[1][3])
        self.assertEqual(client.calls[:5], client.calls[5:])

    def test_no_improvement_reuses_the_baseline_run_without_a_candidate(self):
        client = StubClient(response_chain(improved=False))
        result = self.bridge(client).optimize({"plan": DOCUMENT})
        self.assertIsNone(result["candidate"])
        self.assertIs(result["best"], result["baseline"])
        self.assertEqual(len(client.calls), 3)

    def test_invalid_requests_and_missing_configuration_make_no_upstream_calls(self):
        client = StubClient([])
        empty = CorridorBridge(BridgeConfig(), client)
        with self.assertRaises(BridgeError) as context:
            empty.optimize({"plan": DOCUMENT})
        self.assertEqual(context.exception.http_status, 503)
        self.assertIn("OPSIDIO_CORRIDOR_API_KEY", empty.health()["missing"])
        for invalid in ({}, {"plan": {**DOCUMENT, "schema_version": "0.1"}},
                        {"plan": {**DOCUMENT, "arrivals": {"count": 501}}},
                        {"plan": {**DOCUMENT, "scan": {**DOCUMENT["scan"], "available_staff": 0}}},
                        {"plan": {**DOCUMENT, "walking_speed_mps": float("nan")}}):
            with self.assertRaises(BridgeError) as context:
                self.bridge(client).optimize(invalid)
            self.assertEqual(context.exception.http_status, 422)
        self.assertEqual(client.calls, [])

    def test_dedicated_key_and_timeout_configuration(self):
        dedicated = CorridorBridge.from_env({"OPSIDIO_CORRIDOR_API_KEY": TEST_KEY})
        self.assertEqual(dedicated.config.api_url, CORRIDOR_API_URL)
        self.assertTrue(dedicated.health()["configured"])
        self.assertFalse(dedicated.health()["upstream_checked"])
        self.assertNotIn(TEST_KEY, repr(dedicated.config))
        legacy = {"OPSIDIO_API_URL": "https://legacy.example.test", "OPSIDIO_API_KEY": TEST_KEY}
        self.assertFalse(CorridorBridge.from_env(legacy).health()["configured"])
        self.assertFalse(CorridorBridge.from_env({**legacy, "OPSIDIO_API_URL": CORRIDOR_API_URL}).health()["configured"])
        too_long = CorridorBridge.from_env({"OPSIDIO_CORRIDOR_API_KEY": TEST_KEY, "OPSIDIO_CORRIDOR_API_TIMEOUT_SECONDS": "61"})
        self.assertEqual(too_long.health()["invalid"], ["OPSIDIO_CORRIDOR_API_TIMEOUT_SECONDS"])

    def test_rejects_wrong_ids_snapshots_parent_and_candidate_deltas(self):
        cases = (
            (0, {"id": "../../unexpected"}, "create", 1),
            (0, {"snapshot_hash": "a" * 64}, "create", 1),
            (1, {"plan_id": CANDIDATE_ID}, "optimize", 2),
            (1, {"best_run_id": BASELINE_ID}, "optimize", 2),
            (1, {"candidate_plan_id": None}, "optimize", 2),
            (2, {"snapshot_hash": "b" * 64}, "baseline", 3),
            (3, {"parent_id": None}, "candidate", 4),
            (3, {"document": {**DOCUMENT, "scan": {**DOCUMENT["scan"], "lanes": 3}}}, "candidate", 4),
            (3, {"document": {**DOCUMENT, "name": "Unrelated", "scan": {**DOCUMENT["scan"], "lanes": 2}}}, "candidate", 4),
            (4, {"plan_id": PLAN_ID}, "best", 5),
        )
        for index, changes, stage, calls in cases:
            with self.subTest(stage=stage, changes=changes):
                responses = response_chain()
                responses[index].update(changes)
                client = StubClient(responses)
                with self.assertRaises(BridgeError) as context:
                    self.bridge(client).optimize({"plan": DOCUMENT})
                self.assertEqual(context.exception.http_status, 502)
                self.assertEqual(context.exception.payload["stage"], stage)
                self.assertEqual(len(client.calls), calls)

    def test_deadline_applies_to_the_whole_comparison(self):
        client = StubClient(response_chain())
        with patch("api.simulation.corridor.monotonic", side_effect=[0, 0, 6, 11]):
            with self.assertRaises(BridgeError) as context:
                self.bridge(client, timeout=10).optimize({"plan": DOCUMENT})
        self.assertEqual(context.exception.http_status, 504)
        self.assertEqual(context.exception.payload["stage"], "optimize")
        self.assertEqual(len(client.calls), 1)

    def test_upstream_errors_preserve_details_and_remove_secrets(self):
        upstream = BridgeError(422, {"status": "error", "upstream_status": 422, "debug": TEST_KEY,
                                    "error": {"code": "validation_failed", "message": f"Rejected {TEST_KEY}",
                                              "details": [{"field": "scan.lanes", "message": TEST_KEY}]}})
        client = StubClient([upstream])
        with self.assertRaises(BridgeError) as context:
            self.bridge(client).optimize({"plan": DOCUMENT})
        payload = context.exception.payload
        self.assertEqual(context.exception.http_status, 422)
        self.assertEqual(payload["stage"], "create")
        self.assertEqual(payload["error"]["code"], "validation_failed")
        self.assertEqual(payload["error"]["details"], [{"field": "scan.lanes", "message": "[redacted]"}])
        self.assertNotIn(TEST_KEY, json.dumps(payload))
