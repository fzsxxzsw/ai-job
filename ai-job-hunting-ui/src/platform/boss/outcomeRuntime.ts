import {GM_getValue} from '$'
import {BRIDGE_PROTOCOL_VERSION, MAIN_WORLD_SOURCE, ISOLATED_WORLD_SOURCE} from '../../extension/bridgeProtocol'
import {OUTCOME_API_URL} from '../../extension/outcomesProtocol'
import type {OutcomeCommand, OutcomeFeedback, OutcomeObservation, OutcomeReport, OutcomeStatus} from '../../extension/outcomesProtocol'
import {createPassiveOutcomeCollector, exactPlatformId} from './outcomeCollector'
import type {TerminalProof} from './outcomeCollector'
import {captureCurrentOutcomePanel} from './outcomeDom'

type Snapshot = OutcomeStatus & {unbound: number; discarded: number; captureDiagnostic?: string}
const empty = (): Snapshot => ({scope: '', pending: 0, blocked: 0, expired: 0, error: '', items: [], updatedAt: 0, unbound: 0, discarded: 0})
const listeners = new Set<(value: Snapshot) => void>()
const pending = new Map<string, {identity: string; observation: OutcomeObservation}>()
const firstFacts = new Map<string, Omit<OutcomeObservation, 'eventId'>>()
const deliveredFacts = new Set<string>()
let snapshot = empty()
let running = false
let initialized = false
let identity = ''
let counter = 0
let syncInFlight: Promise<void> | null = null
let inspectAfterRestore: (() => void) | null = null
let restoredAnchors = ''
let captureDiagnostic = {identity: '', message: ''}

function sessionContext() {
    const authorization = localStorage.getItem('Authorization') || ''
    const platformAccount = exactPlatformId((window as any)._PAGE?.uid)
    let serverUrl = ''
    try { serverUrl = String(GM_getValue('custom_server_url', OUTCOME_API_URL)) } catch { /* wait for configuration */ }
    return {authorization, platformAccount, serverUrl}
}
function contextIdentity(context: ReturnType<typeof sessionContext>): string {
    return JSON.stringify([context.authorization, context.platformAccount, context.serverUrl])
}
function notify() {
    if (captureDiagnostic.identity !== identity) captureDiagnostic = {identity, message: ''}
    snapshot = {...snapshot, ...collector.health(), captureDiagnostic: captureDiagnostic.identity === identity ? captureDiagnostic.message : ''}
    for (const listener of listeners) listener({...snapshot})
}

function bridge(command: OutcomeCommand): Promise<any> {
    return new Promise((resolve, reject) => {
        const requestId = `outcome-${Date.now().toString(36)}-${++counter}`
        const handler = (event: MessageEvent) => {
            const response = event.data
            if (event.source !== window || event.origin !== window.location.origin || response?.requestId !== requestId
                || response?.protocol !== BRIDGE_PROTOCOL_VERSION || response?.source !== ISOLATED_WORLD_SOURCE
                || response?.target !== MAIN_WORLD_SOURCE) return
            if (response.operation !== 'outcomes-response' && response.operation !== 'error') return
            clearTimeout(timeout)
            window.removeEventListener('message', handler)
            if (response.ok) resolve(response.payload)
            else reject(new Error('扩展分析后台暂不可用'))
        }
        const timeout = window.setTimeout(() => {
            window.removeEventListener('message', handler)
            reject(new Error('扩展分析后台响应超时'))
        }, 15_000)
        window.addEventListener('message', handler)
        window.postMessage({protocol: BRIDGE_PROTOCOL_VERSION, source: MAIN_WORLD_SOURCE, target: ISOLATED_WORLD_SOURCE,
            requestId, operation: 'outcomes.command', payload: command}, window.location.origin)
    })
}
function ensureIdentity() {
    const context = sessionContext()
    const next = contextIdentity(context)
    if (next !== identity) {
        identity = next; pending.clear(); firstFacts.clear(); deliveredFacts.clear(); restoredAnchors = ''; collector.reset(); snapshot = empty(); notify()
    }
    return context
}
function semanticFact(observation: Omit<OutcomeObservation, 'eventId'>): string {
    const raw = {...observation, observedAt: 0, bindingObservedAt: 0,
        readEvidence: observation.readEvidence ? {...observation.readEvidence, observedAt: 0} : null}
    return JSON.stringify(raw)
}
async function semanticId(observation: Omit<OutcomeObservation, 'eventId'>): Promise<string> {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(semanticFact(observation)))
    return `outcome:${Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join('')}`
}
function queue(observation: Omit<OutcomeObservation, 'eventId'>) {
    const captured = identity
    if (!captured) return
    const key = semanticFact(observation)
    const first = firstFacts.get(key) || structuredClone(observation)
    if (!firstFacts.has(key)) {
        firstFacts.set(key, first)
        if (firstFacts.size > 512) firstFacts.delete(firstFacts.keys().next().value!)
    }
    void semanticId(first).then(eventId => {
        if (captured !== identity || pending.has(eventId) || deliveredFacts.has(eventId)) return
        if (pending.size >= 128) { snapshot.error = '本页分析观察队列已满，等待后台恢复'; notify(); return }
        pending.set(eventId, {identity: captured, observation: {...first, eventId}})
        void synchronize()
    }).catch(() => { snapshot.error = '观察暂未保存'; notify() })
}
const collector = createPassiveOutcomeCollector(queue)

