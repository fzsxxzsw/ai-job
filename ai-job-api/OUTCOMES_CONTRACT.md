# Application outcomes contract v1.4 (schemaVersion 1)

This is the single effective implementation contract. Source branch: codex/application-outcomes-20260907; base 1e5cc9c. API 9100 owns facts, tasks, leases, artifacts, reports and human feedback. Agent 9101 owns the real LangGraph/checkpoint workflow. It does not create duplicate agent_run records or perform browser actions.

## Common transport and types

Browser routes use the existing Authorization session header and strict origin allowlist. Internal routes use X-Internal-Token, configured as API_OUTCOME_INTERNAL_TOKEN on API and Agent; browser sessions do not authorize these routes. Internal base URL is fixed server configuration, never a submitted URL.

All responses retain the existing envelope:
```json
{"code":200,"message":"成功","data":{},"extend":null,"requestId":"opaque-id"}
```
Input objects forbid extra keys and never accept userId. Case/job/report/artifact/feedback/message/platform IDs are opaque strings. Revisions are positive integers; timestamps are Unix milliseconds. Body fields ending in At cannot exceed server now by more than 60 seconds. Never replace missing platform message time with collection time.

## Browser observations

POST /api/job/outcomes/observations
```json
{"schemaVersion":1,"observations":[{"eventId":"stable-event-id","encryptJobId":"CaseSensitiveJob","conversationKey":"CaseSensitiveConversation","bossId":"opaque-peer","source":"BOSS_PASSIVE_MESSAGE","observedAt":1788757200000,"bindingObservedAt":1788757190000,"messages":[{"messageId":"90071992547409932","clientMessageId":null,"role":"HR","text":"明天下午方便来面试吗？","sentAt":1788757195000,"deliveryState":"UNKNOWN"}],"readEvidence":null,"coverage":null}]}
```
Exact fields:
- schemaVersion Literal[1]; observations length 1..32, total request stays within existing body limit.
- eventId string 1..128. encryptJobId string 1..255. conversationKey string 1..255 or null; bossId string 1..80 or null. Null binding is permitted only for APPLICATION_FLOW with messages=[].
- source: APPLICATION_FLOW | BOSS_PASSIVE_MESSAGE | BOSS_SEND_ACK | BOSS_CONVERSATION_SNAPSHOT | BOSS_EXACT_MESSAGE_STATUS.
- observedAt and bindingObservedAt are positive integers describing actual first observation/binding verification, not retry time. Binding may be verified after the original message observation; both times must remain actual and no later than server now + 60 seconds. Later binding must refer to the exact captured message in a stable matching conversation, never an arbitrary later friend-cache entry.
- Except APPLICATION_FLOW, at least one message, readEvidence or coverage is required; an empty observation is HTTP422. BOSS_EXACT_MESSAGE_STATUS sends messages=[] plus readEvidence referencing an already acknowledged message; it cannot itself assert ACK. messages length 0..40. Message: {messageId:string 1..160,clientMessageId:string 1..160|null default null,role:HR|USER,text:string 0..4000,sentAt:positive int|null,deliveryState:ACKNOWLEDGED|UNKNOWN}. Empty text cannot support semantic classification. HR messages must have deliveryState UNKNOWN.
- readEvidence null or {messageId:string,state:READ|UNREAD,source:BOSS_EXACT_MESSAGE_STATUS,observedAt:int}. It must identify the exact USER message in this case. Platform MessageRead means user-read-HR and is not accepted as peer-read evidence. ACK is not READ.
- coverage null or {anchorMessageId:string,latestMessageId:string,checkedAt:int,completeAfterAnchor:true}. Allowed only for BOSS_CONVERSATION_SNAPSHOT with a verified latest conversation position and complete coverage after the concrete outbound anchor. Passive stream, cache/heartbeat and queue retry do not prove coverage.

