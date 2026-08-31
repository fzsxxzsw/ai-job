import assert from 'node:assert/strict'
import test from 'node:test'

import {createClientMidGenerator} from './clientMid.ts'

test('creates distinct increasing clientMid values inside the same millisecond', () => {
    const generate = createClientMidGenerator(() => 1_800_000_000_000)
    const ids = [generate(), generate(), generate()]

    assert.equal(new Set(ids).size, 3)
    assert.ok(BigInt(ids[0]) < BigInt(ids[1]))
    assert.ok(BigInt(ids[1]) < BigInt(ids[2]))
})

test('moves forward with the clock but never moves backwards', () => {
    const times = [2_000, 2_010, 1_990]
    const generate = createClientMidGenerator(() => times.shift() ?? 1_990)
    const ids = [generate(), generate(), generate()].map(BigInt)

    assert.ok(ids[1] > ids[0])
    assert.equal(ids[2], ids[1] + 1n)
})
