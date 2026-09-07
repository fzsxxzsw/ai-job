import assert from 'node:assert/strict'
import test from 'node:test'
import {createUnifiedAutomation} from './unifiedAutomation.ts'
import {automationActionLabel, automationJobLabel, outcomeSubscriptionLabel} from './automationPresentation.ts'

class MemoryStorage {
    values = new Map()
    get length() {return this.values.size}
    key(index) {return [...this.values.keys()][index] ?? null}
    getItem(key) {return this.values.get(key) ?? null}
    setItem(key, value) {this.values.set(key, value)}
    removeItem(key) {this.values.delete(key)}
}
const clone = value => structuredClone(value)
const action = (kind = 'SEND_TEXT', id = 'action-1') => ({actionId: id, jobId: 'job-1', kind, status: 'QUEUED', sequence: 1,
    clientMid: null, payloadHash: 'a'.repeat(64), approvalStatus: 'NOT_REQUIRED', lastErrorCode: null,
    payload: {encryptJobId: 'job-A', bossId: '81', conversationKey: 'BossA:SecA', text: '合成回复'}})
const makeJob = actions => ({jobId: 'job-1', kind: 'REPLY', status: 'WAITING_EXECUTION', phase: 'WAITING_EXECUTION',
    revision: 1, inputHash: 'b'.repeat(64), createdAt: 1, updatedAt: 1, lastErrorCode: null, decision: {code: 'SEND', reason: '合成'},
    actions, result: null, phaseHistory: []})
function rig({actions = [action()], storage = new MemoryStorage(), executorId = 'executor-A', shared, perform, prepare, ready, acknowledged, acknowledgement, onDispatch, onGetJob} = {}) {
    const state = shared || {job: makeJob(actions), calls: [], statusEnabled: true, failStatus: false}
    let scope = 'scope-A', allowed = true, now = 1788757200000, effects = 0
    const api = createUnifiedAutomation({storage, executorId, now: () => now, scope: () => scope, account: () => '40',
        flags: () => ({replyEnabled: allowed, deliveryEnabled: allowed}), clientMid: () => '90071992547409931', acknowledgement,
        async request(path, body) {
            state.calls.push({path, body: clone(body)})
            if (path.endsWith('/status')) {
                if (state.failStatus) throw new Error('offline')
                return {contractVersion: 1, enabled: state.statusEnabled, mode: state.statusEnabled ? 'LANGGRAPH' : 'LEGACY'}
            }
            if (path.includes('/executors/')) return {authorizationRevision: 1}
            if (path === '/api/job/automation/jobs' || path.endsWith('/jobs/job-1')) {if(path.endsWith('/jobs/job-1'))await onGetJob?.();return clone(state.job)}
            if (path.includes('/jobs?')) return [clone(state.job)]
            if (path.endsWith('/actions/claim')) {
                const value = state.job.actions.find(item => item.status === 'QUEUED' && ['NOT_REQUIRED', 'APPROVED'].includes(item.approvalStatus))
                if (!value) return null
                value.status = 'LEASED'; value.executorId = body.executorId
                return {...clone(value), leaseToken: 'lease'.repeat(8), leaseUntil: now + 30000, authorizationRevision: 1}
            }
            const value = state.job.actions.find(item => path.includes('/' + item.actionId + '/'))
            if (path.endsWith('/dispatch')) {
                assert.equal(value.status, 'LEASED'); value.status = 'DISPATCHING'; value.clientMid = body.clientMid
                onDispatch?.()
                return {actionId: value.actionId, status: value.status, dispatchToken: 'dispatch'.repeat(5), clientMid: body.clientMid}
            }
            if (path.endsWith('/receipt')) {
                assert.equal(body.executorId, value.executorId)
                assert.equal(body.clientMid, value.clientMid)
                value.status = body.status
                return clone(value)
            }
            if (path.endsWith('/binding')) return clone(state.job)
            throw new Error('Unexpected API path ' + path)
        },
        execution: {
            ready: (...args) => allowed && (ready?.(...args) ?? true), prepare,
            async perform(context, selected, mid) {
                effects++
                assert.equal(JSON.parse(storage.getItem('ai-job-unified-v1:dispatch:' + selected.actionId)).clientMid, mid, 'dispatch is durable before platform invocation')
                return perform ? perform(context, selected, mid) : {status: 'ACKNOWLEDGED', serverMid: '90071992547409999', platformCode: 0, occurredAt: now, errorCode: null}
            }, acknowledged,
        }})
    const submit = () => api.submit({requestId: 'same-mid', kind: 'REPLY', platformAccount: '40'}, {kind: 'REPLY', encryptJobId: 'job-A'})
    return {api, state, storage, submit, effects: () => effects, stop: () => {allowed = false}, switchScope: () => {scope = 'scope-B'}, advance: ms => {now += ms}}
}