APPLICATION_FLOW is sent only after the existing owner/job snapshot was successfully saved; absent snapshot is HTTP422. It may have null conversationKey/bossId and empty messages, but no readEvidence/coverage. It creates a waiting case, does not assert successful send and never starts a silence timer.
```json
{"schemaVersion":1,"observations":[{"eventId":"application:job-abc:attempt-1","encryptJobId":"job-abc","conversationKey":null,"bossId":null,"source":"APPLICATION_FLOW","observedAt":1788757200000,"bindingObservedAt":1788757200000,"messages":[],"readEvidence":null,"coverage":null}]}
```
Case identity is owner+exact encryptJobId. A stable case_key hash protects case-sensitive identifiers. An unbound case may acquire a verified conversation/peer; a conflicting existing binding is HTTP409 rather than silently merging chats. Uncertain cache associations must be withheld until resolved.

An unacknowledged USER echo may use messageId="client:<cmid>", clientMessageId=<cmid>, deliveryState UNKNOWN. BOSS_SEND_ACK may declare ACKNOWLEDGED only after correlating that client ID to the server MID. Its USER message requires clientMessageId and a different server messageId. API merges this exact owner+case+client-ID association into one message, retaining evidence history; conflicting server aliases are HTTP409. A verified conversation snapshot may supply an already sent USER server message without a client ID. Passive echo alone cannot be ACKNOWLEDGED.

Each repeated stream event retains its first eventId, observedAt, bindingObservedAt and complete payload in the persistent outbox/seen-event registry. A new ACK/read/snapshot is a new event but updates the same message. Retry time/receivedAt never advances evidence freshness. New coverage checkedAt is allowed only after an actual new latest-position verification.

Success data:
```json
{"acceptedEventIds":["stable-event-id"],"duplicateEventIds":[],"cases":[{"caseId":"opaque-case-id","revision":1,"status":"QUEUED"}]}
```
Same eventId and same normalized payload returns its prior receipt. Same eventId with different payload is HTTP409. Repeated later READ never postpones its first deadline, earlier credible READ takes the minimum, and UNREAD never downgrades READ. Repeated NO_REPLY coverage and courtesy messages after rejection/positive acknowledgement preserve the existing report and confirmation. A new explicit outcome or substantive rejection explanation creates a new material revision. Opposite signals with missing message time are UNKNOWN. Material evidence increments revision; unchanged/replayed evidence does not duplicate tasks.

## Outcome facts and time policy

outcome: WAITING | NO_REPLY | REPLIED | POSITIVE | REJECTED | UNKNOWN.
readState: READ | UNREAD | UNKNOWN, always for a concrete USER outbound.
waitingOn: HR | USER | NONE | UNKNOWN.
processingStatus (case): QUEUED | PROCESSING | READY | WAITING_OBSERVATION | RETRY | FAILED.

Ordinary HR conversation is REPLIED, not rejection. A supported invitation/next-step signal is POSITIVE (never inferred hiring). Explicit rejection triggers reason analysis automatically. Positive/negative evidence and waitingOn are separate; after HR asks a question it is normally the user's turn. Silence does not prove rejection or a rejection reason.
Automatic rejection requires a candidate/job-fit denial, an explicit failed hiring assessment, or a decision ending recruitment/cooperation. Negative wording about interview timing/location, contract negotiations, software versions or technical tests does not establish rejection. Clause-level continuation can establish a real interview invitation despite a scheduling disagreement. A short denial may use only the immediately preceding, reliably timed USER question explicitly about candidate/job fit; otherwise it remains REPLIED with its original evidence. Conflicting termination and continued invitation remains UNKNOWN. Isolated colloquial remarks such as "报价接不住" or "不合适" are deliberately insufficient without a clear hiring object or explicit refusal to continue; rule coverage is conservative, not exhaustive. A reliably timed, immediate HR assent such as "可以/好的/没问题" to an explicit USER interview or telephone-conversation request is POSITIVE and retains both proposal and assent as evidence. Courtesy responses to an introduction, promised documents, quoted proposals, or proposals with missing timestamps do not establish that agreement.

