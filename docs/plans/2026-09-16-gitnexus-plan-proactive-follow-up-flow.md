# Proactive Follow-Up Flow

## 1. Objective
Implement one safe automatic follow-up per valid application, generated from frozen resume/JD/conversation facts and sent only while the AI master switch, exact binding, conversation state, and platform risk controls remain valid. [verified]

## 2. Current Behaviour
- `Applications.follow_up_candidates` only previews exact `READ + SOFT_REJECTED` rows and creates no durable work, so the automation worker has nothing to process. [verified]
- Existing `REPLY` and `APPLICATION` jobs already provide durable computation, action leases, exact ACK receipts, and lifecycle audit. [verified]

## 3. Constraints
- No browser navigation, refresh, or delivery during implementation/verification. [assumed]
- Follow-up is automatic when AI reply is enabled; no per-message approval. Each application can create at most one follow-up job. [assumed]
- Explicit rejection, interview, offer, withdrawal, invalid/incomplete application, ambiguous binding, newer HR message, missing ACK, or platform risk stop blocks delivery. [assumed]

## 4. Graph Findings
- `compute` is the single artifact/action producer for automation jobs; its graph callers are unresolved, but text search confirms `Workflow.compute` imports and invokes it. [graph]
- `Jobs.submit` owns durable business-key dedupe and exact binding; graph risk is UNKNOWN, and route/runtime text references confirm its wider contract surface. [graph]
- `browserAutomationReady` has LOW upstream impact across reply/application executors and is the browser authorization gate. [graph]

## 5. Source Findings
- Conversation messages persist role, order, delivery state, application binding, and exact message IDs needed for eligibility/revalidation. [verified]
- Existing `SEND_TEXT` dispatch requires an executor lease, exact client MID, authorization revision, ACK receipt, and risk-aware browser readiness. [verified]
- PDG was unavailable (`no-layer`), so control/data constraints are source-verified rather than PDG-derived. [verified]

## 6. Proposed Changes
- Extend `Applications.follow_up_candidates` to dual evidence tracks: exact read after 24h and acknowledged-no-reply fallback after 48h; return explicit blockers and only mark VALID, complete, exactly bound, terminal-free, never-followed applications eligible. [verified]
- Add `FOLLOW_UP` plus a bounded `FollowUpInput` to automation contracts and durable job identity; freeze resume/history/JD facts and generate exactly one concise `SEND_TEXT` action with `NOT_REQUIRED` approval. [verified]
- Revalidate application, latest message, anchor ACK, terminal events/status, exact binding, and prior follow-up inside `Actions.dispatch` immediately before issuing a platform permit. [verified]
- Extend agent job-kind protocol/graphs and browser runtime types/executor registration. [verified]
- Add a bounded browser-side scanner that submits eligible candidates automatically only when AI reply is enabled, the BOSS risk circuit is clear, the chat bridge is ready, and an exact live contact exists; reuse existing locked `performUnifiedText` + ACK path. [verified]
- Show `FOLLOW_UP` as “自动跟进” in task history and expose evidence-track/blocker details in career protocol. [verified]

## 7. Implementation Sequence
1. Add contracts/types and deterministic business identity (`applicationId`) across API, agent, and UI.
2. Strengthen candidate selection and dispatch-time revalidation, including one-follow-up-only blocking.
3. Add AI follow-up computation/validation with a concise text-only action and automatic approval.
4. Register the automatic scanner/executor without navigation and wire task labels/statuses.
5. Add API, agent, and UI regression tests; verify zero platform calls in tests.

## 8. Test Strategy
- API: exact-read 24h, ACK fallback 48h, invalid/incomplete/terminal/newer-HR/prior-follow-up blockers, deterministic dedupe, auto-approved text-only artifact, dispatch recheck race. [verified]
- Agent: `FOLLOW_UP` claim parsing and graph compilation/lifecycle. [verified]
- UI: master-switch/risk/contact gating, deterministic submission, no duplicate submissions, exact binding readiness, existing reply/application behavior unchanged. [verified]
- Run targeted suites, then full API/agent/UI checks and GitNexus `detect-changes --scope all`. [assumed]

## 11. Implementation Context
- task_summary: Add automatic, once-per-application AI follow-up using the existing durable automation/ACK pipeline.
- evidence_provenance: schema=2; head=3d3581ad2624e850bb2d7b4f06b6a59af7cd7c0f; dirty_digest=0a9c85780067d9afcd0764f307b60891e3cee927ee11eaeb5ec7826d10fd82cd.
- files_to_modify: career/applications.py; automation/{contracts,jobs,storage,computation,actions,routes}.py; agent automation_{client,graph}.py; UI unifiedAutomation.ts, unifiedRuntime.ts, bossPlatform.ts, careerProtocol.ts, AutomationTasks.vue; tests.
- tests: API candidate/automation; agent lifecycle/client; UI unified runtime and follow-up scanner.
- verification_commands: targeted pytest/node tests; package builds; GitNexus detect-changes; push and wait for GitHub Actions before local release.
- pdg_constraints: unavailable; preserve source-verified ordering: eligibility -> durable submit -> frozen compute -> server dispatch recheck -> browser readiness -> platform call -> ACK.
- assumptions: 24h exact-read, 48h ACK fallback, one automatic follow-up, AI master switch controls execution.
- open_questions: none; user explicitly chose automatic follow-up without per-message confirmation.
- avoid: browser navigation/refresh during implementation; second follow-up; sending on UNKNOWN validity or partial metadata; bypassing ACK/risk/manual-takeover gates.

## 12. Assumptions and Open Questions
The AI reply master switch remains the user-visible kill switch; automatic follow-up does not silently enable it. [assumed]

## 13. Definition of Done
Eligible rows automatically become durable `FOLLOW_UP` jobs and send at most one concise ACK-tracked message when all gates remain true; every blocker is explainable, race rechecks cancel stale work, tests pass, CI passes, and the released build ID is verified without claiming live-browser verification. [assumed]
