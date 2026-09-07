import type {OutcomeAnchor, OutcomeCoverage, OutcomeMessage, OutcomeObservation, OutcomeReadEvidence} from '../../extension/outcomesProtocol.ts'

export type OutcomeBinding = {encryptJobId: string; conversationKey: string; bossId: string; observedAt: number}
export type KnownOutbound = {binding: OutcomeBinding; message: OutcomeMessage; clientMid: string; serverMid: string}
export type TerminalProof = {
    conversationKey: string; bossId: string; checkedAt: number; latestMessageId: string
    terminalVerified: true; continuousAfterAnchor: boolean; messageIds: string[]
}
const BINDING_TTL = 30 * 60_000

export function exactPlatformId(value: unknown): string {
    if (typeof value === 'number' && !Number.isSafeInteger(value)) return ''
    if (value == null) return ''
    const id = String(value)
    return /^\d+$/.test(id) && BigInt(id) > 0n ? id : ''
}
export function platformMessageTime(value: unknown, observedAt: number): number | null {
    if (value == null || value === '') return null
    const time = Number(value)
    if (!Number.isSafeInteger(time) || time <= 0) return null
    const milliseconds = time < 100_000_000_000 ? time * 1000 : time
    return milliseconds <= observedAt + 60_000 ? milliseconds : null
}
export function verifiedOutcomeCoverage(outbound: KnownOutbound, proof: TerminalProof | null): OutcomeCoverage | null {
    if (!proof || proof.terminalVerified !== true || proof.conversationKey !== outbound.binding.conversationKey
        || proof.bossId !== outbound.binding.bossId || outbound.message.deliveryState !== 'ACKNOWLEDGED'
        || !outbound.serverMid || !Number.isSafeInteger(proof.checkedAt) || proof.checkedAt <= 0) return null
    const ids = proof.messageIds
    if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length
        || ids[0] !== outbound.serverMid || ids.at(-1) !== proof.latestMessageId) return null
    if (proof.latestMessageId !== outbound.serverMid && !proof.continuousAfterAnchor) return null
    return {anchorMessageId: outbound.serverMid, latestMessageId: proof.latestMessageId, checkedAt: proof.checkedAt, completeAfterAnchor: true}
}

/** The status must be on the exact own bubble. Body text and global unread badges never qualify. */
export function exactDomReadEvidence(root: ParentNode, outbound: KnownOutbound,
    selected: {conversationKey: string; bossId: string} | null, observedAt: number): OutcomeReadEvidence | null {
    if (!selected || selected.conversationKey !== outbound.binding.conversationKey || selected.bossId !== outbound.binding.bossId
        || !outbound.serverMid || outbound.message.role !== 'USER') return null
    const conversation = root.querySelector('.chat-conversation')
    if (!conversation) return null
    const matches: Element[] = []
    for (const element of Array.from(conversation.querySelectorAll('[data-mid], [data-cmid], [data-message-id]'))) {
        if (element.closest('#ai-job, [contenteditable="true"]')) continue
        const role = element.className || ''
        if (typeof role !== 'string' || !/(?:item-myself|message-self|message-mine|from-me|is-self|my-message)/.test(role)
            || /(?:item-friend|message-friend|from-boss|from-other|is-friend)/.test(role)) continue
        const mid = element.getAttribute('data-mid') || element.getAttribute('data-message-id') || ''
        const cmid = element.getAttribute('data-cmid') || ''
        if ((!mid && !cmid) || (mid && mid !== outbound.serverMid) || (cmid && cmid !== outbound.clientMid)) continue
        if (element.getAttribute('data-mid') && element.getAttribute('data-message-id')
            && element.getAttribute('data-mid') !== element.getAttribute('data-message-id')) continue
        matches.push(element)
    }
    if (matches.length !== 1) return null
    const bubble = matches[0]
    // Explicit status elements only: a message which literally says “已读” is not read evidence.
    const statuses = Array.from(bubble.querySelectorAll('.message-status, .read-status, .msg-status, [data-read-status]'))
        .filter(element => !element.closest('.text, .message-text, .text-content, [contenteditable="true"]'))
        .map(element => (element.textContent || '').trim()).filter(text => text === '已读' || text === '未读')
    if (!statuses.length || new Set(statuses).size !== 1) return null
    return {messageId: outbound.serverMid, state: statuses[0] === '已读' ? 'READ' : 'UNREAD',
        source: 'BOSS_EXACT_MESSAGE_STATUS', observedAt}
}

type PendingMessage = {
    raw: {from: {uid: string}; to: {uid: string}; mid: string; cmid: string; time: number | null; encryptJobId: string; conversationKey: string}
    text: string; observedAt: number; peer: string
}
export type MessageBindingProof = {encryptJobId: string; conversationKey: string; bossId: string; messageIds: string[]}

