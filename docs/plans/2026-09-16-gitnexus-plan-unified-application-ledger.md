# GitNexus Engineering Plan

> Task: Build a canonical application ledger that persists assistant and manually submitted jobs, exact conversations, job snapshots, read state, soft rejection, explicit rejection, and interview outcomes.
> Evidence verified at commit 76e294fc9c1b0f556e0f6596c69fc52be67c3455; GitNexus index refreshed this session (`--index-only --pdg`).
> Evidence provenance schema 2; global dirty digest `0a9c85780067d9afcd0764f307b60891e3cee927ee11eaeb5ec7826d10fd82cd`; cited-path manifest 26 sorted entries; exact generated plan path excluded.

## 1. Objective

[verified] Make `career_application` the canonical ledger for every observed BOSS application cycle, regardless of whether the assistant initiated contact or the user submitted manually. Persist an immutable-enough job snapshot, exact binding identifiers, origin, completeness metadata, exact messages, read state, and a current business status.

[verified] Support these durable states without treating advertised experience years as a hard rejection factor: `UNREAD`, `READ`, `SOFT_REJECTED`, `EXPLICIT_REJECTED`, and `INTERVIEW_SCHEDULED`, while retaining existing positive/reply/offer timeline events.

[inferred] “已读未回” is represented as `read_state=READ` plus `application_status=SOFT_REJECTED` only after the existing no-reply policy threshold and verified conversation coverage; a transient read receipt alone must not immediately become a rejection.

## 2. Current Behaviour

- [verified] `career_application` stores exact BOSS identifiers and a JSON snapshot, but it has no origin, normalized job fields, read state, current status, completeness, or update timestamp (`ai-job-api/schema.sql:357`, `ai-job-api/src/job_helper_api/career/schema.py:4`).
- [verified] `conversation_message` stores exact platform/account/job/conversation/message identifiers and causal metadata, but does not reference an application cycle (`ai-job-api/schema.sql:321`, `ai-job-api/src/job_helper_api/automation/schema.py:109`).
- [verified] Assistant acknowledgements call `record_ack`, which creates an application snapshot and a `CONTACT_INITIATED` event (`ai-job-api/src/job_helper_api/career/observations.py:63`).
- [verified] Passive outcome ingestion projects messages and read evidence, then calls `record_observations`; unmatched conversations are skipped because `matched_application` must first find an existing application (`ai-job-api/src/job_helper_api/outcomes/storage.py:116`, `ai-job-api/src/job_helper_api/career/observations.py:12`).
- [verified] `record_observations` additionally requires a prior contact event, so passive/manual conversations cannot create their own application cycle (`ai-job-api/src/job_helper_api/career/observations.py:152`).
- [verified] The policy already distinguishes `READ`, `UNREAD`, `UNKNOWN`, `NO_REPLY`, `REJECTED`, and positive outcomes while requiring sufficient coverage for no-reply classification (`ai-job-api/src/job_helper_api/outcomes/policy.py:266`).
- [verified] BOSS passive collection binds exact job/conversation/boss identifiers and emits messages/read evidence without opening a conversation, but its observation contract carries no job descriptor (`ai-job-hunting-ui/src/platform/boss/outcomeCollector.ts:72`, `ai-job-hunting-ui/src/extension/outcomesProtocol.ts:23`).
- [verified] The existing friend-list response already contains a subset of job/company/recruiter metadata, while assistant filtering has fuller `jobBaseInfo` and `jobExtInfo` including salary, location, JD, and address (`ai-job-hunting-ui/src/platform/bossPlatform.ts:1560`, `ai-job-hunting-ui/src/platform/platform.ts:1680`).

## 3. Relevant Architecture

- [verified] The browser side has a passive boundary: `bossPlatform` observes already-returned friend-list data, `outcomeRuntime` binds it, `outcomeCollector` emits bounded observations, and the outbox validates the strict protocol before POSTing.
- [verified] The API owner transaction is `OutcomeStorage.ingest`: exact binding validation, policy projection, observation history, canonical conversation projection, and career timeline writes occur through one database connection.
- [verified] `career_application_event` is the append-only timeline; `application_view` derives legacy stage from those events. The new current fields should be projections, not replacements for evidence/history.
- [inferred] The stable identity for a manual application should be its exact account/job/conversation/boss binding. An existing assistant application that matches that binding wins and must never be downgraded to manual origin.
- [inferred] Job data should use normalized searchable columns for title/company/recruiter/salary/location/JD and retain the raw source payload plus `snapshotCompleteness`/`missingFields` in `data_json` so partial manual observations remain honest and enrichable.

## 4. GitNexus Findings

- [graph] `impact({target:"observeContact", direction:"upstream"})` returned CRITICAL risk, 18 affected symbols, 2 direct callers, and 7 execution processes, with unresolved dynamic call sites. Planning implication: do not change `observeContact`; enrich the existing outcome-observation path instead.
- [graph] `impact({target:"record_ack", direction:"upstream"})` returned LOW risk with direct caller `Actions.receipt`. It is the correct assistant-origin enrichment boundary.
- [graph] `impact({target:"OutcomeStorage.ingest", direction:"upstream"})` returned LOW lower-bound risk and a test caller. Source verification found the real dynamic route `/api/job/outcomes/observations`, so HTTP compatibility must be preserved.
- [graph] `impact({target:"record_observations", direction:"upstream"})` returned LOW risk with direct caller `OutcomeStorage.ingest`. It is the existing career projection seam.
- [graph] `impact({target:"Applications.insert_application", direction:"upstream"})` returned LOW risk with direct callers `record_ack` and `Applications.import_legacy`. Additive upsert/enrichment behavior must preserve both.
- [graph] `impact({target:"createPassiveOutcomeCollector", direction:"upstream"})` returned LOW risk with direct caller `outcomeRuntime.ts`, 14 affected symbols over 3 layers. Its exact-binding and passive-operation invariants must remain intact.
- [graph] `impact({target:"normalizeOutcomeObservation", direction:"upstream"})` returned UNKNOWN with no resolvable callers. A source search confirmed `normalizeOutcomeCommand` and outbox tests consume it; UNKNOWN is not treated as safe.
- [graph] `query({search_query:"manual assistant application persistence record_ack insert_application observeContact"})` connected assistant acknowledgements to application creation and showed no equivalent passive/manual creation flow.
- [graph] `query({search_query:"conversation message read state outcome projection application status"})` connected `OutcomeStorage.ingest`, `project`, `project_observations`, and the career observation projection.

