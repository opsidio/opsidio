"""Persist event-entry plans, immutable snapshots, and atomic replays."""

import base64
import json
from datetime import datetime

from .event_migrations import migrate_event_schema
from .event_models import EventInputError, EventPlanResource, EventRunResource
from .store import Replay, ReplayWrite, Store


def encode_cursor(created_at: str, resource_id: str) -> str:
    return base64.urlsafe_b64encode(json.dumps([created_at, resource_id], separators=(",", ":")).encode()).decode().rstrip("=")


def decode_cursor(cursor: str) -> tuple[str, str]:
    try:
        if len(cursor) > 2048:
            raise ValueError
        values = json.loads(base64.b64decode(cursor + "=" * (-len(cursor) % 4), altchars=b"-_", validate=True))
        if not isinstance(values, list) or len(values) != 2 or not all(isinstance(value, str) and value for value in values):
            raise ValueError
        return values[0], values[1]
    except (ValueError, UnicodeError) as exc:
        raise EventInputError(422, "validation_failed", "Invalid cursor", [{"field": "cursor", "message": "Expected a valid pagination cursor"}]) from exc


class EventStore(Store):
    def __init__(self, path: str):
        self.path = path
        migrate_event_schema(path)

    def get_event_plan(self, plan_id: str) -> EventPlanResource | None:
        return self._get("event_plans", plan_id, EventPlanResource)

    def get_event_run(self, run_id: str) -> EventRunResource | None:
        return self._get("event_runs", run_id, EventRunResource)

    def list_event_resources(self, kind: str, *, plan_id: str | None, limit: int, cursor: str | None) -> dict:
        if kind not in ("plans", "runs"):
            raise ValueError("Unknown event resource kind")
        table = "event_plans" if kind == "plans" else "event_runs"
        filters, parameters = [], []
        if plan_id is not None:
            filters.append("plan_id = ?")
            parameters.append(plan_id)
        if cursor is not None:
            created_at, resource_id = decode_cursor(cursor)
            filters.append("(created_at < ? OR (created_at = ? AND id < ?))")
            parameters.extend([created_at, created_at, resource_id])
        where = " WHERE " + " AND ".join(filters) if filters else ""
        with self._connect() as connection:
            rows = connection.execute("SELECT created_at, id, body FROM " + table + where + " ORDER BY created_at DESC, id DESC LIMIT ?", [*parameters, limit + 1]).fetchall()
        page = rows[:limit]
        return {"data": [json.loads(row[2]) for row in page], "next_cursor": encode_cursor(page[-1][0], page[-1][1]) if len(rows) > limit else None}

    def get_event_replay(self, operation: str, target: str, key: str, *, now: datetime) -> Replay | None:
        with self._connect() as connection:
            row = connection.execute("SELECT request_hash, status_code, response_json, expiry FROM event_replays WHERE version=? AND operation=? AND target=? AND key=?", ("v4", operation, target, key)).fetchone()
        if row is None or datetime.fromisoformat(row[3]) <= now:
            return None
        return Replay(row[0], row[1], json.loads(row[2]), datetime.fromisoformat(row[3]))

    def commit_event_change(self, *, plan: EventPlanResource | None, run: EventRunResource | None, delete_plan_id: str | None, replay: ReplayWrite | None) -> None:
        with self._connect() as connection:
            if plan is not None:
                connection.execute("INSERT INTO event_plans VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET body=excluded.body", (plan.id, plan.created_at, plan.model_dump_json()))
            if run is not None:
                snapshot_id = "snp_" + run.id
                connection.execute("INSERT INTO event_snapshots VALUES (?, ?, ?, ?)", (snapshot_id, run.plan_id, run.snapshot_hash, json.dumps(run.snapshot_document, ensure_ascii=False, allow_nan=False)))
                connection.execute("INSERT INTO event_runs VALUES (?, ?, ?, ?, ?)", (run.id, run.plan_id, snapshot_id, run.created_at, run.model_dump_json()))
            if delete_plan_id is not None:
                connection.execute("DELETE FROM event_plans WHERE id=?", (delete_plan_id,))
            if replay is not None:
                connection.execute("INSERT OR REPLACE INTO event_replays VALUES (?, ?, ?, ?, ?, ?, ?, ?)", ("v4", replay.operation, replay.target, replay.key, replay.request_hash, replay.status_code, json.dumps(replay.response_json, ensure_ascii=False, allow_nan=False), replay.expiry.isoformat()))
