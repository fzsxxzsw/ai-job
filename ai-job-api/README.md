# Job Helper Python business API

This is the personal business backend on `127.0.0.1:9100`. It makes no Java proxy
calls. Existing users, resumes, preferences, model configurations, conversations,
delivery audits and rejection reports remain in MySQL. The separate LangGraph
Agent on 9101 provides durable workflow infrastructure, not browser execution.

## Browser contracts and filtering

Current Chrome requests keep their URLs and `data/code/message/extend/requestId`
envelope. Login, preferences, local PDF import, model configuration/test, greeting
and reply drafts, conversation stops, delivery audit and rejection analysis are
implemented in Python. Personal product/trial lists are empty; commercial payment,
invitation and payment-SSE endpoints return 410.

The current Chrome payload uses an empty `prompt` with `resumeMatchEnabled`,
`minMatchScore`, `titleRuleStatus` and `titleMatchedKeywords`. This runs the migrated
`LOCAL_RULES_V2` matcher without a model call. Its title/weighted-skill score stays
advisory; a low score never overrides independent hard preference rules. Missing
resume content produces UNKNOWN. Explicit free-text filtering conditions use the
configured model with the resume, job description and conditions.

`API_CONFIRMED_EDUCATION` defaults to empty. This installation may explicitly retain
its old personal setting `全日制本科`; that is inherited configuration, not a newly
verified credential. It is never inserted into historical application snapshots.

## Authentication and data safety

`API_OWNER_USER_ID` binds an existing local account. Silent login only accepts that
account's BOSS identifier; request bodies cannot choose another database user.
This preserves the loopback personal deployment contract, not public multiuser
password authentication. HMAC sessions use `API_SESSION_SECRET` or a persistent
`API_SECRET_FILE` (compose: `/app/data/session.key`); default lifetime is 12 hours.
Old Java tokens expire at cutover. Use the extension's connection test to reconnect;
the backend does not reload BOSS pages.

User model keys are masked when read. A model configuration must have a matching
server-side test result before activation. Temporarily saving changed connection
settings leaves the draft disabled; changing only a prompt preserves verification.
Requests and model outputs are bounded. Host allowlists, HTTPS, deadlines and model
concurrency limits apply. PDF text is extracted locally in a disposable worker;
failure or cancellation retains the old resume.

Conversation pauses and ambiguous/duplicate draft state survive restart. Initial
migration requires global replies paused and seeds per-conversation stops for
historical chats. The extension's existing resume control can resume a chat.
No Python API endpoint sends BOSS messages, starts delivery or claims Agent actions.

## Rejection reports

Manual analysis accepts chat evidence with optional application-time JD/resume
snapshot context. Historical chats without a snapshot remain HR-evidence-only;
the current resume cannot be substituted for a historical snapshot. Reports,
feedback, history and summaries are owner-scoped. Evidence-validated model findings
are merged into the saved report; model failures are explicitly marked RULES_ONLY.
Reports are available under `/api/job/ai/rejections/{id}`, `/history`, `/summary`
and `/status`. Automatic HR-rejection triggering is a separate unfinished workflow.

## Optional email notifications

Python supports the existing per-round (`ermE`) and high-interest (`crE`) email
preferences. Sending requires `API_MAIL_ENABLED=true`, a valid owner email, the
corresponding preference, and SMTP configuration. Defaults do not send mail.
Set `API_MAIL_HOST`, `API_MAIL_PORT` (465), `API_MAIL_SENDER`, optional
`API_MAIL_USERNAME`/`API_MAIL_PASSWORD`, `API_MAIL_SECURITY` (`ssl` or `starttls`)
and `API_MAIL_TIMEOUT_SECONDS` (10). Secrets stay out of logs and responses.

Notification requests enter a bounded background queue and return immediately;
slow SMTP cannot delay a browser reply. Shutdown drains briefly, then cancels pending
workers. Unclaimed queued notifications are best-effort and are not replayed after
a restart. Send attempts are claimed in MySQL before SMTP. A failure or interrupted
send is not automatically retried, preventing duplicate messages after a lost SMTP
response. SMTP failure cannot invalidate a saved reply. Tests inject a fake
transport and do not send real messages. The old Java provider-error notification
templates are not automatically enabled by the personal Python deployment.

