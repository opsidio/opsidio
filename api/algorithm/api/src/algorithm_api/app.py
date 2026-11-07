"""Serve the immutable corridor workflow in one application process."""

import json
import logging
import os
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException

from .engine import ComputationTimeout, compare_lanes, simulate
from .models import OptimizationResource, PlanDocument, PlanResource, RunResource, canonical_hash
from .store import ReplayWrite, Store
from .event_store import EventStore
from .event_routes import register_event_routes

LIMITATIONS = [
    "Synthetic visitors and inputs; no personal visitor records.",
    "Deterministic arrivals and service times without stochastic confidence.",
    "Fixed declared route without obstacle clearance or route choice.",
    "Physical slot capacity is assumed rather than geometrically verified.",
    "No crowd interactions, congestion response, groups, queue switching, or admission service.",
]


def error(status: int, code: str, message: str, *, details=None, headers=None):
    body = {"code": code, "message": message}
    if details is not None:
        body["details"] = details
    return JSONResponse({"error": body}, status_code=status, headers=headers)


def utcnow():
    return datetime.now(timezone.utc)


def create_app(*, database_path: str, api_key: str) -> FastAPI:
    app = FastAPI(openapi_url=None, docs_url=None, redoc_url=None)
    store = Store(database_path)
    event_store = EventStore(database_path)
    mutation_lock = threading.Lock()

    @app.exception_handler(HTTPException)
    async def http_error(request, exc):
        headers = exc.headers
        if exc.status_code == 405:
            route = request.scope.get("route")
            path = getattr(route, "path", request.url.path)
            allowed = sorted({method for candidate in app.routes if getattr(candidate, "path", None) == path for method in (getattr(candidate, "methods", None) or set())})
            headers = {**(headers or {}), "Allow": ", ".join(allowed)}
        return error(exc.status_code, "not_found" if exc.status_code == 404 else "http_error", str(exc.detail), headers=headers)

    @app.exception_handler(Exception)
    async def unexpected_error(request, exc):
        logging.getLogger(__name__).error("Unhandled application error", exc_info=exc)
        return error(500, "internal_error", "Internal server error")

    @app.middleware("http")
    async def authenticate(request: Request, call_next):
        if request.url.path.startswith(("/v3/", "/v4/")):
            supplied = request.headers.get("X-API-Key", "")
            if not api_key or not secrets.compare_digest(supplied.encode(), api_key.encode()):
                return error(401, "invalid_api_key", "Invalid or missing API key")
        return await call_next(request)

    def make_plan(document, parent_id=None):
        return PlanResource(id="pln_" + uuid4().hex, parent_id=parent_id, document=document,
                            snapshot_hash=canonical_hash(document.model_dump(mode="json")), created_at=utcnow().isoformat().replace("+00:00", "Z"))

    def make_run(plan, output):
        return RunResource(id="run_" + uuid4().hex, plan_id=plan.id,
                           snapshot_hash=plan.snapshot_hash, created_at=utcnow().isoformat().replace("+00:00", "Z"), model_id="corridor_v1",
                           engine_version="1.0.0", output=output, limitations=LIMITATIONS)

    def replay_response(operation, target, key, request_hash):
        replay = store.get_replay(operation, target, key, now=utcnow()) if key is not None else None
        if replay is None:
            return None
        if replay.request_hash != request_hash:
            return error(409, "idempotency_conflict", "Idempotency key was used with different content")
        return JSONResponse(replay.response_json, status_code=replay.status_code)

    def mutate(operation, target, submitted, key, request_hash):
        previous = replay_response(operation, target, key, request_hash)
        if previous is not None:
            return previous
        if not mutation_lock.acquire(blocking=False):
            return error(429, "service_busy", "Another POST request is being processed", headers={"Retry-After": "1"})
        try:
            previous = replay_response(operation, target, key, request_hash)
            if previous is not None:
                return previous
            plans, runs, optimizations = [], [], []
            if operation == "createCorridorPlan":
                resource = make_plan(PlanDocument.model_validate(submitted))
                plans.append(resource)
                status = 201
            else:
                if submitted != {}:
                    return error(422, "validation_failed", "Action body must be an empty object",
                                 details=[{"field": "body", "message": "Expected an empty object"}])
                plan = store.get_plan(target)
                if plan is None:
                    return error(404, "plan_not_found", "Plan not found")
                status = 200
                if operation == "simulateCorridorPlan":
                    resource = make_run(plan, simulate(plan.document, deadline=time.monotonic() + 2))
                    runs.append(resource)
                else:
                    comparison = compare_lanes(plan.document, deadline=time.monotonic() + 10)
                    baseline = make_run(plan, comparison.baseline)
                    runs.append(baseline)
                    candidate = None
                    best = baseline
                    if comparison.best_plan is not None:
                        candidate = make_plan(comparison.best_plan, plan.id)
                        plans.append(candidate)
                        best = make_run(candidate, comparison.best)
                        runs.append(best)
                    resource = OptimizationResource(
                        id="opt_" + uuid4().hex, plan_id=plan.id, created_at=utcnow().isoformat().replace("+00:00", "Z"),
                        baseline_run_id=baseline.id, best_run_id=best.id,
                        candidate_plan_id=candidate.id if candidate else None,
                        improved=candidate is not None, stop_reason=comparison.stop_reason,
                        evaluations=comparison.evaluations)
                    optimizations.append(resource)
            body = resource.model_dump(mode="json")
            replay = None if key is None else ReplayWrite(
                operation=operation, target=target, key=key, request_hash=request_hash,
                status_code=status, response_json=body, expiry=utcnow() + timedelta(hours=24))
            store.commit_resources(plans=plans, runs=runs, optimizations=optimizations, replay=replay)
            return JSONResponse(body, status_code=status)
        except ValidationError as exc:
            details = [{"field": ".".join(str(p) for p in item["loc"]), "message": item["msg"]}
                       for item in exc.errors()]
            return error(422, "validation_failed", "Invalid plan document", details=details)
        except ComputationTimeout:
            return error(503, "computation_timeout", "Computation exceeded its deadline")
        finally:
            mutation_lock.release()

    async def post(request, operation, target=""):
        data = bytearray()
        async for chunk in request.stream():
            data.extend(chunk)
            if len(data) >= 1024 * 1024:
                return error(413, "body_too_large", "Request body must be below 1 MiB")
        try:
            submitted = json.loads(data)
            request_hash = canonical_hash(submitted)
        except (ValueError, TypeError, UnicodeDecodeError):
            return error(422, "validation_failed", "Invalid JSON body",
                         details=[{"field": "body", "message": "Expected finite JSON content"}])
        return await run_in_threadpool(mutate, operation, target, submitted,
                                      request.headers.get("Idempotency-Key"), request_hash)

    @app.get("/health", operation_id="getHealth")
    async def health():
        return {"status": "ok"}

    @app.post("/v3/plans", operation_id="createCorridorPlan")
    async def create_plan(request: Request):
        return await post(request, "createCorridorPlan")

    @app.post("/v3/plans/{plan_id}/simulate", operation_id="simulateCorridorPlan")
    async def simulate_plan(plan_id: str, request: Request):
        return await post(request, "simulateCorridorPlan", plan_id)

    @app.post("/v3/plans/{plan_id}/optimize", operation_id="optimizeCorridorPlan")
    async def optimize_plan(plan_id: str, request: Request):
        return await post(request, "optimizeCorridorPlan", plan_id)

    @app.get("/v3/plans/{plan_id}", operation_id="getCorridorPlan")
    def get_plan(plan_id: str):
        resource = store.get_plan(plan_id)
        if resource is None:
            return error(404, "plan_not_found", "Plan not found")
        body = resource.model_dump(mode="json")
        body["candidate_plans"] = [candidate.model_dump(mode="json") for candidate in store.list_candidate_plans(plan_id)]
        return body

    @app.get("/v3/runs/{run_id}", operation_id="getCorridorRun")
    def get_run(run_id: str):
        resource = store.get_run(run_id)
        return resource if resource else error(404, "run_not_found", "Run not found")

    @app.get("/v3/optimizations/{optimization_id}", operation_id="getCorridorOptimization")
    def get_optimization(optimization_id: str):
        resource = store.get_optimization(optimization_id)
        return resource if resource else error(404, "optimization_not_found", "Optimization not found")

    register_event_routes(app, store=event_store, mutation_lock=mutation_lock)
    return app


app = create_app(database_path=os.environ.get("DATABASE_PATH", "./corridor.sqlite3"),
                 api_key=os.environ.get("API_KEY", ""))
