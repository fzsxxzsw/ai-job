# GitNexus Engineering Plan

Generated: 2026-09-10
Repository: `C:/Users/Administrator/Desktop/job-helper-chrome-release-20260905`
Plan posture: full (bug fix + state transition + ranking + diagnostics)

## 1. Objective

Repair the actually deployed Job Helper release so that an explicit user action enabling AI replies also removes the global reply pause, while preserving every historical per-conversation pause; prioritize newly published BOSS jobs and active recruiters without dropping fallback jobs; and make reply/ranking failures directly diagnosable from a read-only backend script.

Acceptance criteria:

- Turning AI replies on saves `aiSeatStatus=1`, then clears only `stop:*` through the existing authenticated control endpoint.
- If clearing the global stop fails, the enable operation compensates by saving `aiSeatStatus=0`, the UI returns to off, and the error is visible; no message is sent as part of the toggle.
- Turning AI replies off does not clear any stop control. No per-session `stop:<jobKey>` value is changed by this repair.
- Jobs published within 7 days with an online Boss rank ahead of other jobs; freshness and online state remain soft ranking signals so incomplete/older jobs are retained.
- Existing preference scoring remains the tie-breaker inside the same recruiting-signal tier.
- Application snapshots persist `lastModifyTime` and `bossOnline` when supplied by BOSS.
- `debug-job-helper.ps1 -Action pipeline` reports global/session pause state, AI-seat/global-stop contradictions, REPLY decision/result counts, SEND_TEXT action/receipt counts, executor heartbeat freshness/capabilities, model fallback readiness, and ranking-signal capture without printing message, resume, token, or prompt content.
- Unit tests, typecheck/build, read-only diagnostics, GitNexus change detection, local release verification, and GitHub checks pass. Browser/BOSS interaction remains untouched unless separately authorized.

## 2. Current Behaviour

- [verified] `AiJob.vue::handlerAISeatStatusChange` only saves `aiSeatStatus`; it does not change `stop:*`.
- [verified] `main.py::stop_session` maps `globalJobKey` to `stop:*` and intentionally avoids per-session round reset for the global key.
- [verified] `conversation.py::is_stopped` and `automation/computation.py` stop a REPLY when the seat, global stop, or session stop blocks it.
- [verified] Runtime data showed AI seat enabled while `stop:* = true`; 78 of 83 REPLY jobs ended with STOP “当前会话或 AI 回复已暂停” and created no actions.
- [verified] `BossPlatform.sortJobsByPreference` currently considers only preference score; the deployed source does not call a freshness/activity ranker.
- [verified] `normalizeBossJob` already captures `lastModifyTime` and `bossOnline`, but `unpackBaseInfo` omits both from application snapshots.
- [verified] Current Python containers emit almost no stage-level logs; the existing debug script focuses on service/runtime/database/rejection health and cannot explain unified REPLY stops.

## 3. Relevant Architecture

- UI state transition: `AiJob.vue` -> `/api/user/save/preference`; existing `AiPower.updateAskStatus` -> `/api/job/seeker/cloned/change/session/status`.
- Reply stop boundary: `main.py::stop_session` -> `Database.set_control`; computation and action authority both read `stop:*`/`stop:<jobKey>`.
- Job intake: `collectBossJobs`/`normalizeBossJob` -> `BossPlatform.getJobList` -> `sortJobsByPreference` -> application workflow.
- Snapshot observability: `BossPlatform.matchJob` -> `unpackBaseInfo` -> unified application snapshot persistence.
- Diagnostics: `debug-job-helper.ps1` performs fixed, aggregate, read-only MySQL queries and sanitized container/runtime checks.

## 4. GitNexus Findings

