export type ManualOutgoingEchoOptions = {
    automatedClientMid?: boolean,
    configuredGreeting?: string,
    endChar?: string,
    now?: number,
    maxAgeMs?: number,
}

function normalizeMessageId(value: unknown): string {
    if (value == null) return ''
    try {
        const normalized = String((value as any)?.toString?.() ?? value).trim()
        return /^\d+$/.test(normalized) && BigInt(normalized) > 0n ? normalized : ''
    } catch (_) {
        return ''
    }
}

/**
 * GeekChatCore publishes a locally-created outgoing message before the server
 * replaces its mid. Historical messages and server echoes have a different
 * mid/cmid pair and must not be mistaken for a fresh manual intervention.
 */
export function isLocalOutgoingEcho(
    message: any,
    now = Date.now(),
    maxAgeMs = 60_000,
): boolean {
    if (!message || message.offline === true) return false
    const clientMid = normalizeMessageId(message.cmid ?? message.clientMid)
    const messageMid = normalizeMessageId(message.mid ?? message.messageId)
    if (clientMid && clientMid === messageMid) return true

    // Some GeekChatCore builds publish only the server-accepted echo, where
    // mid differs from cmid. A fresh timestamp distinguishes it from history.
    if (!messageMid) return false
    const rawTime = Number(message.time ?? message.timestamp ?? message.createdAt)
    if (!Number.isFinite(rawTime) || rawTime <= 0) return false
    const timestamp = rawTime < 1_000_000_000_000 ? rawTime * 1_000 : rawTime
    return Math.abs(now - timestamp) <= Math.max(0, maxAgeMs)
}

export function shouldHandleManualOutgoingEcho(
    message: any,
    text: unknown,
    options: ManualOutgoingEchoOptions = {},
): boolean {
    if (!isLocalOutgoingEcho(message, options.now, options.maxAgeMs)
        || options.automatedClientMid) return false
    const normalizedText = String(text ?? '')
    if (options.endChar && normalizedText.endsWith(options.endChar)) return false
    if (options.configuredGreeting && normalizedText === options.configuredGreeting) return false
    return true
}
