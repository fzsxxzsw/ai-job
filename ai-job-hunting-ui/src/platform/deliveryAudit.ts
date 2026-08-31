import {GM_getValue, GM_setValue, GM_xmlhttpRequest} from "$";
import {hasMaterialDeliveryAuditChange} from "./deliveryAuditState";

export const DELIVERY_AUDIT_KEY = 'ai-job-delivery-audit-v1'

export type DeliveryKind = 'greeting' | 'ai-reply'
export type DeliveryStatus = 'queued' | 'sending' | 'acknowledged' | 'receipt' | 'failed' | 'blocked'

export type DeliveryAuditEntry = {
    id: string,
    key: string,
    kind: DeliveryKind,
    status: DeliveryStatus,
    jobTitle: string,
    content: string,
    attempts: number,
    createdAt: number,
    updatedAt: number,
    acknowledgedAt?: number,
    receiptAt?: number,
    lastError?: string,
    /** BOSS numeric recruiter id. A receipt is never authoritative without it. */
    bossId?: string,
    /** Stable conversation identity, normally encryptBossId:securityId. */
    conversationKey?: string,
    /** Outgoing client id and the server id returned by BOSS messageSync. */
    clientMid?: string,
    serverMid?: string,
}

export type DeliveryIdentity = {
    bossId: string | number,
    conversationKey: string,
    clientMid: string | number,
    serverMid: string | number,
}

export type SelectedConversationIdentity = {
    bossId: string,
    conversationKey: string,
    encryptBossId: string,
    securityId: string,
    brandName: string,
    positionTitle: string,
    recruiterName: string,
}

type ConversationIdentityResolver = (rowText: string) => SelectedConversationIdentity | null

let conversationIdentityResolver: ConversationIdentityResolver | null = null

/**
 * BOSS production builds do not always expose Vue component props on DOM wrappers.
 * The chat module registers an API-backed contact-cache resolver so receipt checks
 * can still bind to the exact recruiter without falling back to message text alone.
 */
export function setConversationIdentityResolver(resolver: ConversationIdentityResolver): void {
    conversationIdentityResolver = resolver
}

const MAX_ENTRIES = 300
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000

function normalizeText(value: unknown): string {
    return String(value || '').replace(/\u0000/g, '').trim()
}

function normalizeIdentityPart(value: unknown): string {
    return String(value ?? '').trim()
}

export function makeConversationKey(encryptBossId: unknown, securityId: unknown): string {
    const boss = normalizeIdentityPart(encryptBossId)
    const security = normalizeIdentityPart(securityId)
    return boss && security ? `${boss}:${security}` : ''
}

function vueSourceFromElement(element: Element | null): any | undefined {
    let current: any = element
    for (let depth = 0; current && depth < 7; depth++, current = current.parentElement) {
        const candidates = [
            current?.__vue__?.source,
            current?.__vue__?._props?.source,
            current?.__vueParentComponent?.props?.source,
            current?.__vueParentComponent?.ctx?.source,
        ]
        const source = candidates.find(candidate => candidate && (candidate.uid || candidate.bossId)
            && candidate.encryptBossId && candidate.securityId)
        if (source) return source
    }
    return undefined
}

export function conversationIdentityFromElement(element: Element | null): SelectedConversationIdentity | null {
    const source = vueSourceFromElement(element)
    if (source) {
        const bossId = normalizeIdentityPart(source.uid || source.bossId)
        const encryptBossId = normalizeIdentityPart(source.encryptBossId)
        const securityId = normalizeIdentityPart(source.securityId)
        const conversationKey = makeConversationKey(encryptBossId, securityId)
        if (bossId && conversationKey) {
            return {
                bossId,
                conversationKey,
                encryptBossId,
                securityId,
                brandName: normalizeText(source.brandName),
                positionTitle: normalizeText(source.title || source.positionTitle),
                recruiterName: normalizeText(source.name || source.recruiterName),
            }
        }
    }

    const row = element?.closest('li') || element
    const rowText = normalizeText((row as HTMLElement | null)?.innerText || row?.textContent)
    return rowText && conversationIdentityResolver ? conversationIdentityResolver(rowText) : null
}

/**
 * Returns the recruiter identity BOSS currently shows in the right-hand conversation.
 * A page receipt is not accepted when the selected row cannot be identified exactly.
 */
export function getSelectedConversationIdentity(root: ParentNode = document): SelectedConversationIdentity | null {
    const selected = root.querySelector(
        '.friend-content.selected, .friend-content-warp.selected, li.selected .friend-content, li[aria-current="true"] .friend-content'
    )
    return conversationIdentityFromElement(selected)
}

