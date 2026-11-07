# AGENTS.md

Read the consolidated rules in this file before you change or deploy anything. They cover the layout, documentation, and Railway commands.

## Questions and answers

For repository questions, read `docs/qna/README.md` and the related topic files before investigating.
Save the question and verified answer in `docs/qna/<topic>.md` before finishing.
Include the date, useful examples, relative links to supporting code or API contracts, and any unresolved uncertainty.
Maintain a linked question index in `docs/qna/README.md` and link the saved answer in the response.
Keep credentials and private personal data out of these files.

Resolve these paths relative to this folder. Use the same Q&A directory for all repository topics.

For follow-up questions:

- **Same topic:** append the question and answer to the existing Markdown file.
- **Different topic:** create a new Markdown file and add it to the Q&A index.

## Codex scope and local paths

This file contains the copied source instructions and the additional agent context, consolidated for OpenAI Codex.

- Use `~/.codex/AGENTS.md` for global Codex instructions. This file sets the project-specific rules.
- This folder is the algorithm product root. Read its existing `openapi.yaml` and `api-quick-start.md` before API work.
- The copied algorithm instructions use `algorithm/` for the product root. Resolve that prefix to this folder.
- Product documentation belongs in this folder's `docs/`; the product glossary belongs in `CONTEXT.md`.
- Resolve the Q&A paths in "Questions and answers" relative to this folder.
- The source multi-product layout and other project instructions below are reference material, not this folder's layout or deployment settings.
- Source-relative documentation links describe the original repository. The linked documents were not copied, except the API style guide included below.
- Source deployment tables and deployment-state statements describe the source projects only. Verify this product's state before deployment.
- Ask before creating Railway resources or changing production infrastructure. Copying this context does not authorize deployment.
- Local scope rules take precedence over conflicting source paths, question locations, and deployment assumptions below.

## Codex configuration

### Railway MCP

The source MCP configurations all define the same Railway HTTP endpoint. Use the native Codex configuration at `.codex/config.toml`:

```toml
[mcp_servers.railway]
url = "https://mcp.railway.com"
```

Project configuration must be trusted by Codex before it can load. Authenticate to Railway when required; keep credentials outside this file.

### OpenAI model preferences from the source

The source model routing includes these OpenAI model identifiers:

| Role | Source identifier |
|---|---|
| Slow | `openai-codex/gpt-6.1-sol:xhigh` |
| Small | `openai-codex/gpt-6-luna` |

These are source routing identifiers, not native Codex configuration keys. Use models supported by the current Codex installation.

## Algorithm product instructions

Source: `hackathon-preparation/AGENTS.md` within the original repository. Apply the local path mapping above.

These product rules apply to Codex. They override the glossary and ADR locations in `~/.codex/AGENTS.md`.

### Layout

```text
algorithm/                the product: one Railway project named algorithm
├── CONTEXT.md            glossary, created with its first term
├── docs/
│   ├── adr/              product decisions, created with the first one
│   ├── qna/              answers to product questions, indexed in README.md
│   ├── specs/            design specs: <yyyy-mm-dd>-<slug>-design.md
│   └── plans/            execution plans: <yyyy-mm-dd>-<slug>/
└── <service>/            one Railway service named algorithm-<service>
    ├── .gitignore        local database files and .schemathesis/
    ├── .python-version   same Python version as the Dockerfile base image
    ├── Dockerfile
    ├── openapi.yaml      API contract, written before the code
    ├── pyproject.toml
    ├── uv.lock
    ├── src/
    └── tests/
docs/adr/                 decisions outside algorithm/
docs/qna/                 answers about repo practices, indexed in README.md
docs/research/            research notes and hackathon context
CONTEXT-MAP.md            every context with its folder and scope
```

- `algorithm/` explains the product. Railway never builds it. It keeps its glossary and decisions inside it, so it can move to its own repo in one step.
- A service folder is the Railway build root. Railway uploads and builds only this folder, so keep everything the service needs inside it, tests and fixtures included. Copy a small helper instead of importing it from another folder.

### Questions and answers

When the user asks a repository question, follow these steps:

1. Use `docs/qna/` for all topics, including repository practices and documentation workflows.
2. Read `docs/qna/README.md` and the related topic files before you investigate.
3. Save the question and the verified answer before you finish:
   - Same topic as an existing file: append `## Follow-up: <question>` with its own `Answered:` date. Link its anchor under the topic in the index.
   - New topic: create `<topic>.md`, and link it from the index.
4. Link the saved answer in your reply. Done when the file holds the answer, the index links it, and your reply links it.

Start a topic file with the question as its title, then `Answered: <yyyy-mm-dd>`, `## Question` with the user's words, `## Answer`, and `## Sources`. Give examples where they help. Link the supporting code or API contract with relative links. State any open uncertainty. Keep credentials and private personal data out of these files.

### APIs

