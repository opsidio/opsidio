# Phase 1 Railway deployment

Date: 2026-11-07
Authorization: The user requested deployment under project `opsidio`.
Actor: Authenticated Railway account on Mac B, through Codex and Railway CLI 5.71.0.
Source: Local service upload from base commit `24aac33d7ed8f22a9fa771a753a0667228ee4eb9`, with new Docker packaging.

## Target

| Setting | Value |
| --- | --- |
| Project | `opsidio`, `9baf9b83-09bb-46e8-8702-c79d21968ce2` |
| Service | `opsidio-api`, `5d0900c0-8976-4ae5-ab5c-ed5397b6e3f5` |
| Environment | `production` |
| Public URL | `https://opsidio-api-production.up.railway.app` |
| Region | `asia-southeast1-eqsg3a`, Singapore |
| Replicas | One, serverless off |
| Volume | `opsidio-api-volume`, `/data` |
| Database | `/data/corridor.sqlite3` |
| Variables | `API_KEY`, `DATABASE_PATH`, Railway-provided `PORT` |
| Health check | Public `/health` |
| Initial deployment | `a509e606-7b23-4a10-b2ed-f5710e4623d5`, created 2026-11-07T06:37:53.474Z |
| Image digest | `sha256:ad547bdcf27059809108f91090eb98c3f7cba2c98447adeccdd0709f93be6293` |

## Changes

Added the service [Dockerfile](../../api/Dockerfile) and [.dockerignore](../../api/.dockerignore).
The image installs locked production dependencies and starts one Uvicorn worker on Railway's `PORT`.
The existing application initializes SQLite after Railway mounts its volume.
The API contract and application code remain unchanged.

Created the project, service, volume, domain, and variables through the authenticated Railway CLI.
Used the public GraphQL API to replace the default region map and configure `/health`.
The Railway MCP was unavailable in this session.
Generated the API key and piped it directly into Railway variables.
No secret value was saved in the repository or printed.

## Verification

- `uv run pytest -q`: 10 passed in 10.40 seconds.
- `npx --yes @redocly/cli@2 lint --skip-rule info-license openapi.yaml`: valid, exit 0.
- The lint tool reported a local Node version warning: installed 22.4.1; expected at least 22.12.0.
- Railway built the Docker image and reported the initial deployment as `SUCCESS`.
- Public `GET /health`: 200 and `{"status":"ok"}`.
- Unauthenticated `/v3` request: 401.
- Authenticated create, simulate, and optimize: 201, 200, and 200.
- Saved plan, Run, and Optimization reads matched their creation results. Plan reads also include candidate plans.
- The two-visitor example admitted both visitors, computed a five-metre route, and found an improved lane candidate.
- Redeployed the same image as `19a8b776-6edf-47f1-8d43-6ef2fa1576d6`; Railway reported `SUCCESS`.
- After redeployment, the saved plan, Run, and Optimization remained readable and exactly matched their previous GET responses.

Smoke resources retained for deployment verification:

| Resource | ID |
| --- | --- |
| Plan | `pln_47a303dec6254a5d8f29702be09975aa` |
| Run | `run_0db7d3fc2ae54495865ae7686fddbff8` |
| Optimization | `opt_dfb11d049c184e5bbcbfa409b4fffeea` |

## Operate and recover

Run commands from `api/algorithm/api/`:

```sh
railway link --project opsidio --service opsidio-api --environment production
railway up --service opsidio-api --environment production
```

Retrieve `API_KEY` through the service's Railway Variables page.
Send it as `X-API-Key` for `/v3` operations.

Stop the service with `railway down --yes`; retain its volume and domain.
For subsequent releases, select the previous deployment's Rollback action in Railway.
Check database compatibility before rolling back a storage change.

The volume preserves data across redeployments; it is not a verified backup policy.
Volume-backed redeployments briefly interrupt service.
No load test, restore drill, or Phase 2 acceptance was performed.

See Railway's [Dockerfile documentation](https://docs.railway.com/builds/dockerfiles) and [volume reference](https://docs.railway.com/volumes/reference).
