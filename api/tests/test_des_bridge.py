"""Contract checks against mocks/local HTTP only; never call the deployed engine."""

from __future__ import annotations

import copy
import io
import json
import socket
import threading
import unittest
import urllib.error
import urllib.request
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from api.simulation import BridgeConfig, BridgeError, SimulationBridge
from api.simulation.__main__ import handler_for
from api.simulation.bridge import EngineClient, json_bytes

ROOT = Path(__file__).resolve().parents[2]
PLAN = json.loads((ROOT / "api/algorithm/example_plan.json").read_text())
RUN = json.loads((Path(__file__).parent / "fixtures/des_bridge_run.json").read_text())
PLAN_RESPONSE = {"id": RUN["plan_id"], "parent_plan_id": None, "optimization_id": None,
                 "candidate_kind": None, "created_at": "2026-11-05T07:52:38Z",
                 "updated_at": "2026-11-05T07:52:38Z", "document": PLAN}
REQUEST = {"plan": PLAN, "base_seed": 20261127, "replications": 20}
VALIDATION = {"valid": True, "issues": [{"severity": "warning", "code": "fixture_warning",
                                         "field": "constraints", "message": "Test warning passes through."}]}


class StubClient:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def request(self, method, path, body=None, **kwargs):
        self.calls.append((method, path, body, kwargs))
        result = self.responses.pop(0)
        if isinstance(result, Exception):
            raise result
        return copy.deepcopy(result)


@contextmanager
def local_server(handler):
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=lambda: server.serve_forever(poll_interval=0.01), daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