- [graph] `handlerAISeatStatusChange` has risk `UNKNOWN` with zero resolved callers because Vue template bindings are not represented as call edges. Text search verifies exactly one `@change="handlerAISeatStatusChange"` binding plus one structural test and generated bundles; source bundles are build outputs, not edit targets.
- [graph] `sortJobsByPreference` has LOW risk: one direct caller (`BossPlatform.getJobList`), five impacted symbols, one affected platform process group.
- [graph] `unpackBaseInfo` has LOW risk: one direct caller (`BossPlatform.matchJob`) and no affected process membership.
- [graph] `debug-job-helper.ps1` has risk `UNKNOWN` as an uncalled file node. Text search verifies it is a standalone manual entry point; runtime code does not import it.
- [graph] Query results locate the reply stop path `ask -> conversation_reply -> is_stopped` and executor ownership/heartbeat handling in `automation/actions.py` and `automation/routes.py`.
- [verified] No impact result was HIGH or CRITICAL, so no edit warning gate is active.

## 5. Statement-Level PDG Findings

- [graph] `handlerAISeatStatusChange` is gated first by the product-mode seat check and then by `loginInterceptor`; the `val` parameter flows into the saved `aiSeatStatus`. The new global-resume call must stay after both guards and after the preference save.
- [graph] `sortJobsByPreference` currently has two `jobList` return uses: unchanged list without preference and preference-only sorted copy. Replace both outcomes with a stable ranker call so freshness works even if preferences are absent.
- [graph] `stop_session` applies per-session round resets only when `not stop` and `jobKey != globalJobKey`. Calling it with `globalJobKey,false` therefore changes only the global control/authority epoch, not historical conversation controls.

## 6. Proposed Changes

1. Add `runtime/aiReplyToggle.ts` as a small, dependency-injected state-transition helper. It saves the requested seat state; on enable it clears the global stop; if that second step fails it makes a best-effort compensating save to disabled and rejects.
2. Update `AiJob.vue::handlerAISeatStatusChange` to use that helper with the existing preference endpoint and `AiPower.updateAskStatus('globalJobKey', false)`. Preserve existing guards/notifications, update the remembered state only after the whole transition succeeds, and roll the local switch back on failure.
3. Add focused toggle tests covering disable, successful enable ordering, and failed global-resume compensation.
4. Add `rankBossJobsForRecruitingLikelihood` to `jobSourceAdapter.ts`: normalize Unix seconds/milliseconds; rank 7-day fresh+online, fresh, 30-day+online, 30-day, older online, known older, unknown; tie-break by preference score, timestamp, then original index.
5. Change `BossPlatform.sortJobsByPreference` to delegate to the ranker and add ranking tests. Add `lastModifyTime` and `bossOnline` to `unpackBaseInfo` for later diagnostics.
6. Extend `debug-job-helper.ps1` with the agent service, ranker marker, and a `pipeline` action. Aggregate only fixed enums/counts/timestamps from `py_api_control`, `automation_job`, `automation_action`, `automation_action_event`, `user_info`, snapshots, sessions, and delivery audit. Treat configured default-model health separately from optional custom-model readiness.
7. Preserve live safety state during rollout: do not clear the current database stop, enable delivery, start automation, or navigate BOSS. The new behavior activates only on a later explicit UI toggle by the user.

## 7. Implementation Sequence

1. Re-anchor this plan and verify the cited files/dirty digest before editing.
2. Implement and unit-test the AI reply toggle helper, then wire the Vue handler. Risk note: compensation is fail-closed; if rollback itself fails, local UI still returns off and the original error remains visible.
3. Implement the soft recruiting-likelihood ranker and unit tests; integrate it into `sortJobsByPreference`; add snapshot fields. Risk note: no hard filtering, so a missing/unstable BOSS field cannot erase candidates.
4. Port and customize pipeline diagnostics. Validate PowerShell parsing and run it against the live stack in read-only mode. Risk note: fixed aggregate output only; no raw `input_json`, `result_json`, message, resume, token, URL query, or prompt text.
5. Run targeted tests, full UI unit/type/build checks, and the repository build script.
6. Run `detect_changes(scope=all)` and inspect every affected process; re-index if graph results are partial/truncated.
7. Run the local-first release script, verify served build/version/hash and container health while keeping global stop intact. Do not perform browser acceptance without authorization.
8. Commit only the plan and intended implementation files, push the branch, wait for GitHub Actions, and report the manual browser/userscript badge verification still required.

