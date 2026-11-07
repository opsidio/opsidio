"""Register editable event-entry workflows alongside corridor routes."""

import json
import logging
import time
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi import Request
from fastapi.responses import JSONResponse, Response
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool

from .engine import ComputationTimeout
from .event_documents import create_document, edit_item, merge_document
from .event_models import EventInputError, EventPlanResource, EventRunResource
from .event_presets import apply_preset, get_preset, list_presets
from .event_runtime import compute_event
from .event_store import decode_cursor, encode_cursor
from .event_validation import resolve_settings, validate_ready
from .models import canonical_hash
from .store import ReplayWrite


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _timestamp() -> str:
    return _now().isoformat(timespec="microseconds").replace("+00:00", "Z")


def _error(status: int, code: str, message: str, details=None, headers=None):
    content = {"code": code, "message": message}
    if details is not None:
        content["details"] = details
    return JSONResponse({"error": content}, status_code=status, headers=headers)


def _invalid(field: str, message: str):
    return EventInputError(422, "validation_failed", message, [{"field": field, "message": message}])


def _pagination(request: Request) -> tuple[int, str | None]:
    value = request.query_params.get("limit", "20")
    try:
        limit = int(value)
    except ValueError as exc:
        raise _invalid("limit", "Limit must be an integer from 1 to 100") from exc
    if str(limit) != value or not 1 <= limit <= 100:
        raise _invalid("limit", "Limit must be an integer from 1 to 100")
    return limit, request.query_params.get("cursor")