Each service keeps its HTTP contract in `openapi.yaml`, in OpenAPI 3.1, in the service folder. The contract comes first, so teammates and agents can build clients, mocks, and tool calls while the backend is in progress. Schemathesis then checks the code against the contract. FastAPI still serves `/openapi.json` from the code, but `openapi.yaml` is the contract.

Before you write or change API code, check the service's `openapi.yaml`. If it does not describe the change yet, suggest that the user write or update it first, and offer to draft it. Write the route code after the user approves the spec or declines the suggestion.

#### Design an API

1. Write or open `algorithm/<service>/openapi.yaml`. Define these parts once under `components`, and reference them from each operation:
   - security scheme `ApiKeyAuth`: an API key in the `X-API-Key` header
   - parameters `Limit`, `Cursor`, and `IdempotencyKey`
   - schemas `Health`, `Money`, and `Error`
   - responses `Unauthorized` (401), `Conflict` (409), `ValidationError` (422), and `TooManyRequests` (429, with `Retry-After`)
2. In the service folder, run `npx --yes @redocly/cli@2 lint --skip-rule info-license openapi.yaml`. Done when it reports no errors, and no warnings other than `operation-4xx-response` on a public `GET /health`.
3. Show the user the new and changed operations. Done when the user approves the spec.
4. Write the FastAPI routes. Match the path, `operationId` (set `operation_id=`), schemas, and status codes of each operation.
5. Run the contract test in "Test". Done when Schemathesis exits 0.

#### API rules

Paths and operations:

- Start every path with the major version: `/v1/orders`.
- Name a collection with a plural noun in kebab-case: `/v1/credit-applications`.
- Address one item by its ID: `/v1/credit-applications/{application_id}`.
- Name path parameters, query parameters, and JSON fields in snake_case. FastAPI then maps them to Python names without aliases.
- Give every operation an `operationId` in camelCase, verb first: `listOrders`, `getOrder`, `createOrder`, `updateOrder`, `deleteOrder`. Generated clients and agent tools use it as the function name.
- Give every operation a `summary` and one tag for its resource.
- Write each `description` for an agent that decides whether to call the operation. Say what the operation does, when to call it, and what it changes.

| Method | Use | Success status |
|---|---|---|
| `GET` | Read one item or a list | 200 |
| `POST` on a collection | Create an item | 201 |
| `POST` on an action path, such as `/v1/plans/{plan_id}/simulate` | Run an action | 200, or 202 when the work finishes later |
| `PATCH` | Change some fields of an item | 200 |
| `DELETE` | Remove an item | 204 |

List every status code that an operation can return. A 500 response is a bug, so leave it out of the spec.

| Status | Use when |
|---|---|
| 401 | The `X-API-Key` header is missing or wrong. |
| 403 | The key is valid, but the caller cannot do this operation. |
| 404 | The item does not exist. |
| 409 | The request conflicts with the current state, or it reuses an `Idempotency-Key` with a different body. |
| 422 | The request fails validation. |
| 429 | The caller sent too many requests. Add a `Retry-After` header. |

Errors:

- Return every 4xx and 5xx response in this shape: `{"error": {"code": "invalid_api_key", "message": "Invalid or missing API key"}}`.
- `code` is a stable snake_case string that clients match on. `message` is for people.
- A 422 response adds `details`, a list of `{"field": ..., "message": ...}` objects.
- FastAPI returns `{"detail": ...}` by default, and Schemathesis reports that body as a schema violation. Register exception handlers for `HTTPException` and `RequestValidationError` that return the shape above.
- Log the full exception on the server. The response carries only the error shape.

Security:

- Apply `ApiKeyAuth` at the top level of the spec. Mark a public operation with `security: []`.
- Compare the key with `secrets.compare_digest`.

Bodies:

- Send and accept `application/json`.
- Give every request body and every response an example. Docs, mock servers, and agents read the examples.
- Write timestamps as RFC 3339 strings in UTC, such as `2026-11-07T09:30:00Z`, with `format: date-time`.
- Write IDs as strings, and enum values as snake_case strings.
- Write money as a decimal string with an ISO 4217 code: `{"amount": "2550000.00", "currency": "IDR"}`. Floating-point numbers lose precision.

Lists:

- Paginate every list with a cursor. Accept the query parameters `limit` (default 20, maximum 100) and `cursor`.
- Return `{"data": [...], "next_cursor": "..."}`. `next_cursor` is `null` on the last page.

Idempotency:

- Every `POST` that creates or changes data accepts an optional `Idempotency-Key` header.
- Store the first response for each key. Replay it when the same key arrives with the same body. Return 409 when the same key arrives with a different body.

Versions:

- A breaking change needs a new major version path, such as `/v2/`. These changes are breaking: removing or renaming a path, a field, or an enum value; adding a required request field; changing a field type; and changing what a status code means.
- Keep additions in the current version: new operations, new optional request fields, and new response fields.
- Set `info.version` with semantic versioning. Its major number matches the path version.
- Mark an operation `deprecated: true` before the next major version removes it.

