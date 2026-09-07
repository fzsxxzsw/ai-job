import {OUTCOME_API_URL} from './outcomesProtocol.ts'
import type {OutcomeAnchor, OutcomeCase, OutcomeCommand, OutcomeObservation, OutcomeStatus} from './outcomesProtocol.ts'

export const OUTCOME_OUTBOX_KEY = 'outcome-outbox-v1'
export const OUTCOME_SESSION_KEY = 'outcome-session-v1'
export const MAX_OUTCOME_EVENTS = 256
export const MAX_OUTCOME_BYTES = 1024 * 1024
const MAX_AGE = 7 * 24 * 60 * 60 * 1000
type Store = {get(key: string): Promise<any>; set(key: string, value: unknown): Promise<void>}
type Session = {scope: string; authorization: string; platformAccount: string}
type Entry = {scope: string; observation: OutcomeObservation; transportEventId?: string; attempts: number; nextAttemptAt: number; blocked: boolean}
type Seen = {scope: string; eventId: string; payloadHash: string; observedAt: number}
type State = {entries: Entry[]; seen: Seen[]; expired: number; anchors: {scope: string; anchor: OutcomeAnchor}[]}
type Dependencies = {fetch: typeof fetch; durable: Store; credentials: Store; now?: () => number}

async function digest(value: string): Promise<string> {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
    return Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('')
}
function stableFact(observation: OutcomeObservation): string {
    return JSON.stringify({...observation, observedAt: 0, bindingObservedAt: 0,
        readEvidence: observation.readEvidence ? {...observation.readEvidence, observedAt: 0} : null})
}