Default API_OUTCOME_READ_WAIT_HOURS=24 and API_OUTCOME_UNREAD_WAIT_HOURS=72, configurable. READ deadline is max(outbound sentAt, earliest credible READ observedAt)+24h; UNREAD deadline is outbound sentAt+72h. NO_REPLY additionally requires waitingOn=HR, concrete ACKNOWLEDGED outbound with trustworthy sentAt, explicit READ or UNREAD for it, and trusted coverage after that anchor with checkedAt >= deadline proving no later HR message. Without that evidence after expiry, status is WAITING_OBSERVATION and the last verified asOf is preserved. receivedAt/replayed batches/heartbeats never extend asOf.

The API creates durable next_check_at and a new revision for a material due transition once. It does not keep rescheduling a stale/offline observation forever. New real evidence wakes the case. The job freezes server time, policy version, facts and snapshot at first claim; later evidence supersedes it.

## Public cases, reports, feedback and task state

GET /api/job/outcomes/cases?limit=20&offset=0 -> {items:[CaseView],total:int}; limit1..100.
GET /api/job/outcomes/cases/{caseId} -> CaseView.
GET /api/job/outcomes/cases/{caseId}/history -> {reports:[ReportView]} (newest first, max50).
GET /api/job/outcomes/tasks?caseId=<optional>&limit=20&offset=0 -> {items:[TaskView],total:int}.
GET /api/job/outcomes/tasks/{jobId} -> TaskView.

CaseView:
```json
{"caseId":"case-id","encryptJobId":"CaseSensitiveJob","conversationKey":"CaseSensitiveConversation","bossId":"peer-id","revision":2,"status":"READY","nextCheckAt":null,"lastObservedAt":1788757200000,"outcome":"POSITIVE","readState":"UNKNOWN","waitingOn":"USER","report":{"reportId":"report-id","caseId":"case-id","revision":2,"outcome":"POSITIVE","readState":"UNKNOWN","waitingOn":"USER","asOf":1788757200000,"summary":"HR邀请安排面试，当前等待你的答复。","analysisSource":"RULES_ONLY","evidence":[{"evidenceId":"M:90071992547409932","source":"CHAT","messageId":"90071992547409932","role":"HR","quote":"明天下午方便来面试吗？"}],"explicitReasons":[],"inferredRisks":[],"unknowns":[],"suggestions":[],"feedbackStatus":"PENDING","isCurrent":true,"feedbackHistory":[]},"task":null}
```
ReportView is the nested report above. analysisSource RULES_ONLY|RULES_AI. Public evidence uses {evidenceId:string,source:CHAT|JOB|RESUME,messageId:string|null,role:HR|USER|null,quote:string}. CHAT messageId is the real platform identifier; engine evidence IDs are never substituted for it. JOB/RESUME have null messageId/role. Reason evidenceIds point to evidenceId. Evidence is bounded/redacted and source-linked. feedbackHistory contains the newest 50 append-only {feedbackId,action,correctedOutcome,correctedReason,createdAt} records. CaseView also has live outcome/readState/waitingOn, so harmless courtesy acknowledgements can update waiting direction without rewriting the confirmed report. Legacy rejection endpoints/history remain compatible. Report revisions do not inherit old confirmation.

TaskView:
```json
{"jobId":"job-id","caseId":"case-id","revision":2,"status":"WAITING_CONFIRMATION","phase":"WAITING_CONFIRMATION","attempts":1,"nextAttemptAt":null,"lastErrorCode":null,"reportId":"report-id","createdAt":1788757200000,"updatedAt":1788757202000,"phaseHistory":[{"phase":"COLLECTING","at":1788757200000},{"phase":"ANALYZING","at":1788757200100},{"phase":"VALIDATING","at":1788757201000},{"phase":"SAVING","at":1788757201500},{"phase":"SAVED","at":1788757201600},{"phase":"WAITING_CONFIRMATION","at":1788757202000}]}
```
Job status: READY|RUNNING|RETRY|WAITING_CONFIRMATION|CONFIRMATION_READY|COMPLETED|SUPERSEDED|FAILED.
Phase: COLLECTING|ANALYZING|VALIDATING|SAVING|SAVED|WAITING_CONFIRMATION|COMPLETED|FAILED|RETRY.
No public view exposes lease, internal credentials, raw model configuration, private frozen context/resume, or stack traces.