Health check:

- Every service has `GET /health`. It returns 200 with `{"status": "ok"}`.
- Keep `/health` outside the version path, and mark it `security: []`, so the Railway health check can call it.
- To protect `/health` with the key instead, keep the top-level `ApiKeyAuth` on it, and list 401. Deploy that service without a Railway health check.

Record each exception to these rules in an ADR.

### Test

Run every command in the service folder.

1. Run `uv run pytest`. Done when every test passes. Run one test with `uv run pytest tests/<file>.py::<test> -v`.
2. Lint the contract, as in step 2 of "Design an API".
3. Test the contract:
   1. Start the API on port 8000 with `API_KEY=test-key` and an empty database.
   2. Run `uvx --from 'schemathesis>=4,<5' schemathesis run openapi.yaml --url http://127.0.0.1:8000 -H "X-API-Key: test-key"`. Done when it exits 0. To test some operations only, add `--include-operation-id-regex '<regex>'`.

Keep Schemathesis settings in `schemathesis.toml` in the service folder:

- A schema-valid body can break a rule that the contract cannot express, such as typical ≤ slow. Then add 422 to `positive_data_acceptance.expected-statuses`.
- An idempotent create replay can return an item that was deleted after the first call. Then set `ensure_resource_availability.enabled = false`, and test create-then-get in pytest.

### Railway

#### Railway state

The user authorized Phase 1 deployment on 2026-11-07 under project `opsidio`.
Use this table for the deployed target; it overrides the copied `algorithm` project naming below.

| Setting | Deployed value |
| --- | --- |
| Railway project | `opsidio` (`9baf9b83-09bb-46e8-8702-c79d21968ce2`) |
| Railway service | `opsidio-api` (`5d0900c0-8976-4ae5-ab5c-ed5397b6e3f5`) |
| Environment | `production` (`57de2987-9915-4ab6-9e13-09b960b94d13`) |
| Public URL | `https://opsidio-api-production.up.railway.app` |
| Build root | `api/algorithm/api/`, uploaded locally with `railway up` |
| Region | Singapore, `asia-southeast1-eqsg3a` |
| Replicas | One; serverless off |
| Volume | `opsidio-api-volume`, mounted at `/data` |
| Variables | Secret `API_KEY`; `DATABASE_PATH=/data/corridor.sqlite3`; Railway-provided `PORT` |
| Health check | Public `GET /health`; `/v3` requires `X-API-Key` |

Run Railway commands from `api/algorithm/api/`.
Link each new checkout with `railway link --project opsidio --service opsidio-api --environment production`.
See [deployment evidence](docs/deployments/2026-11-07-phase-1-railway.md) before changing the deployed service.

#### Rules

- Run every Railway command in a service folder that is linked to its Railway service. In an unlinked folder, `railway up` creates a new Railway project from that folder.
- The CLI stores each link under the folder's absolute path. Link again in each new clone, worktree, or machine: `railway link --project algorithm --service algorithm-<service> --environment production`.
- Keep service settings in Railway, and record them in "Railway state". Railway deprecated `railway.toml` and `railway.json`, and new services cannot use them.
- `railway up` uploads only the files that `.gitignore` does not list.
- Ask the user before you create a Railway project, service, volume, or domain.
- Keep secrets in Railway variables. Pipe a secret in with `--stdin`, and read it back only into a shell variable. A secret never appears in a command line, a log, a file, or a transcript.
- On the VPS, this user cannot reach the Docker daemon. `railway up` builds the image, and its build log is the build check.

#### Set up the CLI

Do this once per machine.

1. Install the Railway CLI. On the VPS, extract the `x86_64-unknown-linux-musl` asset of the latest `railwayapp/cli` GitHub release into `~/.local/bin`. `npm install -g` needs `sudo` there.
2. Run `railway login`. In an SSH or agent shell, it prints a device code and a link. An agent runs it in the background and asks the user to approve the link. The code expires after a short time. If it expires, run `railway login` again. Done when `railway whoami` prints the account.

#### Deploy a service

`<service>` is a folder name, for example `api`. Run each command in `algorithm/<service>/`.

First deploy, once per service:

1. Show the user the project, service, region, volume, and variable names. Done when the user approves.
2. `railway init --name algorithm` creates the project and links the folder. If the project exists already, run `railway link --project algorithm --environment production` instead.
3. `railway add --service algorithm-<service>` creates the service and links it.
4. Run the Railway MCP tool `update-service` with the project and service IDs from `railway status --json`:
   - Set `regions` to `{"asia-southeast1-eqsg3a": {"numReplicas": 1}}` (Singapore). This replaces the whole region map and removes the default region `sfo`, which `railway scale` rejects.
   - Set `healthcheckPath` to `/health` when `/health` is public. Skip it when `/health` needs the key, because the Railway health check cannot send one. Railway then treats a deploy as healthy as soon as it starts.
   - Leave serverless off.

   Done when `railway environment config --json` lists only `asia-southeast1-eqsg3a`.
