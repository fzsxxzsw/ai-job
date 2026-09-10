# Legacy Session Reply Resume Implementation Plan

> Execute this plan inline in the existing release worktree. Do not operate Chrome or a live BOSS page. Follow test-driven development, GitNexus impact analysis before symbol edits, and `detect-changes` before every commit.

**Goal:** Make one explicit global AI-reply enable compensate for the per-conversation stops created by the legacy cutover migration, exactly once, without replaying historical messages or erasing later intentional stops.

**Architecture:** Keep the behavior at the existing global session-status endpoint so user authorization, the authority epoch, the global stop update, the one-time compensation, and its completion marker share one transaction. Operate only on `py_api_control`; existing `automation_job`, `automation_action`, and message rows remain untouched. Extend the read-only pipeline diagnostic with fixed aggregate marker/count fields and one actionable alert.

**Tech stack:** FastAPI, async SQLAlchemy, SQLite/MySQL-compatible control rows, pytest, PowerShell diagnostics.

## Scope guard

- Included: one-time clearing of migration-created/unclassified `stop:<jobKey>` rows, existing `chat-rounds:<jobKey>` reset, completion metadata, and sanitized pipeline diagnostics.
- Excluded: `外包`/`驻场` context interpretation, employment-exclusion rules, delivery counters, UI status wording, replaying old `REPLY` jobs, creating reply actions, and browser automation.

## Task 1: Pin the backend compensation contract with failing tests

**Files:**

- Modify: `ai-job-api/tests/test_conversation.py`
- Test: `ai-job-api/tests/test_conversation.py`

### Step 1: Add real database helpers and sentinel history

Add test-only helpers that insert canonical JSON control values into `py_api_control`, read them back with `json.loads`, and snapshot sentinel `automation_job`/`automation_action` rows. Keep the helpers local to the test module.

### Step 2: Add the first-run regression test

Seed:

```text
migration:legacy-session-pauses-v1 = true
stop:* = true
stop:legacy-a = true
stop:legacy-b = false
chat-rounds:legacy-a = 9
chat-rounds:legacy-b = 3
one terminal REPLY job and one ACKNOWLEDGED SEND_TEXT action
```

Call:

```http
POST /api/job/seeker/cloned/change/session/status?jobKey=globalJobKey&stop=false
```

Assert:

- `stop:*`, `stop:legacy-a`, and `stop:legacy-b` are false.
- both existing chat-round counters are zero.
- `migration:legacy-session-resumed-v1` is an object containing `completed: true`, the new positive authority epoch, and `resumedControlCount: 1` (only a previously true session stop counts as resumed).
- the sentinel job and action rows are byte-for-byte unchanged.

### Step 3: Add boundary tests

Add separate tests proving:

1. After the compensation marker exists, a new per-session stop survives a later global off/on cycle and its round counter is not reset by that later global enable.
2. Global disable leaves the legacy stop and chat-round state unchanged and does not create the resume marker.
3. Without `migration:legacy-session-pauses-v1`, global resume clears only `stop:*`; it leaves per-session stop/round state unchanged and does not create the resume marker.

### Step 4: Verify RED

Run:

```powershell
Set-Location ai-job-api
uv run --frozen pytest tests/test_conversation.py -q
```

Expected: the new first-run and one-time tests fail because the current global endpoint only clears `stop:*`; the existing tests remain green.

## Task 2: Implement the one-time transactional compensation

**Files:**

- Modify: `ai-job-api/src/job_helper_api/main.py`
- Test: `ai-job-api/tests/test_conversation.py`

### Step 1: Run fresh impact analysis

Refresh the GitNexus index for the current HEAD/dirty state, then run upstream impact analysis for `stop_session`. Account for every direct dependent. If risk is HIGH or CRITICAL, stop and warn before editing; if UNKNOWN, confirm callers with `rg`.

### Step 2: Add marker constants and a focused helper

Add module constants:

```python
LEGACY_SESSION_PAUSE_MARKER = "migration:legacy-session-pauses-v1"
LEGACY_SESSION_RESUME_MARKER = "migration:legacy-session-resumed-v1"
```

Add one async private helper next to app creation that accepts the existing database, transaction connection, user id, and authority epoch. It must:

1. Return without mutation unless the old marker is truthy and the new marker is absent/false.
2. Lock and read all existing user control rows matching `stop:%` except `stop:*`.
3. Count only rows whose decoded value is exactly `true`.
4. Bulk-update all existing matching session-stop rows to canonical JSON `false` with one timestamp.
5. Bulk-update all existing `chat-rounds:%` rows to canonical JSON `0` with the same timestamp.
6. Store this sanitized completion object through `Database.set_control`:

```json
{
  "completed": true,
  "authorityEpoch": 123,
  "resumedControlCount": 1
}
```

Do not query or mutate messages, jobs, actions, or payload content.

### Step 3: Call it only from explicit global resume

Inside the existing `stop_session` transaction, keep the authority bump and `stop:*` write in their current order. Immediately after clearing `stop:*`, call the helper only when `jobKey == "globalJobKey" and not stop`. Preserve the current per-session resume behavior (`chat-rounds` and `graph-round-reset`) unchanged.

