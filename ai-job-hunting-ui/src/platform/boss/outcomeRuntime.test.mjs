import assert from 'node:assert/strict'
import test from 'node:test'
import {createRequire} from 'node:module'
import vm from 'node:vm'
import {build} from 'esbuild'

const require = createRequire(import.meta.url)
const bundle = await build({entryPoints: [new URL('./outcomeRuntime.ts', import.meta.url).pathname.replace(/^\/(.:)/, '$1')],
    bundle: true, write: false, platform: 'node', format: 'cjs', plugins: [{name: 'synthetic-gm', setup(builder) {
        builder.onResolve({filter: /^\$$/}, () => ({path: 'gm', namespace: 'fixture'}))
        builder.onLoad({filter: /.*/, namespace: 'fixture'}, () => ({contents: 'export const GM_getValue=()=>"http://127.0.0.1:9100"', loader: 'js'}))
    }}]})
const A = {uid: '81', encryptBossId: 'BossA', securityId: 'SecA', encryptJobId: 'JobA'}
const B = {uid: '82', encryptBossId: 'BossB', securityId: 'SecB', encryptJobId: 'JobB'}

function environment({selected = A, panelSource = A, messagePeer = '81', messageOwned = true, mutateDuringRead = false} = {}) {
    let now = 1788757200000
    const listeners = new Set(), events = [], views = []
    const selectedElement = {__vue__: {source: selected}, parentElement: null}
    const raw = {mid: '90071992547409933', time: null, from: {uid: messagePeer}, to: {uid: '40'}, body: {text: 'A 公司：很抱歉，暂不合适'}}
    const row = {className: 'item-friend', __vue__: messageOwned ? {message: raw} : {}, closest: () => null,
        getAttribute: key => key === 'data-mid' ? raw.mid : null, querySelector: () => ({textContent: raw.body.text})}
    const panel = {__vue__: {source: panelSource}, querySelectorAll: () => {
        if (mutateDuringRead) panel.__vue__.source = B
        return [row]
    }}
    const root = {body: {}, querySelector: selector => selector === '.chat-conversation' ? panel : selectedElement}
    const browser = {_PAGE: {uid: '40'}, location: {origin: 'https://www.zhipin.com'}, setInterval: () => 0, setTimeout,
        addEventListener: (type, listener) => { if (type === 'message') listeners.add(listener) },
        removeEventListener: (_type, listener) => listeners.delete(listener), postMessage(request) {
            if (request.payload.kind === 'enqueue') events.push(...request.payload.observations)
            queueMicrotask(() => {
                const response = {protocol: request.protocol, source: 'ai-job-helper-isolated', target: 'ai-job-helper-main',
                    requestId: request.requestId, ok: true, operation: 'outcomes-response',
                    payload: {scope: 'synthetic-scope', items: [], pending: 0, blocked: 0, expired: 0, error: '', updatedAt: 0, anchors: []}}
                for (const listener of [...listeners]) listener({source: browser, origin: browser.location.origin, data: response})
            })
        }}
    const module = {exports: {}}
    const globals = {module, exports: module.exports, require, window: browser, crypto, TextEncoder, structuredClone, clearTimeout,
        setTimeout, queueMicrotask, Date: class extends Date {static now() {return now}},
        localStorage: {getItem: key => key === 'Authorization' ? 'synthetic-token' : null},
        MutationObserver: class {observe() {} disconnect() {}}, document: root}
    vm.runInNewContext(bundle.outputFiles[0].text, globals)
    const runtime = module.exports
    runtime.subscribeOutcomeReports(value => views.push(value))
    return {runtime, root, events, views, raw, advance: amount => { now += amount },
        flush: () => new Promise(resolve => setTimeout(resolve, 40))}
}

test('runtime reproduction: selected B with still-rendered A panel never assigns A rejection to B', async () => {
    const rig = environment({selected: B, panelSource: A})
    const stop = rig.runtime.watchCurrentOutcomeConversation(rig.root)
    await rig.flush(); stop()
    assert.deepEqual(rig.events, [])
})
test('runtime withholds DOM evidence without message-owned identities or when panel changes during extraction', async () => {
    for (const options of [{messageOwned: false}, {messagePeer: '82'}, {mutateDuringRead: true}]) {
        const rig = environment(options)
        const stop = rig.runtime.watchCurrentOutcomeConversation(rig.root)
        await rig.flush(); stop()
        assert.deepEqual(rig.events, [])
    }
})
test('matching panel/message-owned identity emits real row sender and null missing platform time', async () => {
    const rig = environment()
    const stop = rig.runtime.watchCurrentOutcomeConversation(rig.root)
    await rig.flush(); stop()
    assert.equal(rig.events.length, 1)
    assert.equal(rig.events[0].encryptJobId, 'JobA')
    assert.equal(rig.events[0].bossId, '81')
    assert.equal(rig.events[0].messages[0].sentAt, null)
})
test('first unbound HR event stays visible until exact panel message proof, then preserves original observedAt', async () => {
    const rig = environment()
    rig.runtime.observeOutcomeMessage(rig.raw, rig.raw.body.text, '40')
    assert.equal(rig.views.at(-1).unbound, 1)
    rig.advance(1000)
    rig.runtime.observeOutcomeContacts([A], '40', rig.runtime.captureOutcomeContext())
    assert.equal(rig.views.at(-1).unbound, 1)
    const stop = rig.runtime.watchCurrentOutcomeConversation(rig.root)
    await rig.flush(); stop()
    assert.equal(rig.views.at(-1).unbound, 0)
    assert.equal(rig.events.length, 1)
    assert.equal(rig.events[0].observedAt, 1788757200000)
    assert.equal(rig.events[0].bindingObservedAt, 1788757201000)
    assert.equal(rig.events[0].messages[0].sentAt, null)
})
test('live peer-lookup association replays only its exact original message and retains observation time', async () => {
    const rig=environment()
    rig.runtime.observeOutcomeMessage(rig.raw,rig.raw.body.text,'40')
    rig.advance(1000)
    const contact={bossId:A.uid,encryptJobId:A.encryptJobId,encryptBossId:A.encryptBossId,securityId:A.securityId}
    rig.runtime.observeOutcomePeerAssociation(contact,rig.raw,'40',rig.runtime.captureOutcomeContext(),()=>true)
    await rig.flush()
    assert.equal(rig.events.length,1)
    assert.equal(rig.events[0].observedAt,1788757200000);assert.equal(rig.events[0].bindingObservedAt,1788757201000)
    assert.equal(rig.events[0].messages[0].sentAt,null)
    assert.equal(rig.events[0].coverage,null,'peer identity is never terminal coverage proof')
})
test('superseded or foreign-peer lookup cannot backfill an old HR message', async () => {
    for (const [peer,current] of [['81',false],['82',true]]) {
        const rig=environment();rig.runtime.observeOutcomeMessage(rig.raw,rig.raw.body.text,'40');rig.advance(1000)
        rig.runtime.observeOutcomePeerAssociation({bossId:peer,encryptJobId:A.encryptJobId,encryptBossId:A.encryptBossId,securityId:A.securityId},rig.raw,'40',rig.runtime.captureOutcomeContext(),()=>current)
        await rig.flush();assert.equal(rig.events.length,0);assert.equal(rig.views.at(-1).unbound,1)
    }
})
