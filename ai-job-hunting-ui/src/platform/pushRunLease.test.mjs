import assert from 'node:assert/strict'
import test from 'node:test'

import {
    clearPushRunLease,
    createPushRunLease,
    PUSH_RUN_LEASE_KEY,
    PUSH_RUN_LEASE_MS,
    readPushRunLease,
    writePushRunLease,
} from './pushRunLease.ts'

const identity = {
    bossAccountUid: 'boss-account',
    serverBaseUrl: 'http://127.0.0.1:9100',
    automationPolicyFingerprint: 'policy-A',
}
const memory = () => {
    const values = new Map()
    return {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: key => values.delete(key),
        values,
    }
}

test('an exact same-day lease resumes with the policy fingerprint', () => {
    const storage = memory()
    const now = new Date(2026, 8, 17, 10, 0).getTime()
    const lease = writePushRunLease(storage, identity, now)
    assert.equal(readPushRunLease(storage, identity, now + 1_000)?.issuedAt, now)
    assert.equal(storage.getItem(PUSH_RUN_LEASE_KEY).includes('policy-A'), true)
    assert.ok(lease.expiresAt <= now + PUSH_RUN_LEASE_MS)
})

test('expiry, local-day rollover and identity drift revoke rather than resume', () => {
    const now = new Date(2026, 8, 17, 23, 59).getTime()
    for (const [name, currentIdentity, readAt] of [
        ['account', {...identity, bossAccountUid: 'other'}, now + 1],
        ['server', {...identity, serverBaseUrl: 'http://127.0.0.1:9200'}, now + 1],
        ['policy', {...identity, automationPolicyFingerprint: 'policy-B'}, now + 1],
        ['day', identity, new Date(2026, 8, 18, 0, 0).getTime()],
    ]) {
        const storage = memory()
        storage.setItem(PUSH_RUN_LEASE_KEY, JSON.stringify(createPushRunLease(identity, now)))
        assert.equal(readPushRunLease(storage, currentIdentity, readAt), null, name)
        assert.equal(storage.getItem(PUSH_RUN_LEASE_KEY), null, name)
    }
})

test('manual stop clears the lease', () => {
    const storage = memory()
    writePushRunLease(storage, identity, Date.now())
    clearPushRunLease(storage)
    assert.equal(storage.getItem(PUSH_RUN_LEASE_KEY), null)
})