/** Durable facts contain no credentials. A new login/server/platform account gets a different scope. */
export function createOutcomeOutbox(dependencies: Dependencies) {
    const now = dependencies.now || Date.now
    const owners = new Map<string, string>()
    let serial: Promise<unknown> = Promise.resolve()
    let session: Session | null = null
    let state: State = {entries: [], seen: [], expired: 0, anchors: []}
    let loaded = false
    let items: OutcomeCase[] = []
    let updatedAt = 0
    let error = ''
    let nextPollAt = 0
    let invalidScope = ''

    function exclusive<T>(action: () => Promise<T>): Promise<T> {
        const result = serial.then(action)
        serial = result.catch(() => undefined)
        return result
    }
    async function load() {
        if (loaded) return
        const saved = await dependencies.durable.get(OUTCOME_OUTBOX_KEY)
        if (saved && Array.isArray(saved.entries) && Array.isArray(saved.seen)) state = {...saved,
            anchors: Array.isArray(saved.anchors) ? saved.anchors : []}
        session = await dependencies.credentials.get(OUTCOME_SESSION_KEY) || null
        invalidScope = await dependencies.credentials.get(`${OUTCOME_SESSION_KEY}-invalid`) || ''
        loaded = true
    }
    async function persist() { await dependencies.durable.set(OUTCOME_OUTBOX_KEY, state) }
    function status(): OutcomeStatus {
        const entries = state.entries.filter(entry => entry.scope === session?.scope)
        return {scope: session?.scope || '', pending: entries.filter(e => !e.blocked).length,
            blocked: entries.filter(e => e.blocked).length, expired: state.expired,
            items, updatedAt, error, anchors: state.anchors.filter(value => value.scope === session?.scope).map(value => value.anchor)}
    }
    async function request(path: string, body?: unknown): Promise<any> {
        if (!session) throw new Error('AUTH_REQUIRED')
        const response = await dependencies.fetch(`${OUTCOME_API_URL}${path}`, {
            method: body === undefined ? 'GET' : 'POST',
            headers: {Authorization: session.authorization, 'Content-Type': 'application/json; charset=utf-8'},
            ...(body === undefined ? {} : {body: JSON.stringify(body)}),
            redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(5000),
        })
        if (Number(response.headers.get('content-length') || 0) > MAX_OUTCOME_BYTES) throw new Error('RESPONSE_TOO_LARGE')
        const raw = await response.text()
        if (raw.length > MAX_OUTCOME_BYTES) throw new Error('RESPONSE_TOO_LARGE')
        let envelope: any
        try { envelope = JSON.parse(raw) } catch { throw new Error('INVALID_RESPONSE') }
        if (response.status === 401 || envelope.code === 401) {
            invalidScope = session.scope
            await dependencies.credentials.set(`${OUTCOME_SESSION_KEY}-invalid`, invalidScope)
            session = null
            owners.clear()
            items = []
            await dependencies.credentials.set(OUTCOME_SESSION_KEY, null)
            throw new Error('AUTH_REQUIRED')
        }
        if (!response.ok || envelope.code !== 200) {
            const failure = new Error(`HTTP_${response.status}`) as Error & {status: number}
            failure.status = response.status
            throw failure
        }
        return envelope.data
    }
    async function tickLocked() {
        await load()
        if (!session) return status()
        const at = now()
        const expired = state.entries.filter(entry => at - entry.observation.observedAt > MAX_AGE)
        if (expired.length) {
            state.expired += expired.length
            state.entries = state.entries.filter(entry => at - entry.observation.observedAt <= MAX_AGE)
            await persist()
        }
        // Single-event requests isolate schema/association errors. ACKs are durably accepted before dependent reads.
        const batch = state.entries.filter(entry => entry.scope === session?.scope && !entry.blocked && entry.nextAttemptAt <= at)
            .sort((a, b) => (a.observation.readEvidence ? 2 : a.observation.source === 'BOSS_SEND_ACK' ? 0 : 1)
                - (b.observation.readEvidence ? 2 : b.observation.source === 'BOSS_SEND_ACK' ? 0 : 1)).slice(0, 8)
        for (const entry of batch) {
            if (!session) break
            const observation = entry.observation
            const readId = observation.readEvidence?.messageId
            if (readId && !state.anchors.some(value => value.scope === entry.scope && value.anchor.serverMid === readId
                && value.anchor.binding.encryptJobId === observation.encryptJobId
                && value.anchor.binding.conversationKey === observation.conversationKey && value.anchor.binding.bossId === observation.bossId)) {
                error = '阅读观察已保存，等待对应发送记录确认'
                continue
            }
            try {
                entry.transportEventId ||= `outcome:${await digest(JSON.stringify([entry.scope, observation.eventId]))}`
                await persist()
                const receipt = await request('/api/job/outcomes/observations', {schemaVersion: 1,
                    observations: [{...observation, eventId: entry.transportEventId}]})
                const accepted = new Set([...(receipt?.acceptedEventIds || []), ...(receipt?.duplicateEventIds || [])])
                if (!accepted.has(entry.transportEventId)) throw new Error('RECEIPT_MISSING')
                state.entries = state.entries.filter(value => value !== entry)
                state.seen.push({scope: entry.scope, eventId: observation.eventId,
                    payloadHash: await digest(stableFact(observation)), observedAt: observation.observedAt})
                state.seen = state.seen.filter(seen => at - seen.observedAt <= MAX_AGE).slice(-2048)
                if (observation.bossId && observation.conversationKey
                    && ['BOSS_SEND_ACK', 'BOSS_CONVERSATION_SNAPSHOT'].includes(observation.source)) {
                    for (const message of observation.messages) {
                        if (message.role !== 'USER' || message.deliveryState !== 'ACKNOWLEDGED' || message.messageId.startsWith('client:')) continue
                        if (state.anchors.some(value => value.scope === entry.scope && value.anchor.serverMid === message.messageId
                            && value.anchor.binding.encryptJobId === observation.encryptJobId)) continue
                        state.anchors.push({scope: entry.scope, anchor: {binding: {encryptJobId: observation.encryptJobId,
                            bossId: observation.bossId, conversationKey: observation.conversationKey, observedAt: observation.bindingObservedAt},
                            message: {...message}, clientMid: message.clientMessageId || '', serverMid: message.messageId, acceptedAt: at}})
                    }
                    state.anchors = state.anchors.filter(value => at - value.anchor.acceptedAt <= 30 * 24 * 60 * 60_000).slice(-200)
                }
                error = state.entries.some(value => value.scope === entry.scope && value.blocked)
                    ? '部分观察关联或格式需核实，其他观察继续同步' : ''
                nextPollAt = 0
                await persist()
            } catch (failure) {
                entry.attempts++
                entry.nextAttemptAt = at + Math.min(15 * 60_000, 30_000 * 2 ** Math.min(entry.attempts - 1, 5))
                entry.blocked = [400, 409, 422].includes((failure as any)?.status)
                error = !session ? '登录已过期，等待重新连接' : entry.blocked
                    ? '观察关联或格式需核实，已保留并暂停重试' : '本地分析服务暂不可用，观察已保存并等待重试'
                await persist()
            }
        }
        if (session && at >= nextPollAt) {
            nextPollAt = at + 30_000
            try {
                const result = await request('/api/job/outcomes/cases?limit=20&offset=0')
                if (!result || !Array.isArray(result.items)) throw new Error('INVALID_RESPONSE')
                items = result.items.slice(0, 20)
                updatedAt = now()
                if (!batch.length && !state.entries.some(entry => entry.scope === session?.scope && entry.blocked)) error = ''
            } catch {
                error ||= session ? '分析状态暂未同步，稍后自动重试' : '登录已过期，等待重新连接'
            }
        }
        return status()
    }
    return {
        tick: () => exclusive(tickLocked),
        handle: (command: OutcomeCommand, owner: string): Promise<OutcomeStatus | unknown> => exclusive(async () => {
            await load()
            if (command.kind === 'session') {
                if (command.serverUrl.replace(/\/$/, '') !== OUTCOME_API_URL || !command.authorization || !command.platformAccount) {
                    owners.delete(owner)
                    // Only this document's current session may be deactivated by logout/server change.
                    if (!owners.size) { session = null; items = []; await dependencies.credentials.set(OUTCOME_SESSION_KEY, null) }
                    return {scope: '', pending: 0, blocked: 0, expired: 0, error: '等待本地服务登录和 BOSS 身份', items: [], updatedAt: 0}
                }
                const scope = await digest(JSON.stringify([OUTCOME_API_URL, command.authorization, command.platformAccount]))
                if (scope === invalidScope) return {scope: '', pending: 0, blocked: 0, expired: 0,
                    error: '登录已过期，等待新的登录凭证', items: [], updatedAt: 0}
                if (scope !== session?.scope) { owners.clear(); items = []; updatedAt = 0; error = ''; nextPollAt = 0 }
                session = {scope, authorization: command.authorization, platformAccount: command.platformAccount}
                owners.set(owner, scope)
                await dependencies.credentials.set(OUTCOME_SESSION_KEY, session)
                return status()
            }
            if (!session || owners.get(owner) !== session.scope || command.scope !== session.scope) throw new Error('SESSION_CHANGED')
            if (command.kind === 'status') return status()
            if (command.kind === 'feedback') {
                const result = await request(`/api/job/outcomes/reports/${encodeURIComponent(command.reportId)}/feedback`, command.feedback)
                nextPollAt = 0
                return result
            }
            const additions: Entry[] = []
            for (const observation of command.observations) {
                if (observation.observedAt > now() + 60_000 || observation.bindingObservedAt > now() + 60_000) throw new Error('INVALID_TIME')
                const previous = state.entries.find(entry => entry.scope === command.scope && entry.observation.eventId === observation.eventId)
                    || additions.find(entry => entry.observation.eventId === observation.eventId)
                const seen = state.seen.find(entry => entry.scope === command.scope && entry.eventId === observation.eventId)
                if (previous || seen) {
                    const previousHash = previous ? await digest(stableFact(previous.observation)) : seen!.payloadHash
                    if (previousHash !== await digest(stableFact(observation))) throw new Error('EVENT_CONFLICT')
                    continue
                }
                additions.push({scope: command.scope, observation, attempts: 0, nextAttemptAt: now(), blocked: false})
            }
            const entries = [...state.entries, ...additions]
            if (entries.length > MAX_OUTCOME_EVENTS || JSON.stringify(entries).length > MAX_OUTCOME_BYTES) throw new Error('OUTBOX_FULL')
            state.entries = entries
            await persist()
            return status()
        }),
    }
}