5. If the service stores data, run `railway volume add --mount-path /data`. A service with a volume runs one replica, and each redeploy has a short downtime.
6. Set each variable without a deploy. Set the key with `openssl rand -hex 32 | railway variable set API_KEY --stdin --skip-deploys`, and the rest with `railway variable set NAME=value --skip-deploys`. Check the names only: `railway variable list --json | python3 -c 'import json,sys; print(sorted(json.load(sys.stdin)))'`.
7. `railway up` uploads the folder, builds the `Dockerfile`, and exits 0 when the deploy succeeds.
8. `railway domain` creates the public URL and prints it. Record the service in "Railway state". Done when `GET <URL>/health` returns 200.

Later deploys: run `railway up`. Done when it exits 0 and `GET <URL>/health` returns 200. Then call each changed endpoint on the public URL.

#### Call the deployed API

Read the key into a shell variable. Never print it.

```bash
export ALGORITHM_URL=<public URL from "Railway state">
export ALGORITHM_KEY="$(railway variable list --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["API_KEY"])')"
curl -fsS -H "X-API-Key: $ALGORITHM_KEY" "$ALGORITHM_URL/health"
```

Expected: `{"status":"ok"}`. A missing or wrong key returns 401.

#### Operate a service

- Turn off the API: `railway down --yes`. It removes the running deployment and keeps the project, the service, its settings, the volume, and the domain. Done when `GET <URL>/health` returns 404 `Application not found` and `railway status` shows the service as `Offline`. Turn the API on again with `railway up`.
- Roll back a bad deploy: in the Railway dashboard, open the service's **Deployments** tab, and choose **Rollback** on the previous deployment. The volume data stays.
- Rotate the key: `openssl rand -hex 32 | railway variable set API_KEY --stdin`. The service restarts with the new key. Read the key into the shell again.

### Add a service

1. Create `algorithm/<service>/` with the files in "Layout". To start from an existing service, copy its folder without `.venv`.
2. Name the package `algorithm_<service>` in `pyproject.toml`, `src/`, `tests/`, and the `Dockerfile`.
3. Run `uv lock` in the service folder. Done when `uv run pytest` passes.
4. Add `algorithm` to `CONTEXT-MAP.md` if it is missing.
5. Write the contract with "Design an API". Then deploy with "Deploy a service".

Build the image with these rules:

- Start from `python:3.12-slim`, and copy uv from `ghcr.io/astral-sh/uv`. Install with `uv sync --locked --no-dev`.
- Start uvicorn on host `0.0.0.0` and the port in `$PORT`, with 8000 as the default. Railway sets `PORT`.
- Run the app as a non-root user. A non-root image cannot write to a Railway volume without help. So with a volume, start as root, give the data folder to the app user, and start the app as that user with `setpriv`.

### Glossary

The global rules for glossary content, splitting, and promotion still apply.

- Write the product glossary at `algorithm/CONTEXT.md`.
- Promote a feature group to `algorithm/docs/context/<feature>/CONTEXT.md`.
- Keep `CONTEXT-MAP.md` at the repo root. List each context there with its folder and scope.
- Write each term as `**Term**:` with its definition on the next line. Add `_Avoid_:` with the synonyms to avoid. Group terms under `###` headings in `## Language`.

### ADRs

- Write a decision that affects only `algorithm/` at `algorithm/docs/adr/<n>-<slug>.md`. Number it from `0001`.
- Write every other decision at `docs/adr/<n>-<slug>.md`, in its own number sequence.
- Title an ADR with the decision. Give the context and the reason in one paragraph. Then add `## Considered options`, each with the reason it was rejected, and `## Consequences`.

### Specs and plans

- Write a design spec at `algorithm/docs/specs/<yyyy-mm-dd>-<slug>-design.md`. Write an execution plan in `algorithm/docs/plans/<yyyy-mm-dd>-<slug>/`. These paths replace the `docs/superpowers/` paths of the superpowers skills.
- A plan folder holds `00-overview.md`, one document per task, `execution-log.md`, and `open-questions.md`.
- Each execution-log entry records the date, the task, the model tier used, what changed, and each verification command with its result.

### Commits

- Write each commit message as one imperative sentence, such as `Add the plan document models`.
- Delete each throwaway script after use. Never commit one.

## Source multi-product repository reference

This section describes the original multi-product repository, not the destination folder.

These rules apply to every agent in this repo. They also override the global glossary and ADR locations.

### Layout