## 5. Statement-Level PDG Findings

- [graph] `pdg_query` on `OutcomeStorage.ingest` showed the application-flow snapshot guard and exact-binding conflict branches control the later merge/projection writes. Application ensure/enrichment must run only after binding validation and within the same transaction as projection/history/message linkage.
- [graph] The projection result data-dependence feeds both the stored outcome observation and career projection. Current application status must be derived from that same projection, not recomputed from an independent clock or weaker evidence.
- [graph] `pdg_query` on `record_observations` showed `not app` and missing-contact guards dominate every career event write. Manual discovery requires replacing only the unmatched-app behavior; assistant cycles must retain the real contact-time filter.
- [graph] `pdg_query` on `createPassiveOutcomeCollector` showed verified binding gates message/read/coverage emission. Adding a job descriptor must not bypass account, binding, TTL, decimal-ID, or coverage checks.
- [verified] `project_observations` rejects incomplete bindings and non-decimal server IDs before upsert. `application_id` linkage must be optional at the low-level upsert boundary and supplied only after an exact/unique application match (`ai-job-api/src/job_helper_api/automation/conversation_history.py:454`).
- [inferred] Status precedence must be monotonic for terminal evidence: `OFFER_RECEIVED` / `INTERVIEW_SCHEDULED` / `EXPLICIT_REJECTED` outrank `SOFT_REJECTED`, which outranks read/unread waiting states. Replayed older observations may update evidence history but must not regress the current status.

## 6. Proposed Changes

### 6.1 Additive schema and explicit migration

- File: `ai-job-api/schema.sql`, `ai-job-api/src/job_helper_api/career/schema.py`, `ai-job-api/src/job_helper_api/automation/schema.py`
- Symbols: `career_application`, `conversation_message`
- [verified] Add application origin, normalized job fields, `read_state`, `application_status`, status/evidence timestamps, first/last observation timestamps, and `conversation_message.application_id` plus supporting indexes.
- [inferred] Keep columns nullable/defaulted so old rows and rolling code remain readable. Use `data_json` for raw snapshots/completeness, not secret-bearing browser tokens.

- File: `ai-job-api/src/job_helper_api/migrate.py`
- Symbol: explicit migration plan/apply path
- [verified] Add idempotent column/index DDL and conservative backfill. Link existing messages only where user/platform/account/job/conversation/boss identifies exactly one application; leave ambiguous cycles unlinked and report counts.

### 6.2 Canonical application upsert and status projection

- File: `ai-job-api/src/job_helper_api/career/contracts.py`
- Symbols: `CareerEventType`
- [verified] Add `APPLICATION_DISCOVERED` for passively observed manual applications without fabricating `CONTACT_INITIATED`.

- File: `ai-job-api/src/job_helper_api/career/applications.py`
- Symbols: `Applications.insert_application`, application lookup/view helpers
- [inferred] Extend creation to accept origin and normalized snapshot fields; add idempotent enrichment that fills better data, preserves raw sources, tracks missing fields, and never downgrades `ASSISTANT` origin.
- [inferred] Add exact-binding resolution and stable manual cycle keys derived from the binding when no application exists.

- File: `ai-job-api/src/job_helper_api/career/observations.py`
- Symbols: `record_ack`, `record_observations`, `record_outcome_report`, `matched_application`
- [verified] Mark acknowledged assistant applications `ASSISTANT` and retain full job/resume snapshots.
- [inferred] Ensure a `MANUAL_DISCOVERED` application for exact passive bindings, project current read/business status from the authoritative outcome projection, insert `APPLICATION_DISCOVERED` once, and keep assistant contact-time guards.
- [inferred] Map `NO_REPLY + READ` to `SOFT_REJECTED`; deterministic rejection evidence to `EXPLICIT_REJECTED`; interview-positive evidence to `INTERVIEW_SCHEDULED`; otherwise retain `READ`, `UNREAD`, `HR_REPLIED`, `APPLIED`, or `DISCOVERED` as applicable.

### 6.3 Observation contract and exact message linkage

- File: `ai-job-api/src/job_helper_api/outcomes/contracts.py`
- Symbol: `OutcomeObservation`
- [verified] Add an optional sanitized application/job descriptor with origin/source and completeness fields. Remain backward compatible with existing observations.

- File: `ai-job-api/src/job_helper_api/outcomes/storage.py`
- Symbol: `OutcomeStorage.ingest`
- [inferred] Validate binding first, ensure/enrich the application, persist the outcome projection, project messages with the resolved `application_id`, and update the career state in one transaction.

- File: `ai-job-api/src/job_helper_api/automation/conversation_history.py`
- Symbols: message upsert/project helpers
- [verified] Accept and persist an optional application ID, preserving existing exact-ID validation and idempotent message merge behavior.

### 6.4 Passive browser descriptor capture

- File: `ai-job-hunting-ui/src/extension/outcomesProtocol.ts`
- Symbols: observation types and `normalizeOutcomeObservation`
- [verified] Extend the strict whitelist with a bounded, sanitized optional job descriptor; reject unexpected nested fields and unsafe sizes.

- File: `ai-job-hunting-ui/src/platform/boss/outcomeCollector.ts`
- Symbol: `createPassiveOutcomeCollector`
- [verified] Carry the descriptor alongside an already-verified binding without changing emission timing, read inference, message bounds, or expiry.

- File: `ai-job-hunting-ui/src/platform/boss/outcomeRuntime.ts`, `ai-job-hunting-ui/src/platform/bossPlatform.ts`
- Symbols: `observeOutcomeContacts` and existing passive friend-list observer wiring
- [verified] Normalize the metadata already present in friend-list responses (title/company/recruiter and any available salary/location/JD fields) and mark absent fields explicitly. Do not add network calls, clicks, scrolling, navigation, or BOSS tab refreshes.