export function makeDeliveryAuditId(kind: DeliveryKind, key: string): string {
    return `${kind}:${key}`
}

export function stableDeliveryKey(...parts: string[]): string {
    const raw = parts.join('\u0001')
    let hash = 2166136261
    for (let index = 0; index < raw.length; index++) {
        hash ^= raw.charCodeAt(index)
        hash = Math.imul(hash, 16777619)
    }
    return `${raw.length}:${(hash >>> 0).toString(16)}`
}

export function readDeliveryAudit(): DeliveryAuditEntry[] {
    try {
        const gmRaw = GM_getValue(DELIVERY_AUDIT_KEY, '') as string
        const localRaw = localStorage.getItem(DELIVERY_AUDIT_KEY) || ''
        const parsed = JSON.parse(gmRaw || localRaw || '[]')
        if (!Array.isArray(parsed)) return []
        const now = Date.now()
        return parsed.filter((entry: DeliveryAuditEntry) => entry?.id && entry?.key && entry?.kind
            && entry?.status && entry?.content && now - Number(entry.createdAt || 0) < MAX_AGE_MS
            && !(entry.status === 'receipt'
                && (!entry.bossId || !entry.conversationKey || !entry.clientMid || !entry.serverMid)))
            .slice(-MAX_ENTRIES)
    } catch (_) {
        return []
    }
}

function writeDeliveryAudit(entries: DeliveryAuditEntry[]): void {
    const raw = JSON.stringify(entries.slice(-MAX_ENTRIES))
    GM_setValue(DELIVERY_AUDIT_KEY, raw)
    localStorage.setItem(DELIVERY_AUDIT_KEY, raw)
}

function reportDeliveryAudit(entry: DeliveryAuditEntry): void {
    const authorization = localStorage.getItem('Authorization')
    if (!authorization) return
    try {
        GM_xmlhttpRequest({
            method: 'POST',
            url: 'http://127.0.0.1:9100/api/job/delivery/audit',
            timeout: 5_000,
            headers: {
                'Authorization': authorization,
                'Content-Type': 'application/json; charset=utf-8',
            },
            data: JSON.stringify({
                auditId: entry.id,
                deliveryKey: entry.key,
                kind: entry.kind,
                status: entry.status,
                jobTitle: entry.jobTitle,
                contentHash: stableDeliveryKey(entry.content),
                contentLength: entry.content.length,
                attempts: entry.attempts,
                createdAt: entry.createdAt,
                updatedAt: entry.updatedAt,
                bossId: entry.bossId,
                conversationKey: entry.conversationKey,
                clientMid: entry.clientMid,
                serverMid: entry.serverMid,
            }),
        })
    } catch (_) {
        // Reporting is diagnostic only and must never interrupt message delivery.
    }
}

export function recordDeliveryAudit(input: {
    key: string,
    kind: DeliveryKind,
    status: DeliveryStatus,
    jobTitle?: string,
    content: string,
    attempts?: number,
    lastError?: unknown,
    bossId?: string | number,
    conversationKey?: string,
    clientMid?: string | number,
    serverMid?: string | number,
}): DeliveryAuditEntry {
    const entries = readDeliveryAudit()
    const id = makeDeliveryAuditId(input.kind, input.key)
    const index = entries.findIndex(entry => entry.id === id)
    const previous = index >= 0 ? entries[index] : undefined
    const now = Date.now()

    // Only identity-complete receipts are final. Older content-only records are
    // deliberately allowed to return to the queue after this upgrade.
    const previousHasAuthoritativeReceipt = previous?.status === 'receipt'
        && !!previous.bossId && !!previous.conversationKey && !!previous.clientMid && !!previous.serverMid
    if (previousHasAuthoritativeReceipt) {
        return previous
    }
    const nextStatus = input.status
    const nextJobTitle = normalizeText(input.jobTitle || previous?.jobTitle)
    const nextContent = normalizeText(input.content || previous?.content).slice(0, 1000)
    const nextAttempts = Math.max(Number(input.attempts || 0), Number(previous?.attempts || 0))
    const nextBossId = normalizeIdentityPart(input.bossId ?? previous?.bossId) || undefined
    const nextConversationKey = normalizeIdentityPart(input.conversationKey ?? previous?.conversationKey) || undefined
    const nextClientMid = normalizeIdentityPart(input.clientMid ?? previous?.clientMid) || undefined
    const nextServerMid = normalizeIdentityPart(input.serverMid ?? previous?.serverMid) || undefined
    const suppliedLastError = input.lastError ? normalizeText(input.lastError).slice(0, 500) : undefined
    const nextLastError = input.status === 'acknowledged' || input.status === 'receipt'
        ? undefined
        : suppliedLastError ?? previous?.lastError
    const materialState = {
        status: nextStatus,
        jobTitle: nextJobTitle,
        content: nextContent,
        attempts: nextAttempts,
        lastError: nextLastError,
        bossId: nextBossId,
        conversationKey: nextConversationKey,
        clientMid: nextClientMid,
        serverMid: nextServerMid,
    }
    if (!hasMaterialDeliveryAuditChange(previous, materialState)) {
        return previous!
    }
    const entry: DeliveryAuditEntry = {
        id,
        key: input.key,
        kind: input.kind,
        ...materialState,
        createdAt: Number(previous?.createdAt || now),
        updatedAt: now,
        ...(previous?.acknowledgedAt ? {acknowledgedAt: previous.acknowledgedAt} : {}),
        ...(previous?.receiptAt ? {receiptAt: previous.receiptAt} : {}),
    }
    if (input.status === 'acknowledged') entry.acknowledgedAt = now
    if (input.status === 'receipt') {
        entry.acknowledgedAt = entry.acknowledgedAt || now
        entry.receiptAt = now
        delete entry.lastError
    }
    if (nextStatus !== 'receipt') {
        delete entry.receiptAt
    }

    if (index >= 0) entries[index] = entry
    else entries.push(entry)
    writeDeliveryAudit(entries)
    reportDeliveryAudit(entry)
    return entry
}