POST /api/job/outcomes/reports/{reportId}/feedback
```json
{"requestId":"stable-feedback-id","action":"CORRECT","correctedOutcome":"REPLIED","correctedReason":"这是正常询问信息，还没有明确约面试。"}
```
CONFIRM|CORRECT|IGNORE; correctedOutcome nullable outcome enum; correctedReason nullable max1000, required nonempty for CORRECT. Returns updated ReportView. Feedback is append-only and requestId-idempotent. It changes feedback view, not automated evidence. First feedback on the current report enables its human-confirmation resume; later corrections preserve history and do not reopen AI analysis. Feedback on a superseded report cannot wake/change the latest graph.

## Internal worker protocol

All routes below require X-Internal-Token. API_OUTCOME_LEASE_SECONDS default180 (30..600). Worker single-concurrency initially, renew every10s (at most lease/3). API_READ_ONLY/inactive owner prohibit work; aiSeatStatus pause does not disable analysis.

POST /internal/outcomes/claim with {"workerId":"outcome-agent"}.
Data null means no work. Otherwise:
```json
{"jobId":"job-id","caseId":"case-id","revision":2,"inputHash":"64-lowercase-hex","leaseToken":"runtime-only-token","leaseUntil":1788757380000,"executionMode":"START","phase":"COLLECTING","humanFeedback":null,"reportId":null,"artifactId":null,"context":{"schemaVersion":1,"caseId":"case-id","revision":2,"inputHash":"64-lowercase-hex","outcome":"POSITIVE","readState":"UNKNOWN","waitingOn":"USER","processingStatus":"READY","asOf":1788757200000,"analysisKind":"FACTS_ONLY","policyVersion":"outcome-policy-v1","graphVersion":"outcome-graph-v1"}}
```
executionMode START|RESUME_CONFIRMATION. RESUME_CONFIRMATION includes humanFeedback {feedbackId,reportId,action}, phase WAITING_CONFIRMATION or SAVED, and existing artifactId/reportId. No correction text is required by Agent. The frozen minimal projection is returned with claim; API retains private context/model configuration, so no context route is needed. Checkpoints persist only job/revision/hash/mode/artifact/report references, never the runtime lease or internal token.

Every job operation URL is /internal/outcomes/jobs/{jobId}/{operation}; all use POST and the same lease body:
```json
{"leaseToken":"runtime-only-token","revision":2,"inputHash":"64-lowercase-hex"}
```
- renew: lease body -> {jobId,revision,leaseUntil}.
- analyze: lease body + analysisKind (FACTS_ONLY|REJECTION_CAUSES, matching context) -> {jobId,revision,inputHash,artifactId,reused:bool}.
- validate: lease body + artifactId -> {jobId,artifactId,valid:true,validationVersion:"outcome-validation-v1"}. Invalid artifact returns {jobId,artifactId,valid:false,status:"FAILED",errorCode:"INVALID_ARTIFACT"}; no save allowed.
- commit: lease body + artifactId -> {jobId,caseId,caseRevision,reportId,status:"RUNNING",phase:"SAVED",isCurrent:bool}.
- park: lease body + artifactId + interruptId:string1..128 -> {jobId,reportId,status:"WAITING_CONFIRMATION"|"CONFIRMATION_READY",phase:"WAITING_CONFIRMATION"}.
- complete: lease body + artifactId + feedbackId -> {jobId,caseId,caseRevision,reportId,status:"COMPLETED",isCurrent:bool}.
- retry: lease body + errorCode DEPENDENCY_UNAVAILABLE|CHECKPOINT_UNAVAILABLE|INTERNAL_FAILURE -> {jobId,status:"RETRY"|"FAILED",nextAttemptAt:int|null}; API chooses capped backoff and attempts.