```text
projects/<product>/       one product = one Railway project named <product>
├── AGENTS.md             Railway names, test and deploy commands
├── CONTEXT.md            glossary, created with its first term
├── docs/adr/             this product's decisions, created with the first one
└── <service>/            one Railway service named <product>-<service>
    ├── .python-version   same Python version as the Dockerfile base image
    ├── Dockerfile
    ├── openapi.yaml      API contract, written before the code
    ├── pyproject.toml
    ├── uv.lock
    ├── src/
    └── tests/
docs/adr/                 decisions that span products
docs/api/                 API style guide and the openapi.yaml template
docs/research/            research notes and hackathon context
CONTEXT-MAP.md            every product with its folder and scope
```

- A product is one independent project, for example `projects/bank-credit/`. Products share no code.
- A service folder is the Railway build root. Railway uploads and builds only this folder, so keep everything the service needs inside it. Copy a small helper instead of importing it from another folder.
- A product folder explains the product. Railway never builds it.
- `docs/adr/0001-one-railway-project-per-product.md` records why each product gets its own Railway project.

### APIs

- Before you write or change API code, check the service's `openapi.yaml`. If it does not describe the change yet, suggest that the user write or update it first, and offer to draft it. Write the route code after the user approves the spec or declines the suggestion.
- Follow the API style guide included below when you add or change an endpoint. Every product uses it.

### Railway

- Run every Railway command inside a service folder that is linked to its Railway service. In an unlinked folder, an agent's `railway up` creates a new Railway project from that folder.
- Keep service settings in Railway, and record them in the product's `AGENTS.md`. Railway deprecated `railway.toml` and `railway.json`, and new services cannot use them.

#### Set up the CLI

Do this once per machine.

1. Install the Railway CLI. On the VPS, extract the `x86_64-unknown-linux-musl` asset of the latest `railwayapp/cli` GitHub release into `~/.local/bin`. `npm install -g` needs `sudo` there.
2. Run `railway login`. In an SSH or agent shell, it prints a device code and a link. An agent runs it in the background and asks the user to approve the link. The code expires after a short time. If it expires, run `railway login` again. Done when `railway whoami` prints the account.

#### Deploy a product

`<product>` and `<service>` are folder names, for example `railway-sandbox` and `api`. Run each command in `projects/<product>/<service>/`.

First deploy, once per product:

1. `railway init --name <product>` creates the project and links the folder.
2. `railway add --service <product>-<service>` creates the service and links it.
3. Run the Railway MCP tool `update-service` with the project and service IDs from `railway status --json`:
   - Set `regions` to `{"asia-southeast1-eqsg3a": {"numReplicas": 1}}`. This replaces the whole region map and removes the default region `sfo`, which `railway scale` rejects.
   - Set `healthcheckPath` to `/health`. Skip it when `/health` needs an API key, because the Railway health check cannot send one.

   Done when `railway environment config --json` lists only `asia-southeast1-eqsg3a`.
4. `railway up` uploads the folder, builds the `Dockerfile`, and exits 0 when the deploy succeeds. It uploads only the files that `.gitignore` does not list.
5. `railway domain` creates the public URL and prints it. Record the URL in the product's `AGENTS.md`. Done when `GET <URL>/health` returns 200.

Later deploys: run `railway up`. Done when it exits 0 and `GET <URL>/health` returns 200.

On another machine, link once: `railway link --project <product> --service <product>-<service> --environment production`.

#### Turn off a product's API

1. Run `railway down --yes`. It removes the running deployment and keeps the project, the service, its settings, and its domain.
2. Done when `GET <URL>/health` returns 404 `Application not found` and `railway status` shows the service as `Offline`.

Turn the API on again with `railway up`.

### Add a product

1. Copy `AGENTS.md` and the service folder of an existing product into `projects/<product>/`, without `.venv`.
2. Rename the package in `pyproject.toml`, `src/`, `tests/`, and the `Dockerfile`. Rename the app title and the Railway names in `AGENTS.md`.
3. Run `uv lock` in the service folder. Done when `uv run pytest` passes.
4. Add the product to `CONTEXT-MAP.md`.
5. Deploy the product with the steps in "Deploy a product".

### Glossaries

Each product keeps its glossary and decisions inside its product folder, so the product can move to its own repo in one step. The global rules for content, splitting, and promotion still apply.

- Write a product's glossary at `projects/<product>/CONTEXT.md`.
- Promote a feature group to `projects/<product>/docs/context/<feature>/CONTEXT.md`.
- Keep `CONTEXT-MAP.md` at the repo root. List each product there with its folder and scope.

### ADRs

- Write a decision that affects one product at `projects/<product>/docs/adr/<n>-<slug>.md`. Give each product its own number sequence.
- Write every other decision at the repo root, in `docs/adr/<n>-<slug>.md`. This includes a decision that spans products.

## Source API style guide

The following style guide was referenced by the source instructions. Links remain relative to the original source document.

Every HTTP API in `projects/` follows this guide. Each service keeps its contract in `openapi.yaml`, in OpenAPI 3.1, in the service folder. Write the contract before the code. [ADR 0002](../adr/0002-design-first-openapi.md) records why.

### Design the API first

