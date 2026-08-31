import assert from 'node:assert/strict'
import test from 'node:test'
import {
    calculatePushCooldownMs,
    SAFE_DEFAULT_PUSH_INTERVAL_SECONDS,
    SAFE_MIN_PUSH_INTERVAL_SECONDS,
} from './safetyLimits.ts'

test('allows a three-second minimum while retaining the fifteen-second default', () => {
    assert.equal(SAFE_MIN_PUSH_INTERVAL_SECONDS, 3)
    assert.equal(SAFE_DEFAULT_PUSH_INTERVAL_SECONDS, 15)
})

test('does not delay the first application when there is no previous push', () => {
    assert.equal(calculatePushCooldownMs(0, 15, 100_000), 0)
})

test('waits only for the remaining part of the configured cooldown', () => {
    assert.equal(calculatePushCooldownMs(100_000, 15, 106_000), 9_000)
    assert.equal(calculatePushCooldownMs(100_000, 15, 115_000), 0)
})

test('still respects a user-configured interval above the minimum', () => {
    assert.equal(calculatePushCooldownMs(100_000, 30, 110_000), 20_000)
})