### Step 4: Verify GREEN and regression safety

Run:

```powershell
Set-Location ai-job-api
uv run --frozen pytest tests/test_conversation.py -q
uv run --frozen pytest tests/test_conversation_safety.py -q
uv run --frozen ruff check src tests
uv run --frozen ruff format --check src tests
```

Expected: all commands pass; no outbound executor or browser is invoked.

## Task 3: Add sanitized pipeline visibility

**Files:**

- Modify: `tests/job-helper-maintenance.tests.ps1`
- Modify: `debug-job-helper.ps1`
- Test: `tests/job-helper-maintenance.tests.ps1`

### Step 1: Add a failing diagnostic contract test

Load `debug-job-helper.ps1` as text in the maintenance test and assert it contains:

- both exact migration marker keys;
- a fixed `legacy_session_resume` summary line;
- the fixed alert code `LEGACY_SESSION_STOPS_PENDING`.

Also assert the summary exposes only counts/epoch/marker state, never session keys or message payloads.

Run:

```powershell
pwsh -NoProfile -File tests/job-helper-maintenance.tests.ps1
```

Expected: fail because the diagnostic fields do not exist yet.

### Step 2: Run fresh impact analysis

Refresh GitNexus after the test edit, run upstream impact analysis for `Show-PipelineDiagnostics`, and use `rg` to confirm its standalone call sites if the graph returns UNKNOWN.

### Step 3: Extend the aggregate SQL and fixed output

Add aggregate metrics for:

- original migration-pause marker present;
- compensating-resume marker present;
- sanitized `resumedControlCount`;
- sanitized `authorityEpoch`.

Emit:

```text
legacy_session_resume migration_marker=<0|1> completed=<0|1> resumed=<count> epoch=<number>
```

When the AI seat is enabled, global stop is false, the old marker exists, the new marker is absent, and per-session true stops remain, emit:

```text
pipeline_alert code=LEGACY_SESSION_STOPS_PENDING severity=error affected=<count>
```

Set the existing diagnostic exit code to failure for that contradiction. Do not print control values, job keys, prompts, messages, tokens, or model output.

### Step 4: Verify GREEN

Run:

```powershell
pwsh -NoProfile -File tests/job-helper-maintenance.tests.ps1
pwsh -NoProfile -Command "$null=[System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path './debug-job-helper.ps1'),[ref]$null,[ref]$null)"
```

Expected: both commands pass.

## Task 4: Verify, commit, push, build, and publish in the required order

### Step 1: Run full local pre-push verification

Run:

```powershell
Set-Location ai-job-api
uv run --frozen pytest
uv run --frozen ruff check src tests
uv run --frozen ruff format --check src tests
Set-Location ..
pwsh -NoProfile -File tests/job-helper-maintenance.tests.ps1
```

### Step 2: Gate the commit with GitNexus

Refresh the current index, stage only the four intended code/test files plus this plan if not already committed, run `node .gitnexus/run.cjs detect-changes --scope staged --repo .`, and require a complete, non-truncated result. Commit atomically with a conventional message such as:

```text
fix(reply): resume legacy-paused conversations once
```

### Step 3: Push and wait for GitHub checks

Push the branch to its existing upstream. Wait until every required GitHub Actions check for the pushed commit succeeds. Do not publish a failed or unpushed build locally.

### Step 4: Build and publish locally

Only after GitHub succeeds, run:

```powershell
.\build-job-helper.ps1
.\release-job-helper.ps1
.\debug-job-helper.ps1 -Action status
.\debug-job-helper.ps1 -Action runtime
.\debug-job-helper.ps1 -Action pipeline
```

Verify the served version/build ID, service health, image/runtime identities, and the pending/completed compensation diagnostics. Do not trigger the global toggle from tooling and do not touch Chrome/BOSS.

### Step 5: Final graph and completion review

Refresh GitNexus after the last source commit and run `detect-changes --scope all --repo .`. Confirm all acceptance criteria below, and report any unmet browser-facing item explicitly.

## Acceptance checklist

- First authorized global enable clears the legacy session stops once and records count/epoch metadata.
- Global disable never runs the compensation.
- Absence of the original migration marker prevents compensation.
- A deliberate per-session stop created after compensation survives later global toggles.
- Historical messages, reply jobs, and actions are not replayed or changed.
- Pipeline diagnostics show marker state/counts without sensitive payloads.
- Backend, maintenance, UI/extension, and release build checks pass.
- The installed Chrome extension is not claimed current until the user reloads it and verifies the visible exact build badge; no browser interaction is performed without separate authorization.

## Post-deploy user action

After the new build is running, the user must manually turn AI reply off and on once. That explicit enable authorizes and triggers the one-time compensation. A later read-only pipeline diagnostic should then show `completed=1`, `session_stop_true=0` (unless a current rule deliberately stopped a session), and the recorded resumed count. The backend must not perform this toggle on the user's behalf.
