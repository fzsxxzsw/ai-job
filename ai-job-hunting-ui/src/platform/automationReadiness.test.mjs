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
const {deliveryRunAuthorized} = module.exports

test('a normally completed scan keeps its final LangGraph actions executable', () => {
    assert.equal(deliveryRunAuthorized({isActive: false, status: 'completed', stopRequested: false}, false, false), true)
})

test('an explicit stop or risk circuit still revokes delivery authorization', () => {
    assert.equal(deliveryRunAuthorized({isActive: true, status: 'running', stopRequested: true}, false, false), false)
    assert.equal(deliveryRunAuthorized({isActive: true, status: 'running', stopRequested: false}, true, false), false)
    assert.equal(deliveryRunAuthorized({isActive: true, status: 'running', stopRequested: false}, false, true), false)
})
