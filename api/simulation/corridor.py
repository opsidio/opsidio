"""Forward the corridor workflow to Doni's v3 API using a server-side key."""

from __future__ import annotations

import hashlib
import json
import os
import re
from copy import deepcopy
from dataclasses import replace
from time import monotonic
from typing import Any, Mapping

from .bridge import BridgeConfig, BridgeError, EngineClient, failure

CORRIDOR_API_URL = "https://opsidio-api-production.up.railway.app"
PLAN_ID = re.compile(r"pln_[a-f0-9]{32}\Z")
RUN_ID = re.compile(r"run_[a-f0-9]{32}\Z")
OPTIMIZATION_ID = re.compile(r"opt_[a-f0-9]{32}\Z")


def _matches(pattern: re.Pattern[str], value: Any) -> bool:
    return isinstance(value, str) and pattern.fullmatch(value) is not None


def _snapshot_hash(document: Any) -> str:
    """Match the v3 API's canonical document digest, including UTF-8 labels."""
    data = json.dumps(document, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(data.encode("utf-8")).hexdigest()


class CorridorBridge:
    def __init__(self, config: BridgeConfig, client: EngineClient | None = None):
        self.config = config
        self.client = client

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> CorridorBridge:
        env = os.environ if env is None else env
        url = env.get("OPSIDIO_CORRIDOR_API_URL", CORRIDOR_API_URL).strip().rstrip("/")
        key = env.get("OPSIDIO_CORRIDOR_API_KEY", "").strip()
        try:
            timeout = float(env.get("OPSIDIO_CORRIDOR_API_TIMEOUT_SECONDS", "20"))
        except ValueError:
            timeout = float("nan")
        if not 0 < timeout <= 60:
            timeout = float("nan")
        return cls(BridgeConfig(url, key, timeout))

    def health(self) -> dict[str, Any]:
        health = self.config.health()
        for field in ("missing", "invalid"):
            health[field] = [name.replace("OPSIDIO_API_", "OPSIDIO_CORRIDOR_API_") for name in health[field]]
        return health

    def optimize(self, request: Any) -> dict[str, Any]:
        configuration = self.health()
        if not configuration["configured"]:
            raise failure(503, "corridor_bridge_unconfigured", "Configure the corridor API key on the server.",
                          status="unconfigured", configuration=configuration)
        document = self._request_document(request)
        stage = "create"
        deadline = monotonic() + self.config.timeout_seconds
        try:
            plan = self._request(deadline, "POST", "/v3/plans", document,
                                       idempotency_key="opsidio-corridor-plan-v1-" + _snapshot_hash(document))
            self._check_plan(plan, parent_id=None, document=document)

            stage = "optimize"
            plan_id = plan["id"]
            optimization = self._request(deadline, "POST", f"/v3/plans/{plan_id}/optimize", {},
                                               idempotency_key="opsidio-corridor-opt-v1-" + plan_id)
            self._check_optimization(optimization, plan_id)

            stage = "baseline"
            baseline_id = optimization["baseline_run_id"]
            baseline = self._request(deadline, "GET", f"/v3/runs/{baseline_id}")
            self._check_run(baseline, baseline_id, plan)

            candidate, best = None, baseline
            if optimization["improved"]:
                stage = "candidate"
                candidate_id = optimization["candidate_plan_id"]
                candidate = self._request(deadline, "GET", f"/v3/plans/{candidate_id}")
                candidate_doc = candidate.get("document")
                scan = candidate_doc.get("scan") if isinstance(candidate_doc, dict) else None
                lanes = scan.get("lanes") if isinstance(scan, dict) else None
                initial_scan = document["scan"]
                max_lanes = min(initial_scan[field] for field in ("physical_slots", "available_staff", "available_scanners"))
                if type(lanes) is not int or not initial_scan["lanes"] < lanes <= max_lanes:
                    raise failure(502, "upstream_invalid_response", "The candidate has an invalid scan lane count.")
                expected = deepcopy(document)
                expected["scan"]["lanes"] = lanes
                self._check_plan(candidate, parent_id=plan_id, document=expected, plan_id=candidate_id)

                stage = "best"
                best_id = optimization["best_run_id"]
                best = self._request(deadline, "GET", f"/v3/runs/{best_id}")
                self._check_run(best, best_id, candidate)

            return {"plan": plan, "optimization": optimization, "baseline": baseline, "best": best,
                    "candidate": candidate}
        except BridgeError as exc:
            raise self._public_error(exc, stage) from None

    def _request(self, deadline: float, method: str, path: str, body: dict[str, Any] | None = None,
                 *, idempotency_key: str | None = None) -> dict[str, Any]:
        remaining = deadline - monotonic()
        if remaining <= 0:
            raise self._deadline_error()
        client = self.client or EngineClient(replace(self.config, timeout_seconds=remaining))
        result = client.request(method, path, body, idempotency_key=idempotency_key)
        if monotonic() >= deadline:
            raise self._deadline_error()
        if not isinstance(result, dict):
            raise failure(502, "upstream_invalid_response", "The corridor API did not return a resource.")
        return result

    @staticmethod
    def _deadline_error() -> BridgeError:
        return failure(504, "corridor_timeout", "The corridor comparison exceeded its time limit. Retry the same sample to recover its result.",
                       status="timeout")

    def _public_error(self, exception: BridgeError, stage: str) -> BridgeError:
        def clean(value: str) -> str:
            return value.replace(self.config.api_key, "[redacted]")

        payload = exception.payload
        source = payload.get("error")
        source = source if isinstance(source, dict) else {}
        code, message = source.get("code"), source.get("message")
        error = {"code": clean(code) if isinstance(code, str) else "corridor_request_failed",
                 "message": clean(message) if isinstance(message, str) else "The corridor API request failed."}
        details = source.get("details")
        if isinstance(details, list):
            error["details"] = [{"field": clean(item["field"]), "message": clean(item["message"])}
                                for item in details if isinstance(item, dict)
                                and isinstance(item.get("field"), str) and isinstance(item.get("message"), str)]
        result = {"status": "timeout" if payload.get("status") == "timeout" else "error",
                  "error": error, "stage": stage}
        if type(payload.get("upstream_status")) is int:
            result["upstream_status"] = payload["upstream_status"]
        return BridgeError(exception.http_status, result)

    @staticmethod
    def _request_document(request: Any) -> dict[str, Any]:
        document = request.get("plan") if isinstance(request, dict) else None
        if not isinstance(document, dict) or document.get("schema_version") != "corridor-1":
            raise failure(422, "validation_failed", "Provide a corridor-1 document in plan.", status="invalid")
        scan, arrivals = document.get("scan"), document.get("arrivals")
        lane_fields = ("lanes", "physical_slots", "available_staff", "available_scanners")
        if (not isinstance(scan, dict) or any(type(scan.get(field)) is not int or scan[field] < 1
                                             for field in lane_fields)
                or any(scan[field] < scan["lanes"] for field in lane_fields[1:])):
            raise failure(422, "validation_failed", "Scan capacities must cover all active lanes.", status="invalid")
        if not isinstance(arrivals, dict) or type(arrivals.get("count")) is not int or arrivals["count"] < 1:
            raise failure(422, "validation_failed", "The corridor must contain a positive integer arrival count.", status="invalid")
        try:
            _snapshot_hash(document)
        except (ValueError, TypeError, UnicodeError, RecursionError):
            raise failure(422, "validation_failed", "The corridor plan must contain finite JSON values.",
                          status="invalid") from None
        return document

    @staticmethod
    def _check_plan(resource: dict[str, Any], *, parent_id: str | None, document: dict[str, Any],
                    plan_id: str | None = None) -> None:
        returned_id = resource.get("id")
        if (not _matches(PLAN_ID, returned_id) or (plan_id is not None and returned_id != plan_id)
                or returned_id == parent_id or "parent_id" not in resource or resource["parent_id"] != parent_id
                or resource.get("document") != document
                or resource.get("snapshot_hash") != _snapshot_hash(resource["document"])):
            raise failure(502, "upstream_invalid_response", "The returned corridor plan does not match the requested snapshot.")

    @staticmethod
    def _check_optimization(result: dict[str, Any], plan_id: str) -> None:
        candidate = result.get("candidate_plan_id")
        baseline, best = result.get("baseline_run_id"), result.get("best_run_id")
        improved = result.get("improved")
        if (not _matches(OPTIMIZATION_ID, result.get("id")) or result.get("plan_id") != plan_id
                or not _matches(RUN_ID, baseline) or not _matches(RUN_ID, best)
                or type(improved) is not bool or "candidate_plan_id" not in result
                or result.get("stop_reason") not in ("completed", "time_limit")
                or not isinstance(result.get("evaluations"), list)
                or (improved and (not _matches(PLAN_ID, candidate) or candidate == plan_id or best == baseline))
                or (not improved and (candidate is not None or best != baseline))):
            raise failure(502, "upstream_invalid_response", "The corridor optimization has inconsistent plan or run references.")

    @staticmethod
    def _check_run(run: dict[str, Any], run_id: str, plan: dict[str, Any]) -> None:
        output = run.get("output")
        if (run.get("id") != run_id or run.get("plan_id") != plan["id"]
                or run.get("snapshot_hash") != plan["snapshot_hash"] or run.get("model_id") != "corridor_v1"
                or not isinstance(output, dict)
                or any(not isinstance(output.get(field), dict) for field in ("population", "walking", "scan", "costs", "checks"))):
            raise failure(502, "upstream_invalid_response", "The corridor run does not match its plan or snapshot.")
        population, scan = output["population"], output["scan"]
        count = plan["document"]["arrivals"]["count"]
        admitted, unfinished = population.get("admitted"), population.get("unfinished")
        peak, wait = scan.get("peak_queue"), scan.get("wait_p90_seconds")
        if (type(population.get("total")) is not int or population["total"] != count
                or type(admitted) is not int or type(unfinished) is not int
                or admitted < 0 or unfinished < 0 or admitted + unfinished != count
                or type(scan.get("lanes")) is not int or scan["lanes"] != plan["document"]["scan"]["lanes"]
                or type(peak) is not int or not 0 <= peak <= count or "wait_p90_seconds" not in scan
                or (wait is not None and (type(wait) not in {int, float} or not 0 <= wait < float("inf")))):
            raise failure(502, "upstream_invalid_response", "The corridor run metrics are inconsistent with its plan.")