test('one real dispatch is persisted before effect; duplicate submission and overlapping ticks do not resend', async () => {
    const env = rig(); await env.submit(); await env.submit()
    await Promise.all([env.api.tick(), env.api.tick(), env.api.tick()]); await env.api.tick()
    assert.equal(env.effects(), 1)
    const receipt = env.state.calls.find(call => call.path.endsWith('/receipt')).body
    assert.equal(receipt.clientMid, '90071992547409931')
    assert.equal(receipt.serverMid, '90071992547409999')
})
test('two tabs share claim authority and never execute the same action twice', async () => {
    const first = rig(); await first.submit()
    const second = rig({shared: first.state, storage: first.storage, executorId: 'executor-B'})
    await Promise.all([first.api.tick(), second.api.tick()])
    assert.equal(first.effects() + second.effects(), 1)
})
test('restart keeps an unreceipted dispatch; a late ACK uses its original executor', async () => {
    let release
    const first = rig({perform: () => new Promise(resolve => {release = resolve})}); await first.submit()
    const active = first.api.tick()
    while (!release) await new Promise(resolve => setImmediate(resolve))
    const second = rig({shared: first.state, storage: first.storage, executorId: 'executor-B'})
    await second.api.tick()
    assert.equal(first.state.calls.filter(call => call.path.endsWith('/receipt')).length, 0, 'live dispatch cannot be called interrupted')
    await second.api.acknowledge('90071992547409931', '90071992547409999')
    release({status: 'UNKNOWN', serverMid: null, occurredAt: 1788757200000, platformCode: null, errorCode: 'RECEIPT_MISSING'})
    await active
    assert.equal(first.state.job.actions[0].status, 'ACKNOWLEDGED', 'fast late ACK beats stale UNKNOWN return')
    assert.equal(second.effects(), 0)
    assert.equal(first.state.calls.find(call => call.path.endsWith('/receipt')).body.executorId, 'executor-A')
})
test('risk or pause while preparing prevents claim and any side effect', async () => {
    let env
    env = rig({prepare: async () => env.stop()}); await env.submit(); await env.api.tick()
    assert.equal(env.effects(), 0)
    assert.equal(env.state.calls.some(call => call.path.endsWith('/actions/claim')), false)
})

test('pause after server dispatch but before platform call produces explicit preflight receipt', async () => {
    let env
    env = rig({onDispatch: () => env.stop()}); await env.submit(); await env.api.tick()
    assert.equal(env.effects(), 0)
    const receipt = env.state.calls.find(call => call.path.endsWith('/receipt')).body
    assert.equal(receipt.status, 'FAILED'); assert.equal(receipt.platformCode, null)
    assert.equal(receipt.executionPhase, 'BEFORE_PLATFORM_CALL'); assert.equal(receipt.errorCode, 'AUTHORIZATION_CHANGED')
})

