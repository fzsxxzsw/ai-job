# Legacy Session Reply Resume Design

Status: Draft for written review

## Problem

The Python cutover migration intentionally wrote `stop:<jobKey>=true` for every legacy chat session so the new reply service could not unexpectedly contact historical conversations. The global AI reply switch currently clears only `stop:*`. As a result, enabling AI reply leaves hundreds of legacy per-conversation stops in place, and new inbound messages in those conversations finish with `STOP` instead of reaching the model.

Production evidence on 2026-09-10 confirms the mismatch: the global stop is false, the browser executor is healthy, but 485 per-conversation stop controls remain. A known affected conversation has generated 17 `REPLY` jobs since 2026-09-09 and every one completed with `当前会话或 AI 回复已暂停`.

## Scope

This change only compensates for the legacy migration pause. It does not change employment-exclusion keywords, hard-blocked companies, high-interest handoff, platform risk controls, manual per-conversation resume behavior, or automation status-card wording.

## Considered Approaches

1. Clear only stop rows whose timestamp equals the original migration time. This is safest but incomplete because legacy rows can be rewritten later and then become indistinguishable by timestamp. The reproduced conversation is one such case.
2. Clear every per-conversation stop on every global enable. This fixes legacy sessions but would also erase deliberate stops created after the repair.
3. Perform a one-time compensating resume when the user explicitly enables global AI reply. This is the chosen approach: it clears the unclassified legacy stop set once, records completion, and preserves all future per-conversation stops.

## Chosen Design

When `stop_session(globalJobKey, false)` runs, the backend will continue to start a new authorization epoch and clear `stop:*`. In the same database transaction it will check:

- the original `migration:legacy-session-pauses-v1` marker is true; and
- a new `migration:legacy-session-resumed-v1` marker is not true.

If both conditions hold, it will:

1. Set all existing `stop:<jobKey>` controls to false, excluding `stop:*`.
2. Reset existing `chat-rounds:<jobKey>` controls to zero so a restored legacy conversation does not immediately hit an old round threshold.
3. Record `migration:legacy-session-resumed-v1=true` with the authorization epoch and resumed-control count for diagnostics.

The compensation runs only after the user explicitly turns global AI reply on. It runs only once. Later global off/on cycles do not clear per-conversation stops created by user action, hard blocks, high-interest transfer, or other current rules.

## Safety Properties

- Existing terminal `REPLY` jobs and old inbound messages are not reopened or replayed.
- No queued action is created by the migration compensation itself.
- Only a future inbound message can create a new reply job after the stop is cleared.
- The global stop, risk stop, AI-seat state, hard-block guard, and employment-exclusion behavior remain authoritative.
- The update is atomic: global resume, legacy stop compensation, round reset, authority epoch, and completion marker commit together.
- A failed transaction leaves the previous stop state intact and the UI toggle follows its existing rollback behavior.

## Tests

Backend tests must prove:

1. With the old migration marker present and no resume marker, global resume clears `stop:*`, all legacy `stop:<jobKey>` values, and existing chat-round counters, then records the new marker.
2. A second global resume does not clear a per-conversation stop created after the one-time compensation.
3. Global disable does not run the compensation.
4. Historical completed jobs and actions are unchanged.
5. Without the original migration marker, global resume changes only `stop:*`.

Existing UI tests must continue to prove that enabling AI reply calls the global resume endpoint and rolls the switch back if it fails.

## Acceptance Criteria

- After deploying the change and explicitly toggling AI reply off then on once, old migration-paused conversations can process future inbound messages.
- No historical message is automatically resent.
- The one-time compensation is visible in read-only diagnostics.
- Subsequent deliberate per-conversation stops survive later global toggles.
- All backend, UI, extension, and release verification suites pass.

## Deferred Work

Context-aware handling of words such as `外包`, splitting reply and delivery counters, and adding pause reasons to the chat UI are separate changes and are not part of this repair.
