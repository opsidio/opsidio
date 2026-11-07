"""Forward plans to the documented engine; never calculate simulation results."""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import socket
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Mapping

MAX_BODY_BYTES = 1_048_576
PLAN_ID = re.compile(r"pln_[0-9A-HJKMNP-TV-Z]{26}\Z")
RUN_ID = re.compile(r"run_[0-9A-HJKMNP-TV-Z]{26}\Z")


def json_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


class BridgeError(Exception):
    def __init__(self, http_status: int, payload: dict[str, Any]):
        super().__init__(payload.get("error", {}).get("code", "bridge_error"))
        self.http_status = http_status
        self.payload = payload


def failure(http_status: int, code: str, message: str, *, status: str = "error", **extra: Any) -> BridgeError:
    return BridgeError(http_status, {"status": status, "error": {"code": code, "message": message}, **extra})


@dataclass(frozen=True)
class BridgeConfig:
    api_url: str = ""
    api_key: str = field(default="", repr=False)
    timeout_seconds: float = 180.0

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> BridgeConfig:
        env = os.environ if env is None else env
        try:
            timeout = float(env.get("OPSIDIO_API_TIMEOUT_SECONDS", "180"))
        except ValueError:
            timeout = float("nan")
        return cls(env.get("OPSIDIO_API_URL", "").strip().rstrip("/"),
                   env.get("OPSIDIO_API_KEY", "").strip(), timeout)

    def health(self) -> dict[str, Any]:
        missing = [name for name, value in (("OPSIDIO_API_URL", self.api_url),
                                            ("OPSIDIO_API_KEY", self.api_key)) if not value]
        invalid: list[str] = []
        if self.api_url:
            try:
                url = urllib.parse.urlsplit(self.api_url)
                # Plain HTTP is useful for a local engine, but keys for remote engines need TLS.
                if not (url.scheme == "https" or (url.scheme == "http" and url.hostname in {"localhost", "127.0.0.1", "::1"})):
                    invalid.append("OPSIDIO_API_URL")
                if (not url.hostname or url.username or url.password or url.query or url.fragment
                        or any(char.isspace() for char in self.api_url)):
                    invalid.append("OPSIDIO_API_URL")
                _ = url.port
            except ValueError:
                invalid.append("OPSIDIO_API_URL")
        if any(ord(char) < 32 or ord(char) > 126 for char in self.api_key):
            invalid.append("OPSIDIO_API_KEY")
        if not math.isfinite(self.timeout_seconds) or not 0 < self.timeout_seconds <= 1800:
            invalid.append("OPSIDIO_API_TIMEOUT_SECONDS")
        configured = not missing and not invalid
        return {"status": "configured" if configured else "unconfigured", "configured": configured,
                "missing": missing, "invalid": sorted(set(invalid)), "upstream_checked": False}


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req: Any, fp: Any, code: int, msg: str, headers: Any, newurl: str) -> None:
        # Never send the API key to a redirect destination.
        return None


class EngineClient:
    def __init__(self, config: BridgeConfig):
        self.config = config
        self.opener = urllib.request.build_opener(_NoRedirect())

    def request(self, method: str, path: str, body: dict[str, Any] | None = None,
                *, idempotency_key: str | None = None) -> dict[str, Any]:
        headers = {"X-API-Key": self.config.api_key, "Accept": "application/json"}
        if body is not None:
            headers["Content-Type"] = "application/json"
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        request = urllib.request.Request(self.config.api_url + path, method=method,
                                         data=None if body is None else json_bytes(body), headers=headers)
        try:
            with self.opener.open(request, timeout=self.config.timeout_seconds) as response:
                raw = response.read()
        except urllib.error.HTTPError as exc:
            if 300 <= exc.code < 400:
                raise failure(502, "upstream_redirect_blocked", "The engine redirected the request; check its configured URL.",
                              upstream_status=exc.code) from None
            try:
                payload = json.loads(exc.read())
            except (ValueError, UnicodeError):
                payload = None
            if not isinstance(payload, dict) or not isinstance(payload.get("error"), dict):
                raise failure(exc.code, "upstream_http_error", "The engine returned a non-JSON error.",
                              status="timeout" if exc.code in {408, 504} else "error",
                              upstream_status=exc.code) from None
            # Preserve the upstream code, message, details and HTTP status.
            raise BridgeError(exc.code, {**payload, "status": "timeout" if exc.code in {408, 504} else "error",
                                         "upstream_status": exc.code}) from None
        except (TimeoutError, socket.timeout):
            raise self._timeout() from None
        except urllib.error.URLError as exc:
            if isinstance(exc.reason, (TimeoutError, socket.timeout)):
                raise self._timeout() from None
            raise failure(502, "upstream_unreachable", "Cannot reach the configured engine.") from None
        except OSError:
            raise failure(502, "upstream_unreachable", "Cannot reach the configured engine.") from None
        try:
            payload = json.loads(raw)
            json_bytes(payload)  # Reject non-finite numbers accepted by Python's JSON decoder.
        except (ValueError, UnicodeError, RecursionError):
            raise failure(502, "upstream_invalid_response", "The engine returned invalid JSON.") from None
        if not isinstance(payload, dict):
            raise failure(502, "upstream_invalid_response", "The engine response must be a JSON object.")
        return payload

    @staticmethod
    def _timeout() -> BridgeError:
        return failure(504, "upstream_timeout",
                       "The engine request timed out. Remote work may still be running; retry the same plan and settings to recover its stored run.",
                       status="timeout")