test('natural exact contact response binds only one ACKed application cycle and survives restart', async () => {
    const contactAction = {...action('CONTACT_JOB'), status: 'ACKNOWLEDGED'}
    const env = rig({actions: [contactAction, action('SEND_GREETING', 'greeting')]})
    const context = {kind:'APPLICATION', account:'40',runId:'run-A',encryptJobId:'job-A',greetingEnabled:true,
        job:{encryptBossId:'BossA',securityId:'SecA'},bossId:null,conversationKey:null}
    await env.api.submit({requestId:'application',kind:'APPLICATION',platformAccount:'40'},context)
    const restarted = rig({shared:env.state,storage:env.storage})
    await restarted.api.observeContact({bossId:'81',encryptJobId:'job-A',encryptBossId:'BossA',securityId:'SecA',jobTitle:'合成'},'scope-A')
    assert.equal(env.state.calls.filter(call => call.path.endsWith('/binding')).length,1)
    const saved=JSON.parse(env.storage.getItem('ai-job-unified-v1:job:job-1'))
    assert.equal(saved.context.conversationKey,'BossA:SecA')
    assert.equal(saved.context.contact.bossId,'81')
    env.storage.setItem('ai-job-unified-v1:job:ambiguous',JSON.stringify({...saved,jobId:'job-1'}))
    await restarted.api.observeContact({bossId:'81',encryptJobId:'job-A',encryptBossId:'BossA',securityId:'SecA',jobTitle:'合成'},'scope-A')
    assert.equal(env.state.calls.filter(call => call.path.endsWith('/binding')).length,1,'ambiguous cycles do not rebind')
})

