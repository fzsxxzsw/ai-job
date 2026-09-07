# Job Helper Agent

Manual rejection analysis and report storage are owned by the authenticated Python
API in `../ai-job-api/src/job_helper_api/rejection_engine`. The Agent is solely the
LangGraph service; it has no duplicate rejection engine or Java gateway dependency.
The outcome workflow calls that same API engine through the internal contract;
it never copies private resume/model configuration into its checkpoints. See
[application outcomes](../docs/application-outcomes.md) for the shared deployment
switch, token mapping, evidence boundaries and acceptance requirements.

The Python service keeps the Phase 1 read-only job decision API and adds a
recoverable, human-approved action proposal workflow. It never executes a
browser action. Approval can only create a `CONTACT_JOB` outbox row whose
status is `QUEUED`; there is deliberately no claim, dispatch, result, retry,
selector, script, URL, cookie, or browser endpoint.

## Runtime boundaries

- The Python business API remains on port 9100; this service is loopback-only on 9101.
- `POST /api/v1/job-decisions` is deterministic and read-only.
- Persistent routes require `X-Internal-Token`. The token and `subject_ref`
  come from server configuration, never request JSON and never a browser.
- LangGraph checkpoints use local AsyncSQLite at
  `/app/data/langgraph-checkpoints.sqlite3`, strict msgpack, and one worker.
- MySQL is the facts/outbox database. Alembic owns only `agent_*` tables and a
  separate `alembic_version_agent` table; application startup never migrates.
- The original job-proposal graph has pure decision nodes; its MySQL transaction
  follows the approval result. The separate outcome graph performs authenticated
  API calls for analysis, validation and persistence, then durably interrupts for
  human feedback. API 9100 is the sole writer of the five `outcome_*` tables.

## Application outcome worker

Compose maps `API_OUTCOME_ENABLED` to both the API switch and
`AGENT_OUTCOMES_ENABLED`. The Agent connects to the existing shared network alias
`http://backend:9100`; no `job-helper-api` service or new port is required.
`API_OUTCOME_INTERNAL_TOKEN` is mapped to the Agent's
`AGENT_OUTCOME_INTERNAL_TOKEN`. If empty, both use the existing
`AGENT_INTERNAL_TOKEN`, which must contain at least 32 characters. All tokens
stay in server configuration.

The worker runs collect → analyze → validate → save → human interrupt → complete.
It parks the API job only after LangGraph has persisted the interrupt. Feedback
then makes that same revision claimable for a checkpoint resume. The worker uses
the existing `agent_data` checkpoint volume and does not create duplicate
`agent_run`/`CONTACT_JOB` records. One worker claims jobs initially, with periodic
lease renewal, bounded retries and sanitized task failures.

Readiness requires a compiled outcome graph, a running worker, and a successful
authenticated claim request (an empty queue counts). A wrong token, missing
migration, or inaccessible API must not appear as a ready outcome worker.

## Endpoints

Read-only:

- `GET /health/live`
- `GET /health/ready`
- `POST /api/v1/job-decisions`

Internal persistent API:

- `POST /api/v1/runs`
- `POST /api/v1/runs/{run_id}/resume`
- `GET /api/v1/runs/{run_id}`
- `GET /api/v1/runs/{run_id}/history`

A matching job produces a deterministic `CONTACT_JOB` preview and a durable
LangGraph interrupt. Resuming with `APPROVE` writes the approval and at most
one `QUEUED` action in the same MySQL transaction. `REJECT`, a rejected job,
or a job needing review never creates an action. Repeated requests reconcile
from the checkpoint and return the existing result or a conflict.

## Local development

Python 3.12 and `uv` are required.

```powershell
uv sync --frozen
uv run pytest
```

Read-only mode is the default and has no external dependencies:

```powershell
uv run uvicorn job_helper_agent.main:app --host 127.0.0.1 --port 9101
```

Persistent mode requires MySQL, an unpredictable internal token, and an
explicit migration before startup:

```powershell
$env:AGENT_DB_HOST = '127.0.0.1'
$env:AGENT_DB_PORT = '3306'
$env:AGENT_DB_USER = 'user'
$env:AGENT_DB_PASSWORD = '<database-password>'
$env:AGENT_DB_NAME = 'ai_job'
$env:AGENT_INTERNAL_TOKEN = '<generate-a-random-secret>'
$env:AGENT_PERSISTENCE_ENABLED = 'true'
$env:AGENT_CHECKPOINT_PATH = './data/langgraph-checkpoints.sqlite3'
uv run alembic -c alembic.ini upgrade head
uv run uvicorn job_helper_agent.main:app --host 127.0.0.1 --port 9101 --workers 1
```

The service constructs the SQLAlchemy URL with `URL.create()` so raw database
passwords containing URL punctuation are not interpolated into a URL string.

The repository `release-job-helper.ps1 -ApplyMigrations` performs explicit
migrations after stopping writers and creating a fresh backup. The local build,
deployment and acceptance happen before the corresponding Git commit/push.
Daily `start-job-helper.ps1` never builds or migrates. Direct host development of
outcomes must set `AGENT_OUTCOME_API_URL=http://127.0.0.1:9100` and the same
internal token as the API; the Compose deployment supplies its backend alias.
