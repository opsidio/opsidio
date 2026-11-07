# Phase 2 Railway deployment

Date: 2026-11-07
Status: Production deployment succeeded; post-redeploy persistence comparison remains open.
Authorization: The user authorized production release and later directed completion beyond the original one-hour window.
Source: Local upload from `donisury21/first-deploy-algorithm` with Railway CLI 5.71.0.

## Target

| Setting | Value |
| --- | --- |
| Project | `opsidio`, `9baf9b83-09bb-46e8-8702-c79d21968ce2` |
| Service | `opsidio-api`, `5d0900c0-8976-4ae5-ab5c-ed5397b6e3f5` |
| Environment | `production`, `57de2987-9915-4ab6-9e13-09b960b94d13` |
| Public URL | `https://opsidio-api-production.up.railway.app` |
| Region and replicas | `asia-southeast1-eqsg3a`, one replica |
| Volume and database | `/data`, `/data/corridor.sqlite3` |
| Health check | Public `/health` |
| Variables | Existing `API_KEY`, `DATABASE_PATH`, and Railway `PORT` retained |
| Previous successful deployment | `19a8b776-6edf-47f1-8d43-6ef2fa1576d6`, image `sha256:2dbb4d90508483d451ad577ecf9eadf2197e6ea831d8e9b9951bf115f4b2236c` |
| Phase 2 deployment | `33340aaf-6fcd-4504-abf7-1c337dcd6981`, image `sha256:a577383cd2c4cfece453df9bc98151b871a634d006982f128d3dd5772ec32da6` |

## Release checks

- `railway up --service opsidio-api --environment production --ci --message "Deploy Phase 2 event-entry simulation"`: exit 0; Railway reported `Deploy complete` and `SUCCESS`.
- Public `/health`: 200 with `{"status":"ok"}`.
- Missing API key on `/v3`: 401.
- H13 capture test: one passed, one skipped in 58.62 seconds. It checked v3 baseline reads, a v3 lane optimization, v4 presets, readiness, item edits, a full reference flow run, and a full reference DES run at 20 replications.
- The v3 Plan, Run, and Optimization bodies matched the saved pre-release bodies byte-for-byte. Their SHA-256 values remain `16f0e586814334e2ba4002bbeca04e17ff0b400d0d4aa6e954a30534d4dd472f`, `83f24f97d8d764e198a8dbce30f2194e9e0cf83939f7d960bf695288096a3e46`, and `41cb536e3afc8fba92e62cb941d193c4807107002425b3f1650820ed8d8ccfda`.
- Public v4 resources: Plan `epl_e63f1fccca7a41f5b8189bb6e453937f`; DES/20 Run `ern_092e298c7b8a4e3e8f4fdcdf86c74dd7`.
- Exact v3/v4 GET bodies from this capture are in `/tmp/phase2-public-capture.json` for the planned same-image redeployment comparison.

## Open acceptance

The user asked to skip the second deployment check because of time. The same-image redeployment and exact post-redeploy v3/v4 GET comparison were not run.

The migration code verifies the first-migration SQLite backup before applying the additive schema. The production service started and accepted v4 writes. Direct inspection of the production backup file was not possible because Railway SSH has no registered key; no SSH key was added.

Schemathesis reported 4,052 passing cases and two warnings, then stalled after its summary. The run was terminated with exit 143. The user moved this check to the Phase 2 open-items list.

Do not roll back to the removed deployment `a509e606-7b23-4a10-b2ed-f5710e4623d5`. If rollback is required, use the captured previous successful deployment above and preserve the database volume and migration backup.
