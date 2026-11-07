"""Persist immutable corridor resources and atomic replay responses."""

import json
import sqlite3
from dataclasses import dataclass
from contextlib import contextmanager
from datetime import datetime

from .models import OptimizationResource, PlanResource, RunResource


@dataclass
class Replay:
    request_hash: str
    status_code: int
    response_json: dict
    expiry: datetime


@dataclass
class ReplayWrite(Replay):
    operation: str
    target: str
    key: str


class Store:
    def __init__(self, path: str):
        self.path = path
        with self._connect() as connection:
            connection.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS plans (
                    id TEXT PRIMARY KEY,
                    parent_id TEXT REFERENCES plans(id),
                    body TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS runs (
                    id TEXT PRIMARY KEY,
                    plan_id TEXT NOT NULL REFERENCES plans(id),
                    body TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS optimizations (
                    id TEXT PRIMARY KEY,
                    plan_id TEXT NOT NULL REFERENCES plans(id),
                    baseline_run_id TEXT NOT NULL REFERENCES runs(id),
                    best_run_id TEXT NOT NULL REFERENCES runs(id),
                    candidate_plan_id TEXT REFERENCES plans(id),
                    body TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS replays (
                    operation TEXT NOT NULL, target TEXT NOT NULL, key TEXT NOT NULL,
                    request_hash TEXT NOT NULL, status_code INTEGER NOT NULL,
                    response_json TEXT NOT NULL, expiry TEXT NOT NULL,
                    PRIMARY KEY(operation, target, key)
                );
            """)

    @contextmanager
    def _connect(self):
        connection = sqlite3.connect(self.path, timeout=5)
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA busy_timeout=5000")
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def _get(self, table: str, id: str, model):
        with self._connect() as connection:
            row = connection.execute(f"SELECT body FROM {table} WHERE id = ?", (id,)).fetchone()
        return model.model_validate_json(row[0]) if row else None

    def get_plan(self, id: str) -> PlanResource | None:
        return self._get("plans", id, PlanResource)

    def list_candidate_plans(self, parent_id: str) -> list[PlanResource]:
        with self._connect() as connection:
            rows = connection.execute("SELECT body FROM plans WHERE parent_id = ? ORDER BY id", (parent_id,)).fetchall()
        return [PlanResource.model_validate_json(row[0]) for row in rows]

    def get_run(self, id: str) -> RunResource | None:
        return self._get("runs", id, RunResource)

    def get_optimization(self, id: str) -> OptimizationResource | None:
        return self._get("optimizations", id, OptimizationResource)

    def get_replay(self, operation: str, target: str, key: str, *, now: datetime) -> Replay | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT request_hash, status_code, response_json, expiry FROM replays "
                "WHERE operation = ? AND target = ? AND key = ?", (operation, target, key)
            ).fetchone()
        if row is None or datetime.fromisoformat(row[3]) <= now:
            return None
        return Replay(row[0], row[1], json.loads(row[2]), datetime.fromisoformat(row[3]))

    def commit_resources(self, *, plans: list[PlanResource], runs: list[RunResource],
                         optimizations: list[OptimizationResource], replay: ReplayWrite | None) -> None:
        with self._connect() as connection:
            for plan in plans:
                connection.execute("INSERT INTO plans VALUES (?, ?, ?)",
                                   (plan.id, plan.parent_id, plan.model_dump_json()))
            for run in runs:
                connection.execute("INSERT INTO runs VALUES (?, ?, ?)",
                                   (run.id, run.plan_id, run.model_dump_json()))
            for optimization in optimizations:
                connection.execute("INSERT INTO optimizations VALUES (?, ?, ?, ?, ?, ?)",
                                   (optimization.id, optimization.plan_id, optimization.baseline_run_id,
                                    optimization.best_run_id, optimization.candidate_plan_id,
                                    optimization.model_dump_json()))
            if replay:
                connection.execute("INSERT OR REPLACE INTO replays VALUES (?, ?, ?, ?, ?, ?, ?)",
                                   (replay.operation, replay.target, replay.key, replay.request_hash,
                                    replay.status_code, json.dumps(replay.response_json, allow_nan=False),
                                    replay.expiry.isoformat()))