def register_event_routes(app, *, store, mutation_lock):
    logger = logging.getLogger("uvicorn.error")

    def plan_for(plan_id):
        plan = store.get_event_plan(plan_id)
        if plan is None:
            raise EventInputError(404, "plan_not_found", "Plan not found", [])
        return plan

    def replay_response(operation, target, key, body_hash):
        replay = store.get_event_replay(operation, target, key, now=_now()) if key is not None else None
        if replay is None:
            return None
        if replay.request_hash != body_hash:
            return _error(409, "idempotency_conflict", "Idempotency key was used with different content")
        return JSONResponse(replay.response_json, status_code=replay.status_code)

    def read(request, operation, kind):
        params = request.path_params
        if operation.startswith("listEvent"):
            limit, cursor = _pagination(request)
            if kind in ("venue", "step"):
                records = sorted(list_presets(kind), key=lambda item: item["id"], reverse=True)
                if cursor is not None:
                    marker, last_id = decode_cursor(cursor)
                    if marker != "preset":
                        raise _invalid("cursor", "Invalid preset cursor")
                    records = [record for record in records if record["id"] < last_id]
                page = records[:limit]
                return {"data": page, "next_cursor": encode_cursor("preset", page[-1]["id"]) if len(records) > limit else None}
            plan_id = params.get("plan_id")
            if plan_id is not None:
                plan_for(plan_id)
            return store.list_event_resources(kind, plan_id=plan_id, limit=limit, cursor=cursor)
        if kind in ("venue", "step"):
            preset = get_preset(kind, params["preset_id"])
            if preset is None:
                raise EventInputError(404, "preset_not_found", "Preset not found", [])
            return preset
        if kind == "plans":
            return plan_for(params["plan_id"]).model_dump(mode="json")
        run = store.get_event_run(params["run_id"])
        if run is None:
            raise EventInputError(404, "run_not_found", "Run not found", [])
        return run.model_dump(mode="json")

    def mutate(request, operation, submitted, body_hash):
        params = request.path_params
        target = params.get("plan_id", "")
        key = request.headers.get("Idempotency-Key") if request.method == "POST" else None
        previous = replay_response(operation, target, key, body_hash)
        if previous is not None:
            return previous
        if not mutation_lock.acquire(blocking=False):
            return _error(429, "service_busy", "Another mutation is being processed", headers={"Retry-After": "1"})
        try:
            previous = replay_response(operation, target, key, body_hash)
            if previous is not None:
                return previous
            status, changed_plan, run, delete_plan_id = 200, None, None, None
            if operation == "createEventPlan":
                timestamp = _timestamp()
                changed_plan = EventPlanResource(id="epl_" + uuid4().hex, created_at=timestamp, updated_at=timestamp, document=create_document(submitted))
                status = 201
                body = changed_plan.model_dump(mode="json")
            else:
                plan = plan_for(target)
                document = plan.document
                if operation == "deleteEventPlan":
                    delete_plan_id = target
                    status, body = 204, None
                elif operation == "validateEventPlan":
                    if submitted:
                        raise _invalid("body", "Validation body must be an empty object")
                    body = validate_ready(document).model_dump(mode="json")
                elif operation == "simulateEventPlan":
                    resolved = resolve_settings(document, submitted)
                    population = document.get("event", {})
                    count = sum(item.get("sold", 0) + item.get("issued", 0) for item in population.get("ticket_categories", []))
                    if count > 10000:
                        raise EventInputError(422, "workload_limit_exceeded", "Simulation supports at most 10,000 sold-plus-issued ticket holders", [{"field": "event", "message": "Sold-plus-issued total exceeds 10,000"}])
                    validation = validate_ready(document)
                    if not validation.valid:
                        raise EventInputError(422, "plan_invalid", "Plan is not ready for simulation", [{"field": issue.field, "message": issue.message} for issue in validation.issues if issue.severity == "error"])
                    started = time.monotonic()
                    logger.info(json.dumps({"event": "event_computation_started", "operation": operation, "request_id": request.state.event_request_id, "method": resolved["simulation_method"], "engine_version": "event_entry_v1"}))
                    try:
                        result = compute_event(document, resolved, deadline=started + 60)
                    finally:
                        logger.info(json.dumps({"event": "event_computation_stopped", "operation": operation, "request_id": request.state.event_request_id, "duration_ms": round((time.monotonic() - started) * 1000, 3), "method": resolved["simulation_method"], "engine_version": "event_entry_v1"}))
                    from .event_engine import CAPACITY_MODEL_VERSION, ENGINE_VERSION
                    run_id, created_at = "ern_" + uuid4().hex, _timestamp()
                    snapshot_hash = canonical_hash(document)
                    output = result["output"]
                    manifest = output.setdefault("run_manifest", {})
                    manifest.update({"run_id": run_id, "plan_id": target, "created_at": created_at, "snapshot_hash": snapshot_hash, "engine_version": ENGINE_VERSION, "capacity_model_version": CAPACITY_MODEL_VERSION, "resolved_settings": resolved})
                    run = EventRunResource(id=run_id, plan_id=target, created_at=created_at, snapshot_hash=snapshot_hash, snapshot_document=document, simulation_method=resolved["simulation_method"], request_settings=submitted, resolved_settings=resolved, engine_version=ENGINE_VERSION, runtime_ms=(time.monotonic() - started) * 1000, output=output, limitations=result["limitations"])
                    body = run.model_dump(mode="json")
                else:
                    if operation == "updateEventPlan":
                        document = merge_document(document, submitted)
                    elif "Preset" in operation:
                        if set(submitted) != {"preset_id"} or not isinstance(submitted["preset_id"], str) or not submitted["preset_id"]:
                            raise _invalid("preset_id", "Expected a nonempty preset_id")
                        document = apply_preset(document, "venue" if "Venue" in operation else "step", submitted["preset_id"])
                    else:
                        collection = "steps" if "Step" in operation else "roles"
                        action = "create" if operation.startswith("create") else "update" if operation.startswith("update") else "delete"
                        document = edit_item(document, collection, action, params.get("step_id", params.get("role_id")), submitted if action != "delete" else None)
                        status = 201 if action == "create" else 204 if action == "delete" else 200
                    changed_plan = plan.model_copy(update={"document": document, "updated_at": _timestamp()})
                    body = changed_plan.model_dump(mode="json") if status != 204 else None
            replay = None if key is None else ReplayWrite(operation=operation, target=target, key=key, request_hash=body_hash, status_code=status, response_json=body, expiry=_now() + timedelta(hours=24))
            store.commit_event_change(plan=changed_plan, run=run, delete_plan_id=delete_plan_id, replay=replay)
            return Response(status_code=204) if status == 204 else JSONResponse(body, status_code=status)
        finally:
            mutation_lock.release()

    def endpoint_for(operation, kind=None):
        async def endpoint(request: Request):
            started = time.monotonic()
            request.state.event_request_id = uuid4().hex
            status = 500
            submitted = None
            try:
                if request.method == "GET":
                    response = JSONResponse(await run_in_threadpool(read, request, operation, kind))
                else:
                    data = bytearray()
                    async for chunk in request.stream():
                        data.extend(chunk)
                        if len(data) >= 1024 * 1024:
                            status = 413
                            return _error(413, "body_too_large", "Request body must be below 1 MiB")
                    try:
                        submitted = json.loads(data) if data else {} if operation == "validateEventPlan" or request.method == "DELETE" else json.loads(data)
                        body_hash = canonical_hash(submitted)
                    except (ValueError, TypeError, UnicodeError, RecursionError) as exc:
                        raise _invalid("body", "Expected finite JSON content") from exc
                    if not isinstance(submitted, dict):
                        raise _invalid("body", "Expected a JSON object")
                    idempotency_key = request.headers.get("Idempotency-Key")
                    if request.method == "POST" and idempotency_key is not None and len(idempotency_key) > 200:
                        raise _invalid("Idempotency-Key", "Idempotency-Key must be at most 200 characters")
                    response = await run_in_threadpool(mutate, request, operation, submitted, body_hash)
                status = response.status_code
                return response
            except EventInputError as exc:
                status = exc.status
                return _error(exc.status, exc.code, exc.message, exc.details if exc.details else None)
            except ValidationError as exc:
                status = 422
                return _error(422, "validation_failed", "Invalid event request", [{"field": ".".join(map(str, item["loc"])), "message": item["msg"]} for item in exc.errors()])
            except ComputationTimeout:
                status = 503
                return _error(503, "computation_timeout", "Computation exceeded its deadline")
            except Exception:
                logger.exception("Event request failed operation=%s", operation)
                return _error(500, "internal_error", "Internal server error")
            finally:
                method = submitted.get("simulation_method") if isinstance(submitted, dict) else None
                method = method if isinstance(method, str) and method in ("flow", "des") else None
                logger.info(json.dumps({"event": "event_request", "operation": operation, "request_id": request.state.event_request_id, "status": status, "duration_ms": round((time.monotonic() - started) * 1000, 3), "method": method, "engine_version": "event_entry_v1"}))
        return endpoint

    operations = [
        ("GET", "/v4/venue-presets", "listEventVenuePresets", "venue"),
        ("GET", "/v4/venue-presets/{preset_id}", "getEventVenuePreset", "venue"),
        ("GET", "/v4/step-presets", "listEventStepPresets", "step"),
        ("GET", "/v4/step-presets/{preset_id}", "getEventStepPreset", "step"),
        ("POST", "/v4/plans", "createEventPlan", None),
        ("GET", "/v4/plans", "listEventPlans", "plans"),
        ("GET", "/v4/plans/{plan_id}", "getEventPlan", "plans"),
        ("PATCH", "/v4/plans/{plan_id}", "updateEventPlan", None),
        ("DELETE", "/v4/plans/{plan_id}", "deleteEventPlan", None),
        ("POST", "/v4/plans/{plan_id}/steps", "createEventStep", None),
        ("PATCH", "/v4/plans/{plan_id}/steps/{step_id}", "updateEventStep", None),
        ("DELETE", "/v4/plans/{plan_id}/steps/{step_id}", "deleteEventStep", None),
        ("POST", "/v4/plans/{plan_id}/roles", "createEventRole", None),
        ("PATCH", "/v4/plans/{plan_id}/roles/{role_id}", "updateEventRole", None),
        ("DELETE", "/v4/plans/{plan_id}/roles/{role_id}", "deleteEventRole", None),
        ("POST", "/v4/plans/{plan_id}/apply-venue-preset", "applyEventVenuePreset", None),
        ("POST", "/v4/plans/{plan_id}/apply-step-preset", "applyEventStepPreset", None),
        ("POST", "/v4/plans/{plan_id}/validate", "validateEventPlan", None),
        ("POST", "/v4/plans/{plan_id}/simulate", "simulateEventPlan", None),
        ("GET", "/v4/plans/{plan_id}/runs", "listEventRuns", "runs"),
        ("GET", "/v4/runs/{run_id}", "getEventRun", "runs"),
    ]
    for method, path, operation, kind in operations:
        app.add_api_route(path, endpoint_for(operation, kind), methods=[method], operation_id=operation)
