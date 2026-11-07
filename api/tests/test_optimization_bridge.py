"""The V1 optimization path submits to the API without running a local DES."""
import copy
import unittest
from api.simulation.bridge import BridgeConfig, BridgeError, SimulationBridge
from api.simulation.optimization import OptimizationBridge
from api.tests.test_des_bridge import PLAN_RESPONSE, REQUEST, VALIDATION, StubClient

JOB = {"id": "opt_01JC9Y5N2B7C4D6F8G0H2J4K6M", "plan_id": PLAN_RESPONSE["id"], "status": "queued", "candidates": []}


class OptimizationTests(unittest.TestCase):
    def configured(self, client):
        return OptimizationBridge(SimulationBridge(BridgeConfig("https://engine.example.test", "test-secret"), client))

    def test_submit_prepares_the_snapshot_then_starts_a_job_without_simulate(self):
        client = StubClient([{"status": "ok"}, PLAN_RESPONSE, VALIDATION, JOB] * 2)
        optimizer = self.configured(client)
        result = optimizer.start(REQUEST)
        optimizer.start(REQUEST)
        self.assertEqual(result["optimization"], JOB)
        self.assertEqual([call[1].split('/')[-1] for call in client.calls[:4]], ["health", "plans", "validate", "optimize"])
        self.assertEqual(client.calls[3][2]["verify"], {"replications": 20, "base_seed": REQUEST["base_seed"]})
        self.assertEqual(client.calls[3][3], client.calls[7][3])

    def test_failed_validation_blocks_optimization(self):
        client = StubClient([{"status": "ok"}, PLAN_RESPONSE, {"valid": False, "issues": []}])
        with self.assertRaises(BridgeError):
            self.configured(client).start(REQUEST)
        self.assertEqual(len(client.calls), 3)

    def test_configuration_and_ids_fail_before_external_calls(self):
        client = StubClient([])
        optimizer = OptimizationBridge(SimulationBridge(BridgeConfig(), client))
        for method, argument in [(optimizer.start, REQUEST), (optimizer.get_job, JOB["id"]), (optimizer.get_plan, '../plans')]:
            with self.assertRaises(BridgeError):
                method(argument)
        self.assertEqual(client.calls, [])

    def test_job_and_candidate_identity_are_checked(self):
        client = StubClient([JOB, PLAN_RESPONSE, {**JOB, "id": "opt_01JC9Y5N2B7C4D6F8G0H2J4K6N"}])
        optimizer = self.configured(client)
        self.assertEqual(optimizer.get_job(JOB["id"]), JOB)
        self.assertEqual(optimizer.get_plan(PLAN_RESPONSE["id"]), PLAN_RESPONSE)
        with self.assertRaises(BridgeError):
            optimizer.get_job(JOB["id"])
