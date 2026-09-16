/** Fixed authenticated automation transport. Platform operations are injected by the browser adapter. */
import type {OutcomeTask} from '../extension/outcomesProtocol'
export const ACTION_KINDS = ['CONTACT_JOB', 'SEND_GREETING', 'SEND_TEXT', 'SEND_RESUME', 'ACCEPT_PHONE', 'ACCEPT_WECHAT', 'ACCEPT_RESUME'] as const
export type ActionKind = typeof ACTION_KINDS[number]
export type AutomationDecision = {code: 'SEND' | 'CONTACT' | 'REJECT' | 'STOP' | 'MISSING_MATERIALS' | 'REVIEW_READY'; reason: string}
export type AutomationAction = {
    actionId: string; jobId: string; kind: ActionKind; status: string; sequence: number; clientMid: string | null
    payloadHash: string; approvalStatus: 'NOT_REQUIRED' | 'PENDING' | 'APPROVED' | 'DECLINED'
    payload: {encryptJobId: string; bossId: string | null; conversationKey: string | null; text?: string
        requestMessageId?: string; resumeVersionId?: string | null; platformResumeId?: string | null}
    lastErrorCode: string | null; leaseToken?: string; leaseUntil?: number; authorizationRevision?: number
}
export type AutomationJob = {
    jobId: string; kind: 'REPLY' | 'APPLICATION' | 'FOLLOW_UP' | 'CAREER_REVIEW'; status: string; phase: string; revision: number
    inputHash: string; createdAt: number; updatedAt: number; lastErrorCode: string | null; decision: AutomationDecision | null
    actions: AutomationAction[]; phaseHistory: {phase: string; at?: number}[]
    reviewedAt?: number | null; display?: {jobTitle: string; companyName: string; recruiterName: string}
    result: null | {schemaVersion: 1; kind: AutomationJob['kind']; decision: AutomationDecision; analysis: Record<string, unknown> | null; missingMaterials: string[]}
}
export type AutomationStatus = {
    contractVersion: 1; enabled: boolean; mode: 'LANGGRAPH' | 'LEGACY'; buildId: string
    agent: {state: 'READY' | 'STALE' | 'OFFLINE'; lastSeenAt: number | null; lastCompletedAt: number | null; lastErrorCode: string | null}
    executor: {state: 'READY' | 'STALE' | 'OFFLINE'; lastSeenAt: number | null}
    counts: {queued: number; running: number; waitingExecution: number; waitingConfirmation: number; uncertain: number; reviewedUncertain: number; failed: number; completed: number}
    outcomes: {enabled: boolean; caseCount: number; reportCount: number; lastObservedAt: number | null
        tasks?: {counts: Record<string, number>; total: number; items: OutcomeTask[]}}
}
export type FilterInput = {prompt: string; jobBaseInfo: string; jobExtInfo: string; resumeMatchEnabled: boolean; minMatchScore: number; titleRuleStatus?: string; titleMatchedKeywords: string[]; configuredSalaryRange?: string; offeredSalaryRange?: string}
export type AutomationSubmission = {
    requestId: string; kind: 'REPLY' | 'APPLICATION' | 'FOLLOW_UP'; platformAccount: string; conversationKey: string | null; encryptJobId: string; bossId: string | null
    input: {inboundMessageId: string; inboundSentAt: number | null; question: string; jobKey: string; jobInfo: Record<string, unknown>; platformResumeId: string | null
        exchangeRequest: null | {kind: 'ACCEPT_PHONE' | 'ACCEPT_WECHAT' | 'ACCEPT_RESUME'; requestMessageId: string}}
        | {cycleKey: string; filterInput: FilterInput; localAssessment: {passed: boolean; reason: string}; greeting: {enabled: boolean; text: string}; preparedResumeVersionId: string | null; strategyPlanId: string | null}
        | {applicationId: string; anchorOutboundMessageId: string; anchorOutboundAt: number; evidenceTrack: 'EXACT_READ_NO_REPLY' | 'EXACT_UNREAD_NO_REPLY' | 'ACKNOWLEDGED_WAITING'; jobKey: string; jobInfo: Record<string, unknown>}
}
export type ActionReceipt = {status: 'ACKNOWLEDGED' | 'FAILED' | 'UNKNOWN'; serverMid: string | null; platformCode: number | null; occurredAt: number; errorCode: string | null; executionPhase?: 'BEFORE_PLATFORM_CALL' | 'PLATFORM_RESULT'}
export type AutomationSnapshot = {status: AutomationStatus | null; jobs: AutomationJob[]; error: string; held: number; updatedAt: number}
type SubmissionProof<C> = {
    schemaVersion: 1; scope: string; recoveryIdentity: string; requestId: string
    semanticHash: string; recoveryHash: string; body: AutomationSubmission; context: C; createdAt: number
}
type SavedJob<C> = {
    scope: string; jobId: string; context: C; completed: boolean; reconciledActions?: string[]
    submission?: SubmissionProof<C>
}
type Dispatch = {scope: string; jobId: string; actionId: string; executorId: string; dispatchToken: string; clientMid: string | null; dispatchedAt: number; receipt?: ActionReceipt; delivered?: boolean}
export type AutomationExecution<C> = {
    ready(context: C, action: AutomationAction): boolean
    prepare?(context: C, action: AutomationAction): Promise<void>
    run?(context: C, action: AutomationAction, operation: () => Promise<void>): Promise<void>
    perform(context: C, action: AutomationAction, clientMid: string | null): Promise<ActionReceipt>
    completed?(context: C, job: AutomationJob): Promise<void> | void
    acknowledged?(context: C, action: AutomationAction, receipt?: ActionReceipt): Promise<void> | void
}
type Dependencies<C> = {
    request(path: string, body?: unknown): Promise<any>; scope(): string; account(): string; executorId: string; capabilities?(): ActionKind[]
    flags(): {replyEnabled: boolean; deliveryEnabled: boolean}; storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>
    execution: AutomationExecution<C>; clientMid(): string; acknowledgement?(clientMid: string): string | null; now?(): number
    recoveryIdentity?(): string
    recoverSubmissionContext?(stored: C, body: AutomationSubmission, proposed?: C, proposedBody?: AutomationSubmission): C | null
}
const PREFIX = 'ai-job-unified-v1:'
const TERMINAL = new Set(['COMPLETED', 'SUPERSEDED', 'CANCELLED', 'FAILED'])
const BLOCKING_CONTACT = new Set(['QUEUED', 'LEASED', 'DISPATCHING', 'UNKNOWN', 'ACKNOWLEDGED'])
export async function automationRequestId(parts: unknown[]): Promise<string> {
    const bytes = new TextEncoder().encode(JSON.stringify(parts))
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('')
}

