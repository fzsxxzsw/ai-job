export const EMPTY_AI_REPLY_RETRY_DELAY_MS = 15_000

export const EMPTY_AI_REPLY_WARNING =
    'AI坐席返回空文本，已阻止发送并保留未读，将在15秒后重试'

const INVISIBLE_FORMAT_CHARACTERS = /[\u200B-\u200D\u2060\uFEFF]/g

/**
 * Return a trimmed, sendable AI text reply. Null means that no visible text
 * exists and the inbound message must remain unread for a later retry.
 */
export function normalizeSendableAiReply(answerContent: unknown): string | null {
    if (typeof answerContent !== 'string') return null

    const trimmed = answerContent.trim()
    const visibleText = trimmed.replace(INVISIBLE_FORMAT_CHARACTERS, '').trim()
    return visibleText.length > 0 ? trimmed : null
}