## 8. Test Strategy

- Unit: `aiReplyToggle.test.mjs` verifies call order (`save enabled` before `clear global`), no clear on disable, compensation on failure, and rejection propagation.
- Unit: `jobSourceAdapter.test.mjs` verifies 7-day fresh+online priority, fallback retention, Unix seconds, preference tie-break, timestamp tie-break, and stable original order.
- Static: `pnpm test`, `pnpm run typecheck`, and the extension/package build under `ai-job-hunting-ui`.
- Script: PowerShell parser validation plus `./debug-job-helper.ps1 -Action pipeline`; assert it reports `GLOBAL_REPLY_STOP_WITH_ENABLED_SEAT` on the current data and does not print sensitive payloads.
- Integration: `./build-job-helper.ps1` followed by `./release-job-helper.ps1` per the release worktree instructions; verify service health, exact version/build ID, image IDs, runtime hash, and extension artifact hashes.
- Regression: confirm the global database stop remains true after deployment until the user explicitly toggles AI off then on; no outbound automation is invoked by any test/release step.
- CI: push only after local verification, then wait for the corresponding GitHub Actions checks to succeed.

## 9. Risk and Impact Analysis

- AI toggle state is safety-sensitive. Mitigation: ordered two-step enable, fail-closed compensation, explicit user action only, existing authenticated APIs, and no session-stop deletion.
- Freshness timestamps may be absent or in seconds. Mitigation: normalization plus soft tiers and stable fallback ordering.
- `bossOnline` is only a point-in-time signal. Mitigation: it affects priority, never eligibility.
- Vue template invocation is outside the graph caller model. Mitigation: direct template/text verification and focused helper unit tests.
- Diagnostic JSON paths/schema may drift. Mitigation: required-table presence checks, fixed SQL enums, aggregate-only fallback, and degraded exit status instead of raw row output.
- GitNexus reported the index one commit behind despite a forced rebuild; source evidence is pinned to HEAD `8e62245...`, and all target symbols were verified directly before edits.

## 10. Files Expected to Change

- `docs/plans/2026-09-10-gitnexus-plan-reply-ranking-diagnostics.md`
- `ai-job-hunting-ui/src/runtime/aiReplyToggle.ts` (new)
- `ai-job-hunting-ui/src/runtime/aiReplyToggle.test.mjs` (new)
- `ai-job-hunting-ui/src/components/ui/AiJob.vue`
- `ai-job-hunting-ui/src/platform/boss/jobSourceAdapter.ts`
- `ai-job-hunting-ui/src/platform/boss/jobSourceAdapter.test.mjs`
- `ai-job-hunting-ui/src/platform/platform.ts`
- `debug-job-helper.ps1`

Generated bundles, runtime files, extension artifacts, and release metadata may be regenerated by the documented build/release scripts but are not hand-edited and must be isolated according to repository release rules.

## 11. Reusable Implementation Context

Task contract:

- Change only the actual release worktree.
- Never manipulate Chrome/BOSS without explicit authorization.
- Never clear live stops or send messages as part of implementation/testing.
- Use `apply_patch` for source edits, impact before symbol edits, and `detect_changes` before commit.

Key symbols and anchors:

- `Function:ai-job-hunting-ui/src/components/ui/AiJob.vue:handlerAISeatStatusChange`, lines 933–956.
- `Method:ai-job-hunting-ui/src/platform/platform.ts:BossPlatform.sortJobsByPreference#1`, lines 1158–1164.
- `Method:ai-job-hunting-ui/src/platform/platform.ts:BossPlatform.unpackBaseInfo#1`, lines 1660–1678.
- `Function:ai-job-api/src/job_helper_api/main.py:create_app.stop_session`, lines 284–298.
- `Function:ai-job-api/src/job_helper_api/conversation.py:is_stopped`, lines 55–62.
- `ai-job-api/src/job_helper_api/automation/computation.py`, REPLY stop branch around lines 100–102.

