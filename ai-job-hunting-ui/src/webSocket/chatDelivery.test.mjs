import assert from 'node:assert/strict'
import test from 'node:test'
import {extractDeliveryConfirmations, normalizeProtocolId} from './chatDelivery.ts'

test('normalizes protobuf Long-like ids without losing precision', () => {
    const longLike = {toString: () => '70432568684999'}
    assert.equal(normalizeProtocolId(longLike), '70432568684999')
    assert.equal(normalizeProtocolId('0'), '')
    assert.equal(normalizeProtocolId('not-an-id'), '')
})

test('extracts messageSync acknowledgement and ignores a local mid=cmid packet', () => {
    assert.deepEqual(extractDeliveryConfirmations({
        messageSync: [{clientMid: {toString: () => '101'}, serverMid: {toString: () => '9001'}}],
        messages: [{cmid: '102', mid: '102'}],
    }), [{clientMid: '101', serverMid: '9001'}])
})

test('accepts server message echo as acknowledgement fallback', () => {
    assert.deepEqual(extractDeliveryConfirmations({
        messages: [{cmid: '103', mid: '9003'}],
    }), [{clientMid: '103', serverMid: '9003'}])
})

test('accepts direct, array, complete protocol, and nested envelope ACK aliases', () => {
    const cases = [
        {
            payload: {clientMessageId: '201', msgId: '9201'},
            expected: {clientMid: '201', serverMid: '9201'},
        },
        {
            payload: [{clientMID: '202', messageId: '9202'}],
            expected: {clientMid: '202', serverMid: '9202'},
        },
        {
            payload: {type: 5, messageSyncs: [{cmid: '203', serverMID: '9203'}]},
            expected: {clientMid: '203', serverMid: '9203'},
        },
        {
            payload: {data: {result: {payload: {clientMid: '204', serverMid: '9204'}}}},
            expected: {clientMid: '204', serverMid: '9204'},
        },
        {
            payload: {messages: [{clientMID: '205', msgId: '9205'}]},
            expected: {clientMid: '205', serverMid: '9205'},
        },
    ]

    for (const {payload, expected} of cases) {
        assert.deepEqual(extractDeliveryConfirmations(payload), [expected])
    }
})

test('does not treat aliased local client and server ids as an ACK', () => {
    assert.deepEqual(extractDeliveryConfirmations({
        clientMessageId: '301',
        messageId: '301',
    }), [])
})