- File: `ai-job-hunting-ui/src/platform/platform.ts`
- Symbols: existing assistant application observation payload
- [verified] Reuse the already available full `jobBaseInfo`/`jobExtInfo` snapshot when observing assistant-origin applications so later passive events enrich rather than duplicate the canonical row.

### 6.5 Tests and release verification

- Files: existing API/UI test files listed in §8
- [verified] Add end-to-end storage assertions for origins, status precedence, completeness, exact application-message linkage, replay idempotency, and conservative migration.

## 7. Implementation Sequence

1. Add schema declarations and an idempotent explicit migration, including unambiguous historical linkage/backfill and migration tests. Stop here with old code still compatible with new nullable/defaulted columns.
2. Extend the career application repository with origin-aware idempotent create/enrich, exact binding resolution, current status projection, and one-time discovery events. Add repository/career-flow tests.
3. Extend outcome ingestion and conversation history so the application is ensured before messages/status are projected in the same transaction. Add API integration tests for manual and assistant paths, status precedence, exact linkage, and replay.
4. Extend the strict browser observation protocol and passive collector/runtime descriptor flow. Add protocol/outbox/collector tests proving sanitization and zero new browser actions.
5. Run all targeted tests, API lint/full tests, UI test/typecheck/build, then the repository build script. Inspect GitNexus changes, create the verified local candidate, and only then commit/push.
6. Apply the explicit migration and local release only with stopped writers, a verified database backup, and rollback package. Verify API/runtime health and served build ID without controlling BOSS/Chrome. Report the required manual extension reload/badge check.

## 8. Test Strategy

- `ai-job-api/tests/test_migration.py`
  - old schema → plan migration → required columns/indexes reported;
  - apply twice → no duplicate/error;
  - unique exact binding → historical messages linked;
  - two application cycles for one binding → messages remain unlinked and ambiguity counted.
- `ai-job-api/tests/test_career_flows.py`
  - assistant ACK with full snapshot → one `ASSISTANT` row, full normalized/raw fields, `CONTACT_INITIATED` once;
  - passive manual binding → one `MANUAL_DISCOVERED` row and `APPLICATION_DISCOVERED` once;
  - later assistant evidence for same exact cycle → enrich and upgrade origin without duplicate;
  - incomplete descriptor → stored missing-field list, no fabricated values;
  - older/replayed evidence → no status regression or duplicate events.
- `ai-job-api/tests/test_conversation_history.py`
  - exact messages → correct `application_id`;
  - invalid/incomplete binding → skipped as before;
  - same message replay → idempotent content/link update;
  - ambiguous application cycles → no unsafe link.
- `ai-job-api/tests/test_outcomes.py`
  - manual observation with `UNREAD` → application `UNREAD`;
  - verified `READ` before threshold → `READ`, not rejection;
  - verified `NO_REPLY + READ` after threshold → `SOFT_REJECTED`;
  - explicit rejection evidence → `EXPLICIT_REJECTED`;
  - interview evidence → `INTERVIEW_SCHEDULED`;
  - terminal status followed by weaker/older observation → terminal status retained;
  - assistant observation → existing row enriched, no duplicate;
  - transaction failure → no partially linked message/application status.
- `ai-job-hunting-ui/src/extension/outcomeOutbox.test.mjs`
  - optional descriptor survives strict normalization/outbox replay;
  - unknown/oversized nested fields are rejected or dropped per contract;
  - old observation without descriptor remains valid.
- `ai-job-hunting-ui/src/platform/boss/outcomeCollector.test.mjs`
  - friend-list binding emits normalized known fields and explicit missing fields;
  - exact binding/read/message/TTL guards remain unchanged;
  - no click, scroll, navigation, refresh, or extra fetch is introduced.
- Verification commands:
  - `uv run --frozen pytest tests/test_migration.py tests/test_career_flows.py tests/test_conversation_history.py tests/test_outcomes.py`
  - `uv run --frozen pytest`
  - `uv run --frozen ruff check .`
  - `pnpm test`
  - `pnpm typecheck`
  - `pnpm build`
  - `.\build-job-helper.ps1`

## 9. Risk and Impact Analysis

- [graph] `observeContact` is CRITICAL and has 2 direct callers across 7 processes. It will not be modified; assistant snapshot enrichment uses lower-risk acknowledgement/observation seams.
- [graph] Direct consumers of `record_ack`, `record_observations`, `Applications.insert_application`, `OutcomeStorage.ingest`, and `createPassiveOutcomeCollector` are all covered by existing or expanded tests named in §8.
- [verified] Protocol compatibility risk: the browser normalizer uses strict key whitelists. Backend fields and frontend sanitizer must land together, while the descriptor stays optional for older queued observations.
- [inferred] Identity risk: job ID alone cannot identify an application cycle. Only exact binding or an existing unique application may be linked; ambiguous history remains explicitly unlinked.
- [inferred] Migration risk: backfill could attach historical messages to the wrong cycle. The migration must prefer missing data over a false association and report ambiguity.
- [inferred] Status race risk: delayed/out-of-order observations can regress state. Status updates require deterministic precedence plus evidence timestamps/material keys.
- [verified] Transaction risk: outcome, history, message, and career updates currently share an owner transaction. New ensure/link/status writes must remain on that connection and rollback together.
- [inferred] Payload/performance risk: raw job data can be large. The passive descriptor must be bounded/sanitized, indexed columns kept small, and raw payload stored once/enriched idempotently.
- [verified] Browser safety risk: live BOSS interaction can trigger controls or account restrictions. Verification is limited to unit/integration/build checks; no BOSS tab operation is part of implementation.
- [verified] Release risk: schema changes require explicit migration with stopped writers and verified backup; startup must not perform DDL.

## 10. Files Expected to Change

