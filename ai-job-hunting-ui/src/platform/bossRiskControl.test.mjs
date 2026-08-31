import assert from 'node:assert/strict'
import test, {beforeEach} from 'node:test'
import {
    clearBossRiskCircuit,
    detectBossRiskSignal,
    getBossRiskStop,
    tripBossRiskCircuit,
} from './bossRiskControl.ts'

const storage = new Map()
globalThis.localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key),
}

beforeEach(() => {
    storage.clear()
    clearBossRiskCircuit()
})

test('recognizes the explicit BOSS account abnormal response', () => {
    const signal = detectBossRiskSignal({data: {message: '您的账户存在异常行为。'}})
    assert.match(signal?.reason || '', /账户存在异常行为/)
})

test('does not mistake an ordinary business failure for account risk', () => {
    assert.equal(detectBossRiskSignal({data: {code: 1, message: '该职位已关闭'}}), null)
})

test('persists a risk stop until the user explicitly clears it', () => {
    const state = tripBossRiskCircuit({response: {status: 429}})
    assert.equal(state?.status, 429)
    assert.equal(getBossRiskStop()?.status, 429)

    assert.equal(clearBossRiskCircuit(), true)
    assert.equal(getBossRiskStop(), null)
})