1. Copy [`openapi-template.yaml`](openapi-template.yaml) to `projects/<product>/<service>/openapi.yaml`, or open the existing file. Replace the example operations, and keep the conventions below.
2. In the service folder, run `npx --yes @redocly/cli@2 lint --skip-rule info-license openapi.yaml`. Done when it reports no errors. The only accepted warning is `operation-4xx-response` on a public `GET /health`.
3. Show the user the new and changed operations. Done when the user approves the spec.
4. Write the FastAPI routes. Match the path, `operationId` (set `operation_id=`), schemas, and status codes of each operation.
5. Start the API on port 8000. Then run `uvx --from 'schemathesis>=4,<5' schemathesis run openapi.yaml --url http://127.0.0.1:8000 -H "X-API-Key: <key>"`. Schemathesis sends requests generated from the spec and reports each response that the spec does not describe. Done when it exits 0.

### Paths

- Start every path with the major version: `/v1/orders`.
- Name a collection with a plural noun in kebab-case: `/v1/credit-applications`.
- Address one item by its ID: `/v1/credit-applications/{application_id}`.
- Name path parameters, query parameters, and JSON fields in snake_case. FastAPI then maps them to Python names without aliases.

### Operations

- Give every operation an `operationId` in camelCase, verb first: `listOrders`, `getOrder`, `createOrder`, `updateOrder`, `deleteOrder`. Generated clients and agent tools use it as the function name.
- Give every operation a `summary` and one tag for its resource.
- Write each `description` for an agent that decides whether to call the operation. Say what the operation does, when to call it, and what it changes.

| Method | Use | Success status |
|---|---|---|
| `GET` | Read one item or a list | 200 |
| `POST` on a collection | Create an item | 201 |
| `POST` on an action path, such as `/v1/plans/{plan_id}/simulate` | Run an action | 200, or 202 when the work finishes later |
| `PATCH` | Change some fields of an item | 200 |
| `DELETE` | Remove an item | 204 |

### Status codes

List every status code that an operation can return. Reference the shared responses in the template.

| Status | Use when |
|---|---|
| 401 | The `X-API-Key` header is missing or wrong. |
| 403 | The key is valid, but the caller cannot do this operation. |
| 404 | The item does not exist. |
| 409 | The request conflicts with the current state, or it reuses an `Idempotency-Key` with a different body. |
| 422 | The request fails validation. FastAPI returns 422 for invalid input. |
| 429 | The caller sent too many requests. Add a `Retry-After` header. |

A 500 response is a bug. Leave it out of the spec.

### Errors

Return every 4xx and 5xx response in this shape:

```json
{"error": {"code": "invalid_api_key", "message": "Invalid or missing API key"}}
```

- `code` is a stable snake_case string that clients match on. `message` is for people.
- A 422 response adds `details`, a list of `{"field": ..., "message": ...}` objects.
- FastAPI returns `{"detail": ...}` by default, and Schemathesis reports that body as a schema violation. Register exception handlers for `HTTPException` and `RequestValidationError` that return the shape above.
- Log the full exception on the server. The response carries only the error shape.

### Security

- Define the `ApiKeyAuth` scheme, the `X-API-Key` header, once. Apply it at the top level of the spec.
- Mark a public operation with `security: []`.

### Bodies

- Send and accept `application/json`.
- Give every request body and every response an example. Docs, mock servers, and agents read the examples.
- Write timestamps as RFC 3339 strings in UTC, such as `2026-11-07T09:30:00Z`, with `format: date-time`.
- Write IDs as strings, and enum values as snake_case strings.
- Write money as a decimal string with an ISO 4217 code: `{"amount": "2550000.00", "currency": "IDR"}`. Floating-point numbers lose precision.

### Lists

- Paginate every list with a cursor. Accept the query parameters `limit` (default 20, maximum 100) and `cursor`.
- Return `{"data": [...], "next_cursor": "..."}`. `next_cursor` is `null` on the last page.

### Idempotency

- Every `POST` that creates or changes data accepts an optional `Idempotency-Key` header.
- Store the first response for each key. Replay it when the same key arrives with the same body. Return 409 when the same key arrives with a different body.

### Versions

- A breaking change needs a new major version path, such as `/v2/`. These changes are breaking:
  - removing or renaming a path, a field, or an enum value
  - adding a required request field
  - changing a field type
  - changing what a status code means
- Keep additions in the current version: new operations, new optional request fields, and new response fields.
- Set `info.version` with semantic versioning. Its major number matches the path version.
- Mark an operation `deprecated: true` before the next major version removes it.

### Health check

- Every service has `GET /health`. It returns 200 with `{"status": "ok"}`.
- Keep `/health` outside the version path, and mark it `security: []`, so the Railway health check can call it.
- A product that protects `/health` records the exception in its `AGENTS.md`.

## Source project references

These instructions apply only to their named source projects. Their URLs, service names, test commands, and environment assumptions do not configure algorithm.

The source projects also contain import-only agent files. Their imported instructions are consolidated here.