| File | Symbols | Reason |
| ---- | ------- | ------ |
| `ai-job-api/schema.sql` | `career_application`, `conversation_message` | Canonical columns, linkage, indexes |
| `ai-job-api/src/job_helper_api/career/schema.py` | career DDL | Keep component schema aligned |
| `ai-job-api/src/job_helper_api/automation/schema.py` | conversation DDL | Keep component schema aligned |
| `ai-job-api/src/job_helper_api/migrate.py` | migration plan/apply | Explicit additive migration/backfill |
| `ai-job-api/src/job_helper_api/career/contracts.py` | `CareerEventType` | Manual discovery event |
| `ai-job-api/src/job_helper_api/career/applications.py` | `Applications` helpers | Origin-aware create/enrich/resolve/status |
| `ai-job-api/src/job_helper_api/career/observations.py` | acknowledgement/outcome projection | Ensure manual apps and project current state |
| `ai-job-api/src/job_helper_api/outcomes/contracts.py` | `OutcomeObservation` | Optional sanitized job descriptor |
| `ai-job-api/src/job_helper_api/outcomes/storage.py` | `OutcomeStorage.ingest` | Transactional ensure/link/project |
| `ai-job-api/src/job_helper_api/automation/conversation_history.py` | message project/upsert | Persist exact application link |
| `ai-job-hunting-ui/src/extension/outcomesProtocol.ts` | types/normalizer | Strict descriptor contract |
| `ai-job-hunting-ui/src/platform/boss/outcomeCollector.ts` | passive collector | Carry descriptor with binding |
| `ai-job-hunting-ui/src/platform/boss/outcomeRuntime.ts` | contact observer | Normalize existing friend-list metadata |
| `ai-job-hunting-ui/src/platform/bossPlatform.ts` | observer mapping | Expose already-returned fields only |
| `ai-job-hunting-ui/src/platform/platform.ts` | assistant observation | Reuse full assistant job snapshot |
| `ai-job-api/tests/test_migration.py` | migration tests | Safe/idempotent backfill |
| `ai-job-api/tests/test_career_flows.py` | career tests | Origin/enrichment/events/status |
| `ai-job-api/tests/test_conversation_history.py` | history tests | Exact message-to-app linkage |
| `ai-job-api/tests/test_outcomes.py` | outcome tests | Read/rejection/interview mappings |
| `ai-job-hunting-ui/src/extension/outcomeOutbox.test.mjs` | protocol/outbox tests | Compatibility and sanitization |
| `ai-job-hunting-ui/src/platform/boss/outcomeCollector.test.mjs` | collector tests | Passive capture and safety invariants |

## 11. Reusable Implementation Context

