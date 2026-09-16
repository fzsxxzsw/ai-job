import assert from 'node:assert/strict'
import test from 'node:test'
import {automationRequestId, createUnifiedAutomation} from './unifiedAutomation.ts'
import {automationActionLabel, automationApprovalAvailable, automationJobLabel, outcomeSubscriptionLabel} from './automationPresentation.ts'

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
function rig({actions = [action()], storage = new MemoryStorage(), executorId = 'executor-A', shared, perform, prepare, ready, acknowledged, acknowledgement, onDispatch, onGetJob, onStatus} = {}) {
    const state = shared || {job: makeJob(actions), calls: [], statusEnabled: true, failStatus: false}
    let scope = 'scope-A', allowed = true, now = 1788757200000, effects = 0
    const api = createUnifiedAutomation({storage, executorId, now: () => now, scope: () => scope, account: () => '40',
        flags: () => ({replyEnabled: allowed, deliveryEnabled: allowed}), clientMid: () => '90071992547409931', acknowledgement,
        async request(path, body) {
            state.calls.push({path, body: clone(body)})
            if (path.endsWith('/status')) {
                await onStatus?.()
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
    env.state.job.kind = 'APPLICATION'
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
    env.state.job.kind='APPLICATION'
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

test('expired and revoked jobs explain unsent cancellation without erasing earlier ACKs', () => {
    const sent = {...action('CONTACT_JOB', 'contact'), status: 'ACKNOWLEDGED'}
    const cancelled = {...action('SEND_GREETING', 'greeting'), status: 'CANCELLED', lastErrorCode: 'AUTHORIZATION_CHANGED'}
    const revoked = {...makeJob([sent, cancelled]), status: 'CANCELLED', lastErrorCode: 'AUTHORIZATION_CHANGED'}
    assert.match(automationJobLabel(revoked), /授权已变化；部分已发送，剩余已取消（分项回执保留）/)
    assert.doesNotMatch(automationJobLabel(revoked), /本轮未发送/)
    assert.match(automationActionLabel(sent), /平台已确认/)
    assert.match(automationActionLabel(cancelled), /授权变化，未发送/)
    const expired = {...makeJob([{...cancelled, lastErrorCode: 'ACTION_EXPIRED'}]), status: 'CANCELLED', lastErrorCode: 'ACTION_EXPIRED'}
    assert.match(automationJobLabel(expired), /等待执行已超时；未发动作已取消/)
    assert.match(automationActionLabel(expired.actions[0]), /等待超时，未发送/)
})

test('cancelled pending approval stays visible but cannot be approved again', () => {
    const pending = {...action('ACCEPT_PHONE'), approvalStatus: 'PENDING'}
    const waiting = {...makeJob([pending]), status: 'WAITING_CONFIRMATION'}
    assert.equal(automationApprovalAvailable(waiting, pending), true)
    assert.equal(automationApprovalAvailable(waiting, {...pending, status: 'CANCELLED'}), false)
    assert.equal(automationApprovalAvailable({...waiting, status: 'CANCELLED'}, pending), false)
    assert.equal(automationApprovalAvailable({...waiting, status: 'FAILED'}, pending), false)
    assert.equal(automationApprovalAvailable(waiting, {...pending, status: 'ACKNOWLEDGED'}), false)
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
test('parked unknown jobs use one detail GET per minute while new queued work stays prompt', async () => {
    const unknown = {...action(), status: 'UNKNOWN'}
    const env = rig({actions: [unknown]})
    env.state.job.status = 'UNCERTAIN'
    await env.submit(); await env.api.tick()
    const detailCalls = () => env.state.calls.filter(call => call.path.endsWith('/jobs/job-1')).length
    assert.equal(detailCalls(), 1)
    for (let index = 0; index < 19; index++) { env.advance(3_000); await env.api.tick() }
    assert.equal(detailCalls(), 1, 'parked UNKNOWN does not monopolize every three-second pass')
    env.advance(3_000); await env.api.tick()
    assert.equal(detailCalls(), 2, 'periodic refresh still detects missed server reconciliation')
    env.state.job.status = 'WAITING_EXECUTION'
    env.state.job.actions[0].status = 'QUEUED'
    env.advance(3_000); await env.api.tick()
    assert.equal(env.effects(), 1, 'list status change wakes new executable work without the parked delay')
})
test('server-visible late ACK wakes a parked UNKNOWN job for exact reconciliation', async () => {
    const acknowledged = []
    const env = rig({actions: [{...action(), status: 'UNKNOWN'}],
        acknowledged: (_context, item) => acknowledged.push(item.actionId)})
    env.state.job.status = 'UNCERTAIN'
    await env.submit(); await env.api.tick()
    env.state.job.actions[0].status = 'ACKNOWLEDGED'
    env.advance(3_000); await env.api.tick()
    assert.deepEqual(acknowledged, ['action-1'])
    assert.equal(env.effects(), 0, 'reconciliation never replays the original send')
})
test('exact late ACK refreshes only its job immediately and cannot trigger a newly queued send', async () => {
    const acknowledged = []
    const env = rig({perform: async () => ({status: 'UNKNOWN', serverMid: null, platformCode: null,
        occurredAt: 1788757200000, errorCode: 'RECEIPT_MISSING'}),
    acknowledged: (_context, item) => acknowledged.push(item.actionId)})
    await env.submit(); await env.api.tick()
    env.state.job.status = 'UNCERTAIN'
    await env.api.tick()
    const before = env.state.calls.filter(call => call.path.endsWith('/jobs/job-1')).length
    env.state.job.actions.push(action('SEND_TEXT', 'second-action'))
    await env.api.acknowledge('90071992547409931', '90071992547409999')
    assert.equal(env.state.calls.filter(call => call.path.endsWith('/jobs/job-1')).length, before + 1)
    assert.deepEqual(acknowledged, ['action-1'])
    assert.equal(env.effects(), 1, 'the ACK listener reconciles but never executes queued work')
})
test('concurrent status reads share one request, reject on failure, and isolate scope changes', async () => {
    let release, block = true
    const env = rig({onStatus: () => block ? new Promise(resolve => { release = resolve }) : undefined})
    const first = env.api.status(true)
    const second = env.api.enabled()
    while (!release) await new Promise(resolve => setImmediate(resolve))
    assert.equal(env.state.calls.filter(call => call.path.endsWith('/status')).length, 1)
    env.switchScope(); block = false
    const switched = await env.api.status(true)
    assert.equal(switched.enabled, true)
    release()
    await assert.rejects(first, /AUTOMATION_SCOPE_CHANGED/)
    await assert.rejects(second, /AUTOMATION_SCOPE_CHANGED/)
    assert.equal(env.state.calls.filter(call => call.path.endsWith('/status')).length, 2)
    env.state.failStatus = true
    await assert.rejects(env.api.status(true), /offline/)
    await assert.rejects(env.api.enabled(), /offline/, 'failed refresh does not expose the old enabled cache')
})
test('late SDK-remapped ACK is accepted only with exact registered original-MID proof', async () => {
    let proven=false
    const env=rig({acknowledgement:()=>proven?'90071992547409999':null,perform:async()=>({status:'UNKNOWN',serverMid:null,platformCode:null,occurredAt:1788757200000,errorCode:'RECEIPT_MISSING'})})
    await env.submit();await env.api.tick()
    await env.api.acknowledge('81111111111111111','90071992547409999');assert.equal(env.state.job.actions[0].status,'UNKNOWN')
    proven=true;await env.api.acknowledge('81111111111111111','90071992547409999');assert.equal(env.state.job.actions[0].status,'ACKNOWLEDGED')
})

test('committed APPLICATION with a lost response survives reload and token rotation without a second cycle', async () => {
    const storage = new MemoryStorage()
    let executionScope = 'token-scope-A'
    let recoveryIdentity = 'server-A:user-7:account-40'
    let currentPolicy = 'policy-A'
    let currentRunId = 'run-A'
    let committed = false
    let submitCalls = 0
    let effects = 0
    const contact = {...action('CONTACT_JOB'), jobId: 'application-job', payload: {
        encryptJobId: 'job-A', bossId: null, conversationKey: null,
    }}
    const job = {...makeJob([contact]), jobId: 'application-job', kind: 'APPLICATION',
        decision: {code: 'CONTACT', reason: '合成匹配'}}
    const body = {
        requestId: 'original-application-cycle', kind: 'APPLICATION', platformAccount: '40',
        conversationKey: null, bossId: null, encryptJobId: 'job-A', input: {
            cycleKey: 'original-application-cycle',
            filterInput: {prompt: '', jobBaseInfo: '{}', jobExtInfo: '{}', resumeMatchEnabled: false,
                minMatchScore: 0, titleMatchedKeywords: []},
            localAssessment: {passed: true, reason: '通过'}, greeting: {enabled: false, text: ''},
            preparedResumeVersionId: null, strategyPlanId: null,
        },
    }
    const originalContext = {kind: 'APPLICATION', account: '40', policy: 'policy-A', runId: 'run-A',
        encryptJobId: 'job-A', bossId: null, conversationKey: null, greetingEnabled: false,
        job: {encryptJobId: 'job-A', encryptBossId: 'boss-A', securityId: 'security-A'}}

    const runtime = () => createUnifiedAutomation({
        storage, executorId: 'executor-A', scope: () => executionScope,
        recoveryIdentity: () => recoveryIdentity, account: () => '40',
        flags: () => ({replyEnabled: true, deliveryEnabled: true}), clientMid: () => '1',
        recoverSubmissionContext(stored, storedBody, proposed) {
            const candidate = proposed || stored
            if (storedBody.kind !== 'APPLICATION' || stored.account !== '40'
                || stored.policy !== currentPolicy || candidate.policy !== currentPolicy) return null
            return {...stored, runId: currentRunId}
        },
        async request(path, requestBody) {
            if (path.endsWith('/status')) return {contractVersion: 1, enabled: true, mode: 'LANGGRAPH'}
            if (path.endsWith('/executors/heartbeat')) return {}
            if (path === '/api/job/automation/jobs') {
                submitCalls++
                assert.deepEqual(requestBody, body, 'recovery must replay the original request semantics')
                if (!committed) {
                    committed = true
                    throw new Error('response lost after commit')
                }
                return clone(job)
            }
            if (path.includes('/jobs?')) return committed ? [clone(job)] : []
            if (path.endsWith('/jobs/application-job')) return clone(job)
            if (path.endsWith('/actions/claim')) {
                if (job.actions[0].status !== 'QUEUED') return null
                job.actions[0].status = 'LEASED'
                job.actions[0].executorId = requestBody.executorId
                return {...clone(job.actions[0]), leaseToken: 'lease'.repeat(8), leaseUntil: Date.now() + 30_000,
                    authorizationRevision: 1}
            }
            if (path.endsWith('/dispatch')) {
                job.actions[0].status = 'DISPATCHING'
                return {dispatchToken: 'dispatch'.repeat(5), clientMid: null}
            }
            if (path.endsWith('/receipt')) {
                job.actions[0].status = requestBody.status
                job.status = 'COMPLETED'
                return clone(job.actions[0])
            }
            throw new Error('Unexpected API path ' + path)
        },
        execution: {
            ready: () => true,
            async perform(context) {
                effects++
                assert.equal(context.runId, 'run-B', 'reload rebinds only to the newly authorized run')
                return {status: 'ACKNOWLEDGED', serverMid: null, platformCode: 0,
                    occurredAt: Date.now(), errorCode: null}
            },
        },
    })

    const beforeReload = runtime()
    await assert.rejects(beforeReload.submit(body, originalContext), /response lost after commit/)
    assert.equal(submitCalls, 1)
    assert.equal(storage.getItem('ai-job-unified-v1:job:application-job'), null)
    assert.ok(storage.getItem('ai-job-unified-v1:pending-submit:original-application-cycle'))

    executionScope = 'token-scope-B'
    currentRunId = 'run-B'
    currentPolicy = 'policy-B'
    await runtime().tick()
    assert.equal(submitCalls, 1, 'policy changes fail closed before replay')
    recoveryIdentity = 'server-B:user-7:account-40'
    currentPolicy = 'policy-A'
    await runtime().tick()
    assert.equal(submitCalls, 1, 'server/account recovery identity changes fail closed before replay')

    recoveryIdentity = 'server-A:user-7:account-40'
    const afterReload = runtime()
    assert.equal(await afterReload.unresolvedApplication('job-A'), null,
        'a proven pre-dispatch recovery rejoins the APPLICATION main chain')
    const changedBody = clone(body)
    changedBody.requestId = 'changed-application-cycle'
    changedBody.input.cycleKey = 'changed-application-cycle'
    changedBody.input.greeting.text = 'changed semantics'
    await assert.rejects(afterReload.submit(changedBody, {...originalContext, runId: 'run-B'}),
        /AUTOMATION_SUBMISSION_SEMANTICS_CHANGED/)
    assert.equal(submitCalls, 2, 'semantic drift is rejected before another POST')
    const resumedBody = clone(body)
    resumedBody.requestId = 'new-run-cycle'
    resumedBody.input.cycleKey = 'new-run-cycle'
    const resumed = await afterReload.submit(resumedBody, {...originalContext, runId: 'run-B'})
    assert.equal(resumed.jobId, 'application-job')
    assert.equal(submitCalls, 2, 'the new run binds to the recovered job instead of creating another cycle')
    await afterReload.tick()
    await afterReload.tick()
    assert.equal(submitCalls, 2, 'the exact original request is replayed once under the rotated token')
    assert.equal(effects, 1, 'CONTACT executes exactly once after recovery')
    assert.equal(storage.getItem('ai-job-unified-v1:pending-submit:original-application-cycle'), null)
    const saved = JSON.parse(storage.getItem('ai-job-unified-v1:job:application-job'))
    assert.equal(saved.scope, 'token-scope-B')
    assert.equal(saved.context.runId, 'run-B')
})

test('a concurrent APPLICATION_ALREADY_UNRESOLVED loser is absorbed by the equivalent accepted job', async () => {
    const storage = new MemoryStorage()
    let currentRunId = 'run-A'
    let submitCalls = 0
    const contact = {...action('CONTACT_JOB'), jobId: 'winner-job', payload: {
        encryptJobId: 'job-A', bossId: null, conversationKey: null,
    }}
    const job = {...makeJob([contact]), jobId: 'winner-job', kind: 'APPLICATION',
        decision: {code: 'CONTACT', reason: '合成匹配'}}
    const body = {
        requestId: 'winner-cycle', kind: 'APPLICATION', platformAccount: '40', conversationKey: null,
        bossId: null, encryptJobId: 'job-A', input: {cycleKey: 'winner-cycle',
            filterInput: {prompt: '', jobBaseInfo: '{}', jobExtInfo: '{}', resumeMatchEnabled: false,
                minMatchScore: 0, titleMatchedKeywords: []},
            localAssessment: {passed: true, reason: '通过'}, greeting: {enabled: false, text: ''},
            preparedResumeVersionId: null, strategyPlanId: null},
    }
    const context = {kind: 'APPLICATION', account: '40', policy: 'policy-A', runId: 'run-A',
        encryptJobId: 'job-A', bossId: null, conversationKey: null, greetingEnabled: false,
        job: {encryptJobId: 'job-A', encryptBossId: 'boss-A', securityId: 'security-A'}}
    const api = createUnifiedAutomation({
        storage, executorId: 'executor-A', scope: () => 'scope-A',
        recoveryIdentity: () => 'server-A:user-7:account-40', account: () => '40',
        flags: () => ({replyEnabled: true, deliveryEnabled: true}), clientMid: () => '1',
        recoverSubmissionContext(stored, storedBody) {
            if (storedBody.kind !== 'APPLICATION' || stored.account !== '40' || stored.policy !== 'policy-A') return null
            return {...stored, runId: currentRunId}
        },
        async request(path, requestBody) {
            if (path.endsWith('/status')) return {contractVersion: 1, enabled: true, mode: 'LANGGRAPH'}
            if (path.endsWith('/executors/heartbeat')) return {}
            if (path === '/api/job/automation/jobs') {
                submitCalls++
                if (requestBody.requestId !== 'winner-cycle') throw new Error('APPLICATION_ALREADY_UNRESOLVED')
                return clone(job)
            }
            if (path.endsWith('/jobs/winner-job')) return clone(job)
            if (path.includes('/jobs?')) return [clone(job)]
            throw new Error('Unexpected API path ' + path)
        },
        execution: {ready: () => false, async perform() { throw new Error('must not execute') }},
    })

    await api.submit(body, context)
    assert.equal(submitCalls, 1)
    const saved = JSON.parse(storage.getItem('ai-job-unified-v1:job:winner-job'))
    const loserBody = clone(body)
    loserBody.requestId = 'loser-cycle'
    loserBody.input.cycleKey = 'loser-cycle'
    const loserContext = {...context, runId: 'run-B'}
    const loserProof = {...saved.submission, requestId: loserBody.requestId, body: loserBody,
        context: loserContext, semanticHash: await automationRequestId(['automation-submission-v1', loserBody, loserContext])}
    storage.setItem('ai-job-unified-v1:pending-submit:loser-cycle', JSON.stringify(loserProof))

    currentRunId = 'run-B'
    await api.tick()
    assert.equal(submitCalls, 1, 'the rejected concurrent request is not replayed into a permanent 409 loop')
    assert.equal(storage.getItem('ai-job-unified-v1:pending-submit:loser-cycle'), null)
    assert.equal(JSON.parse(storage.getItem('ai-job-unified-v1:job:winner-job')).context.runId, 'run-B')
})