class SimulationBridge:
    def __init__(self, config: BridgeConfig, client: EngineClient | None = None):
        self.config = config
        self.client = client or EngineClient(config)

    def run(self, request: Any) -> dict[str, Any]:
        health = self.config.health()
        if not health["configured"]:
            raise failure(503, "bridge_unconfigured", "Configure the local bridge environment before running DES.",
                          status="unconfigured", configuration=health)
        self._validate_request(request)
        plan_document = request["plan"]
        settings = {"simulation_method": "des", "base_seed": request["base_seed"],
                    "replications": request["replications"]}
        # Reuse a plan during the engine's 24-hour idempotency window, including after a timeout.
        create_key = "opsidio-bridge-plan-v1-" + hashlib.sha256(json_bytes(plan_document)).hexdigest()
        plan_id: str | None = None
        stage = "health"
        try:
            remote_health = self.client.request("GET", "/health")
            if remote_health.get("status") != "ok":
                raise failure(502, "upstream_unhealthy", "The configured engine did not report healthy status.")
            stage = "create"
            plan = self.client.request("POST", "/v1/plans", plan_document, idempotency_key=create_key)
            if not isinstance(plan.get("id"), str) or not PLAN_ID.fullmatch(plan["id"]):
                raise failure(502, "upstream_invalid_response", "The engine did not return a valid plan identity.")
            plan_id = plan["id"]
            stage = "validate"
            validation = self.client.request("POST", f"/v1/plans/{plan_id}/validate")
            if type(validation.get("valid")) is not bool or not isinstance(validation.get("issues"), list):
                raise failure(502, "upstream_invalid_response", "The engine returned an invalid validation result.")
            if not validation["valid"]:
                error = failure(422, "plan_invalid", "The engine rejected this plan. Resolve its validation errors before simulation.",
                                status="invalid", validation=validation, plan=plan)
                error.payload["error"]["details"] = [issue for issue in validation["issues"]
                                                      if isinstance(issue, dict) and issue.get("severity") == "error"]
                raise error
            stage = "simulate"
            # Deliberately do not cache the simulate HTTP response: the engine's natural
            # plan/snapshot/settings reuse reports its current `reused` value truthfully.
            run = self.client.request("POST", f"/v1/plans/{plan_id}/simulate", settings)
            if (not isinstance(run.get("id"), str) or not RUN_ID.fullmatch(run["id"])
                    or run.get("plan_id") != plan_id or run.get("simulation_method") != "des"
                    or not isinstance(run.get("output"), dict) or type(run.get("reused")) is not bool):
                raise failure(502, "upstream_invalid_response", "The engine returned an incomplete or mismatched DES run.")
            return {"status": "completed", "plan": plan, "validation": validation, "run": run}
        except BridgeError as exc:
            exc.payload["stage"] = stage
            if plan_id is not None:
                exc.payload["plan_id"] = plan_id
            raise

    @staticmethod
    def _validate_request(request: Any) -> None:
        errors: list[dict[str, str]] = []
        if not isinstance(request, dict):
            raise failure(422, "validation_failed", "The request must be a JSON object.", status="invalid")
        try:
            json_bytes(request)
        except (ValueError, TypeError, RecursionError):
            raise failure(422, "validation_failed", "The plan must contain finite JSON values.", status="invalid") from None
        plan = request.get("plan")
        if not isinstance(plan, dict):
            errors.append({"field": "plan", "message": "Provide a full v0.1 plan object."})
        else:
            if plan.get("schema_version") != "0.1":
                errors.append({"field": "plan.schema_version", "message": "Must be 0.1."})
            for name in ("event", "venue", "process_steps", "staff", "constraints"):
                if not isinstance(plan.get(name), dict):
                    errors.append({"field": "plan." + name, "message": "This full-plan section must be an object."})
        if type(request.get("base_seed")) is not int:
            errors.append({"field": "base_seed", "message": "Must be an integer."})
        if type(request.get("replications")) is not int or not 1 <= request["replications"] <= 100:
            errors.append({"field": "replications", "message": "Must be an integer from 1 to 100."})
        if errors:
            error = failure(422, "validation_failed", "The request has invalid fields.", status="invalid")
            error.payload["error"]["details"] = errors
            raise error