```yaml
implementation_context:
  task_summary: 'Persist a unified application ledger for assistant and manually submitted BOSS jobs, with exact job snapshot, conversation linkage, read state, soft rejection, explicit rejection, and interview status.'
  acceptance_criteria:
    - 'Assistant acknowledgements and passive/manual observations converge on one exact application cycle without duplicates.'
    - 'Job title, company, recruiter, salary, location, JD, raw source snapshot, and explicit completeness metadata are persisted when available.'
    - 'Every safely resolvable conversation message stores the exact application_id.'
    - 'UNREAD, READ, SOFT_REJECTED, EXPLICIT_REJECTED, and INTERVIEW_SCHEDULED are durable and evidence-backed.'
    - 'Experience-year wording is retained as source data only and is not a hard rejection rule.'
    - 'Migration is additive, idempotent, conservative on ambiguous cycles, and requires explicit execution.'
    - 'No extra BOSS network request, click, scroll, navigation, or refresh is added.'
  evidence_provenance:
    schema_version: 2
    head_commit: '76e294fc9c1b0f556e0f6596c69fc52be67c3455'
    generated_plan_path: 'docs/plans/2026-09-16-gitnexus-plan-unified-application-ledger.md'
    global_dirty_digest:
      algorithm: 'sha256'
      canonicalization: 'gitnexus-evidence-provenance-v2 NUL-framed UTF-8 records'
      value: '0a9c85780067d9afcd0764f307b60891e3cee927ee11eaeb5ec7826d10fd82cd'
    cited_path_manifest:
      - {path: 'AGENTS.md', object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: 'sha256:21d5ca6f3820ac3c446f0f68400b22bc08fc906da21611fe95e2e4be12847f21', index_digest: 'sha256:21d5ca6f3820ac3c446f0f68400b22bc08fc906da21611fe95e2e4be12847f21', worktree_digest: 'sha256:5b43a0ab60ea5d852d53fdbdf9252c2c5e9619c3344b1886da2755ff618efd3c', untracked_digest: absent}
      - {path: 'ai-job-api/schema.sql', object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: 'sha256:6386763f04ed18ae4aaaff74cd4c2928bc3cc782f20f072f8b27744b8944e171', index_digest: 'sha256:6386763f04ed18ae4aaaff74cd4c2928bc3cc782f20f072f8b27744b8944e171', worktree_digest: 'sha256:d753783a118306fee5518e6b3e599fb3c9b56cb040e4beb599ea112c46ef1d8c', untracked_digest: absent}
      - {path: 'ai-job-api/src/job_helper_api/automation/conversation_history.py', object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: 'sha256:f01e3bb26e122985d04583f8f56b1931bc7f6288ae02cc8f023c62fd8e81e9de', index_digest: 'sha256:f01e3bb26e122985d04583f8f56b1931bc7f6288ae02cc8f023c62fd8e81e9de', worktree_digest: 'sha256:6b374845345d93a113fbc67ad55f1c5df80fd5d604293da838cc81cfc5b47239', untracked_digest: absent}
      - {path: 'ai-job-api/src/job_helper_api/automation/schema.py', object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: 'sha256:a706b3ca132523536b2f666c801631ca4eaa5c4296f17612f0dcc92e515a1ba4', index_digest: 'sha256:a706b3ca132523536b2f666c801631ca4eaa5c4296f17612f0dcc92e515a1ba4', worktree_digest: 'sha256:ce71916cbbd5da146b852edf3c690a0a0e1c1ab94a175c02b0263ea2c0f948de', untracked_digest: absent}
      - {path: 'ai-job-api/src/job_helper_api/career/applications.py', object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: 'sha256:90f33cd0cb9ee2f986a2c7bcf0d2a2d35dfa3e7bba456387588c729d45f086cb', index_digest: 'sha256:90f33cd0cb9ee2f986a2c7bcf0d2a2d35dfa3e7bba456387588c729d45f086cb', worktree_digest: 'sha256:6b1c53c8d60f7252dcaff47b06879adfb443b9a2de01609621cc205314d18eec', untracked_digest: absent}
      - {path: 'ai-job-api/src/job_helper_api/career/contracts.py', object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: 'sha256:b20ba2f27dfe9fdfec478053782397525c0ae2658e9083e976ea3662a185f375', index_digest: 'sha256:b20ba2f27dfe9fdfec478053782397525c0ae2658e9083e976ea3662a185f375', worktree_digest: 'sha256:91a0da60a5435f5f11e4cf7f496272e24947c6045fdc5fb7cba6cdb14aa6a534', untracked_digest: absent}
      - {path: 'ai-job-api/src/job_helper_api/career/observations.py', object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: 'sha256:cbbdc7c4ea422b2a348283caf70aaebf1c2b44686cf65de99b210cb285d3bcf9', index_digest: 'sha256:cbbdc7c4ea422b2a348283caf70aaebf1c2b44686cf65de99b210cb285d3bcf9', worktree_digest: 'sha256:bc4f468bfd57d74be7941bb489a5b2fdb465058b79c52a9bd0bfc12e4eae3cad', untracked_digest: absent}
      - {path: 'ai-job-api/src/job_helper_api/career/schema.py', object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: 'sha256:a97af5b652c60d5f7f40a60833597a32df2620a0e54647ea9512d5d41968bad7', index_digest: 'sha256:a97af5b652c60d5f7f40a60833597a32df2620a0e54647ea9512d5d41968bad7', worktree_digest: 'sha256:3d8121035a5992c9ea8690587ba253bded485a0b6ba80cbb6a25f26c277e4318', untracked_digest: absent}
      - {path: 'ai-job-api/src/job_helper_api/migrate.py', object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: 'sha256:3bdc631fc88a2644e81aad96b7077c5a17fe99cd1badfa747c26f8017e36b198', index_digest: 'sha256:3bdc631fc88a2644e81aad96b7077c5a17fe99cd1badfa747c26f8017e36b198', worktree_digest: 'sha256:f7cb6d462c1a48e23915d1702014f44a91309030355543b29b8d4beb3113617b', untracked_digest: absent}
      - {path: 'ai-job-api/src/job_helper_api/outcomes/contracts.py', object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: 'sha256:f76b9f6a38e7166810c636cd04a07abb2d5d268352bb034986a126c7bc1b844f', index_digest: 'sha256:f76b9f6a38e7166810c636cd04a07abb2d5d268352bb034986a126c7bc1b844f', worktree_digest: 'sha256:17ad254aac6db9c976bbbedf7ee217a9e9348078a44ca7ba1bfcb77d2925337c', untracked_digest: absent}
      - {path: 'ai-job-api/src/job_helper_api/outcomes/policy.py', object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: 'sha256:486accbe300834309e6c120822751359fe07ffd6a1a8fb9f535ce133fd60ac68', index_digest: 'sha256:486accbe300834309e6c120822751359fe07ffd6a1a8fb9f535ce133fd60ac68', worktree_digest: 'sha256:bd9102d5eb3e1b2db93c967ad72621906c4a9cadace62ac5397f4601f5e14646', untracked_digest: absent}
      - {path: 'ai-job-api/src/job_helper_api/outcomes/storage.py', object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: 'sha256:d166291d293e6a6e0a4e67afc995db3c98fe60e746c447e3a37c8f549825e4cd', index_digest: 'sha256:d166291d293e6a6e0a4e67afc995db3c98fe60e746c447e3a37c8f549825e4cd', worktree_digest: 'sha256:0236aec02235eebe34fdf3fb1bae1e02f44c3122340a8663714d320206f269b9', untracked_digest: absent}
      - {path: 'ai-job-api/tests/test_career_flows.py', object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: 'sha256:96e5957e6deba5c240788ccffcaee00bacf760b1b61d3298f6e0efcef1fcf218', index_digest: 'sha256:96e5957e6deba5c240788ccffcaee00bacf760b1b61d3298f6e0efcef1fcf218', worktree_digest: 'sha256:89154374cce9a9cb5c2e2a6eb53c99fa6ed6a75844b0bf03927198ef3ed4423f', untracked_digest: absent}
      - {path: 'ai-job-api/tests/test_conversation_history.py', object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: 'sha256:1f307d37a8d52578b930eaac19377af1c1be5d58b6a23ab32802b734b024047c', index_digest: 'sha256:1f307d37a8d52578b930eaac19377af1c1be5d58b6a23ab32802b734b024047c', worktree_digest: 'sha256:d504037e17f1bf31f3965601335463a69ab17032dd95a9b9456313af3af938e2', untracked_digest: absent}
      - {path: 'ai-job-api/tests/test_migration.py', object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: 'sha256:0d0a42b5782f624afb7dd3594383f6a19536fc29efb9a0719a93bbbca7b16c72', index_digest: 'sha256:0d0a42b5782f624afb7dd3594383f6a19536fc29efb9a0719a93bbbca7b16c72', worktree_digest: 'sha256:42bdda7df8849f35e0b4aec9e4e04e28fd781a80bb36651d4386d388b7bb1b13', untracked_digest: absent}
      - {path: 'ai-job-api/tests/test_outcomes.py', object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: 'sha256:ebd4ca108d8a049de2f6b98acbace7ac27c5ce74adc90744098197c7597b9a06', index_digest: 'sha256:ebd4ca108d8a049de2f6b98acbace7ac27c5ce74adc90744098197c7597b9a06', worktree_digest: 'sha256:5225e02a0bf74098f3be7a9164e0190bfe8e886f07a13930a538bbcb3238d4f0', untracked_digest: absent}
      - {path: 'ai-job-hunting-ui/package.json', object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: 'sha256:d526cc6021fa22beb2650f760bcf09a05e0600ccffabcc8cfeee0c2944702649', index_digest: 'sha256:d526cc6021fa22beb2650f760bcf09a05e0600ccffabcc8cfeee0c2944702649', worktree_digest: 'sha256:d526cc6021fa22beb2650f760bcf09a05e0600ccffabcc8cfeee0c2944702649', untracked_digest: absent}
      - {path: 'ai-job-hunting-ui/src/extension/outcomeOutbox.test.mjs', object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: 'sha256:01d80ad06b0d2454c9d9d1b2570be30d522f1da0ee2b80b99539ea72a66943fb', index_digest: 'sha256:01d80ad06b0d2454c9d9d1b2570be30d522f1da0ee2b80b99539ea72a66943fb', worktree_digest: 'sha256:651464eb2556e169da3eda8a92ea8015a355d8713179bd502ddb5c69d341aa43', untracked_digest: absent}
      - {path: 'ai-job-hunting-ui/src/extension/outcomesProtocol.ts', object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: 'sha256:663209452e71d208d7cc58a13990db3702c0693f78589a137c6b8d84a1759d82', index_digest: 'sha256:663209452e71d208d7cc58a13990db3702c0693f78589a137c6b8d84a1759d82', worktree_digest: 'sha256:8a87ef61dd4ec2a921afe6f70cf0892d71d52dde1bdad68ef94723aa5ef41cf4', untracked_digest: absent}
      - {path: 'ai-job-hunting-ui/src/platform/boss/outcomeCollector.test.mjs', object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: 'sha256:e8bb004220f6eade2989bb3a7c6113adc123f2494f1e7e697e4011ca50546028', index_digest: 'sha256:e8bb004220f6eade2989bb3a7c6113adc123f2494f1e7e697e4011ca50546028', worktree_digest: 'sha256:3a228ecf59a39e2905591a45d67b99aba2e6cf33e23792351f1a19234a64ed0b', untracked_digest: absent}
      - {path: 'ai-job-hunting-ui/src/platform/boss/outcomeCollector.ts', object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: 'sha256:a327fdf3d2fa64be8d1dea5048b8802e2028f34922049e7cf724ec8942b9b50b', index_digest: 'sha256:a327fdf3d2fa64be8d1dea5048b8802e2028f34922049e7cf724ec8942b9b50b', worktree_digest: 'sha256:08c26bfeca859b8b140f2a65050c94089fd9e4db7a34bc7bc1cf6979fe71fb91', untracked_digest: absent}
      - {path: 'ai-job-hunting-ui/src/platform/boss/outcomeRuntime.ts', object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: 'sha256:019c573c3c4c6afee9e1dc7688e87e346faf2695435f543b53581660d0bb6f5e', index_digest: 'sha256:019c573c3c4c6afee9e1dc7688e87e346faf2695435f543b53581660d0bb6f5e', worktree_digest: 'sha256:7f72eabe468f3ce5d304e0ff86895fefa24505d9b88082c461fe0a5bb3b6c900', untracked_digest: absent}
      - {path: 'ai-job-hunting-ui/src/platform/bossPlatform.ts', object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: 'sha256:ab2b80a70e17f2785a8c91648b7ebb72b5910784d64e706d0359fb7e55894531', index_digest: 'sha256:ab2b80a70e17f2785a8c91648b7ebb72b5910784d64e706d0359fb7e55894531', worktree_digest: 'sha256:b19abe751754c116b84581c0bc23074ae5e1fc386796d8ed7ca17995245d5294', untracked_digest: absent}
      - {path: 'ai-job-hunting-ui/src/platform/platform.ts', object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: 'sha256:08d5ba10bfe31d23af2e46a500da2673869c5f2eddd0af2b8016d1a9a61e8f87', index_digest: 'sha256:08d5ba10bfe31d23af2e46a500da2673869c5f2eddd0af2b8016d1a9a61e8f87', worktree_digest: 'sha256:1896b9f785b5132566eaa051125b61901f7a1629b7cd5a198f74a310989599ad', untracked_digest: absent}
      - {path: 'build-job-helper.ps1', object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: 'sha256:a39f18fe9637c57ad1ffd798c802c5ce1cac997dae8e272a3b4640ad8ae5e089', index_digest: 'sha256:a39f18fe9637c57ad1ffd798c802c5ce1cac997dae8e272a3b4640ad8ae5e089', worktree_digest: 'sha256:f875c330f4f5addf4dd27097215bc4a31c61ec4880b421547b04d8417a9fb555', untracked_digest: absent}
      - {path: 'release-job-helper.ps1', object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: 'sha256:4b88335f1ef19f9b948de07baafa851581a477fb88d7bb2ce64d7115be888de5', index_digest: 'sha256:4b88335f1ef19f9b948de07baafa851581a477fb88d7bb2ce64d7115be888de5', worktree_digest: 'sha256:2a62ed198641250eef44ebd24afbf289800809424f9653f8810cf46bb1cf8ff3', untracked_digest: absent}
  primary_symbols:
    - {symbol: 'OutcomeStorage.ingest', file: 'ai-job-api/src/job_helper_api/outcomes/storage.py', lines: '116-227', role: 'Owner transaction for validation, projection, observation, message, and career writes'}
    - {symbol: 'record_ack', file: 'ai-job-api/src/job_helper_api/career/observations.py', lines: '63-134', role: 'Assistant-origin application creation and snapshot capture'}
    - {symbol: 'record_observations', file: 'ai-job-api/src/job_helper_api/career/observations.py', lines: '152-187', role: 'Passive observation to career projection seam'}
    - {symbol: 'Applications.insert_application', file: 'ai-job-api/src/job_helper_api/career/applications.py', lines: '118-162', role: 'Idempotent application persistence'}
    - {symbol: 'project_observations', file: 'ai-job-api/src/job_helper_api/automation/conversation_history.py', lines: '454-517', role: 'Canonical exact-message projection'}
    - {symbol: 'createPassiveOutcomeCollector', file: 'ai-job-hunting-ui/src/platform/boss/outcomeCollector.ts', lines: '72-213', role: 'Passive exact-binding/read/message collector'}
  related_symbols:
    - {symbol: 'project', relationship: 'CALLED_BY OutcomeStorage.ingest', relevance: 'Authoritative outcome/read-state policy'}
    - {symbol: 'normalizeOutcomeObservation', relationship: 'CALLED_BY normalizeOutcomeCommand; outbox contract', relevance: 'Strict browser payload boundary'}
    - {symbol: 'application_view', relationship: 'READS career_application_event', relevance: 'Existing derived stage compatibility'}
    - {symbol: 'observeOutcomeContacts', relationship: 'CALLS collector.bind', relevance: 'Passive friend-list metadata boundary'}
  execution_path:
    - 'Existing BOSS friend-list response is observed without extra browser interaction.'
    - 'Runtime normalizes exact binding plus bounded job descriptor and binds the passive collector.'
    - 'Collector emits exact messages/read/coverage and descriptor through strict protocol/outbox.'
    - 'OutcomeStorage.ingest validates binding, ensures/enriches one application, runs policy projection, stores observation, links messages, and projects current career state in one transaction.'
    - 'Append-only application events retain evidence while current columns support cleaning/reporting queries.'
  pdg_constraints:
    - description: 'Exact application binding validation dominates all application/message/status mutations.'
      affected_statements: ['ai-job-api/src/job_helper_api/outcomes/storage.py:116', 'ai-job-api/src/job_helper_api/career/observations.py:12']
      implementation_consequence: 'Ensure/enrich only after validation; never fall back from ambiguous binding to job ID alone.'
    - description: 'Outcome projection is the authoritative data source for read and business status.'
      affected_statements: ['ai-job-api/src/job_helper_api/outcomes/policy.py:266', 'ai-job-api/src/job_helper_api/outcomes/storage.py:116']
      implementation_consequence: 'Pass the same projection into career status update inside the owner transaction.'
    - description: 'Collector binding guards account, job, conversation, boss, TTL, read evidence, and message bounds.'
      affected_statements: ['ai-job-hunting-ui/src/platform/boss/outcomeCollector.ts:72']
      implementation_consequence: 'Descriptor is payload metadata only and cannot weaken or replace binding guards.'
  architectural_patterns:
    - {pattern: 'Explicit idempotent migration', example_location: 'ai-job-api/src/job_helper_api/migrate.py', usage_guidance: 'Add nullable/defaulted DDL and conservative backfill; no startup DDL.'}
    - {pattern: 'Owner transaction', example_location: 'ai-job-api/src/job_helper_api/outcomes/storage.py OutcomeStorage.ingest', usage_guidance: 'Application/message/status/history writes share one connection and rollback boundary.'}
    - {pattern: 'Append-only event plus current projection', example_location: 'ai-job-api/src/job_helper_api/career/applications.py application_view', usage_guidance: 'Keep evidence events and update searchable current fields deterministically.'}
    - {pattern: 'Strict passive browser protocol', example_location: 'ai-job-hunting-ui/src/extension/outcomesProtocol.ts', usage_guidance: 'Sanitize bounded optional descriptors and preserve backward compatibility.'}
  files_to_modify:
    - {file: 'ai-job-api/schema.sql', symbols: ['career_application', 'conversation_message'], intended_change: 'Add canonical status/snapshot/link columns and indexes.'}
    - {file: 'ai-job-api/src/job_helper_api/career/schema.py', symbols: ['career schema'], intended_change: 'Mirror application schema.'}
    - {file: 'ai-job-api/src/job_helper_api/automation/schema.py', symbols: ['conversation schema'], intended_change: 'Mirror message application link.'}
    - {file: 'ai-job-api/src/job_helper_api/migrate.py', symbols: ['migration planner/apply'], intended_change: 'Add idempotent DDL and conservative backfill.'}
    - {file: 'ai-job-api/src/job_helper_api/career/contracts.py', symbols: ['CareerEventType'], intended_change: 'Add application discovery event.'}
    - {file: 'ai-job-api/src/job_helper_api/career/applications.py', symbols: ['Applications.insert_application', 'application helpers'], intended_change: 'Origin-aware idempotent create/enrich/resolve/status.'}
    - {file: 'ai-job-api/src/job_helper_api/career/observations.py', symbols: ['record_ack', 'record_observations', 'record_outcome_report'], intended_change: 'Ensure manual apps and project current state.'}
    - {file: 'ai-job-api/src/job_helper_api/outcomes/contracts.py', symbols: ['OutcomeObservation'], intended_change: 'Optional sanitized job descriptor.'}
    - {file: 'ai-job-api/src/job_helper_api/outcomes/storage.py', symbols: ['OutcomeStorage.ingest'], intended_change: 'Transactional ensure/link/project.'}
    - {file: 'ai-job-api/src/job_helper_api/automation/conversation_history.py', symbols: ['upsert_message', 'project_observations'], intended_change: 'Persist exact application link.'}
    - {file: 'ai-job-hunting-ui/src/extension/outcomesProtocol.ts', symbols: ['normalizeOutcomeObservation'], intended_change: 'Strict descriptor contract.'}
    - {file: 'ai-job-hunting-ui/src/platform/boss/outcomeCollector.ts', symbols: ['createPassiveOutcomeCollector'], intended_change: 'Carry descriptor with verified binding.'}
    - {file: 'ai-job-hunting-ui/src/platform/boss/outcomeRuntime.ts', symbols: ['observeOutcomeContacts'], intended_change: 'Normalize already-returned metadata.'}
    - {file: 'ai-job-hunting-ui/src/platform/bossPlatform.ts', symbols: ['passive friend-list observer'], intended_change: 'Expose available metadata only.'}
    - {file: 'ai-job-hunting-ui/src/platform/platform.ts', symbols: ['assistant observation'], intended_change: 'Reuse full assistant snapshot.'}
  tests:
    - {file: 'ai-job-api/tests/test_migration.py', scenarios: ['old schema → additive migration', 'repeat apply → idempotent', 'unique binding → linked', 'ambiguous cycles → unlinked/reported']}
    - {file: 'ai-job-api/tests/test_career_flows.py', scenarios: ['assistant ACK → one ASSISTANT row', 'manual observation → one MANUAL_DISCOVERED row', 'later enrichment → no duplicate', 'partial fields → explicit missing list', 'replay → no regression']}
    - {file: 'ai-job-api/tests/test_conversation_history.py', scenarios: ['exact binding → application_id', 'invalid/ambiguous → no unsafe link', 'replay → idempotent']}
    - {file: 'ai-job-api/tests/test_outcomes.py', scenarios: ['UNREAD/READ persisted', 'NO_REPLY+READ → SOFT_REJECTED', 'rejection → EXPLICIT_REJECTED', 'interview → INTERVIEW_SCHEDULED', 'weaker replay → no regression', 'rollback → no partial write']}
    - {file: 'ai-job-hunting-ui/src/extension/outcomeOutbox.test.mjs', scenarios: ['descriptor strict normalization', 'old payload compatibility', 'outbox replay']}
    - {file: 'ai-job-hunting-ui/src/platform/boss/outcomeCollector.test.mjs', scenarios: ['known/missing descriptor fields', 'binding/read/message/TTL guards', 'zero browser actions']}
  verification_commands:
    - 'cd ai-job-api && uv run --frozen pytest tests/test_migration.py tests/test_career_flows.py tests/test_conversation_history.py tests/test_outcomes.py'
    - 'cd ai-job-api && uv run --frozen pytest'
    - 'cd ai-job-api && uv run --frozen ruff check .'
    - 'cd ai-job-hunting-ui && pnpm test'
    - 'cd ai-job-hunting-ui && pnpm typecheck'
    - 'cd ai-job-hunting-ui && pnpm build'
    - '.\\build-job-helper.ps1'
  risks:
    - 'Ambiguous application cycles must remain unlinked rather than be guessed.'
    - 'Out-of-order observations must not regress terminal status.'
    - 'Optional descriptor must remain compatible with old queued observations.'
    - 'Passive metadata can be partial; completeness must be explicit and later enrichable.'
    - 'Migration/release requires stopped writers, verified backup, and rollback package.'
  assumptions:
    - 'Check that friend-list payload field names used for descriptor normalization remain present by fixture/source inspection; do not verify against a live BOSS page.'
    - 'Check that the owner transaction connection is passed through all new repository helpers by an integration rollback test.'
    - 'Check status precedence against product expectation in tests: terminal explicit/interview/offer evidence outranks soft/read states.'
    - 'Check that assistant ACK data remains the most complete source and manual passive payload only fills missing fields.'
  open_questions:
    - 'Some manual applications will initially lack JD, salary, or location because the passive list does not expose them. The accepted behavior is explicit missing-field metadata plus later enrichment, not extra scraping.'
    - 'Historical ambiguous cycles are intentionally left unlinked and reported for a future manual reconciliation tool.'
  avoid:
    - 'Do not repeat full repository discovery.'
    - 'Do not replace established patterns without evidence.'
    - 'Do not edit the CRITICAL observeContact flow unless a fresh impact analysis and explicit warning justify it.'
    - 'Do not link by job ID alone when more than one cycle can exist.'
    - 'Do not fabricate manual job fields or read state.'
    - 'Do not turn advertised experience years into a hard rejection rule.'
    - 'Do not add BOSS clicks, scrolling, navigation, refreshes, or extra network requests.'
    - 'Do not run schema DDL at service startup.'
    - 'Do not apply the live migration without stopped writers, verified backup, and rollback protection.'
```

