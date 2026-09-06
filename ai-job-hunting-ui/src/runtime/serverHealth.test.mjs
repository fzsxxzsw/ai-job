import test from 'node:test'
import assert from 'node:assert/strict'
import {createHealthMonitor, normalizeServerUrl, connectionPresentation} from './serverHealth.ts'

const response = (body = {status: 'UP'}, status = 200) => ({ok: status === 200, status, json: async () => body})
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b}); return {promise,resolve,reject} }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
function fixture(fetcher, extra = {}) {
    let url = 'http://127.0.0.1:9100/'
    const updates = []
    const monitor = createHealthMonitor({getUrl: () => url, onChange: s => updates.push(s), fetcher, ...extra})
    return {monitor, updates, switchUrl(value) { url=value; monitor.invalidate() }}
}
test('normalizes missing slash and rejects credentials or unsupported schemes', () => {
    assert.equal(normalizeServerUrl(' http://127.0.0.1:9100/api?x=1#y '), 'http://127.0.0.1:9100/api/')
    assert.throws(() => normalizeServerUrl('file:///x'))
    assert.throws(() => normalizeServerUrl('http://name:password@127.0.0.1:9100'))
})
test('checking is never mislabeled offline', () => {
    assert.equal(connectionPresentation('checking').label,'检查中')
    assert.equal(connectionPresentation('online').label,'在线')
})
test('health GET omits credentials, has abort signal, and validates body', async () => {
    const f=fixture(async (url, opts) => {
        assert.equal(String(url),'http://127.0.0.1:9100/actuator/health')
        assert.equal(opts.method,'GET'); assert.equal(opts.credentials,'omit'); assert.ok(opts.signal)
        return response()
    })
    assert.equal(await f.monitor.check(),true)
    assert.equal(f.monitor.getState().status,'online'); f.monitor.stop()
})
test('HTTP 200 but DOWN is not online', async () => {
    const f=fixture(async () => response({status:'DOWN'}))
    assert.equal(await f.monitor.check(),false); assert.equal(f.monitor.getState().status,'offline'); f.monitor.stop()
})
test('recovery clears stale error after a failed check', async () => {
    let online=false
    const f=fixture(async () => {if (!online) throw new TypeError('failed'); return response()})
    assert.equal(await f.monitor.check(),false)
    online=true; assert.equal(await f.monitor.check(),true)
    assert.equal(f.monitor.getState().lastError,''); f.monitor.stop()
})
test('concurrent same-server checks share one request', async () => {
    const d=deferred(); let count=0
    const f=fixture(() => {count++;return d.promise})
    const a=f.monitor.check(), b=f.monitor.check()
    assert.equal(a,b); assert.equal(count,1); d.resolve(response()); assert.equal(await a,true); f.monitor.stop()
})
test('old failure cannot overwrite a newer-server success', async () => {
    const old=deferred(); let count=0
    const f=fixture(() => ++count===1 ? old.promise : Promise.resolve(response()))
    const a=f.monitor.check(); f.switchUrl('http://127.0.0.1:9200/')
    assert.equal(await f.monitor.check(),true)
    old.reject(new TypeError('old request failed')); assert.equal(await a,false)
    assert.equal(f.monitor.getState().status,'online'); f.monitor.stop()
})
test('deadline terminates a fetch that ignores AbortSignal', async () => {
    const f=fixture(() => new Promise(() => {}), {timeoutMs:15})
    assert.equal(await f.monitor.check(),false)
    assert.match(f.monitor.getState().lastError,/超时/); assert.equal(f.monitor.getState().isChecking,false); f.monitor.stop()
})
test('deadline also covers a response body that never finishes', async () => {
    const f=fixture(async () => ({ok:true,status:200,json:() => new Promise(() => {})}), {timeoutMs:15})
    assert.equal(await f.monitor.check(),false); f.monitor.stop()
})
test('polling recovers without a click and stop removes its timer', async () => {
    let online=false, calls=0
    const f=fixture(async () => {calls++;if (!online) throw new TypeError('offline');return response()}, {pollMs:15})
    f.monitor.start(); await sleep(8); assert.equal(f.monitor.getState().status,'offline')
    online=true; await sleep(40); assert.equal(f.monitor.getState().status,'online')
    f.monitor.stop(); const total=calls; await sleep(40); assert.equal(calls,total)
})
test('quiet polling does not temporarily turn online into offline/checking', async () => {
    let next=async () => response()
    const f=fixture(() => next())
    await f.monitor.check(); const d=deferred(); next=() => d.promise
    const task=f.monitor.check(false)
    assert.equal(f.monitor.getState().status,'online'); assert.equal(f.monitor.getState().isChecking,true)
    d.resolve(response()); await task; f.monitor.stop()
})
test('poll start is idempotent and disposal ignores late completion', async () => {
    const d=deferred(); let calls=0
    const f=fixture(() => {calls++;return d.promise})
    f.monitor.start(); f.monitor.start(); assert.equal(calls,1)
    f.monitor.stop(); const n=f.updates.length; d.resolve(response()); await sleep(5)
    assert.equal(f.updates.length,n)
})
