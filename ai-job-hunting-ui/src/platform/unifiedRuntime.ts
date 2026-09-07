import axios from '../axios'
import {UserStore} from '../stores'
import {ServerStore} from '../stores/server'
import {PushRunStore} from '../stores/pushRun'
import {Tools} from './utils'
import {Message} from '../webSocket/protobuf'
import {getBossRiskStop} from './bossRiskControl'
import {exactPlatformId} from './boss/outcomeCollector'
import {ACTION_KINDS, automationRequestId, createUnifiedAutomation, type AutomationAction, type AutomationExecution, type AutomationJob, type AutomationSubmission} from './unifiedAutomation'

export type BrowserAutomationContext = {
    kind: 'REPLY' | 'APPLICATION'; account: string; policy: string; encryptJobId: string; conversationKey: string | null
    bossId: string | null; contact?: BossUserInfo; job?: BossJobDetail; runId?: string
    inboundMessageId?: string; inboundMessageMid?: string; question?: string
    snapshot?: {encryptJobId: string; jobBaseInfo: string; jobExtInfo: string; preMatchResult: unknown}
    greetingEnabled?: boolean
}
const executors = new Map<BrowserAutomationContext['kind'], AutomationExecution<BrowserAutomationContext>>()
let rawIdentity = '', scope = '', identityPromise: Promise<void> | null = null
let runtime: ReturnType<typeof createUnifiedAutomation<BrowserAutomationContext>> | null = null
let timer: ReturnType<typeof setInterval> | undefined
const account = () => String(Tools.window?._PAGE?.uid || '')
const identity = () => JSON.stringify([ServerStore().baseUrl, localStorage.getItem('Authorization') || '', account()])
export const currentAutomationPolicy = () => JSON.stringify([UserStore().user.preference, UserStore().user.resumeId || null])
async function ensureIdentity() {
    if (rawIdentity === identity() && scope) return
    if (identityPromise) { await identityPromise; if (rawIdentity === identity() && scope) return }
    const captured = identity()
    identityPromise = (async () => {
        const value = await automationRequestId(['automation-scope', captured])
        if (captured !== identity()) throw new Error('AUTOMATION_SCOPE_CHANGED')
        rawIdentity = captured; scope = value
    })().finally(() => { identityPromise = null })
    await identityPromise
}
function flags() {
    const push = PushRunStore()
    const continuationStopped = !!localStorage.getItem('ai-job-unified-stop:' + scope + ':' + push.runId)
    return {replyEnabled: !!UserStore().user.aiSeatStatus && !getBossRiskStop(),
        deliveryEnabled: (push.isActive || push.status === 'completed') && !continuationStopped && !push.stopRequested && !getBossRiskStop()}
}
export function browserAutomationReady(context: BrowserAutomationContext, action: AutomationAction): boolean {
    if (context.account !== account() || context.policy !== currentAutomationPolicy() || getBossRiskStop()
        || String(action.payload.encryptJobId) !== context.encryptJobId) return false
    const enabled = flags()
    if (context.kind === 'REPLY' ? !enabled.replyEnabled : !enabled.deliveryEnabled || context.runId !== PushRunStore().runId) return false
    if (context.kind === 'APPLICATION' && action.kind === 'CONTACT_JOB' && !PushRunStore().isActive) return false
    if (action.payload.bossId && context.bossId && action.payload.bossId !== context.bossId) return false
    if (action.payload.conversationKey && context.conversationKey && action.payload.conversationKey !== context.conversationKey) return false
    if (['SEND_RESUME', 'ACCEPT_RESUME', 'ACCEPT_PHONE', 'ACCEPT_WECHAT'].includes(action.kind)) {
        if (action.approvalStatus !== 'APPROVED') return false
        if (action.kind.includes('RESUME') && (!action.payload.platformResumeId || action.payload.platformResumeId !== String(UserStore().user.resumeId || ''))) return false
        if (action.kind.startsWith('ACCEPT_') && action.payload.requestMessageId !== context.inboundMessageMid) return false
    }
    return true
}
function getRuntime() {
    if (runtime) return runtime
    runtime = createUnifiedAutomation<BrowserAutomationContext>({
        scope: () => rawIdentity === identity() ? scope : '', account, executorId: crypto.randomUUID(), flags, storage: localStorage,
        capabilities: () => ACTION_KINDS.filter(kind => kind !== 'CONTACT_JOB' || PushRunStore().isActive),
        clientMid: () => Message.createClientMid(),
        acknowledgement: mid => Tools.window.AIJobHelperChatBridge?.getAcknowledgement?.(mid) || null,
        async request(path, body) {
            const captured = identity()
            const config = {jobHelperScopeGuard: () => captured === identity(), suppressGlobalErrorToast: true} as any
            const response = body === undefined ? await axios.get(path, config) : await axios.post(path, body, config)
            return response.data.data
        },
        execution: {
            ready: (context, action) => browserAutomationReady(context, action) && !!executors.get(context.kind)?.ready(context, action),
            prepare: async (context, action) => { await executors.get(context.kind)?.prepare?.(context, action) },
            run: async (context, action, operation) => {
                const execution = executors.get(context.kind)
                if (execution?.run) await execution.run(context, action, operation)
                else await operation()
            },
            perform: (context, action, mid) => executors.get(context.kind)!.perform(context, action, mid),
            completed: (context, job) => executors.get(context.kind)?.completed?.(context, job),
            acknowledged: (context, action, receipt) => executors.get(context.kind)?.acknowledged?.(context, action, receipt),
        },
    })
    return runtime
}
export function registerAutomationExecutor(kind: BrowserAutomationContext['kind'], execution: AutomationExecution<BrowserAutomationContext>) {
    executors.set(kind, execution)
    startUnifiedAutomation()
}
export function startUnifiedAutomation() {
    if (timer) return
    const poll = () => { void ensureIdentity().then(() => getRuntime().tick()).catch(() => undefined) }
    timer = setInterval(poll, 3000)
    poll()
}
/** Any failure holds the automatic caller. There is deliberately no legacy fallback. */
export async function unifiedAutomationEnabled(): Promise<boolean> { await ensureIdentity(); return getRuntime().enabled() }
export async function submitAutomation(body: AutomationSubmission, context: BrowserAutomationContext): Promise<AutomationJob> {
    await ensureIdentity()
    if (body.platformAccount !== account()) throw new Error('AUTOMATION_SCOPE_CHANGED')
    const job = await getRuntime().submit(body, structuredClone(context))
    startUnifiedAutomation(); void getRuntime().tick().catch(() => undefined)
    return job
}
export async function getAutomationJob(jobId: string) { await ensureIdentity(); return getRuntime().getJob(jobId) }
export function captureAutomationScope() { return rawIdentity === identity() ? scope : '' }
export async function prepareAutomationIdentity() { await ensureIdentity(); return captureAutomationScope() }
export async function saveAutomationSnapshot(payload: unknown, expectedScope: string) {
    if (!expectedScope || expectedScope !== captureAutomationScope()) throw new Error('AUTOMATION_SCOPE_CHANGED')
    const response = await axios.post('/api/job/ai/applications/snapshot', payload,
        {timeout: 5000, suppressGlobalErrorToast: true, jobHelperScopeGuard: () => expectedScope === captureAutomationScope()} as any)
    if (expectedScope !== captureAutomationScope()) throw new Error('AUTOMATION_SCOPE_CHANGED')
    return response.data.data
}
export async function cancelAutomationJob(jobId: string) { await ensureIdentity(); return getRuntime().cancel(jobId) }
export function stopGreetingContinuation() {
    localStorage.setItem('ai-job-unified-stop:' + scope + ':' + PushRunStore().runId, 'true')
    getRuntime().hold('本轮待发招呼已停止；已经派发的动作保留回执核对')
    void getRuntime().tick().catch(() => undefined)
}
export async function automationRunSummary(runId: string) { await ensureIdentity(); return getRuntime().runSummary(runId) }
export async function unresolvedAutomationApplication(encryptJobId: string) { await ensureIdentity(); return getRuntime().unresolvedApplication(encryptJobId) }
export async function bindAutomationContact(actionId: string, bossId: string, conversationKey: string) {
    await ensureIdentity(); return getRuntime().bindContact(actionId, bossId, conversationKey)
}
export function observeUnifiedContacts(friends: any[], observedAccount: string, capturedScope: string) {
    if (!capturedScope || capturedScope !== captureAutomationScope() || observedAccount !== account()) return
    // Existing natural contact response only. Never request or navigate the platform for this observer.
    const groups = new Map<string, any[]>()
    for (const friend of friends) {
        const key = exactPlatformId(friend?.uid)
        if (!key || typeof friend.encryptJobId !== 'string' || !friend.encryptJobId || !friend.encryptBossId || !friend.securityId) continue
        groups.set(key, [...(groups.get(key) || []), friend])
    }
    for (const matches of groups.values()) {
        if (matches.length !== 1) continue
        const friend = matches[0]
        void getRuntime().observeContact({bossId: String(friend.uid), encryptJobId: friend.encryptJobId,
            encryptBossId: friend.encryptBossId, securityId: friend.securityId, jobTitle: `${friend.brandName || ''}-${friend.title || ''}`}, capturedScope).catch(() => undefined)
    }
}
export function holdUnifiedAutomation(reason: string) { getRuntime().hold(reason) }
export function acknowledgeUnifiedAutomation(clientMid: string, serverMid: string) {
    // Exact ACKs can arrive after a timeout. They reconcile a stored dispatch; they never send.
    void ensureIdentity().then(() => getRuntime().acknowledge(clientMid, serverMid)).catch(() => undefined)
}
export function subscribeUnifiedAutomation(listener: Parameters<ReturnType<typeof getRuntime>['subscribe']>[0]) {
    startUnifiedAutomation(); return getRuntime().subscribe(listener)
}
export async function approveAutomationAction(action: AutomationAction, decision: 'APPROVE' | 'DECLINE') {
    await ensureIdentity(); const result = await getRuntime().approve(action, decision)
    void getRuntime().tick().catch(() => undefined); return result
}