Analyze reuses the sole rejection_engine computation helper for REJECTION_CAUSES, writes one durable job artifact, and publishes neither outcome_report nor legacy rejection_analysis rows. FACTS_ONLY never requests rejection reasons. Cross-process per-job lock prevents concurrent double model calls; renewal is a separate short transaction. Duplicate analysis returns the same artifact. HTTP409 ANALYSIS_BUSY is retryable with lease renewal. Model duration can be120s plus3s slot wait; Agent HTTP timeout150s. Failed/unavailable model yields honest RULES_ONLY. A process crash after provider response but before artifact persistence can require another provider call; exactly-once billing is not promised.

Validate independently checks artifact hash/schema, allowed enums, exact correspondence to frozen evidence/outcome, and no rejection-reason inference from silence; records validation hash and phase history. Commit requires that same validated artifact, active owner, matching unexpired lease, input hash and case revision in one transaction. Report uniqueness is case+revision; old analysis cannot replace current_report_id.

CRITICAL save/interrupt protocol: commit keeps status RUNNING, phase SAVED and the current lease. Agent then enters its durable LangGraph human interrupt. Only AFTER the interrupt checkpoint is persisted does the worker call park. park atomically clears the lease and sets WAITING_CONFIRMATION. If feedback arrived before park, it sets CONFIRMATION_READY instead; no confirmation is lost. If feedback arrives after park, it also sets CONFIRMATION_READY.

Crash recovery: save-before-checkpoint/park still has a reclaimable lease. On expiry, claim returns the same job/revision with existing artifact/report. Replay uses the existing artifact, successful validation and report id, reaches a real interrupt, and parks; no duplicate report and no second model call. If checkpoint is missing for a job whose API artifact/report exists, reconstruct the graph from those durable references; do not require a second user confirmation. Existing feedback is carried in claim and may complete the human node during reconstruction. Corrupt/unrecoverable checkpoints without safe durable references are visible errors.

After feedback, claim sets a new runtime lease and executionMode RESUME_CONFIRMATION. Resume the matching durable interrupt with server-provided humanFeedback, or reconstruct/replay the safe pending stages described above, then call complete. Only complete acknowledges task completion and permits END. It checks stored feedbackId/report and current revision. Repeated completed artifact/feedback is idempotent. Stale revision output or feedback never changes a newer case/report. Later corrections do not restart analysis.

Errors use normal envelope and data=null: HTTP401 INTERNAL_AUTH_REQUIRED; HTTP403 OWNER_INACTIVE; HTTP404 JOB_NOT_FOUND; HTTP409 LEASE_LOST|REVISION_SUPERSEDED|INPUT_MISMATCH|ARTIFACT_MISMATCH|ANALYSIS_BUSY; HTTP422 validation; HTTP503 OUTCOME_DISABLED|READ_ONLY|DEPENDENCY_UNAVAILABLE. All409 except ANALYSIS_BUSY are terminal for that lease. Error text persisted in task views is a fixed sanitized code, never an upstream exception body.

## Storage and migration

Five additive tables; API is their sole state writer:
- outcome_case: id,user_id,case_key(unique with user),encrypt_job_id,binding,revision,facts_json,current_report_id,status,next_check_at,last_observed_at,last_verified_observation_at,timestamps.
- outcome_observation: id,user_id,event_id(unique with user),case_id,payload_hash,source,observed_at,received_at,payload_json.
- outcome_job: id,user_id,case_id,revision(unique case+revision),context_json,input_hash,status,phase,phase_history_json,available_at,lease_token,lease_until,attempts,artifact_json,artifact_id,validation_hash,report_id,feedback_id,last_error_code,timestamps.
- outcome_report: id,user_id,case_id,revision(unique case+revision),report_json,feedback_status,timestamps.
- outcome_feedback: id,user_id,report_id,request_id(unique with user),payload_hash,action,corrected_outcome,corrected_reason,created_at.

API explicit migration creates them; startup does not perform DDL. Fresh schema has14 tables. Existing MySQL records/snapshots/rejections remain intact. Identifiers use binary equality. Tests use synthetic/disposable databases, never production. Browser collection and analysis are passive; no CONTACT_JOB, sending, automatic confirmations or strategy edits are part of this protocol.