test('another tab binding during a stale tick GET cannot be erased by ACK reconciliation', async () => {
    let release, pause = false
    const env=rig({actions:[{...action('CONTACT_JOB'),status:'ACKNOWLEDGED'},action('SEND_GREETING','greeting')],ready:()=>false,
        onGetJob:()=>pause?new Promise(resolve=>{release=resolve}):undefined})
    await env.api.submit({requestId:'app',kind:'APPLICATION',platformAccount:'40'}, {kind:'APPLICATION',encryptJobId:'job-A',greetingEnabled:true,job:{encryptBossId:'BossA',securityId:'SecA'}})
    pause=true;const tick=env.api.tick();while(!release)await new Promise(resolve=>setImmediate(resolve))
    const observer=rig({shared:env.state,storage:env.storage})
    await observer.api.observeContact({bossId:'81',encryptJobId:'job-A',encryptBossId:'BossA',securityId:'SecA',jobTitle:'合成'},'scope-A')
    release();await tick
    const saved=JSON.parse(env.storage.getItem('ai-job-unified-v1:job:job-1'))
    assert.equal(saved.context.contact.bossId,'81');assert.equal(saved.context.conversationKey,'BossA:SecA')
    assert.equal(JSON.parse(env.storage.getItem('ai-job-unified-v1:binding:job-1')).bossId,'81')
})
test('unknown platform result has a real observation time and never triggers resend', async () => {
    const env = rig({perform: async () => {throw new Error('network uncertainty')}})
    await env.submit(); await env.api.tick(); await env.api.tick()
    const receipt = env.state.calls.find(call => call.path.endsWith('/receipt')).body
    assert.equal(receipt.status, 'UNKNOWN'); assert.ok(receipt.occurredAt > 0); assert.equal(env.effects(), 1)
})
test('non-message dispatch uses null MID and specific platform success', async () => {
    const env = rig({actions: [action('CONTACT_JOB')], perform: async (_context, _action, mid) => {
        assert.equal(mid, null)
        return {status: 'ACKNOWLEDGED', serverMid: null, platformCode: 0, occurredAt: 1788757200000, errorCode: null}
    }})
    await env.submit(); await env.api.tick()
    assert.equal(env.state.calls.find(call => call.path.endsWith('/dispatch')).body.clientMid, null)
})
test('sensitive pending approval cannot execute; exact approved action can', async () => {
    const item = action('ACCEPT_PHONE'); item.approvalStatus = 'PENDING'
    const env = rig({actions: [item]}); await env.submit(); await env.api.tick(); assert.equal(env.effects(), 0)
    env.state.job.actions[0].approvalStatus = 'APPROVED'; await env.api.tick(); assert.equal(env.effects(), 1)
})
test('scope change isolates old pending jobs and sends no platform request', async () => {
    const env = rig(); await env.submit(); env.switchScope(); await env.api.tick(); assert.equal(env.effects(), 0)
})
test('API status failure has no legacy fallback, including before submission', async () => {
    const env = rig(); env.state.failStatus = true
    await assert.rejects(env.submit()); assert.equal(env.effects(), 0)
})
test('contact ACK follow-up runs once across restart even when association fails', async () => {
    let lookups = 0
    const env = rig({actions: [action('CONTACT_JOB')], acknowledged: () => {lookups++; throw new Error('lookup unavailable')}})
    await env.submit(); await env.api.tick(); await env.api.tick(); await env.api.tick()
    const restarted = rig({shared: env.state, storage: env.storage, acknowledged: () => lookups++})
    await restarted.api.tick(); assert.equal(lookups, 1); assert.equal(env.effects(), 1)
})
test('task presentation distinguishes no action, declined operation, failure and unknown', () => {
    assert.match(automationJobLabel({...makeJob([]), status: 'COMPLETED'}), /无需发送/)
    assert.match(automationJobLabel({...makeJob([]), status: 'FAILED'}), /失败/)
    assert.match(automationJobLabel({...makeJob([]), status: 'UNCERTAIN'}), /不会重发/)
    assert.match(automationActionLabel({...action('SEND_RESUME'), approvalStatus: 'DECLINED'}), /未发送/)
    assert.equal(outcomeSubscriptionLabel(null, 1, ''), '连接尚未确认')
    assert.equal(outcomeSubscriptionLabel({outcomes: {enabled: true}, agent: {state: 'OFFLINE'}}, 1, ''), '分析工作进程未就绪')
})
test('32 old-scope jobs cannot occupy current-scope work slots', async () => {
    const env = rig()
    for (let index=0;index<32;index++) env.storage.setItem('ai-job-unified-v1:job:old-'+index, JSON.stringify({scope:'old-scope',jobId:'old-'+index,context:{},completed:false}))
    await env.submit(); await env.api.tick(); assert.equal(env.effects(),1)
})
test('round robin progresses beyond 32 held jobs without deleting uncertain evidence', async () => {
    const storage=new MemoryStorage(), visits=[]
    for(let index=0;index<33;index++) storage.setItem('ai-job-unified-v1:job:'+index,JSON.stringify({scope:'A',jobId:String(index),context:{},completed:false}))
    const api=createUnifiedAutomation({storage,executorId:'e',scope:()=> 'A',account:()=> '40',flags:()=>({replyEnabled:true,deliveryEnabled:false}),clientMid:()=> '1',
        request:async path=> {
            if(path.endsWith('/status'))return {contractVersion:1,enabled:true,mode:'LANGGRAPH'}
            if(path.includes('/heartbeat'))return {}
            if(path.includes('/jobs?'))return []
            visits.push(path.split('/').at(-1));return {...makeJob([]),status:'UNCERTAIN'}
        },execution:{ready:()=>false,perform:async()=>{throw Error('never')}}})
    await api.tick();await api.tick()
    assert.equal(new Set(visits).size,33);assert.equal(storage.length,33)
})
test('late SDK-remapped ACK is accepted only with exact registered original-MID proof', async () => {
    let proven=false
    const env=rig({acknowledgement:()=>proven?'90071992547409999':null,perform:async()=>({status:'UNKNOWN',serverMid:null,platformCode:null,occurredAt:1788757200000,errorCode:'RECEIPT_MISSING'})})
    await env.submit();await env.api.tick()
    await env.api.acknowledge('81111111111111111','90071992547409999');assert.equal(env.state.job.actions[0].status,'UNKNOWN')
    proven=true;await env.api.acknowledge('81111111111111111','90071992547409999');assert.equal(env.state.job.actions[0].status,'ACKNOWLEDGED')
})