## 12. Assumptions and Open Questions

### Assumptions

- [assumed] Existing friend-list fixtures accurately represent the passive metadata fields available without a detail request. Verify by source/fixture inspection before coding; do not inspect live BOSS.
- [assumed] `OutcomeStorage.ingest` can pass one owner connection through all new helpers. Verify with a forced rollback integration test.
- [assumed] Terminal status precedence is `OFFER_RECEIVED`/`INTERVIEW_SCHEDULED`/`EXPLICIT_REJECTED` above `SOFT_REJECTED`, then `HR_REPLIED`, then `READ`/`UNREAD`, then `APPLIED`/`DISCOVERED`. Encode the chosen order centrally and test it.
- [assumed] Assistant ACK snapshots are the preferred completeness source; passive manual descriptors enrich missing fields but do not erase richer data. Verify merge semantics in tests.

### Resolved design questions

- [inferred] Manual submissions do not need a fabricated contact timestamp. Use `APPLICATION_DISCOVERED` and exact observation time; only assistant cycles use `CONTACT_INITIATED` for causal filtering.
- [inferred] “已读未回就是婉拒” is implemented after the existing no-reply deadline/coverage proof, preventing an immediate read receipt from becoming a false rejection.
- [verified] Experience-year wording is stored as raw job data only; it is explicitly excluded from hard rejection/risk logic.

