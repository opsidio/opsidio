"""Start and inspect Doni's queued optimization using the local plan snapshot."""
import hashlib
import re
from typing import Any
from .bridge import PLAN_ID, SimulationBridge, failure, json_bytes

OPTIMIZATION_ID = re.compile(r"opt_[0-9A-HJKMNP-TV-Z]{26}\Z")


class OptimizationBridge:
    def __init__(self, bridge: SimulationBridge):
        self.bridge = bridge

    def start(self, request: Any) -> dict[str, Any]:
        prepared = self.bridge.run(request, prepare_only=True)
        plan_id = prepared["plan"]["id"]
        settings = {
            "optimization_method": "greedy", "time_limit_seconds": 60,
            "max_kept_moves": 40,
            "verify": {"replications": request["replications"], "base_seed": request["base_seed"]},
        }
        key = "opsidio-optimize-v1-" + hashlib.sha256(json_bytes({"plan_id": plan_id, **settings})).hexdigest()
        job = self.bridge.client.request("POST", f"/v1/plans/{plan_id}/optimize", settings, idempotency_key=key)
        self._check_job(job, plan_id)
        return {"plan": prepared["plan"], "validation": prepared["validation"], "optimization": job}

    def get_job(self, identifier: str) -> dict[str, Any]:
        if not OPTIMIZATION_ID.fullmatch(identifier):
            raise failure(422, "invalid_optimization_id", "Use the optimization ID returned by the service.")
        self._configured()
        job = self.bridge.client.request("GET", f"/v1/optimizations/{identifier}")
        self._check_job(job)
        if job["id"] != identifier:
            raise failure(502, "upstream_invalid_response", "Optimization identity mismatch.")
        return job

    def get_plan(self, identifier: str) -> dict[str, Any]:
        if not PLAN_ID.fullmatch(identifier):
            raise failure(422, "invalid_plan_id", "Use a plan ID returned by the service.")
        self._configured()
        plan = self.bridge.client.request("GET", f"/v1/plans/{identifier}")
        if plan.get("id") != identifier or not isinstance(plan.get("document"), dict):
            raise failure(502, "upstream_invalid_response", "Candidate plan identity mismatch.")
        return plan

    def _configured(self) -> None:
        if not self.bridge.config.health()["configured"]:
            raise failure(503, "bridge_unconfigured", "Configure the API service before optimizing.", status="unconfigured")

    @staticmethod
    def _check_job(job: dict[str, Any], plan_id: str | None = None) -> None:
        if (not isinstance(job.get("id"), str) or not OPTIMIZATION_ID.fullmatch(job["id"])
                or job.get("status") not in {"queued", "running", "succeeded", "failed", "cancelled"}
                or (plan_id is not None and job.get("plan_id") != plan_id)):
            raise failure(502, "upstream_invalid_response", "The service returned an invalid optimization job.")
