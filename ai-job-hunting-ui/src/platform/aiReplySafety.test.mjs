import assert from 'node:assert/strict'
import test from 'node:test'
import {
    EMPTY_AI_REPLY_RETRY_DELAY_MS,
    EMPTY_AI_REPLY_WARNING,
    normalizeSendableAiReply,
} from './aiReplySafety.ts'

test('empty and whitespace-only AI replies are not sendable', () => {
    for (const value of [undefined, null, {}, '', '   ', '\n\t', '\u00a0', '\u200b\ufeff']) {
        assert.equal(normalizeSendableAiReply(value), null)
    }
})

test('visible AI replies are trimmed and remain sendable', () => {
    assert.equal(normalizeSendableAiReply('  您好，可以继续沟通。  '), '您好，可以继续沟通。')
    assert.equal(normalizeSendableAiReply('\u200b您好\u200b'), '\u200b您好\u200b')
})

test('empty-reply retry metadata is fixed and contains no message identity', () => {
    assert.equal(EMPTY_AI_REPLY_RETRY_DELAY_MS, 15_000)
    assert.equal(EMPTY_AI_REPLY_WARNING, 'AI坐席返回空文本，已阻止发送并保留未读，将在15秒后重试')
})