### Deferred follow-up

- A future manual reconciliation UI may resolve historically ambiguous cycles; this change reports/retains them without guessing.
- A future read-only analytics cleaner can consume the canonical status/snapshot/message model after this storage foundation lands.

## 13. Definition of Done

- One exact canonical application row is created/enriched for both assistant and manually submitted/observed application cycles.
- Origin, exact binding, normalized title/company/recruiter/salary/location/JD, raw snapshot, completeness/missing fields, read state, current business status, evidence, and timestamps are queryable.
- Exact conversation messages reference the correct application where resolution is unique; ambiguous history remains unlinked and reported.
- `UNREAD`, `READ`, `SOFT_REJECTED`, `EXPLICIT_REJECTED`, and `INTERVIEW_SCHEDULED` mappings are covered by deterministic tests and do not regress under replay/out-of-order evidence.
- Assistant and passive/manual observations are idempotent and converge without duplicate applications or events.
- Browser protocol remains backward compatible and passive; no new click/scroll/navigation/refresh/fetch behavior exists.
- Explicit migration passes plan/apply/idempotency/backfill tests and is not run at startup.
- Targeted and full API tests/lint plus UI tests/typecheck/build pass.
- GitNexus `detect_changes` is complete (not partial/truncated) before each implementation commit.
- The repository build produces a verified local candidate; migration/release is performed only with backup/stopped writers/rollback, runtime health and served build ID are checked, and code is committed/pushed.
- Because browser control is not authorized, the final handoff explicitly identifies the manual Chrome extension reload and visible version/build-badge verification step.