export function createPassiveOutcomeCollector(emit: (observation: Omit<OutcomeObservation, 'eventId'>) => void) {
    const bindings = new Map<string, OutcomeBinding>()
    const outbounds = new Map<string, KnownOutbound>()
    const acks = new Map<string, {serverMid: string; observedAt: number}>()
    const sentReads = new Set<string>()
    const pending = new Map<string, PendingMessage>()
    let discarded = 0
    let account = ''
    function changeAccount(next: string) {
        if (next === account) return
        account = next; bindings.clear(); outbounds.clear(); acks.clear(); sentReads.clear(); pending.clear(); discarded = 0
    }
    function publish(binding: OutcomeBinding, source: OutcomeObservation['source'], messages: OutcomeMessage[], observedAt: number,
        readEvidence: OutcomeReadEvidence | null = null, coverage: OutcomeCoverage | null = null) {
        emit({encryptJobId: binding.encryptJobId, conversationKey: binding.conversationKey, bossId: binding.bossId,
            source, observedAt, bindingObservedAt: binding.observedAt, messages, readEvidence, coverage})
    }
    function acknowledge(clientMid: string, serverMid: string, observedAt: number) {
        if (!exactPlatformId(clientMid) || !exactPlatformId(serverMid) || clientMid === serverMid) return
        const previous = acks.get(clientMid)
        if (previous && previous.serverMid !== serverMid) return
        if (!previous) acks.set(clientMid, {serverMid, observedAt})
        const outbound = outbounds.get(clientMid)
        if (!outbound || outbound.serverMid === serverMid) return
        outbound.serverMid = serverMid
        outbound.message = {...outbound.message, messageId: serverMid, deliveryState: 'ACKNOWLEDGED'}
        publish(outbound.binding, 'BOSS_SEND_ACK', [outbound.message], previous?.observedAt || observedAt)
    }
    function prune(at: number) {
        for (const [key, item] of pending) if (at - item.observedAt > 24 * 60 * 60_000) { pending.delete(key); discarded++ }
    }
    function deliver(raw: PendingMessage['raw'], text: string, observedAt: number, binding: OutcomeBinding) {
        const role = raw.from.uid === account ? 'USER' : 'HR'
        const mid = raw.mid, cmid = raw.cmid
        const message: OutcomeMessage = {messageId: mid || `client:${cmid}`, clientMessageId: cmid || null, role,
            text, sentAt: raw.time, deliveryState: 'UNKNOWN'}
        if (role === 'USER' && cmid) {
            const server = (mid && mid !== cmid ? mid : acks.get(cmid)?.serverMid) || ''
            message.messageId = `client:${cmid}`
            let outbound = outbounds.get(cmid)
            if (!outbound) {
                outbound = {binding: {...binding}, message, clientMid: cmid, serverMid: ''}
                outbounds.set(cmid, outbound)
                publish(outbound.binding, 'BOSS_PASSIVE_MESSAGE', [message], observedAt)
            }
            if (server) acknowledge(cmid, server, observedAt)
        } else if (mid) {
            // A server-ID-only echo is retained as UNKNOWN. It never creates an acknowledged anchor.
            publish({...binding}, 'BOSS_PASSIVE_MESSAGE', [message], observedAt)
        }
        if (outbounds.size > 300) outbounds.delete(outbounds.keys().next().value!)
        if (acks.size > 600) acks.delete(acks.keys().next().value!)
    }
    function provesBinding(item: PendingMessage, binding: OutcomeBinding, proof?: MessageBindingProof): boolean {
        if (item.peer !== binding.bossId || item.raw.encryptJobId && item.raw.encryptJobId !== binding.encryptJobId
            || item.raw.conversationKey && item.raw.conversationKey !== binding.conversationKey) return false
        return (!!item.raw.encryptJobId && !!item.raw.conversationKey)
            || (!!proof && proof.encryptJobId === binding.encryptJobId && proof.conversationKey === binding.conversationKey
                && proof.bossId === binding.bossId && !!item.raw.mid && proof.messageIds.includes(item.raw.mid))
    }
    return {
        reset: () => { account = ''; changeAccount('__reset__'); account = '' },
        health: () => ({unbound: pending.size, discarded}),
        restoreAcknowledged(anchors: OutcomeAnchor[], ownAccount: unknown) {
            changeAccount(exactPlatformId(ownAccount))
            if (!account) return
            for (const anchor of anchors.slice(-200)) {
                if (!anchor?.binding?.encryptJobId || !anchor.binding.conversationKey || !exactPlatformId(anchor.binding.bossId)
                    || !Number.isSafeInteger(anchor.acceptedAt) || anchor.acceptedAt <= 0
                    || !exactPlatformId(anchor.serverMid) || anchor.message?.messageId !== anchor.serverMid
                    || anchor.message.role !== 'USER' || anchor.message.deliveryState !== 'ACKNOWLEDGED'
                    || anchor.clientMid && !exactPlatformId(anchor.clientMid)) continue
                const key = anchor.clientMid || `server:${anchor.binding.encryptJobId}:${anchor.serverMid}`
                const previous = outbounds.get(key)
                if (previous && (previous.binding.encryptJobId !== anchor.binding.encryptJobId || previous.serverMid && previous.serverMid !== anchor.serverMid)) continue
                outbounds.set(key, {binding: {...anchor.binding}, message: {...anchor.message}, clientMid: anchor.clientMid, serverMid: anchor.serverMid})
            }
        },
        bind(raw: any[], ownAccount: unknown, observedAt: number, proof?: MessageBindingProof) {
            changeAccount(exactPlatformId(ownAccount))
            if (!account) return
            prune(observedAt)
            for (const friend of raw) {
                const bossId = exactPlatformId(friend?.uid)
                const job = typeof friend?.encryptJobId === 'string' ? friend.encryptJobId : ''
                const boss = typeof friend?.encryptBossId === 'string' ? friend.encryptBossId : ''
                const security = typeof friend?.securityId === 'string' ? friend.securityId : ''
                if (!bossId || !job || !boss || !security) continue
                const binding = {encryptJobId: job, conversationKey: `${boss}:${security}`, bossId, observedAt}
                bindings.set(bossId, binding)
                for (const [key, item] of pending) {
                    if (!provesBinding(item, binding, proof)) continue
                    deliver(item.raw, item.text, item.observedAt, binding)
                    pending.delete(key)
                }
            }
        },
        message(raw: any, text: string, ownAccount: unknown, observedAt: number) {
            changeAccount(exactPlatformId(ownAccount))
            if (!account) return
            prune(observedAt)
            const from = exactPlatformId(raw?.from?.uid), to = exactPlatformId(raw?.to?.uid)
            const role = from === account && to !== account ? 'USER' : to === account && from !== account ? 'HR' : null
            if (!role) return
            const peer = role === 'USER' ? to : from
            const mid = exactPlatformId(raw.mid), cmid = exactPlatformId(raw.cmid)
            if (!mid && !cmid) return
            const key = `${from}:${to}:${mid || cmid}`
            const item: PendingMessage = pending.get(key) || {peer, observedAt, text: String(text || '').slice(0, 4000),
                raw: {from: {uid: from}, to: {uid: to}, mid, cmid, time: platformMessageTime(raw.time, observedAt),
                    encryptJobId: typeof raw.encryptJobId === 'string' ? raw.encryptJobId : '',
                    conversationKey: typeof raw.conversationKey === 'string' ? raw.conversationKey : ''}}
            const binding = bindings.get(peer)
            if (!binding || observedAt < binding.observedAt || observedAt - binding.observedAt > BINDING_TTL
                || item.raw.encryptJobId && item.raw.encryptJobId !== binding.encryptJobId
                || item.raw.conversationKey && item.raw.conversationKey !== binding.conversationKey) {
                if (!pending.has(key) && pending.size >= 128) { discarded++; return }
                pending.set(key, item)
                return
            }
            if (pending.has(key) && !provesBinding(item, binding)) return
            deliver(item.raw, item.text, item.observedAt, binding)
            pending.delete(key)
        },
        acknowledge(clientMid: string, serverMid: string, observedAt: number) { acknowledge(clientMid, serverMid, observedAt) },
        inspectCurrent(root: ParentNode, selected: {conversationKey: string; bossId: string} | null, observedAt: number,
            proof: TerminalProof | null = null) {
            if (!selected) return
            for (const outbound of outbounds.values()) {
                if (selected.conversationKey !== outbound.binding.conversationKey || selected.bossId !== outbound.binding.bossId) continue
                const read = exactDomReadEvidence(root, outbound, selected, observedAt)
                const coverage = verifiedOutcomeCoverage(outbound, proof)
                const key = read ? `${outbound.binding.conversationKey}:${read.messageId}:${read.state}` : ''
                if (read && !sentReads.has(key)) {
                    sentReads.add(key)
                    publish(outbound.binding, 'BOSS_EXACT_MESSAGE_STATUS', [], observedAt, read)
                }
                if (coverage) publish(outbound.binding, 'BOSS_CONVERSATION_SNAPSHOT', [outbound.message], observedAt, read, coverage)
            }
        },
    }
}
