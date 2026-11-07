# Corridor simulation API

This service saves immutable `corridor-1` plans, deterministic Runs, and measured lane comparisons. It uses one FastAPI process and SQLite WAL.

The model accepts 3–32 route nodes, positive integer visitor and scan lane counts, and a horizon up to 86,400 seconds.
Visitor and lane counts have no fixed upper limit. Active lanes must fit the declared slots, staff, scanners, and budget.
Simulation and optimization retain their computation deadlines.
It assumes a fixed declared route, constant walking speed and scan service, and physical slot capacity supplied by the caller. It does not model crowd interactions, rerouting, stochastic behavior, or admission service. Results are not calibrated venue readiness or a complete ABM.

## Start locally

```sh
uv sync --locked
API_KEY=local-test-key DATABASE_PATH=./corridor.sqlite3 uv run uvicorn algorithm_api.app:app --host 127.0.0.1 --port 8000
```

The public health check is `GET /health`. All `/v3` routes require `X-API-Key`.

## Create and simulate an event-entry plan

Use `/v4` for full event documents. Create a partial plan or send the complete source document.

```sh
curl -sS http://127.0.0.1:8000/v4/plans \
  -H 'X-API-Key: local-test-key' -H 'Content-Type: application/json' -d '{}'

curl -sS -X POST http://127.0.0.1:8000/v4/plans/PLAN_ID/validate \
  -H 'X-API-Key: local-test-key' -H 'Content-Type: application/json' -d '{}'

curl -sS -X POST http://127.0.0.1:8000/v4/plans/PLAN_ID/simulate \
  -H 'X-API-Key: local-test-key' -H 'Content-Type: application/json' \
  -d '{"simulation_method":"des"}'
```

The simulation method must be `flow` or `des`. DES defaults to 20 replications.
Runs preserve the complete input document as an immutable snapshot.
Event-entry plans and runs use separate SQLite tables from corridor records.

## Create and run a plan

```sh
curl -sS http://127.0.0.1:8000/v3/plans \
  -H 'X-API-Key: local-test-key' -H 'Content-Type: application/json' \
  --data-binary @examples/corridor-plan.json

curl -sS -X POST http://127.0.0.1:8000/v3/plans/PLAN_ID/simulate \
  -H 'X-API-Key: local-test-key' -H 'Content-Type: application/json' -d '{}'
```

Use `Idempotency-Key` on POST requests when clients may retry. Plans and computed results persist in the SQLite file.


## Deploy to Railway

The `Dockerfile` installs locked production dependencies with uv and starts one Uvicorn worker.
It binds to Railway's `PORT` on `0.0.0.0`.
The `.dockerignore` excludes local environments, databases, caches, and environment files from the image context.

Run Railway commands from this service directory:

```sh
railway link --project opsidio --service opsidio-api --environment production
railway up --service opsidio-api --environment production
```

Use a volume mounted at `/data` and set `DATABASE_PATH=/data/corridor.sqlite3`.
Store `API_KEY` in Railway variables. Retrieve it through the Railway dashboard; do not commit or print it.
Use the public `/health` endpoint for deployment checks.

The public base URL is `https://opsidio-api-production.up.railway.app`.
All `/v3` requests require the `X-API-Key` header.
A volume-backed redeployment briefly interrupts service.

Stop the deployment with `railway down --yes`; retain the volume for recovery.
For later releases, use Railway's deployment rollback to restore the previous image.
Check database compatibility before rolling back a release that changes storage.