## Database and operation

`schema.sql` initializes a fresh MySQL database without Java source or an automatic
owner account. Select the intended database before running it. Existing databases
use the explicit compatibility migration after a verified backup:

```sh
uv run --frozen python -m job_helper_api.migrate          # read-only plan
uv run --frozen python -m job_helper_api.migrate --apply # explicit apply
# Release only, after the fresh backup and stopping the old writer:
uv run --frozen python -m job_helper_api.migrate --apply --pause-owner
```

The callable `migrate(settings, apply=False)` supports an isolated database copy.
Only the explicit release `--pause-owner` option changes the bound owner to paused;
it requires `--apply`, audits the prior state and never re-enables replies on rollback.
Migration creates missing rejection/`py_api_*` tables, makes snapshot references
nullable, widens rejection context to LONGTEXT, and preserves case-sensitive
idempotency keys. It does not delete business rows. MySQL DDL implicitly commits;
preconditions are checked first and steps are idempotent for safe reruns. App
startup and daily start never run DDL.

MySQL advisory locks coordinate duplicate writes across API instances using a
separate connection pool. Case-sensitive identifier comparisons also support
legacy utf8mb3 columns. The local runtime remains one Uvicorn worker and one
production backend. `API_READ_ONLY=true` is the standalone default; deployment
explicitly selects writable mode after acceptance.

`/health/live`, `/health/ready` and `/actuator/health` expose implementation,
version and build ID. Readiness checks schema/database access. Model status reads
the effective owner configuration without making a model request; configured is
not evidence of provider availability.

## Development and acceptance

### Unified automation and career review

`API_AUTOMATION_ENABLED` routes automatic replies and contact decisions through
the Agent's persistent graph. API owns immutable inputs, one artifact and separate
actions. A generated draft is not a sent message: only exact platform ACKs update
conversation history, reply rounds or attachment observations. The contact ACK
and greeting ACK are independent. Lost dispatch results remain UNKNOWN and cannot
be automatically resent. Phone, WeChat and resume exchanges require approval of
the specific payload. An explicitly reported abort before the platform call is
distinct from a definite platform failure; ordinary timeouts remain UNKNOWN.

`API_CAREER_ENABLED` enables immutable resume versions, application timelines,
fixed-window cohorts, review confirmation and separate proposal/strategy approval.
Statistics use confirmed event time, retain historical interviews after rejection,
and distinguish contact-based rates from resume-send-based interview rates.
Unknown or mixed actual resume exposure cannot enter a named-version comparison.
Current cohorts remain descriptive because job family, level and channel have not
been independently normalized and verified. No causal or automatic optimization
claim is made from these counts.

The selected prepared version's actual content enters future filtering, while a
platform attachment ID alone never proves its resume content. Model-assisted
reviews use the existing analysis router with at most three provider attempts and
independent evidence checks; failures are visibly RULES_ONLY. Evidence and complete
JD samples are bounded with explicit coverage counts. Acceptable resume patches
currently perform formatting only; new skills, dates, employers and achievements
remain questions until verified. Strategy application preserves hard preferences,
selects a future plan and does not start automation. Dispatch reservations consume
the plan's allocation even when the platform result is unknown; selecting the same
plan again cannot restore its budget.

Deleting a review clears its private API input/artifact and creates a persistent
deletion fence. The Agent removes the actual checkpoint and acknowledges cleanup
before the API reports deletion complete. Accepted resume versions, confirmed
application facts and explicitly approved strategy records are separate retained
resources; external backups follow their own retention. Startup never runs the
explicit migration required for these new tables.

```sh
uv sync --frozen
uv run --frozen pytest
uv run --frozen ruff check src tests
uv run --frozen ruff format --check src tests
```

Unit/API tests use synthetic SQLite data and mocked model/SMTP responses. MySQL
integration tests require an explicitly opted-in disposable database, never the
production schema. Local restored-copy acceptance, final image/runtime switch and
Chrome version verification are tracked separately in `MIGRATION_STATUS.md`.