function start() {
    if (initialized) return
    initialized = true
    // These timers only communicate with the local extension/API. They never request BOSS pages.
    window.setInterval(() => { void synchronize() }, 10_000)
    window.addEventListener('storage', event => { if (event.key === 'Authorization' || event.key === 'custom_server_url') void synchronize() })
    void synchronize()
}
function synchronize(): Promise<void> {
    if (syncInFlight) return syncInFlight
    syncInFlight = (async () => {
        const context = ensureIdentity()
        const captured = identity
        try {
            const result = await bridge({kind: 'session', ...context}) as OutcomeStatus
            if (captured !== contextIdentity(sessionContext())) return
            if (!result.scope) { snapshot = {...result, ...collector.health()}; notify(); return }
            const entries = Array.from(pending.values()).filter(entry => entry.identity === captured).slice(0, 32)
            if (entries.length) {
                await bridge({kind: 'enqueue', scope: result.scope, observations: entries.map(entry => entry.observation)})
                if (captured !== contextIdentity(sessionContext())) return
                for (const entry of entries) {
                    pending.delete(entry.observation.eventId)
                    deliveredFacts.add(entry.observation.eventId)
                }
                while (deliveredFacts.size > 2048) deliveredFacts.delete(deliveredFacts.values().next().value!)
            }
            const status = await bridge({kind: 'status', scope: result.scope}) as OutcomeStatus
            if (captured !== contextIdentity(sessionContext())) return
            const anchors = JSON.stringify(status.anchors || [])
            const changedAnchors = anchors !== restoredAnchors
            if (changedAnchors) {
                collector.restoreAcknowledged(status.anchors || [], context.platformAccount)
                restoredAnchors = anchors
            }
            snapshot = {...status, ...collector.health()}
            notify()
            if (changedAnchors) inspectAfterRestore?.()
        } catch {
            if (captured === identity) { snapshot.error = '分析后台暂不可用，本页观察等待重试'; notify() }
        }
    })().finally(() => { syncInFlight = null })
    return syncInFlight
}

