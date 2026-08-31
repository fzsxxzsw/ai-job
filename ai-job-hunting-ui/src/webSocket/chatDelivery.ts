export type ChatDeliveryConfirmation = {
    clientMid: string,
    serverMid: string,
}

export const CHAT_BRIDGE_READY_EVENT = 'ai-job-helper:chat-bridge-ready'

export function normalizeProtocolId(value: unknown): string {
    if (value == null) return ''
    let normalized = ''
    try {
        normalized = String((value as any)?.toString?.() ?? value).trim()
    } catch (_) {
        return ''
    }
    if (!/^\d+$/.test(normalized)) return ''
    try {
        return BigInt(normalized) > 0n ? normalized : ''
    } catch (_) {
        return ''
    }
}

function asArray(value: unknown): any[] {
    if (!value) return []
    return Array.isArray(value) ? value : [value]
}

function isObject(value: unknown): value is Record<string, any> {
    return !!value && typeof value === 'object'
}

function hasProtocolCollections(value: unknown): boolean {
    if (!isObject(value) || Array.isArray(value)) return false
    return value.messageSync != null || value.messageSyncs != null || value.messages != null
}

function unwrapDeliveryEnvelope(value: any): any {
    let current = value
    const visited = new Set<any>()
    for (let depth = 0; depth < 6; depth++) {
        if (!isObject(current) || Array.isArray(current) || hasProtocolCollections(current)
            || visited.has(current)) return current
        const hasDirectIdentity = current.clientMid != null || current.clientMID != null
            || current.clientMessageId != null || current.cmid != null
        if (hasDirectIdentity) return current
        visited.add(current)
        const key = ['data', 'result', 'payload'].find(candidate => current[candidate] != null)
        if (!key) return current
        current = current[key]
    }
    return current
}

function firstProtocolId(source: any, fields: string[]): string {
    for (const field of fields) {
        const normalized = normalizeProtocolId(source?.[field])
        if (normalized) return normalized
    }
    return ''
}

function extractConfirmation(candidate: any): ChatDeliveryConfirmation | undefined {
    const clientMid = firstProtocolId(candidate,
        ['clientMid', 'clientMID', 'clientMessageId', 'cmid'])
    const serverMid = firstProtocolId(candidate,
        ['serverMid', 'serverMID', 'mid', 'msgId', 'messageId'])
    // Locally encoded outbound messages use mid === cmid; that is not an ACK.
    if (!clientMid || !serverMid || clientMid === serverMid) return undefined
    return {clientMid, serverMid}
}

/**
 * BOSS normally acknowledges an outgoing cmid through messageSync. Some builds
 * instead echo the accepted message with cmid=client id and mid=server id.
 */
export function extractDeliveryConfirmations(protocol: any): ChatDeliveryConfirmation[] {
    const confirmations: ChatDeliveryConfirmation[] = []
    const source = unwrapDeliveryEnvelope(protocol)
    const candidates = Array.isArray(source)
        ? source
        : hasProtocolCollections(source)
            ? [
                ...asArray(source?.messageSync ?? source?.messageSyncs),
                ...asArray(source?.messages),
            ]
            : asArray(source)
    for (const candidate of candidates) {
        const confirmation = extractConfirmation(candidate)
        if (confirmation) confirmations.push(confirmation)
    }
    return Array.from(new Map(confirmations.map(item => [item.clientMid, item])).values())
}
