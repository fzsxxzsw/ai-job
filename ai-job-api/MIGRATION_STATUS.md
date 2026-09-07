# Python migration coverage and acceptance

This document describes the source implementation and acceptance gates. The
single current runtime receipt under `JobHelper/runtime` identifies the installed
version/build; Git history and the final release commit record verification.
Source availability does not by itself certify a successful local deployment.

## Implemented personal backend coverage

- Current Chrome 9100 routes/envelopes, owner isolation and restart-stable signed
  sessions. Old Java sessions require reconnecting through the extension.
- Preferences, local PDF import, tested/masked model configuration and manual
  stop/resume. Explicit resume starts a fresh reply authorization period while
  retaining conversation history.
- LOCAL_RULES_V2 resume/JD scoring accepts the current empty-prompt Chrome payload;
  score stays advisory. Explicit free-text filtering uses the configured model.
- Greeting/reply drafts, durable conversation control, audit receipts and snapshots.
- Evidence-validated rejection reports, HR-only historical analysis without forged
  snapshots, owner-scoped feedback, history, summaries and status.
- Configurable opt-in round/high-interest SMTP notifications use a bounded queue;
  SMTP never delays browser responses. Send attempts are durable and never
  automatically repeated after an ambiguous outcome.
- Standalone MySQL schema and explicit idempotent compatibility migration. Read-only
  planning and application startup do not mutate schema. Cutover requires a backup
  and paused replies; release can explicitly use `--apply --pause-owner`.
- Legacy rows remain intact; compatibility includes nullable snapshot references,
  LONGTEXT context and binary idempotency keys. Identifier comparisons also support
  legacy utf8mb3 columns.
- Core boundaries have type annotations. Locked Ruff configuration checks source
  correctness/imports and a consistent readable format.

## Acceptance gates

1. Run frozen API/Agent tests, Ruff checks and formatting checks. Fixture tests
   use synthetic SQLite data and fake model/SMTP responses, including real Chrome
   request shapes, model failures, session/notification persistence, stopping,
   explicit resume, PDF cancellation and slow SMTP response isolation.
2. Run opted-in disposable MySQL tests: fresh standalone schema, legacy compatibility,
   Chinese LONGTEXT, case-sensitive IDs, duplicate requests, owner isolation and
   restart retrieval. Never aim destructive fixtures at the production database.
3. Restore the verified production backup into a separate database. Verify migration
   planning/application, all existing data, equivalent API responses and single-writer
   behavior. A model configuration check is not a successful real-provider call.
4. Build locally, then switch the single runtime using a fresh backup and an explicit
   owner pause. Verify health, version, build ID, database identity and recovery.
5. Verify the installed Chrome artifact against that exact served version/build.
   Browser interaction follows the project's separate authorization rules. Record
   any remaining manual reload or real-model acceptance honestly.
6. Commit/push the accepted source and retain the single current runtime receipt.
   User-requested local-first release order supersedes the older GitHub-first order.

## Boundaries that migration does not change

Sales/payment/invitation stay disabled. Automatic HR-rejection triggers and
LangGraph browser execution are separate workflows. The optional configured
full-time-bachelor fact inherits this installation's old personal setting; it is
not a newly verified credential or a replacement historical resume. Real SMTP or
BOSS message sending is not part of fixture/migration verification.