export function captureOutcomeContext(): string {
    try { return contextIdentity(sessionContext()) } catch { return '' }
}
export function observeOutcomeContacts(friends: any[], platformAccount: unknown, expectedContext: string): void {
    try {
        if (!expectedContext || expectedContext !== captureOutcomeContext()) return
        ensureIdentity(); collector.bind(friends, platformAccount, Date.now()); notify(); start()
    } catch { /* passive */ }
}
/** Fresh peer-lookup association from the original live handler, never a later cache replay. */
export function observeOutcomePeerAssociation(contact: {bossId: unknown; encryptJobId: unknown; encryptBossId: string; securityId: string},
    rawMessage: any, platformAccount: string, expectedContext: string, stillCurrent: () => boolean): void {
    try {
        const peer = exactPlatformId(contact.bossId), mid = exactPlatformId(rawMessage?.mid)
        if (!stillCurrent() || !expectedContext || expectedContext !== captureOutcomeContext() || !peer || !mid
            || exactPlatformId(rawMessage.from?.uid) !== peer || exactPlatformId(rawMessage.to?.uid) !== platformAccount
            || typeof contact.encryptJobId !== 'string' || !contact.encryptJobId || !contact.encryptBossId || !contact.securityId) return
        ensureIdentity()
        const conversationKey = `${contact.encryptBossId}:${contact.securityId}`
        collector.bind([{uid: peer, encryptJobId: contact.encryptJobId, encryptBossId: contact.encryptBossId, securityId: contact.securityId}],
            platformAccount, Date.now(), {bossId: peer, encryptJobId: contact.encryptJobId, conversationKey, messageIds: [mid]})
        notify(); start()
    } catch { /* Association cannot interfere with the reply or its platform response. */ }
}
export function observeOutcomeMessage(message: unknown, text: string, platformAccount: unknown): void {
    try { ensureIdentity(); collector.message(message, text, platformAccount, Date.now()); notify(); start() } catch { /* passive */ }
}
export function observeOutcomeAcknowledgement(clientMid: string, serverMid: string): void {
    try { ensureIdentity(); collector.acknowledge(clientMid, serverMid, Date.now()); start() } catch { /* passive */ }
}
export function observeOutcomeApplication(encryptJobId: string, expectedContext: string): void {
    try {
        if (!expectedContext || expectedContext !== captureOutcomeContext()) return
        ensureIdentity()
        const now = Date.now()
        queue({encryptJobId, conversationKey: null, bossId: null, source: 'APPLICATION_FLOW', observedAt: now,
            bindingObservedAt: now, messages: [], readEvidence: null, coverage: null})
        start()
    } catch { /* successful delivery/snapshot remain successful */ }
}

/** Observe the already open conversation only. No clicks, scrolling, network fetches, or mark-read calls. */
export function subscribeOutcomeReports(listener: (value: Snapshot) => void): () => void {
    listeners.add(listener)
    start()
    listener({...snapshot})
    return () => listeners.delete(listener)
}

export function watchCurrentOutcomeConversation(root: Document = document,
    readTerminalProof?: (root: Document, identity: {bossId: string; conversationKey: string}) => TerminalProof | null): () => void {
    if (running) return () => undefined
    running = true
    let queued = false
    const inspect = () => {
        queued = false
        try {
            ensureIdentity()
            const panel = captureCurrentOutcomePanel(root, (window as any)._PAGE?.uid, message => {
                captureDiagnostic = {identity, message}; notify()
            })
            if (!panel || !panel.recheck()) return
            const current = panel.binding
            collector.bind([{...current, uid: current.bossId}], (window as any)._PAGE?.uid, Date.now(),
                {...current, messageIds: panel.messages.map(message => message.mid)})
            for (const message of panel.messages) collector.message(message, message.text, (window as any)._PAGE?.uid, Date.now())
            if (!panel.recheck()) return
            // No terminal source is assumed: a viewport at the bottom does not prove full coverage.
            collector.inspectCurrent(root, current, Date.now(), readTerminalProof?.(root, current) || null)
            notify()
        } catch { captureDiagnostic = {identity, message: '当前消息采集未完成，等待下一次页面变化后核对'}; notify() }
    }
    const observer = new MutationObserver(records => {
        if (queued || !records.some(record => (record.target as Element)?.closest?.('.chat-conversation, .friend-content, .friend-content-warp')
            || Array.from(record.addedNodes).some(node => node instanceof Element && (node.matches('.chat-conversation') || node.querySelector('.chat-conversation'))))) return
        queued = true
        queueMicrotask(inspect)
    })
    observer.observe(root.body, {subtree: true, childList: true, characterData: true,
        attributes: true, attributeFilter: ['class', 'data-mid', 'data-cmid', 'data-message-id', 'data-read-status']})
    inspect()
    inspectAfterRestore = inspect
    return () => { observer.disconnect(); running = false; inspectAfterRestore = null }
}

export async function sendOutcomeFeedback(reportId: string, feedback: OutcomeFeedback): Promise<OutcomeReport> {
    await synchronize()
    const scope = snapshot.scope
    const captured = identity
    if (!scope) throw new Error('请先连接本地服务')
    const result = await bridge({kind: 'feedback', scope, reportId, feedback}) as OutcomeReport
    if (captured !== contextIdentity(sessionContext())) throw new Error('登录或服务器已切换')
    return result
}
