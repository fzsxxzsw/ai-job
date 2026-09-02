# Job Helper Agent

The Python service keeps the Phase 1 read-only job decision API and adds a
recoverable, human-approved action proposal workflow. It never executes a
browser action. Approval can only create a `CONTACT_JOB` outbox row whose
status is `QUEUED`; there is deliberately no claim, dispatch, result, retry,
selector, script, URL, cookie, or browser endpoint.

## Runtime boundaries

- Java remains on port 9100; this sidecar remains loopback-only on port 9101.
- `POST /api/v1/job-decisions` is deterministic and read-only.
- Persistent routes require `X-Internal-Token`. The token and `subject_ref`
  come from server configuration, never request JSON and never a browser.
- LangGraph checkpoints use local AsyncSQLite at
  `/app/data/langgraph-checkpoints.sqlite3`, strict msgpack, and one worker.
- MySQL is the facts/outbox database. Alembic owns only `agent_*` tables and a
  separate `alembic_version_agent` table; application startup never migrates.
- Every graph node is pure. The MySQL transaction occurs only after the graph
  reaches an approval terminal state.

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

The repository `release-job-helper.ps1` performs the migration explicitly
after the pushed commit and required GitHub Actions have succeeded. Daily
`start-job-helper.ps1` never builds or migrates.
