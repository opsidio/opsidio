"""Run the local bridge: python3.11 -m api.simulation."""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from .optimization import OptimizationBridge
from .bridge import MAX_BODY_BYTES, BridgeConfig, BridgeError, SimulationBridge, failure, json_bytes


def handler_for(bridge: SimulationBridge) -> type[BaseHTTPRequestHandler]:
    optimizer = OptimizationBridge(bridge)

    class Handler(BaseHTTPRequestHandler):
        server_version = "OpsidioBridge/0.1"

        def log_message(self, format: str, *args: Any) -> None:
            # No request/body/header logging; credentials only exist on the upstream client.
            pass

        def send_json(self, status: int, payload: dict[str, Any]) -> None:
            raw = json_bytes(payload)
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            try:
                self.wfile.write(raw)
            except (BrokenPipeError, ConnectionResetError):
                pass  # A closed browser does not prove that an upstream run stopped.

        def do_GET(self) -> None:
            try:
                if self.path == "/api/simulation/health":
                    self.send_json(200, bridge.config.health())
                elif self.path.startswith("/api/simulation/optimizations/"):
                    self.send_json(200, optimizer.get_job(self.path.removeprefix("/api/simulation/optimizations/")))
                elif self.path.startswith("/api/simulation/plans/"):
                    self.send_json(200, optimizer.get_plan(self.path.removeprefix("/api/simulation/plans/")))
                else:
                    raise failure(404, "not_found", "Unknown bridge route.")
            except BridgeError as exc:
                self.send_json(exc.http_status, exc.payload)

        def do_POST(self) -> None:
            try:
                if self.path not in {"/api/simulation/run", "/api/simulation/optimize"}:
                    raise failure(404, "not_found", "Unknown bridge route.")
                # JSON plus no CORS support prevents an unrelated web page from making
                # a simple cross-origin form POST that spends this local server's key.
                if self.headers.get_content_type() != "application/json":
                    raise failure(415, "unsupported_media_type", "Send application/json.")
                if self.headers.get("Transfer-Encoding"):
                    raise failure(400, "unsupported_transfer_encoding", "Send a Content-Length header.")
                try:
                    length = int(self.headers.get("Content-Length", ""))
                except ValueError:
                    raise failure(411, "length_required", "Send a Content-Length header.") from None
                if not 0 <= length <= MAX_BODY_BYTES:
                    raise failure(413, "body_too_large", "The request body limit is 1 MB.")
                raw = self.rfile.read(length)
                if len(raw) != length:
                    raise failure(400, "invalid_json", "The JSON request body was incomplete.")
                try:
                    def reject_constant(value: str) -> None:
                        raise ValueError(value)
                    request = json.loads(raw, parse_constant=reject_constant)
                    json_bytes(request)
                except (ValueError, UnicodeError, RecursionError):
                    raise failure(400, "invalid_json", "The request body must contain valid JSON.") from None
                self.send_json(202 if self.path.endswith("/optimize") else 200, optimizer.start(request) if self.path.endswith("/optimize") else bridge.run(request))
            except BridgeError as exc:
                self.send_json(exc.http_status, exc.payload)

    return Handler


def main() -> None:
    config = BridgeConfig.from_env()
    server = ThreadingHTTPServer(("127.0.0.1", 8000), handler_for(SimulationBridge(config)))
    server.daemon_threads = True
    print(f"Opsidio DES bridge: http://127.0.0.1:8000 ({config.health()['status']})", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