Evidence provenance (compact): schema 2; HEAD `8e62245c7cd3f27564f0b8273cc9ea9439bbcdf2`; global dirty digest `0a9c85780067d9afcd0764f307b60891e3cee927ee11eaeb5ec7826d10fd82cd`; generated path `docs/plans/2026-09-10-gitnexus-plan-reply-ranking-diagnostics.md`.

Evidence provenance (full):

```json
{
  "schema_version": 2,
  "head_commit": "8e62245c7cd3f27564f0b8273cc9ea9439bbcdf2",
  "generated_plan_path": "docs/plans/2026-09-10-gitnexus-plan-reply-ranking-diagnostics.md",
  "global_dirty_digest": {
    "algorithm": "sha256",
    "canonicalization": "gitnexus-evidence-provenance-v2 NUL-framed UTF-8 records",
    "value": "0a9c85780067d9afcd0764f307b60891e3cee927ee11eaeb5ec7826d10fd82cd"
  },
  "cited_path_manifest": [
    {"path":"ai-job-api/src/job_helper_api/automation/computation.py","object_kind":{"head":"regular","index":"regular","worktree":"regular","untracked":"absent"},"state":"clean","rename_from":null,"rename_to":null,"head_digest":"sha256:c138d6ed5994a81a718c7fd7692740c74a55e2732f3d9f31266ad7476c5647f6","index_digest":"sha256:c138d6ed5994a81a718c7fd7692740c74a55e2732f3d9f31266ad7476c5647f6","worktree_digest":"sha256:c138d6ed5994a81a718c7fd7692740c74a55e2732f3d9f31266ad7476c5647f6","untracked_digest":"absent"},
    {"path":"ai-job-api/src/job_helper_api/conversation.py","object_kind":{"head":"regular","index":"regular","worktree":"regular","untracked":"absent"},"state":"clean","rename_from":null,"rename_to":null,"head_digest":"sha256:02c7bef7159862fcf9d28c78099ec2a0e953366bcaa1da52b8714bc985694292","index_digest":"sha256:02c7bef7159862fcf9d28c78099ec2a0e953366bcaa1da52b8714bc985694292","worktree_digest":"sha256:cd464225abb34c2dbfab71100237de513c9ca616d7e0e0b813b9591bbb9fbfc4","untracked_digest":"absent"},
    {"path":"ai-job-api/src/job_helper_api/main.py","object_kind":{"head":"regular","index":"regular","worktree":"regular","untracked":"absent"},"state":"clean","rename_from":null,"rename_to":null,"head_digest":"sha256:ed938960c11177e292f0f52943dfdab6861c6e4957918371b1e8d3b9cfd3739a","index_digest":"sha256:ed938960c11177e292f0f52943dfdab6861c6e4957918371b1e8d3b9cfd3739a","worktree_digest":"sha256:a20b63f545683fb2c7f2e81f0f8e4bbbc9708c1dc60ba7ae491088c06112fef3","untracked_digest":"absent"},
    {"path":"ai-job-hunting-ui/package.json","object_kind":{"head":"regular","index":"regular","worktree":"regular","untracked":"absent"},"state":"clean","rename_from":null,"rename_to":null,"head_digest":"sha256:839c2bb38153b38cf0870d311623f554e69d724931d98a7feb476d1f8ceacf7c","index_digest":"sha256:839c2bb38153b38cf0870d311623f554e69d724931d98a7feb476d1f8ceacf7c","worktree_digest":"sha256:839c2bb38153b38cf0870d311623f554e69d724931d98a7feb476d1f8ceacf7c","untracked_digest":"absent"},
    {"path":"ai-job-hunting-ui/src/components/ui/AiJob.vue","object_kind":{"head":"regular","index":"regular","worktree":"regular","untracked":"absent"},"state":"clean","rename_from":null,"rename_to":null,"head_digest":"sha256:cef3a7c1d32535e32e18038da96de323cca63437427e14497be0ef9b59bdc9ad","index_digest":"sha256:cef3a7c1d32535e32e18038da96de323cca63437427e14497be0ef9b59bdc9ad","worktree_digest":"sha256:cef3a7c1d32535e32e18038da96de323cca63437427e14497be0ef9b59bdc9ad","untracked_digest":"absent"},
    {"path":"ai-job-hunting-ui/src/platform/aiPower.ts","object_kind":{"head":"regular","index":"regular","worktree":"regular","untracked":"absent"},"state":"clean","rename_from":null,"rename_to":null,"head_digest":"sha256:cce437cc21a6fa6301c42640dca0e7730303c07252575c8640c58d57f4859c69","index_digest":"sha256:cce437cc21a6fa6301c42640dca0e7730303c07252575c8640c58d57f4859c69","worktree_digest":"sha256:fe979ce3cda719cc9e81a38f3ed1ef8ef161443b692e1919e9b2289c703e617c","untracked_digest":"absent"},
    {"path":"ai-job-hunting-ui/src/platform/boss/jobSourceAdapter.test.mjs","object_kind":{"head":"regular","index":"regular","worktree":"regular","untracked":"absent"},"state":"clean","rename_from":null,"rename_to":null,"head_digest":"sha256:6cc9fbcc9b4726a4402482d52d8ee5d8ea4f5a8fb099b8499bd998cb2223c1a8","index_digest":"sha256:6cc9fbcc9b4726a4402482d52d8ee5d8ea4f5a8fb099b8499bd998cb2223c1a8","worktree_digest":"sha256:4942b243c6620dc5d9e78464295c2c65c2a44e7d0e2f99f0115dc149dbeae3e5","untracked_digest":"absent"},
    {"path":"ai-job-hunting-ui/src/platform/boss/jobSourceAdapter.ts","object_kind":{"head":"regular","index":"regular","worktree":"regular","untracked":"absent"},"state":"clean","rename_from":null,"rename_to":null,"head_digest":"sha256:fada3dc5e78265074ee033685c2952eeaf0458009ac4cc535c178ea3f21e05a6","index_digest":"sha256:fada3dc5e78265074ee033685c2952eeaf0458009ac4cc535c178ea3f21e05a6","worktree_digest":"sha256:fcafcd352512e2dc8c36aac49a71e81349960a94dea90f91c7336ff2f4e499d5","untracked_digest":"absent"},
    {"path":"ai-job-hunting-ui/src/platform/platform.ts","object_kind":{"head":"regular","index":"regular","worktree":"regular","untracked":"absent"},"state":"clean","rename_from":null,"rename_to":null,"head_digest":"sha256:d4628bb50263540618dd1721fdbb51400aa4351f88836f52cdc462754f430199","index_digest":"sha256:d4628bb50263540618dd1721fdbb51400aa4351f88836f52cdc462754f430199","worktree_digest":"sha256:c5b4a6ac05c5041e6f51c681611313d4124bee9bba1a89f274c11452fbca35f1","untracked_digest":"absent"},
    {"path":"ai-job-hunting-ui/src/runtime/aiReplyToggle.test.mjs","object_kind":{"head":"absent","index":"absent","worktree":"absent","untracked":"absent"},"state":"absent","rename_from":null,"rename_to":null,"head_digest":"absent","index_digest":"absent","worktree_digest":"absent","untracked_digest":"absent"},
    {"path":"ai-job-hunting-ui/src/runtime/aiReplyToggle.ts","object_kind":{"head":"absent","index":"absent","worktree":"absent","untracked":"absent"},"state":"absent","rename_from":null,"rename_to":null,"head_digest":"absent","index_digest":"absent","worktree_digest":"absent","untracked_digest":"absent"},
    {"path":"build-job-helper.ps1","object_kind":{"head":"regular","index":"regular","worktree":"regular","untracked":"absent"},"state":"clean","rename_from":null,"rename_to":null,"head_digest":"sha256:a39f18fe9637c57ad1ffd798c802c5ce1cac997dae8e272a3b4640ad8ae5e089","index_digest":"sha256:a39f18fe9637c57ad1ffd798c802c5ce1cac997dae8e272a3b4640ad8ae5e089","worktree_digest":"sha256:c694f76f66490395d69413544a6ddc48a108cb0f2fc4be396755f97361ece150","untracked_digest":"absent"},
    {"path":"debug-job-helper.ps1","object_kind":{"head":"regular","index":"regular","worktree":"regular","untracked":"absent"},"state":"clean","rename_from":null,"rename_to":null,"head_digest":"sha256:f9f166027def9faae0e434c277e399d53330c52aabe0945cde9add3d6913a375","index_digest":"sha256:f9f166027def9faae0e434c277e399d53330c52aabe0945cde9add3d6913a375","worktree_digest":"sha256:51bcc23329ab591ff124f5593cfefaba2759c7bfc9b350f3e5485548de4102e5","untracked_digest":"absent"},
    {"path":"docker-compose.local.yml","object_kind":{"head":"regular","index":"regular","worktree":"regular","untracked":"absent"},"state":"clean","rename_from":null,"rename_to":null,"head_digest":"sha256:d7ecc19a2f5d507012a472d8f254e70ccc9aae2312c0703f6de3df7f52c4c22c","index_digest":"sha256:d7ecc19a2f5d507012a472d8f254e70ccc9aae2312c0703f6de3df7f52c4c22c","worktree_digest":"sha256:d7ecc19a2f5d507012a472d8f254e70ccc9aae2312c0703f6de3df7f52c4c22c","untracked_digest":"absent"},
    {"path":"release-job-helper.ps1","object_kind":{"head":"regular","index":"regular","worktree":"regular","untracked":"absent"},"state":"clean","rename_from":null,"rename_to":null,"head_digest":"sha256:4b88335f1ef19f9b948de07baafa851581a477fb88d7bb2ce64d7115be888de5","index_digest":"sha256:4b88335f1ef19f9b948de07baafa851581a477fb88d7bb2ce64d7115be888de5","worktree_digest":"sha256:4dcdb326d02a2027533f116517f5277da87b31ef6a9b87b74d2114528eb93c75","untracked_digest":"absent"}
  ]
}
```

