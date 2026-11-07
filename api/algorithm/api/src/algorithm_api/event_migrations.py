"""Back up SQLite once and apply additive event-entry migrations."""

import os
import sqlite3
from pathlib import Path
from uuid import uuid4


MIGRATION = 1
SCHEMA = (
    "CREATE TABLE IF NOT EXISTS event_schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
    "CREATE TABLE event_plans (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, body TEXT NOT NULL)",
    "CREATE TABLE event_snapshots (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES event_plans(id) ON DELETE CASCADE, snapshot_hash TEXT NOT NULL, document TEXT NOT NULL)",
    "CREATE TABLE event_runs (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES event_plans(id) ON DELETE CASCADE, snapshot_id TEXT NOT NULL REFERENCES event_snapshots(id) ON DELETE CASCADE, created_at TEXT NOT NULL, body TEXT NOT NULL)",
    "CREATE INDEX event_plans_page ON event_plans(created_at DESC, id DESC)",
    "CREATE INDEX event_runs_page ON event_runs(plan_id, created_at DESC, id DESC)",
    "CREATE TABLE event_replays (version TEXT NOT NULL, operation TEXT NOT NULL, target TEXT NOT NULL, key TEXT NOT NULL, request_hash TEXT NOT NULL, status_code INTEGER NOT NULL, response_json TEXT NOT NULL, expiry TEXT NOT NULL, PRIMARY KEY(version, operation, target, key))",
)


def migrate_event_schema(path: str) -> None:
    database = Path(path)
    connection = sqlite3.connect(path, timeout=5)
    connection.execute("PRAGMA foreign_keys=ON")
    connection.execute("PRAGMA busy_timeout=5000")
    try:
        ledger = connection.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='event_schema_migrations'").fetchone()
        if ledger and connection.execute("SELECT 1 FROM event_schema_migrations WHERE version=?", (MIGRATION,)).fetchone():
            return
        backups = database.parent / "backups"
        backups.mkdir(exist_ok=True)
        backup = backups / (database.name + ".before-event-001.sqlite3")
        if not backup.exists():
            temporary = backups / (backup.name + "." + uuid4().hex + ".tmp")
            try:
                destination = sqlite3.connect(temporary)
                try:
                    connection.backup(destination)
                    destination.execute("PRAGMA journal_mode=DELETE")
                    if destination.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                        raise RuntimeError("Event migration backup failed integrity check")
                finally:
                    destination.close()
                with temporary.open("rb") as stream:
                    os.fsync(stream.fileno())
                os.replace(temporary, backup)
                directory = os.open(backups, os.O_RDONLY)
                try:
                    os.fsync(directory)
                finally:
                    os.close(directory)
            finally:
                temporary.unlink(missing_ok=True)
        with connection:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute(SCHEMA[0])
            if connection.execute("SELECT 1 FROM event_schema_migrations WHERE version=?", (MIGRATION,)).fetchone():
                return
            for statement in SCHEMA[1:]:
                connection.execute(statement)
            connection.execute("INSERT INTO event_schema_migrations VALUES (?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))", (MIGRATION,))
    finally:
        connection.close()
