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
    jobId: string; kind: 'REPLY' | 'APPLICATION' | 'CAREER_REVIEW'; status: string; phase: string; revision: number
    inputHash: string; createdAt: number; updatedAt: number; lastErrorCode: string | null; decision: AutomationDecision | null
    actions: AutomationAction[]; phaseHistory: {phase: string; at?: number}[]
    result: null | {schemaVersion: 1; kind: AutomationJob['kind']; decision: AutomationDecision; analysis: Record<string, unknown> | null; missingMaterials: string[]}
}
export type AutomationStatus = {
    contractVersion: 1; enabled: boolean; mode: 'LANGGRAPH' | 'LEGACY'; buildId: string
    agent: {state: 'READY' | 'STALE' | 'OFFLINE'; lastSeenAt: number | null; lastCompletedAt: number | null; lastErrorCode: string | null}
    executor: {state: 'READY' | 'STALE' | 'OFFLINE'; lastSeenAt: number | null}
    counts: {queued: number; running: number; waitingExecution: number; waitingConfirmation: number; uncertain: number; failed: number; completed: number}
    outcomes: {enabled: boolean; caseCount: number; reportCount: number; lastObservedAt: number | null
        tasks?: {counts: Record<string, number>; total: number; items: OutcomeTask[]}}
}
export type FilterInput = {prompt: string; jobBaseInfo: string; jobExtInfo: string; resumeMatchEnabled: boolean; minMatchScore: number; titleRuleStatus?: string; titleMatchedKeywords: string[]}
export type AutomationSubmission = {
    requestId: string; kind: 'REPLY' | 'APPLICATION'; platformAccount: string; conversationKey: string | null; encryptJobId: string; bossId: string | null
    input: {inboundMessageId: string; inboundSentAt: number | null; question: string; jobKey: string; jobInfo: Record<string, unknown>; platformResumeId: string | null
        exchangeRequest: null | {kind: 'ACCEPT_PHONE' | 'ACCEPT_WECHAT' | 'ACCEPT_RESUME'; requestMessageId: string}}
        | {cycleKey: string; filterInput: FilterInput; localAssessment: {passed: boolean; reason: string}; greeting: {enabled: boolean; text: string}; preparedResumeVersionId: string | null; strategyPlanId: string | null}
}
export type ActionReceipt = {status: 'ACKNOWLEDGED' | 'FAILED' | 'UNKNOWN'; serverMid: string | null; platformCode: number | null; occurredAt: number; errorCode: string | null; executionPhase?: 'BEFORE_PLATFORM_CALL' | 'PLATFORM_RESULT'}
export type AutomationSnapshot = {status: AutomationStatus | null; jobs: AutomationJob[]; error: string; held: number; updatedAt: number}
type SavedJob<C> = {scope: string; jobId: string; context: C; completed: boolean; reconciledActions?: string[]}
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
}
const PREFIX = 'ai-job-unified-v1:'
const TERMINAL = new Set(['COMPLETED', 'SUPERSEDED', 'CANCELLED', 'FAILED'])
export async function automationRequestId(parts: unknown[]): Promise<string> {
    const bytes = new TextEncoder().encode(JSON.stringify(parts))
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('')
}
export function createUnifiedAutomation<C>(dependencies: Dependencies<C>) {
    const now = dependencies.now || Date.now
    let snapshot: AutomationSnapshot = {status: null, jobs: [], error: '', held: 0, updatedAt: 0}
    let statusScope = '', statusAt = 0
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
    async function status(force = false): Promise<AutomationStatus> {
        const scope = dependencies.scope()
        if (scope !== statusScope) { snapshot.status = null; snapshot.jobs = []; snapshot.updatedAt = 0 }
        if (!force && scope === statusScope && snapshot.status && now() - statusAt < 2_000) return snapshot.status
        try {
            const value = await request('/status') as AutomationStatus
            if (value.contractVersion !== 1 || !['LANGGRAPH', 'LEGACY'].includes(value.mode)
                || value.enabled !== (value.mode === 'LANGGRAPH')) throw new Error('AUTOMATION_CONTRACT_INVALID')
            if (scope !== statusScope) snapshot.jobs = []
            snapshot.status = value; snapshot.error = ''; snapshot.updatedAt = now(); statusScope = scope; statusAt = now(); publish()
            return value
        } catch (error) { snapshot.error = '统一任务服务暂不可用，自动操作已等待；不会切回旧发送流程'; publish(); throw error }
    }
    async function heartbeat() {
        return request('/executors/heartbeat', {executorId: dependencies.executorId, platformAccount: dependencies.account(), capabilities: dependencies.capabilities?.() || [...ACTION_KINDS], ...dependencies.flags()})
    }
    async function submit(body: AutomationSubmission, context: C): Promise<AutomationJob> {
        if (!(await status()).enabled) throw new Error('AUTOMATION_DISABLED')
        const scope = dependencies.scope()
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
    async function tickJob(saved: SavedJob<C>) {
        if (saved.scope !== dependencies.scope() || saved.completed || running.has(saved.jobId)) return
        running.add(saved.jobId)
        try {
            const job = await request('/jobs/' + encodeURIComponent(saved.jobId)) as AutomationJob
            mergeBinding('job:' + saved.jobId, saved)
            snapshot.jobs = [job, ...snapshot.jobs.filter(item => item.jobId !== job.jobId)].slice(0, 30)
            for (const acknowledged of job.actions.filter(action => action.status === 'ACKNOWLEDGED')) {
                if (saved.reconciledActions?.includes(acknowledged.actionId)) continue
                saved.reconciledActions = [...(saved.reconciledActions || []), acknowledged.actionId]
                write('job:' + saved.jobId, saved)
                await dependencies.execution.acknowledged?.(saved.context, acknowledged, read<Dispatch>('dispatch:' + acknowledged.actionId)?.receipt)
                write('job:' + saved.jobId, saved)
            }
            if (TERMINAL.has(job.status)) {
                if (job.status === 'COMPLETED') await dependencies.execution.completed?.(saved.context, job)
                saved.completed = true; write('job:' + saved.jobId, saved); return
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
        } catch { snapshot.error = '任务正在等待可靠授权、平台关联或回执；未确认动作不会重发' }
        finally { running.delete(saved.jobId); publish() }
    }
    let nextJob = 0
    async function pass() {
        if (!(await status(true)).enabled) return
        await heartbeat()
        snapshot.jobs = await request('/jobs?limit=30&offset=0') as AutomationJob[]
        snapshot.held = 0
        for (const record of list<Dispatch>('dispatch:')) {
            if (record.scope !== dependencies.scope()) continue
            // A different tab may still be performing this dispatch. Only the API expires
            // DISPATCHING; an empty local receipt is never evidence of an interrupted send.
            if (record.receipt && !record.delivered) { try { await sendReceipt(record) } catch { /* persisted for retry */ } }
        }
        const jobs = list<SavedJob<C>>('job:').filter(job => job.scope === dependencies.scope() && !job.completed)
        const start = jobs.length ? nextJob % jobs.length : 0
        for (let offset = 0; offset < Math.min(30, jobs.length); offset++) await tickJob(jobs[(start + offset) % jobs.length])
        nextJob = jobs.length ? (start + Math.min(30, jobs.length)) % jobs.length : 0
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
            await sendReceipt(record)
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
            for (const saved of list<SavedJob<C>>('job:')) {
                if (saved.scope !== dependencies.scope()) continue
                const context = saved.context as {kind?: string; encryptJobId?: string}
                if (context.kind !== 'APPLICATION' || context.encryptJobId !== encryptJobId) continue
                const job = await request('/jobs/' + encodeURIComponent(saved.jobId)) as AutomationJob
                if (job.actions.some(action => ['DISPATCHING', 'UNKNOWN', 'ACKNOWLEDGED'].includes(action.status))) return job
                if (!TERMINAL.has(job.status)) return job
            }
            return null
        },
        approve: async (action: AutomationAction, decision: 'APPROVE' | 'DECLINE') => request(`/actions/${encodeURIComponent(action.actionId)}/approval`, {
            requestId: await automationRequestId(['approval', action.actionId, decision, action.payloadHash]), decision, payloadHash: action.payloadHash}),
        subscribe(listener: (value: AutomationSnapshot) => void) { listeners.add(listener); listener({...snapshot}); return () => { listeners.delete(listener) } },
        hold(reason: string) { snapshot.error = reason; snapshot.held++; publish() },
    }
}