function applicationRecoveryValue<C>(body: AutomationSubmission, context: C): unknown {
    if (body.kind !== 'APPLICATION') return [body, context]
    const {requestId: _requestId, input, ...submission} = body
    const applicationInput = input && typeof input === 'object'
        ? Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'cycleKey'))
        : input
    if (!context || typeof context !== 'object' || Array.isArray(context)) {
        return [{...submission, input: applicationInput}, context]
    }
    const {runId: _runId, ...stableContext} = context as C & {runId?: string}
    return [{...submission, input: applicationInput}, stableContext]
}
export function createUnifiedAutomation<C>(dependencies: Dependencies<C>) {
    const now = dependencies.now || Date.now
    let snapshot: AutomationSnapshot = {status: null, jobs: [], error: '', held: 0, updatedAt: 0}
    let statusScope = '', statusAt = 0
    let statusInFlight: {scope: string; promise: Promise<AutomationStatus>} | null = null
    const PARKED_UNKNOWN_POLL_MS = 60_000
    const parkedUnknownUntil = new Map<string, number>()
    const pendingAckRefresh = new Map<string, Set<string>>()
    const listeners = new Set<(state: AutomationSnapshot) => void>(), running = new Set<string>()
    const publish = () => { for (const listener of listeners) listener({...snapshot}) }
    const rawRead = <T>(key: string): T | null => { try { return JSON.parse(dependencies.storage.getItem(PREFIX + key) || 'null') } catch { return null } }
    type Binding = {scope: string; contact: unknown; bossId: string; conversationKey: string}
    function mergeBinding<T>(key: string, value: T): T {
        if (!key.startsWith('job:') || !value) return value
        const saved = value as unknown as SavedJob<C>, binding = rawRead<Binding>('binding:' + saved.jobId)
        if (binding?.scope === saved.scope) Object.assign(saved.context as object,
            {contact: binding.contact, bossId: binding.bossId, conversationKey: binding.conversationKey})
        return value
    }
    const read = <T>(key: string): T | null => mergeBinding(key, rawRead<T>(key))
    const write = (key: string, value: unknown) => {
        if (key.startsWith('job:')) {
            const saved = value as SavedJob<C>, context = saved.context as any
            // Binding is an immutable API-confirmed fact in its own key. A stale job snapshot
            // in another tab cannot erase it, even if localStorage read/write calls interleave.
            if (context.kind === 'APPLICATION' && context.contact && context.bossId && context.conversationKey) {
                const binding = rawRead<Binding>('binding:' + saved.jobId)
                if (binding && (binding.scope !== saved.scope || binding.bossId !== context.bossId || binding.conversationKey !== context.conversationKey)) throw new Error('BINDING_CONFLICT')
                if (!binding) dependencies.storage.setItem(PREFIX + 'binding:' + saved.jobId, JSON.stringify({scope: saved.scope,
                    contact: context.contact, bossId: context.bossId, conversationKey: context.conversationKey}))
            }
            mergeBinding(key, value)
        }
        dependencies.storage.setItem(PREFIX + key, JSON.stringify(value))
    }
    const remove = (key: string) => dependencies.storage.removeItem(PREFIX + key)
    function list<T>(kind: string): T[] {
        const entries: T[] = []
        for (let index = 0; index < dependencies.storage.length; index++) {
            const key = dependencies.storage.key(index)
            if (key?.startsWith(PREFIX + kind)) { const item = read<T>(key.slice(PREFIX.length)); if (item) entries.push(item) }
        }
        return entries
    }
    async function request(path: string, body?: unknown, captured = dependencies.scope()) {
        if (!captured || captured !== dependencies.scope()) throw new Error('AUTOMATION_SCOPE_CHANGED')
        const result = await dependencies.request('/api/job/automation' + path, body)
        if (captured !== dependencies.scope()) throw new Error('AUTOMATION_SCOPE_CHANGED')
        return result
    }
    const recoveryIdentity = () => dependencies.recoveryIdentity?.() || dependencies.scope()
    const sameApplication = (left: AutomationSubmission | undefined, right: AutomationSubmission) =>
        left?.kind === 'APPLICATION' && right.kind === 'APPLICATION'
        && left.platformAccount === right.platformAccount && left.encryptJobId === right.encryptJobId
    async function proofFor(body: AutomationSubmission, context: C, scope: string): Promise<SubmissionProof<C>> {
        const stableIdentity = recoveryIdentity()
        if (!scope || !stableIdentity || body.kind !== 'APPLICATION' || body.platformAccount !== dependencies.account()) {
            throw new Error('AUTOMATION_SUBMISSION_SCOPE_CHANGED')
        }
        return {
            schemaVersion: 1,
            scope,
            recoveryIdentity: stableIdentity,
            requestId: body.requestId,
            semanticHash: await automationRequestId(['automation-submission-v1', body, context]),
            recoveryHash: await automationRequestId(['automation-application-recovery-v1', applicationRecoveryValue(body, context)]),
            body,
            context,
            createdAt: now(),
        }
    }
    async function validateSubmissionProof(proof: SubmissionProof<C>): Promise<void> {
        if (!proof || proof.schemaVersion !== 1 || proof.body?.kind !== 'APPLICATION'
            || proof.requestId !== proof.body.requestId || proof.body.platformAccount !== dependencies.account()
            || typeof proof.scope !== 'string' || !proof.scope || typeof proof.recoveryIdentity !== 'string') {
            throw new Error('AUTOMATION_PENDING_SUBMISSION_INVALID')
        }
        const semanticHash = await automationRequestId(['automation-submission-v1', proof.body, proof.context])
        const recoveryHash = await automationRequestId([
            'automation-application-recovery-v1', applicationRecoveryValue(proof.body, proof.context),
        ])
        if (semanticHash !== proof.semanticHash || recoveryHash !== proof.recoveryHash) {
            throw new Error('AUTOMATION_PENDING_SUBMISSION_CORRUPT')
        }
        if (!proof.recoveryIdentity || proof.recoveryIdentity !== recoveryIdentity()) {
            throw new Error('AUTOMATION_RECOVERY_IDENTITY_CHANGED')
        }
    }
    async function authorizedSubmissionContext(
        proof: SubmissionProof<C>,
        proposedBody?: AutomationSubmission,
        proposedContext?: C,
    ): Promise<C> {
        await validateSubmissionProof(proof)
        if (proposedBody) {
            if (!proposedContext || !sameApplication(proof.body, proposedBody)) {
                throw new Error('AUTOMATION_SUBMISSION_SEMANTICS_CHANGED')
            }
            const proposedHash = await automationRequestId([
                'automation-application-recovery-v1', applicationRecoveryValue(proposedBody, proposedContext),
            ])
            if (proposedHash !== proof.recoveryHash) throw new Error('AUTOMATION_SUBMISSION_SEMANTICS_CHANGED')
        }
        const recovered = dependencies.recoverSubmissionContext
            ? dependencies.recoverSubmissionContext(proof.context, proof.body, proposedContext, proposedBody)
            : proof.scope === dependencies.scope() ? proof.context : null
        if (!recovered) throw new Error('AUTOMATION_SUBMISSION_AUTHORIZATION_CHANGED')
        return recovered
    }
    const applicationBlocksNewCycle = (job: AutomationJob) => !TERMINAL.has(job.status)
        || job.actions.some(action => action.kind === 'CONTACT_JOB' && BLOCKING_CONTACT.has(action.status))
    const hasDispatch = (saved: SavedJob<C>) =>
        list<Dispatch>('dispatch:').some(record => record.jobId === saved.jobId)
    const hasForeignDispatch = (saved: SavedJob<C>, currentScope: string) =>
        list<Dispatch>('dispatch:').some(record => record.jobId === saved.jobId && record.scope !== currentScope)
    async function adoptSubmission(proof: SubmissionProof<C>, context: C, job: AutomationJob): Promise<AutomationJob> {
        if (!job?.jobId || job.kind !== 'APPLICATION') throw new Error('AUTOMATION_SUBMISSION_RESPONSE_INVALID')
        const key = 'job:' + job.jobId
        const previous = read<SavedJob<C>>(key)
        if (previous?.submission && previous.submission.requestId !== proof.requestId) {
            throw new Error('AUTOMATION_SUBMISSION_JOB_CONFLICT')
        }
        write(key, {
            ...(previous || {}),
            scope: dependencies.scope(),
            jobId: job.jobId,
            context,
            completed: TERMINAL.has(job.status),
            submission: proof,
        } satisfies SavedJob<C>)
        remove('pending-submit:' + proof.requestId)
        snapshot.jobs = [job, ...snapshot.jobs.filter(item => item.jobId !== job.jobId)].slice(0, 30)
        publish()
        return job
    }
    async function absorbEquivalentPending(
        pending: SubmissionProof<C>,
        proposedBody?: AutomationSubmission,
        proposedContext?: C,
    ): Promise<AutomationJob | null> {
        // Concurrent tabs may durably write different cycle/request ids before
        // either POST returns. The API accepts one and rejects the other. A
        // current-auth read of the accepted, still-blocking job plus an exact
        // recovery hash is the only evidence allowed to retire the losing intent.
        await authorizedSubmissionContext(pending, proposedBody, proposedContext)
        const matches: {saved: SavedJob<C>; job: AutomationJob; context: C}[] = []
        for (const saved of list<SavedJob<C>>('job:')) {
            const accepted = saved.submission
            if (!accepted || !sameApplication(accepted.body, pending.body)
                || accepted.recoveryHash !== pending.recoveryHash) continue
            const context = await authorizedSubmissionContext(accepted, proposedBody, proposedContext)
            const job = await request('/jobs/' + encodeURIComponent(saved.jobId), undefined, dependencies.scope()) as AutomationJob
            if (job.jobId !== saved.jobId || job.kind !== 'APPLICATION') {
                throw new Error('AUTOMATION_SUBMISSION_RESPONSE_INVALID')
            }
            if (applicationBlocksNewCycle(job)) matches.push({saved, job, context})
        }
        if (matches.length > 1) throw new Error('AUTOMATION_SUBMISSION_AMBIGUOUS')
        if (!matches.length) return null
        const {saved, job, context} = matches[0]
        if (!hasDispatch(saved)) {
            saved.scope = dependencies.scope()
            saved.context = context
            saved.completed = TERMINAL.has(job.status)
            write('job:' + saved.jobId, saved)
        }
        remove('pending-submit:' + pending.requestId)
        snapshot.jobs = [job, ...snapshot.jobs.filter(item => item.jobId !== job.jobId)].slice(0, 30)
        publish()
        return job
    }
    async function recoverPendingSubmissions(): Promise<void> {
        for (const proof of list<SubmissionProof<C>>('pending-submit:')) {
            try {
                if (await absorbEquivalentPending(proof)) continue
                const context = await authorizedSubmissionContext(proof)
                const job = await request('/jobs', proof.body, dependencies.scope()) as AutomationJob
                await adoptSubmission(proof, context, job)
            } catch (error) {
                snapshot.held++
                snapshot.error = String((error as Error)?.message || error).startsWith('AUTOMATION_')
                    ? '待恢复投递的服务器、账号、设置或执行授权已变化；未重放旧请求'
                    : '待恢复投递仍在等待原请求的幂等确认；不会创建新投递轮次'
            }
        }
    }
    async function recoverPendingForSubmission(body: AutomationSubmission, context: C): Promise<AutomationJob | null> {
        const exact = read<SubmissionProof<C>>('pending-submit:' + body.requestId)
        if (exact && !sameApplication(exact.body, body)) {
            throw new Error('AUTOMATION_SUBMISSION_SEMANTICS_CHANGED')
        }
        const matches = list<SubmissionProof<C>>('pending-submit:').filter(proof => sameApplication(proof.body, body))
        if (matches.length > 1) throw new Error('AUTOMATION_SUBMISSION_AMBIGUOUS')
        const proof = matches[0]
        if (!proof) return null
        const absorbed = await absorbEquivalentPending(proof, body, context)
        if (absorbed) return absorbed
        const recovered = await authorizedSubmissionContext(proof, body, context)
        const job = await request('/jobs', proof.body, dependencies.scope()) as AutomationJob
        return adoptSubmission(proof, recovered, job)
    }
    async function recoverSavedForSubmission(body: AutomationSubmission, context: C): Promise<AutomationJob | null> {
        const blocking: {saved: SavedJob<C>; proof: SubmissionProof<C>; job: AutomationJob}[] = []
        for (const saved of list<SavedJob<C>>('job:')) {
            const proof = saved.submission
            if (!proof || !sameApplication(proof.body, body)) continue
            await validateSubmissionProof(proof)
            const job = await request('/jobs/' + encodeURIComponent(saved.jobId), undefined, dependencies.scope()) as AutomationJob
            if (job.jobId !== saved.jobId || job.kind !== 'APPLICATION') {
                throw new Error('AUTOMATION_SUBMISSION_RESPONSE_INVALID')
            }
            if (!applicationBlocksNewCycle(job)) {
                saved.completed = true
                write('job:' + saved.jobId, saved)
                continue
            }
            blocking.push({saved, proof, job})
        }
        if (blocking.length > 1) throw new Error('AUTOMATION_SUBMISSION_AMBIGUOUS')
        if (!blocking.length) return null
        const {saved, proof, job} = blocking[0]
        const currentScope = dependencies.scope()
        const recovered = await authorizedSubmissionContext(proof, body, context)
        if (saved.scope !== currentScope && hasForeignDispatch(saved, currentScope)) {
            throw new Error('AUTOMATION_SUBMISSION_DISPATCH_SCOPE_CHANGED')
        }
        saved.scope = currentScope
        saved.context = recovered
        saved.completed = false
        write('job:' + saved.jobId, saved)
        snapshot.jobs = [job, ...snapshot.jobs.filter(item => item.jobId !== job.jobId)].slice(0, 30)
        publish()
        return job
    }
    async function reauthorizeSavedApplications(): Promise<void> {
        for (const saved of list<SavedJob<C>>('job:')) {
            if (saved.completed || saved.submission?.body.kind !== 'APPLICATION') continue
            try {
                const currentScope = dependencies.scope()
                const context = await authorizedSubmissionContext(saved.submission)
                if (saved.scope === currentScope && JSON.stringify(saved.context) === JSON.stringify(context)) continue
                const job = await request('/jobs/' + encodeURIComponent(saved.jobId), undefined, currentScope) as AutomationJob
                if (job.jobId !== saved.jobId || job.kind !== 'APPLICATION') {
                    throw new Error('AUTOMATION_SUBMISSION_RESPONSE_INVALID')
                }
                snapshot.jobs = [job, ...snapshot.jobs.filter(item => item.jobId !== job.jobId)].slice(0, 30)
                if (!applicationBlocksNewCycle(job)) {
                    saved.completed = true
                    write('job:' + saved.jobId, saved)
                    continue
                }
                if (saved.scope !== currentScope && hasForeignDispatch(saved, currentScope)) {
                    throw new Error('AUTOMATION_SUBMISSION_DISPATCH_SCOPE_CHANGED')
                }
                if (saved.scope !== currentScope || JSON.stringify(saved.context) !== JSON.stringify(context)) {
                    saved.scope = currentScope
                    saved.context = context
                    write('job:' + saved.jobId, saved)
                }
            } catch {
                // The saved job and its dispatch evidence remain intact. A future exact
                // account/policy authorization can recover it; this pass never sends.
            }
        }
    }
    async function status(force = false): Promise<AutomationStatus> {
        const scope = dependencies.scope()
        if (scope !== statusScope) {
            snapshot.status = null; snapshot.jobs = []; snapshot.updatedAt = 0
            parkedUnknownUntil.clear(); pendingAckRefresh.clear()
        }
        if (statusInFlight?.scope === scope) return statusInFlight.promise
        if (!force && scope === statusScope && snapshot.status && now() - statusAt < 2_000) return snapshot.status
        const promise = (async () => {
            try {
                const value = await request('/status', undefined, scope) as AutomationStatus
                if (value.contractVersion !== 1 || !['LANGGRAPH', 'LEGACY'].includes(value.mode)
                    || value.enabled !== (value.mode === 'LANGGRAPH')) throw new Error('AUTOMATION_CONTRACT_INVALID')
                if (scope !== dependencies.scope()) throw new Error('AUTOMATION_SCOPE_CHANGED')
                if (scope !== statusScope) snapshot.jobs = []
                snapshot.status = value; snapshot.error = ''; snapshot.updatedAt = now(); statusScope = scope; statusAt = now(); publish()
                return value
            } catch (error) {
                if (scope === dependencies.scope()) {
                    snapshot.status = null; statusAt = 0
                    snapshot.error = '统一任务服务暂不可用，自动操作已等待；不会切回旧发送流程'; publish()
                }
                throw error
            }
        })()
        statusInFlight = {scope, promise}
        try { return await promise }
        finally { if (statusInFlight?.promise === promise) statusInFlight = null }
    }
    async function heartbeat() {
        return request('/executors/heartbeat', {executorId: dependencies.executorId, platformAccount: dependencies.account(), capabilities: dependencies.capabilities?.() || [...ACTION_KINDS], ...dependencies.flags()})
    }
    async function submit(body: AutomationSubmission, context: C): Promise<AutomationJob> {
        if (!(await status()).enabled) throw new Error('AUTOMATION_DISABLED')
        const scope = dependencies.scope()
        if (body.kind === 'APPLICATION') {
            const pending = await recoverPendingForSubmission(body, context)
            if (pending) return pending
            const saved = await recoverSavedForSubmission(body, context)
            if (saved) return saved
            const proof = await proofFor(body, context, scope)
            const authorizedContext = await authorizedSubmissionContext(proof, body, context)
            const pendingKey = 'pending-submit:' + proof.requestId
            const collision = read<SubmissionProof<C>>(pendingKey)
            if (collision) throw new Error('AUTOMATION_SUBMISSION_REQUEST_CONFLICT')
            // This durable intent is written before the POST. If the server commits and
            // the response is lost, every retry must reuse this exact request body/id.
            write(pendingKey, proof)
            const persisted = read<SubmissionProof<C>>(pendingKey)
            if (!persisted || persisted.semanticHash !== proof.semanticHash
                || persisted.recoveryHash !== proof.recoveryHash) {
                throw new Error('AUTOMATION_PENDING_SUBMISSION_NOT_DURABLE')
            }
            const job = await request('/jobs', proof.body, scope) as AutomationJob
            return adoptSubmission(proof, authorizedContext, job)
        }
        const job = await request('/jobs', body, scope) as AutomationJob
        // One key per server job prevents concurrent tabs from replacing an entire queue snapshot.
        const previous = read<SavedJob<C>>('job:' + job.jobId)
        if (!previous) write('job:' + job.jobId, {scope, jobId: job.jobId, context, completed: false})
        snapshot.jobs = [job, ...snapshot.jobs.filter(item => item.jobId !== job.jobId)].slice(0, 30); publish()
        return job
    }
    async function sendReceipt(record: Dispatch) {
        if (!record.receipt || record.scope !== dependencies.scope()) return
        const requestId = await automationRequestId(['receipt', record.actionId, record.receipt.status, record.receipt.serverMid])
        await request(`/actions/${encodeURIComponent(record.actionId)}/receipt`, {requestId, executorId: record.executorId,
            platformAccount: dependencies.account(), dispatchToken: record.dispatchToken, clientMid: record.clientMid, ...record.receipt}, record.scope)
        record.delivered = true; write('dispatch:' + record.actionId, record)
    }
    async function refreshJob(saved: SavedJob<C>): Promise<AutomationJob> {
        const job = await request('/jobs/' + encodeURIComponent(saved.jobId)) as AutomationJob
        parkedUnknownUntil.delete(saved.jobId)
        mergeBinding('job:' + saved.jobId, saved)
        snapshot.jobs = [job, ...snapshot.jobs.filter(item => item.jobId !== job.jobId)].slice(0, 30)
        for (const acknowledged of job.actions.filter(action => action.status === 'ACKNOWLEDGED')) {
            if (saved.reconciledActions?.includes(acknowledged.actionId)) continue
            saved.reconciledActions = [...(saved.reconciledActions || []), acknowledged.actionId]
            write('job:' + saved.jobId, saved)
            await dependencies.execution.acknowledged?.(saved.context, acknowledged, read<Dispatch>('dispatch:' + acknowledged.actionId)?.receipt)
            write('job:' + saved.jobId, saved)
        }
        if (saved.scope !== dependencies.scope()) throw new Error('AUTOMATION_SCOPE_CHANGED')
        const pendingActions = pendingAckRefresh.get(saved.jobId)
        if (pendingActions) {
            for (const actionId of pendingActions) {
                if (job.actions.some(action => action.actionId === actionId && action.status === 'ACKNOWLEDGED')) pendingActions.delete(actionId)
            }
            if (!pendingActions.size) pendingAckRefresh.delete(saved.jobId)
        }
        return job
    }
    async function tickJob(saved: SavedJob<C>) {
        if (saved.scope !== dependencies.scope() || saved.completed || running.has(saved.jobId)) return
        running.add(saved.jobId)
        try {
            const job = await refreshJob(saved)
            if (TERMINAL.has(job.status)) {
                if (job.status === 'COMPLETED') await dependencies.execution.completed?.(saved.context, job)
                saved.completed = true; write('job:' + saved.jobId, saved); return
            }
            if (job.status === 'UNCERTAIN' && !pendingAckRefresh.has(saved.jobId) && !job.actions.some(action =>
                ['QUEUED', 'LEASED', 'DISPATCHING'].includes(action.status))) {
                // The exact ACK listener below still reconciles immediately. A periodic
                // detail refresh catches server-side changes missed by this browser.
                parkedUnknownUntil.set(saved.jobId, now() + PARKED_UNKNOWN_POLL_MS)
                snapshot.held++; return
            }
            const queued = job.actions.find(action => action.status === 'QUEUED' && action.approvalStatus !== 'PENDING')
            if (!queued || !dependencies.execution.ready(saved.context, queued)) { snapshot.held++; return }
            await dependencies.execution.prepare?.(saved.context, queued)
            if (!dependencies.execution.ready(saved.context, queued) || saved.scope !== dependencies.scope()) return
            const execute = async () => {
            if (!dependencies.execution.ready(saved.context, queued) || saved.scope !== dependencies.scope()) return
            await heartbeat()
            const action = await request('/actions/claim', {executorId: dependencies.executorId, platformAccount: dependencies.account(), jobId: job.jobId}) as AutomationAction | null
            if (!action) return
            if (action.actionId !== queued.actionId || !ACTION_KINDS.includes(action.kind) || !dependencies.execution.ready(saved.context, action)) return
            // A local persisted dispatch is never a permission to execute again, including after a crash.
            const existing = read<Dispatch>('dispatch:' + action.actionId)
            if (existing) { if (existing.receipt && !existing.delivered) await sendReceipt(existing); return }
            const clientMid = ['SEND_GREETING', 'SEND_TEXT'].includes(action.kind) ? action.clientMid || dependencies.clientMid() : null
            const permit = await request(`/actions/${encodeURIComponent(action.actionId)}/dispatch`, {executorId: dependencies.executorId,
                platformAccount: dependencies.account(), leaseToken: action.leaseToken, authorizationRevision: action.authorizationRevision, clientMid})
            const record: Dispatch = {scope: saved.scope, jobId: job.jobId, actionId: action.actionId, executorId: dependencies.executorId, dispatchToken: permit.dispatchToken, clientMid: permit.clientMid, dispatchedAt: now()}
            write('dispatch:' + action.actionId, record)
            if (!dependencies.execution.ready(saved.context, action) || saved.scope !== dependencies.scope()) {
                record.receipt = {status: 'FAILED', serverMid: null, platformCode: null, occurredAt: now(), errorCode: 'AUTHORIZATION_CHANGED', executionPhase: 'BEFORE_PLATFORM_CALL'}
            } else {
                try { record.receipt = await dependencies.execution.perform(saved.context, action, record.clientMid) }
                catch { record.receipt = {status: 'UNKNOWN', serverMid: null, platformCode: null, occurredAt: now(), errorCode: 'PLATFORM_RESULT_UNKNOWN', executionPhase: 'PLATFORM_RESULT'} }
            }
            const concurrentAck = read<Dispatch>('dispatch:' + action.actionId)
            if (concurrentAck?.receipt?.status === 'ACKNOWLEDGED') {
                record.receipt = concurrentAck.receipt; record.delivered = concurrentAck.delivered
            }
            write('dispatch:' + action.actionId, record)
            await sendReceipt(record)
            }
            if (dependencies.execution.run) await dependencies.execution.run(saved.context, queued, execute)
            else await execute()
        } catch {
            if (saved.scope === dependencies.scope()) snapshot.error = '任务正在等待可靠授权、平台关联或回执；未确认动作不会重发'
        }
        finally { running.delete(saved.jobId); if (saved.scope === dependencies.scope()) publish() }
    }
    let nextJob = 0
    async function pass() {
        if (!(await status(true)).enabled) return
        snapshot.held = 0
        await recoverPendingSubmissions()
        await reauthorizeSavedApplications()
        await heartbeat()
        snapshot.jobs = await request('/jobs?limit=30&offset=0') as AutomationJob[]
        for (const job of snapshot.jobs) {
            const saved = read<SavedJob<C>>('job:' + job.jobId)
            if (job.status !== 'UNCERTAIN' || job.actions.some(action =>
                ['QUEUED', 'LEASED', 'DISPATCHING'].includes(action.status)
                || action.status === 'ACKNOWLEDGED' && !saved?.reconciledActions?.includes(action.actionId))) {
                parkedUnknownUntil.delete(job.jobId)
            }
        }
        for (const record of list<Dispatch>('dispatch:')) {
            if (record.scope !== dependencies.scope()) continue
            // A different tab may still be performing this dispatch. Only the API expires
            // DISPATCHING; an empty local receipt is never evidence of an interrupted send.
            if (record.receipt && !record.delivered) { try { await sendReceipt(record) } catch { /* persisted for retry */ } }
        }
        const jobs = list<SavedJob<C>>('job:').filter(job => job.scope === dependencies.scope() && !job.completed)
        const active = jobs.filter(job => !parkedUnknownUntil.has(job.jobId))
        const dueUnknown = jobs.filter(job => parkedUnknownUntil.has(job.jobId)
            && parkedUnknownUntil.get(job.jobId)! <= now())
        const eligible = [...active, ...dueUnknown]
        const start = eligible.length ? nextJob % eligible.length : 0
        for (let offset = 0; offset < Math.min(30, eligible.length); offset++) await tickJob(eligible[(start + offset) % eligible.length])
        nextJob = eligible.length ? (start + Math.min(30, eligible.length)) % eligible.length : 0
        publish()
    }
    let passing: Promise<void> | null = null
    function tick(): Promise<void> {
        if (!passing) passing = pass().finally(() => { passing = null })
        return passing
    }
    async function acknowledge(clientMid: string, serverMid: string) {
        if (!clientMid || !serverMid) return
        for (const record of list<Dispatch>('dispatch:')) {
            if (record.scope !== dependencies.scope() || !record.clientMid || record.receipt?.status === 'ACKNOWLEDGED') continue
            if (record.clientMid !== clientMid && dependencies.acknowledgement?.(record.clientMid) !== serverMid) continue
            record.receipt = {status: 'ACKNOWLEDGED', serverMid, platformCode: 0, occurredAt: now(), errorCode: null}; record.delivered = false
            write('dispatch:' + record.actionId, record)
            const pendingActions = pendingAckRefresh.get(record.jobId) || new Set<string>()
            pendingActions.add(record.actionId)
            pendingAckRefresh.set(record.jobId, pendingActions)
            parkedUnknownUntil.delete(record.jobId)
            await sendReceipt(record)
            const saved = read<SavedJob<C>>('job:' + record.jobId)
            if (saved && saved.scope === dependencies.scope() && !running.has(saved.jobId)) {
                running.add(saved.jobId)
                try { await refreshJob(saved); publish() }
                catch { if (saved.scope === dependencies.scope()) { snapshot.error = '回执已保存，任务状态等待下次核对'; publish() } }
                finally { running.delete(saved.jobId) }
            }
        }
    }
    async function bindContact(actionId: string, bossId: string, conversationKey: string) {
        const requestId = await automationRequestId(['binding', actionId, bossId, conversationKey])
        return request(`/actions/${encodeURIComponent(actionId)}/binding`, {requestId, platformAccount: dependencies.account(), bossId, conversationKey})
    }
    async function observeContact(contact: {bossId: string; encryptJobId: string; encryptBossId: string; securityId: string; jobTitle: string}, capturedScope: string) {
        if (!capturedScope || capturedScope !== dependencies.scope()) return
        const conversationKey = `${contact.encryptBossId}:${contact.securityId}`
        const candidates: {saved: SavedJob<C>; action: AutomationAction}[] = []
        for (const saved of list<SavedJob<C>>('job:')) {
            if (saved.scope !== capturedScope || saved.completed) continue
            const context = saved.context as any
            if (context.kind !== 'APPLICATION' || context.encryptJobId !== contact.encryptJobId || !context.greetingEnabled
                || context.job?.encryptBossId !== contact.encryptBossId || context.job?.securityId !== contact.securityId
                || context.bossId && context.bossId !== contact.bossId) continue
            const job = await request('/jobs/' + encodeURIComponent(saved.jobId), undefined, capturedScope) as AutomationJob
            const ack = job.actions.find(action => action.kind === 'CONTACT_JOB' && action.status === 'ACKNOWLEDGED')
            if (ack && job.actions.some(action => action.kind === 'SEND_GREETING' && action.status === 'QUEUED')) candidates.push({saved, action: ack})
        }
        if (candidates.length !== 1) { if (candidates.length > 1) { snapshot.error = '联系人对应多个投递轮次，招呼等待明确关联'; publish() }; return }
        const {saved, action} = candidates[0]
        await bindContact(action.actionId, contact.bossId, conversationKey)
        if (capturedScope !== dependencies.scope()) return
        Object.assign(saved.context as object, {contact: {...contact}, bossId: contact.bossId, conversationKey})
        write('job:' + saved.jobId, saved)
    }
    return {status, submit, tick, acknowledge, bindContact, observeContact,
        async runSummary(runId: string) {
            const result = {contacted: 0, waitingGreeting: 0, uncertainGreeting: 0}
            for (const saved of list<SavedJob<C>>('job:')) {
                const context = saved.context as {kind?: string; runId?: string}
                if (saved.scope !== dependencies.scope() || context.kind !== 'APPLICATION' || context.runId !== runId) continue
                const job = await request('/jobs/' + encodeURIComponent(saved.jobId)) as AutomationJob
                if (job.actions.some(action => action.kind === 'CONTACT_JOB' && action.status === 'ACKNOWLEDGED')) result.contacted++
                if (job.actions.some(action => action.kind === 'SEND_GREETING' && ['QUEUED', 'LEASED', 'DISPATCHING'].includes(action.status))) result.waitingGreeting++
                if (job.actions.some(action => action.kind === 'SEND_GREETING' && action.status === 'UNKNOWN')) result.uncertainGreeting++
            }
            return result
        },
        enabled: async () => (await status()).enabled,
        getJob: async (jobId: string) => request('/jobs/' + encodeURIComponent(jobId)) as Promise<AutomationJob>,
        cancel: async (jobId: string) => request(`/jobs/${encodeURIComponent(jobId)}/cancel`, {requestId: await automationRequestId(['cancel', jobId])}),
        async unresolvedApplication(encryptJobId: string): Promise<AutomationJob | null> {
            await recoverPendingSubmissions()
            const unresolvedPending = list<SubmissionProof<C>>('pending-submit:').filter(proof =>
                proof?.body?.kind === 'APPLICATION'
                && proof.body.platformAccount === dependencies.account()
                && proof.body.encryptJobId === encryptJobId)
            if (unresolvedPending.length) throw new Error('AUTOMATION_APPLICATION_RECOVERY_PENDING')
            for (const saved of list<SavedJob<C>>('job:')) {
                const context = saved.context as {kind?: string; account?: string; encryptJobId?: string}
                if (context.kind !== 'APPLICATION' || context.encryptJobId !== encryptJobId) continue
                if (context.account && context.account !== dependencies.account()) continue
                const currentScope = dependencies.scope()
                if (saved.submission) await validateSubmissionProof(saved.submission)
                else if (saved.scope !== currentScope) {
                    // Legacy records have no stable recovery proof. A current-auth GET may
                    // block a duplicate cycle, but never grants permission to execute it.
                    const legacy = await request('/jobs/' + encodeURIComponent(saved.jobId), undefined, currentScope) as AutomationJob
                    if (legacy.jobId !== saved.jobId || legacy.kind !== 'APPLICATION') {
                        throw new Error('AUTOMATION_SUBMISSION_RESPONSE_INVALID')
                    }
                    if (applicationBlocksNewCycle(legacy)) return legacy
                    continue
                }
                const job = await request('/jobs/' + encodeURIComponent(saved.jobId), undefined, currentScope) as AutomationJob
                if (job.jobId !== saved.jobId || job.kind !== 'APPLICATION') {
                    throw new Error('AUTOMATION_SUBMISSION_RESPONSE_INVALID')
                }
                if (applicationBlocksNewCycle(job)) {
                    if (!saved.submission) return job
                    const recovered = await authorizedSubmissionContext(saved.submission)
                    const sideEffectStarted = hasDispatch(saved) || job.actions.some(action => action.kind === 'CONTACT_JOB'
                        && ['DISPATCHING', 'UNKNOWN', 'ACKNOWLEDGED'].includes(action.status))
                    if (sideEffectStarted || saved.scope !== currentScope && hasForeignDispatch(saved, currentScope)) return job
                    saved.scope = currentScope
                    saved.context = recovered
                    saved.completed = false
                    write('job:' + saved.jobId, saved)
                    // A persisted proof with no dispatched side effect is recoverable.
                    // Let doPush call submit(), which returns this exact server job after
                    // validating the new run's semantics; it never creates a new cycle.
                    continue
                }
                if (!saved.completed) {
                    saved.completed = true
                    write('job:' + saved.jobId, saved)
                }
            }
            return null
        },
        approve: async (action: AutomationAction, decision: 'APPROVE' | 'DECLINE') => request(`/actions/${encodeURIComponent(action.actionId)}/approval`, {
            requestId: await automationRequestId(['approval', action.actionId, decision, action.payloadHash]), decision, payloadHash: action.payloadHash}),
        subscribe(listener: (value: AutomationSnapshot) => void) { listeners.add(listener); listener({...snapshot}); return () => { listeners.delete(listener) } },
        hold(reason: string) { snapshot.error = reason; snapshot.held++; publish() },
    }
}