export function hasBossDeliveryReceipt(content: string, identity: DeliveryIdentity, root: ParentNode = document): boolean {
    const normalizedContent = normalizeText(content)
    const expectedBossId = normalizeIdentityPart(identity?.bossId)
    const expectedConversationKey = normalizeIdentityPart(identity?.conversationKey)
    const clientMid = normalizeIdentityPart(identity?.clientMid)
    const serverMid = normalizeIdentityPart(identity?.serverMid)
    if (!normalizedContent || !expectedBossId || !expectedConversationKey || !clientMid || !serverMid) return false

    const selected = getSelectedConversationIdentity(root)
    if (!selected || selected.bossId !== expectedBossId
        || selected.conversationKey !== expectedConversationKey) return false

    const conversation = root.querySelector('.chat-conversation')
    if (!conversation) return false
    const candidates = Array.from(conversation.querySelectorAll('*')).filter(element => {
        const text = normalizeText((element as HTMLElement).innerText || element.textContent)
        return text.includes(normalizedContent)
    })
    return candidates.some(candidate => {
        let current: Element | null = candidate
        for (let depth = 0; current && current !== conversation && depth < 6; depth++, current = current.parentElement) {
            const text = normalizeText((current as HTMLElement).innerText || current.textContent)
            // Keep the receipt structurally close to this exact outgoing bubble. Climbing
            // to the whole conversation would let another message's receipt satisfy it.
            const receipt = Array.from(current.querySelectorAll('*')).some(child =>
                /^(?:\[)?(?:送达|已读)(?:\])?$/.test(normalizeText((child as HTMLElement).innerText || child.textContent))
            )
            if (receipt && text.includes(normalizedContent) && text.length <= normalizedContent.length + 160) {
                return true
            }
        }
        return false
    })
}

export function reconcileDeliveryAuditFromDom(): DeliveryAuditEntry[] {
    const entries = readDeliveryAudit()
    let changed = false
    const changedEntries: DeliveryAuditEntry[] = []
    const now = Date.now()
    for (const entry of entries) {
        if (entry.status === 'receipt' || entry.status !== 'acknowledged'
            || !entry.bossId || !entry.conversationKey || !entry.clientMid || !entry.serverMid
            || !hasBossDeliveryReceipt(entry.content, {
                bossId: entry.bossId,
                conversationKey: entry.conversationKey,
                clientMid: entry.clientMid,
                serverMid: entry.serverMid,
            })) continue
        entry.status = 'receipt'
        entry.acknowledgedAt = entry.acknowledgedAt || now
        entry.receiptAt = now
        entry.updatedAt = now
        delete entry.lastError
        changed = true
        changedEntries.push(entry)
    }
    if (changed) {
        writeDeliveryAudit(entries)
        changedEntries.forEach(reportDeliveryAudit)
    }
    return entries
}

export function backfillVisibleGreetingReceipts(content: string): DeliveryAuditEntry[] {
    void content
    // Historical DOM rows do not expose the outgoing clientMid/serverMid pair. They
    // remain useful to a human, but can never be promoted to authoritative receipts.
    return readDeliveryAudit()
}
