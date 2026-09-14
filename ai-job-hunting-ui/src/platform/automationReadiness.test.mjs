import assert from 'node:assert/strict'
import test from 'node:test'
import {createRequire} from 'node:module'
import vm from 'node:vm'
import {build} from 'esbuild'

const bundled = await build({
    entryPoints: [new URL('./automationReadiness.ts', import.meta.url).pathname.replace(/^\/(.:)/, '$1')],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
})
const module = {exports: {}}
vm.runInNewContext(bundled.outputFiles[0].text, {
    module,
    exports: module.exports,
    require: createRequire(import.meta.url),
})
const {deliveryRunAuthorized, COMPLETED_DELIVERY_GRACE_MS} = module.exports
const startedAt = new Date(2026, 8, 15, 10, 0).getTime()
const base = {runId: 'run-A', startedAt, isActive: true, status: 'running', stopRequested: false}

test('current run permits actions, but explicit stop, risk and missing identity revoke it', () => {
    assert.equal(deliveryRunAuthorized(base, false, false, startedAt + 1000), true)
    assert.equal(deliveryRunAuthorized({...base, runId: ''}, false, false, startedAt + 1000), false)
    assert.equal(deliveryRunAuthorized({...base, stopRequested: true}, false, false, startedAt + 1000), false)
    assert.equal(deliveryRunAuthorized(base, true, false, startedAt + 1000), false)
    assert.equal(deliveryRunAuthorized(base, false, true, startedAt + 1000), false)
})

test('naturally completed run has only a bounded same-day in-memory continuation', () => {
    const completedAt = startedAt + 10_000
    const completed = {...base, isActive: false, status: 'completed', completedAt}
    assert.equal(deliveryRunAuthorized(completed, false, false, completedAt), true)
    assert.equal(deliveryRunAuthorized(completed, false, false, completedAt + COMPLETED_DELIVERY_GRACE_MS), true)
    assert.equal(deliveryRunAuthorized(completed, false, false, completedAt + COMPLETED_DELIVERY_GRACE_MS + 1), false)
    assert.equal(deliveryRunAuthorized({...completed, completedAt: undefined}, false, false, completedAt + 1), false)
    assert.equal(deliveryRunAuthorized({...completed, status: 'blocked'}, false, false, completedAt + 1), false)
})

test('no run can continue into another local calendar day', () => {
    const nearMidnight = new Date(2026, 8, 15, 23, 59, 30).getTime()
    const atMidnight = new Date(2026, 8, 16, 0, 0, 0).getTime()
    assert.equal(deliveryRunAuthorized({...base, startedAt: nearMidnight}, false, false, atMidnight), false)
    assert.equal(deliveryRunAuthorized({...base, isActive: false, status: 'completed', startedAt: nearMidnight,
        completedAt: nearMidnight + 1}, false, false, atMidnight), false)
})