class BridgeTests(unittest.TestCase):
    def configured(self, client):
        return SimulationBridge(BridgeConfig("https://engine.example.test", "test-secret"), client)

    def test_unconfigured_has_no_network_or_credentials(self):
        config = BridgeConfig.from_env({"OPSIDIO_API_KEY": "test-secret"})
        client = StubClient([])
        self.assertEqual(config.health()["missing"], ["OPSIDIO_API_URL"])
        self.assertNotIn("test-secret", repr(config))
        with self.assertRaises(BridgeError) as caught:
            SimulationBridge(config, client).run(REQUEST)
        self.assertEqual(caught.exception.http_status, 503)
        self.assertEqual(caught.exception.payload["status"], "unconfigured")
        self.assertNotIn("test-secret", json.dumps(caught.exception.payload))
        self.assertEqual(client.calls, [])

    def test_invalid_configuration(self):
        for url in ("http://engine.example.test", "https://user:password@engine.example.test", "https://engine.example.test?key=bad"):
            self.assertFalse(BridgeConfig(url, "test-secret").health()["configured"])
        self.assertFalse(BridgeConfig.from_env({"OPSIDIO_API_URL": "https://engine.example.test", "OPSIDIO_API_KEY": "test", "OPSIDIO_API_TIMEOUT_SECONDS": "NaN"}).health()["configured"])
        self.assertTrue(BridgeConfig("http://127.0.0.1:9000", "test").health()["configured"])

    def test_invalid_inputs_do_not_touch_engine(self):
        for changes in ({"base_seed": True}, {"replications": 0}, {"replications": 101}, {"plan": {"schema_version": "0.1"}}):
            client = StubClient([])
            with self.subTest(changes=changes), self.assertRaises(BridgeError) as caught:
                self.configured(client).run({**REQUEST, **changes})
            self.assertEqual(caught.exception.http_status, 422)
            self.assertEqual(client.calls, [])

    def test_success_preserves_output_and_reused_status(self):
        repeated = {**RUN, "reused": True}
        client = StubClient([{"status": "ok"}, PLAN_RESPONSE, VALIDATION, RUN,
                             {"status": "ok"}, PLAN_RESPONSE, VALIDATION, repeated])
        bridge = self.configured(client)
        first, second = bridge.run(REQUEST), bridge.run(REQUEST)
        self.assertEqual(first["run"], RUN)
        self.assertEqual(first["plan"], PLAN_RESPONSE)
        self.assertEqual(first["validation"], VALIDATION)
        self.assertTrue(second["run"]["reused"])
        self.assertEqual(client.calls[1][3]["idempotency_key"], client.calls[5][3]["idempotency_key"])
        self.assertEqual(client.calls[3][2], {"simulation_method": "des", "base_seed": 20261127, "replications": 20})
        self.assertEqual(client.calls[3][3], {})

    def test_invalid_plan_retains_issues_and_stops_before_simulation(self):
        validation = {"valid": False, "issues": [{"severity": "error", "code": "unknown_reference", "field": "venue", "message": "Unknown step"}]}
        client = StubClient([{"status": "ok"}, PLAN_RESPONSE, validation])
        with self.assertRaises(BridgeError) as caught:
            self.configured(client).run(REQUEST)
        self.assertEqual(caught.exception.http_status, 422)
        self.assertEqual(caught.exception.payload["validation"], validation)
        self.assertEqual(caught.exception.payload["plan_id"], RUN["plan_id"])
        self.assertEqual(caught.exception.payload["stage"], "validate")
        self.assertEqual(len(client.calls), 3)

    def test_auth_failure_stops_before_create(self):
        error = BridgeError(401, {"status": "error", "error": {"code": "invalid_api_key", "message": "Invalid or missing API key"}})
        client = StubClient([error])
        with self.assertRaises(BridgeError) as caught:
            self.configured(client).run(REQUEST)
        self.assertEqual(caught.exception.http_status, 401)
        self.assertEqual(caught.exception.payload["stage"], "health")
        self.assertEqual(len(client.calls), 1)

    def test_timeout_keeps_plan_id_and_does_not_claim_cancellation(self):
        client = StubClient([{"status": "ok"}, PLAN_RESPONSE, VALIDATION, EngineClient._timeout()])
        with self.assertRaises(BridgeError) as caught:
            self.configured(client).run(REQUEST)
        self.assertEqual(caught.exception.http_status, 504)
        self.assertEqual(caught.exception.payload["status"], "timeout")
        self.assertEqual(caught.exception.payload["stage"], "simulate")
        self.assertEqual(caught.exception.payload["plan_id"], RUN["plan_id"])
        self.assertIn("may still be running", caught.exception.payload["error"]["message"])

    def test_rejects_wrong_run_identity(self):
        client = StubClient([{"status": "ok"}, PLAN_RESPONSE, VALIDATION, {**RUN, "plan_id": "another-plan"}])
        with self.assertRaises(BridgeError) as caught:
            self.configured(client).run(REQUEST)
        self.assertEqual(caught.exception.http_status, 502)

    def test_engine_http_errors_preserve_code_message_details_and_status(self):
        client = EngineClient(BridgeConfig("https://engine.example.test", "test-secret"))
        payload = {"error": {"code": "validation_failed", "message": "Invalid plan", "details": [{"field": "event.schedule", "message": "Required"}]}}
        error = urllib.error.HTTPError("https://engine.example.test", 422, "invalid", {}, io.BytesIO(json_bytes(payload)))
        with patch.object(client.opener, "open", side_effect=error), self.assertRaises(BridgeError) as caught:
            client.request("POST", "/v1/plans", PLAN)
        self.assertEqual(caught.exception.http_status, 422)
        self.assertEqual(caught.exception.payload["error"], payload["error"])
        timeout = urllib.error.URLError(socket.timeout())
        with patch.object(client.opener, "open", side_effect=timeout), self.assertRaises(BridgeError) as caught:
            client.request("GET", "/health")
        self.assertEqual(caught.exception.payload["status"], "timeout")

    def test_real_http_round_trip_only_to_local_mock(self):
        calls = []
        responses = [(200, {"status": "ok"}), (201, PLAN_RESPONSE), (200, VALIDATION), (200, RUN)]
        class MockEngine(BaseHTTPRequestHandler):
            def do_GET(self):
                self.reply()
            def do_POST(self):
                self.reply()
            def reply(self):
                data = self.rfile.read(int(self.headers.get("Content-Length", "0")))
                calls.append((self.command, self.path, dict(self.headers), json.loads(data) if data else None))
                status, payload = responses.pop(0)
                self.send_response(status)
                self.end_headers()
                self.wfile.write(json_bytes(payload))
            def log_message(self, *args):
                pass
        with local_server(MockEngine) as engine_url:
            config = BridgeConfig(engine_url, "local-test-key")
            with local_server(handler_for(SimulationBridge(config))) as bridge_url:
                health = json.load(urllib.request.urlopen(bridge_url + "/api/simulation/health"))
                self.assertTrue(health["configured"])
                self.assertEqual(calls, [])
                request = urllib.request.Request(bridge_url + "/api/simulation/run", data=json_bytes(REQUEST), headers={"Content-Type": "application/json"})
                result = json.load(urllib.request.urlopen(request))
        self.assertEqual(result["run"], RUN)
        self.assertEqual([c[1] for c in calls], ["/health", "/v1/plans", f"/v1/plans/{RUN['plan_id']}/validate", f"/v1/plans/{RUN['plan_id']}/simulate"])
        self.assertEqual(calls[1][3], PLAN)
        self.assertEqual(calls[0][2]["X-Api-Key"], "local-test-key")

    def test_local_http_rejects_bad_bodies_without_upstream_calls(self):
        client = StubClient([])
        with local_server(handler_for(self.configured(client))) as url:
            for body, content_type, status in ((b"not json", "application/json", 400), (b"{}", "text/plain", 415), (b'{"value":NaN}', "application/json", 400)):
                req = urllib.request.Request(url + "/api/simulation/run", data=body, headers={"Content-Type": content_type})
                with self.subTest(body=body), self.assertRaises(urllib.error.HTTPError) as caught:
                    urllib.request.urlopen(req)
                self.assertEqual(caught.exception.code, status)
        self.assertEqual(client.calls, [])


if __name__ == "__main__":
    unittest.main()