## 12. Assumptions and Open Questions

- [assumed] `lastModifyTime` remains a reasonable proxy for publication/refresh recency; BOSS does not provide a stable documented contract, so the implementation treats it as a soft signal.
- [assumed] `bossOnline` represents current recruiter activity at capture time, not guaranteed hiring intent.
- [open] The exact historical actor that set `stop:* = true` cannot be reconstructed because access logging/control-event auditing was absent. This repair makes the current contradiction visible and prevents the UI from recreating it during explicit enable; a persistent control-event audit table is deferred.
- [open] Existing per-session pauses were deliberately seeded/mutated and remain preserved. A future batch-resume UI would require separate user confirmation and is out of scope.
- [open] Browser badge/installed userscript acceptance requires explicit authorization and will be reported as manual if not granted.

## 13. Definition of Done

- All acceptance criteria above are met by tests or read-only runtime evidence.
- GitNexus `detect_changes(scope=all)` is complete, non-truncated, reviewed, and run before commit.
- Local build/release succeeds with exact version/build/hash records and healthy services while existing stops remain intact.
- Only intended source/plan/generated release artifacts are committed according to repository policy; no unrelated changes enter the commit.
- The branch is pushed and GitHub Actions pass.
- Final handoff clearly distinguishes code/runtime completion from the unperformed browser/BOSS verification and states that no outbound action was triggered.
