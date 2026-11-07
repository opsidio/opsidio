# Corridor simulation API

This service saves immutable `corridor-1` plans, deterministic Runs, and measured lane comparisons. It uses one FastAPI process and SQLite WAL.

The model accepts 3–32 route nodes, 1–500 synthetic visitors, 1–8 scan lanes, and a horizon up to 86,400 seconds. It assumes a fixed declared route, constant walking speed and scan service, and physical slot capacity supplied by the caller. It does not model crowd interactions, rerouting, stochastic behavior, or admission service. Results are not calibrated venue readiness or a complete ABM.

## Start locally

```sh
uv sync --locked
API_KEY=local-test-key DATABASE_PATH=./corridor.sqlite3 uv run uvicorn algorithm_api.app:app --host 127.0.0.1 --port 8000
```

The public health check is `GET /health`. All `/v3` routes require `X-API-Key`.

## Create and run a plan

```sh
curl -sS http://127.0.0.1:8000/v3/plans \
  -H 'X-API-Key: local-test-key' -H 'Content-Type: application/json' \
  --data-binary @examples/corridor-plan.json

curl -sS -X POST http://127.0.0.1:8000/v3/plans/PLAN_ID/simulate \
  -H 'X-API-Key: local-test-key' -H 'Content-Type: application/json' -d '{}'
```

Use `Idempotency-Key` on POST requests when clients may retry. Plans and computed results persist in the SQLite file.