### opsidio-sandbox

Source: `projects/opsidio-sandbox/AGENTS.md` in the original repository.

| Item | Value |
|---|---|
| Public URL | `https://opsidio-sandbox-api-production.up.railway.app` |
| Railway project | `opsidio-sandbox` |
| Railway service | `opsidio-sandbox-api`, built from `api/` |
| Environment | `production` |
| Region | Singapore: `asia-southeast1-eqsg3a` |
| Replicas | 1. A service with a volume cannot have more. |
| Volume | Mounted at `/data`. The SQLite file is `/data/opsidio.sqlite3`. |
| Variables | `API_KEY`, `DATABASE_PATH=/data/opsidio.sqlite3`, `SIM_WORKERS=2` |
| Health check | `GET /health` with the header `X-API-Key` set to `API_KEY` returns 200. A missing or wrong key returns 401. |
| Railway health check | None. Railway cannot send the `X-API-Key` header, so its check would get 401 and fail the deploy. See [ADR 0003](docs/adr/0003-protected-health-without-railway-check.md). |

#### Test

Run every command in `api/`.

1. Run `uv run pytest`. Done when every test passes.
2. Lint the contract: `npx --yes @redocly/cli@2 lint --skip-rule info-license openapi.yaml`. Done when it reports no errors and no warnings.
3. Test the contract:
   1. Remove `/tmp/opsidio-dev.sqlite3*`.
   2. Start the API: `API_KEY=test-key DATABASE_PATH=/tmp/opsidio-dev.sqlite3 uv run uvicorn --factory opsidio_sandbox_api.main:create_app --port 8000 --no-access-log`.
   3. Run `uvx --from 'schemathesis>=4,<5' schemathesis run openapi.yaml --url http://127.0.0.1:8000 -H "X-API-Key: test-key"`. Done when it exits 0.
4. `api/schemathesis.toml` accepts 422 as a positive answer: a schema-valid body can break a shape rule the contract cannot express, such as typical ≤ slow.
5. `api/schemathesis.toml` turns off `ensure_resource_availability`: an idempotent `createPlan` replay (spec §11) can return a plan that was deleted after the first call. Pytest covers create-then-get.

#### Deploy

Run every Railway command in `api/`. That folder is linked to `opsidio-sandbox-api`. In an unlinked folder, `railway up` creates a new project.

Read the key into a shell variable. Never print it:

```bash
export OPSIDIO_URL=https://opsidio-sandbox-api-production.up.railway.app
export OPSIDIO_KEY="$(railway variable list --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["API_KEY"])')"
```

First deploy, once per product:

1. `railway init --name opsidio-sandbox` creates the project and links `api/`.
2. `railway add --service opsidio-sandbox-api` creates the service and links it.
3. Run the Railway MCP tool `update-service` with `regions` set to `{"asia-southeast1-eqsg3a": {"numReplicas": 1}}`. Do not set `healthcheckPath`. Leave serverless off. Done when `railway environment config --json` lists only `asia-southeast1-eqsg3a`.
4. `railway volume add --mount-path /data`.
5. Set the variables:
   - `openssl rand -hex 32 | railway variable set API_KEY --stdin --skip-deploys`
   - `railway variable set DATABASE_PATH=/data/opsidio.sqlite3 --skip-deploys`
   - `railway variable set SIM_WORKERS=2 --skip-deploys`
6. `railway up`, then `railway domain`.

On another machine, link once: `railway link --project opsidio-sandbox --service opsidio-sandbox-api --environment production`.

Every later deploy: `railway up`. Done when it exits 0 and `curl -fsS -H "X-API-Key: $OPSIDIO_KEY" "$OPSIDIO_URL/health"` returns 200. The volume keeps the SQLite file across deploys.

Turn off the API: `railway down --yes`. It removes the running deployment and keeps the project, the volume, and the domain. Turn it on again with `railway up`.

Roll back a bad deploy: in the Railway dashboard, open the service's **Deployments** tab and choose **Rollback** on the previous deployment. The volume data stays.

Rotate the key: `openssl rand -hex 32 | railway variable set API_KEY --stdin`. The service restarts with the new key. Read the key again into `OPSIDIO_KEY`.

#### Smoke test

Run in `api/` with `OPSIDIO_URL` and `OPSIDIO_KEY` set:

```bash
curl -fsS -H "X-API-Key: $OPSIDIO_KEY" "$OPSIDIO_URL/health"
curl -s -o /dev/null -w '%{http_code}\n' "$OPSIDIO_URL/health"
PLAN_ID=$(curl -fsS -H "X-API-Key: $OPSIDIO_KEY" -H 'Content-Type: application/json' \
  --data @tests/fixtures/example_plan.json "$OPSIDIO_URL/v1/plans" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
curl -fsS -H "X-API-Key: $OPSIDIO_KEY" -H 'Content-Type: application/json' -d '{}' "$OPSIDIO_URL/v1/plans/$PLAN_ID/simulate"
curl -fsS -H "X-API-Key: $OPSIDIO_KEY" -H 'Content-Type: application/json' -d '{"simulation_method":"des"}' "$OPSIDIO_URL/v1/plans/$PLAN_ID/simulate"
curl -fsS -H "X-API-Key: $OPSIDIO_KEY" -H 'Content-Type: application/json' -d '{}' "$OPSIDIO_URL/v1/plans/$PLAN_ID/optimize"
```

