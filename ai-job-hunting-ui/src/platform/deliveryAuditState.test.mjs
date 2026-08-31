import assert from 'node:assert/strict'
import test from 'node:test'
import {hasMaterialDeliveryAuditChange} from './deliveryAuditState.ts'

const state = {
    status: 'failed',
    jobTitle: 'Example role',
    content: 'hello',
    attempts: 3,
    lastError: 'retry limit reached',
    bossId: '7',
    conversationKey: 'boss:security',
    clientMid: 'client-1',
    serverMid: undefined,
}

test('identical audit polling is a no-op', () => {
    assert.equal(hasMaterialDeliveryAuditChange(state, {...state}), false)
})

test('a real delivery transition remains reportable', () => {
    assert.equal(hasMaterialDeliveryAuditChange(state, {
        ...state,
        status: 'acknowledged',
        serverMid: 'server-1',
        lastError: undefined,
    }), true)
})
