import assert from 'node:assert/strict'
import test from 'node:test'

import {
    isLocalOutgoingEcho,
    shouldHandleManualOutgoingEcho,
} from './manualOutgoing.ts'

const localMessage = {
    mid: '70001',
    cmid: '70001',
    body: {type: 1, text: '你好'},
}

test('recognizes only a fresh local outgoing GeekChatCore echo', () => {
    assert.equal(isLocalOutgoingEcho(localMessage), true)
    assert.equal(isLocalOutgoingEcho({
        ...localMessage,
        mid: '90001',
        time: 1_800_000_000_000,
    }, 1_800_000_005_000), true)
    assert.equal(isLocalOutgoingEcho({
        ...localMessage,
        mid: '90001',
        time: 1_700_000_000_000,
    }, 1_800_000_005_000), false)
    assert.equal(isLocalOutgoingEcho({
        time: 1_800_000_000_000,
        body: {type: 10},
    }, 1_800_000_005_000), false)
    assert.equal(isLocalOutgoingEcho({...localMessage, offline: true}), false)
})

test('manual text is handled but known automated messages are ignored', () => {
    assert.equal(shouldHandleManualOutgoingEcho(localMessage, '我自己回复'), true)
    assert.equal(shouldHandleManualOutgoingEcho(localMessage, 'AI回复\0', {endChar: '\0'}), false)
    assert.equal(shouldHandleManualOutgoingEcho(localMessage, '自定义招呼语', {
        configuredGreeting: '自定义招呼语',
    }), false)
    assert.equal(shouldHandleManualOutgoingEcho(localMessage, '任意内容', {
        automatedClientMid: true,
    }), false)
})