Expected: `/health` with the key returns `{"status":"ok"}`, and without it 401. Both simulate calls return 200. The optimize call returns 202. Poll `GET /v1/optimizations/<id>` every 30 s until the status is `succeeded`. Then `GET /v1/plans/<plan_id>` returns each candidate plan.

### railway-sandbox

Source: `projects/railway-sandbox/AGENTS.md` in the original repository.

| Item | Value |
|---|---|
| Railway project | `railway-sandbox` |
| Railway service | `railway-sandbox-api`, built from `api/` |
| Environment | `production` |
| Region | Singapore: `southeast-asia` |
| Public URL | `https://railway-sandbox-api-production.up.railway.app` |
| API key | `API_KEY` in `api/.env`. The image copies the file. The service has no Railway variables. |
| Health check | `GET /health` with the header `X-API-Key` set to `API_KEY` returns 200. A missing or wrong key returns 401. |
| Railway health check | None. Railway cannot send the `X-API-Key` header, so its check would get 401 and fail the deploy. |

#### Test

Run `uv run pytest` in `api/`. Done when every test passes.

#### Deploy

Run every Railway command in `api/`. Log in first with `railway login`.

Keep `api/.env` out of `.gitignore`. `railway up` skips ignored files, and the app exits at start without `API_KEY`.

First deploy, once per product:

1. `railway init --name railway-sandbox` creates the project and links `api/`.
2. `railway add --service railway-sandbox-api` creates the service and links it.
3. Run the Railway MCP tool `update-service` with `regions` set to `{"asia-southeast1-eqsg3a": {"numReplicas": 1}}`. The tool replaces the whole region map, so it also removes the default region `sfo`, which `railway scale` rejects. Done when `railway environment config --json` lists only `asia-southeast1-eqsg3a`.
4. `railway up`, then `railway domain`. Done when `GET https://<domain>/health` with the header `X-API-Key` returns 200.

On another machine, link once: `railway link --project railway-sandbox --service railway-sandbox-api --environment production`.

Every later deploy: `railway up`. Done when it exits 0 and `/health` with the header `X-API-Key` returns 200.

Stop the API: `railway down --yes`. It removes the running deployment and keeps the service and its domain. Start it again with `railway up`.

### bank-credit

Source: `projects/bank-credit/AGENTS.md` in the original repository.

| Item | Value |
|---|---|
| Railway project | `bank-credit` |
| Railway service | `bank-credit-api`, built from `api/` |
| Environment | `production` |
| Region | Singapore: `southeast-asia` |
| Health check | `GET /health` returns 200 |

#### Test

Run `uv run pytest` in `api/`. Done when every test passes.

#### Deploy

Run every Railway command in `api/`. Log in first with `railway login`.

First deploy, once per product:

1. `railway init --name bank-credit` creates the project and links `api/`.
2. `railway add --service bank-credit-api` creates the service and links it.
3. `railway scale southeast-asia=1`. Then set every other region in `railway environment config --json` to 0.
4. `railway environment edit --service-config bank-credit-api deploy.healthcheckPath /health`
5. `railway up`, then `railway domain`. Done when `GET https://<domain>/health` returns 200.

On another machine, link once: `railway link --project bank-credit --service bank-credit-api --environment production`.

Every later deploy: `railway up`. Done when it exits 0 and `/health` returns 200.

### supply-chain

Source: `projects/supply-chain/AGENTS.md` in the original repository.

| Item | Value |
|---|---|
| Railway project | `supply-chain` |
| Railway service | `supply-chain-api`, built from `api/` |
| Environment | `production` |
| Region | Singapore: `southeast-asia` |
| Health check | `GET /health` returns 200 |

#### Test

Run `uv run pytest` in `api/`. Done when every test passes.

#### Deploy

Run every Railway command in `api/`. Log in first with `railway login`.

First deploy, once per product:

1. `railway init --name supply-chain` creates the project and links `api/`.
2. `railway add --service supply-chain-api` creates the service and links it.
3. `railway scale southeast-asia=1`. Then set every other region in `railway environment config --json` to 0.
4. `railway environment edit --service-config supply-chain-api deploy.healthcheckPath /health`
5. `railway up`, then `railway domain`. Done when `GET https://<domain>/health` returns 200.

On another machine, link once: `railway link --project supply-chain --service supply-chain-api --environment production`.

Every later deploy: `railway up`. Done when it exits 0 and `/health` returns 200.
