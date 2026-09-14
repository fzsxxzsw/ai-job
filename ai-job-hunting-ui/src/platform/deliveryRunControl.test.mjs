import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
import {waitForPushDelay, waitForPushPreflight, greetingDispatchAuthorized} from './deliveryRunWait.ts'
import {greetingLockIdentity, makeGreetingTaskKey, reserveNewGreetingTask} from './greetingIdentity.ts'
import {
    isRetryableDelivery, canRetryAfterConfirmedUngreeted, isDispatchUncertain,
    isManualReviewDelivery, hasServerAcknowledgement,
} from './deliveryQueue.ts'

function actualMethods(className, names, globals) {
    const source = ts.createSourceFile('platform.ts', readFileSync(new URL('./platform.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
    const klass = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === className)
    assert.ok(klass, `missing ${className}`)
    const members = names.map(name => {
        const member = klass.members.find(node => node.name?.getText(source) === name)
        assert.ok(member, `missing ${className}.${name}`)
        return member.getText(source)
    })
    const code = ts.transpileModule(`class ${className} { ${members.join('\n')} }; ${className}`, {
        compilerOptions: {target: ts.ScriptTarget.ES2022},
    }).outputText
    return runInNewContext(code, globals)
}

test('stop interrupts an actual 120-second page wait before another page is loaded', async () => {
    const state = {stopRequested: false, setPhase() {}}
    const Type = actualMethods('AbsPlatform', ['next', 'pausePush'], {
        PushStatus: {PUSHING: 1, PAUSE: 2}, PushRunStore: () => state,
        userStore: {user: {preference: {npi: 120}}}, SAFE_MIN_NEXT_PAGE_INTERVAL_SECONDS: 90,
        waitForPushDelay, Date, console,
    })
    const instance = new Type()
    instance.pushStatus = 1
    instance.pushAbortController = new AbortController()
    instance.logRecorder = {info() {}}
    let loads = 0
    instance.acquireDataPre = async () => { loads++; return true }
    const started = Date.now()
    const pending = instance.next()
    setTimeout(() => instance.pausePush(), 8)
    assert.equal(await pending, false)
    assert.equal(loads, 0)
    assert.ok(Date.now() - started < 500, 'stop must not wait 120 seconds')
})

test('live page and contact waits keep the configured safe intervals', async () => {
    let pageWait = 0
    const Type = actualMethods('AbsPlatform', ['next'], {
        PushStatus: {PUSHING: 1}, PushRunStore: () => ({setPhase() {}}),
        userStore: {user: {preference: {npi: 30}}}, SAFE_MIN_NEXT_PAGE_INTERVAL_SECONDS: 90,
        waitForPushDelay: async ms => { pageWait = ms; return true }, Date,
    })
    const instance = new Type()
    instance.pushStatus = 1
    instance.pushAbortController = new AbortController()
    instance.logRecorder = {info() {}}
    instance.acquireDataPre = async () => true
    assert.equal(await instance.next(), true)
    assert.equal(pageWait, 90_000)

    let contactWait = 0
    let lockSignal
    const Cooldown = actualMethods('BossPlatform', ['runWithGlobalPushCooldown'], {
        userStore: {user: {preference: {pi: 1}}}, SAFE_MIN_PUSH_INTERVAL_SECONDS: 3,
        TampermonkeyApi: {GmGetValue: () => 1, GmSetValue() {}}, BOSS_LAST_PUSH_AT_KEY: 'last',
        calculatePushCooldownMs: (_, seconds) => seconds * 1000,
        PushRunStore: () => ({stopRequested: false, setPhase() {}}),
        waitForPushDelay: async ms => { contactWait = ms; return true },
        getBossRiskStop: () => null, PushStatus: {PUSHING: 1},
        PublishStopExp: class extends Error {}, PublishLimitExp: class extends Error {}, Date,
        navigator: {locks: {request: async (_, options, callback) => { lockSignal = options.signal; return callback() }}},
    })
    const boss = new Cooldown()
    boss.pushStatus = 1
    boss.pushAbortController = new AbortController()
    boss.isLimit = () => ({limit: false})
    assert.equal(await boss.runWithGlobalPushCooldown(async () => 'sent'), 'sent')
    assert.equal(contactWait, 3000)
    assert.equal(lockSignal, boss.pushAbortController.signal)
})

test('stop interrupts waiting for the cross-tab contact Web Lock', async () => {
    const Type = actualMethods('BossPlatform', ['runWithGlobalPushCooldown'], {
        navigator: {locks: {request: (_name, options) => new Promise((_, reject) => {
            options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), {name: 'AbortError'})), {once: true})
        })}},
        PublishStopExp: class extends Error {}, Date,
    })
    const boss = new Type()
    boss.pushAbortController = new AbortController()
    let executed = false
    const pending = boss.runWithGlobalPushCooldown(async () => { executed = true })
    boss.pushAbortController.abort()
    await assert.rejects(pending, /用户已停止投递/)
    assert.equal(executed, false)
})

test('read-only startup preflight can stop without resuming a late result', async () => {
    const controller = new AbortController()
    let finish
    const slow = new Promise(resolve => { finish = resolve })
    const pending = waitForPushPreflight(slow, controller.signal)
    controller.abort()
    assert.deepEqual(await pending, {stopped: true})
    finish('late remote settings')
    await Promise.resolve()
})

test('greeting authorization requires the exact same account and run, with only a bounded same-page completion grace', () => {
    const now = Date.now()
    const run = {runId: 'run-1', status: 'running', isActive: true, stopRequested: false, startedAt: now - 1000}
    const entry = {runId: 'run-1', account: 'account-1', createdAt: now - 500}
    assert.equal(greetingDispatchAuthorized(entry, run, 'account-1', false, false, now), true)
    assert.equal(greetingDispatchAuthorized({...entry, runId: undefined}, run, 'account-1', false, false, now), false)
    assert.equal(greetingDispatchAuthorized(entry, run, 'account-2', false, false, now), false)
    assert.equal(greetingDispatchAuthorized(entry, {...run, stopRequested: true}, 'account-1', false, false, now), false)
    assert.equal(greetingDispatchAuthorized(entry, run, 'account-1', true, false, now), false)
    const completed = {...run, status: 'completed', isActive: false, completedAt: now}
    assert.equal(greetingDispatchAuthorized(entry, completed, 'account-1', false, false, now + 1000), true)
    assert.equal(greetingDispatchAuthorized(entry, completed, 'account-1', false, false, now + 120_001), false)
    assert.equal(greetingDispatchAuthorized(entry, {...completed, runId: ''}, 'account-1', false, false, now), false)
})

test('manual stop marker is durable and cannot be unlocked by exact DOM ungreeted evidence', () => {
    const item = {key: 'greeting:boss', attempts: 0, userStoppedAt: 1}
    assert.equal(isRetryableDelivery(item), false)
    assert.equal(canRetryAfterConfirmedUngreeted({...item, dispatchedAt: 2}, 60_000), false)
    const Type = actualMethods('BossPlatform', ['recoverGreetingAfterConfirmedUngreeted'], {canRetryAfterConfirmedUngreeted})
    const boss = new Type()
    boss.enqueueGreeting = () => { throw Error('must not requeue') }
    boss.recoverGreetingAfterConfirmedUngreeted(item)
    assert.equal(item.userStoppedAt, 1)
})

function greetingHarness() {
    const calls = {send: 0, failures: 0, persisted: 0, lookups: 0}
    const state = {authorized: true, sendResult: true, duringSend: null}
    class Message {
        constructor(options) { this.msgObj = {cmid: options.clientMid || 'client-1', body: {type: 1}} }
        async send(_retries, _delay, canDispatch) {
            await state.duringSend?.()
            if (!canDispatch()) return false
            calls.send++
            if (state.sendResult) this.msgObj.__serverMid = 'server-1'
            return state.sendResult
        }
    }
    const Type = actualMethods('BossPlatform', ['deliverPendingGreetingLocked'], {
        getBossRiskStop: () => null,
        Tools: {isHardBlockedCompany: () => false, window: {
            _PAGE: {uid: 'account-1'}, AIJobHelperChatBridge: {isReady: () => true, getAcknowledgement: () => null},
        }},
        isDispatchUncertain, isManualReviewDelivery, shouldMoveUncertainToManualReview: () => false,
        readDeliveryAudit: () => [], hasBossDeliveryReceipt: () => false, hasServerAcknowledgement,
        isExhaustedDelivery: () => false, recordDeliveryAudit() {}, Message, Date,
    })
    const boss = new Type()
    boss.greetingSendingKeys = new Set()
    boss.greetingRunAuthorized = entry => entry.runId === 'current' && state.authorized && !entry.userStoppedAt
    boss.logRecorder = {warn() {}}
    boss.persistGreetingEntry = () => { calls.persisted++ }
    boss.persistGreetingFailure = entry => { calls.failures++; entry.attempts++ }
    boss.enqueueGreeting = () => {}
    boss.removeGreetingFromQueue = () => {}
    boss.requestBossData = async () => { calls.lookups++; return {data: {bossId: '42'}} }
    const entry = (overrides = {}) => ({key: 'greeting:boss', runId: 'current', account: 'account-1',
        brandName: 'ordinary', jobTitle: 'developer', content: 'hello', toUid: '42', toName: 'boss',
        createdAt: Date.now(), attempts: 0, clientMid: 'client-1', conversationKey: 'conversation-1', ...overrides})
    return {boss, calls, state, entry}
}

test('actual Boss greeting method sends only a current authorized run and reconciles old/unknown without new writes', async () => {
    const {boss, calls, entry} = greetingHarness()
    assert.equal(await boss.deliverPendingGreetingLocked(entry(), false), true)
    assert.equal(calls.send, 1)
    assert.equal(calls.persisted, 1)
    assert.equal(await boss.deliverPendingGreetingLocked(entry({runId: 'previous'}), false), false)
    assert.equal(await boss.deliverPendingGreetingLocked(entry({runId: undefined}), false), false)
    assert.equal(await boss.deliverPendingGreetingLocked(entry({dispatchedAt: Date.now()}), false), false)
    assert.equal(calls.send, 1)
    assert.equal(calls.failures, 0)
})

test('actual greeting method stops after a pending Boss lookup and again at the final send callback', async () => {
    const {boss, calls, state, entry} = greetingHarness()
    let finishLookup
    boss.requestBossData = () => new Promise(resolve => { finishLookup = resolve })
    const waiting = boss.deliverPendingGreetingLocked(entry({toUid: undefined, bossLookup: {
        encryptBossId: 'boss', securityId: 'security',
    }}), false)
    await Promise.resolve()
    state.authorized = false
    finishLookup({data: {bossId: '42'}})
    assert.equal(await waiting, false)
    assert.equal(calls.send, 0)
    assert.equal(calls.failures, 0)

    state.authorized = true
    state.duringSend = async () => { state.authorized = false }
    assert.equal(await boss.deliverPendingGreetingLocked(entry(), false), false)
    assert.equal(calls.send, 0)
    assert.equal(calls.failures, 0, 'a deliberate stop must not count as channel failure')
})

test('manual retire holds the global lock, preserves undecided records and never claims delivery', async () => {
    let lockAvailable = false
    const audit = []
    const queue = [
        {key: 'old', runId: 'previous', attempts: 0},
        {key: 'unknown', runId: 'previous', attempts: 0, dispatchedAt: 2},
        {key: 'ack', runId: 'previous', attempts: 0, serverMid: 'server'},
        {key: 'current', runId: 'current', attempts: 0},
    ]
    const Type = actualMethods('BossPlatform', ['retireOldUnsentGreetings', 'oldUnsentGreetingCount'], {
        navigator: {locks: {request: async (_name, options, callback) => {
            assert.equal(options.ifAvailable, true)
            return callback(lockAvailable ? {} : null)
        }}},
        PUSH_RUN_LOCK_NAME: 'push-run', isRetryableDelivery, greetingLockIdentity,
        runWithOptionalDeliveryLock: async (_locks, _kind, _scope, callback) => ({acquired: true, value: await callback()}),
        recordDeliveryAudit: item => audit.push(item), Date,
    })
    const boss = new Type()
    boss.readGreetingQueue = () => queue
    boss.greetingRunAuthorized = item => item.runId === 'current'
    boss.persistGreetingEntry = () => {}
    assert.equal(boss.oldUnsentGreetingCount(), 1)
    await assert.rejects(boss.retireOldUnsentGreetings(), /另一个标签页仍在投递/)
    assert.equal(queue[0].userStoppedAt, undefined)
    lockAvailable = true
    assert.equal(await boss.retireOldUnsentGreetings(), 1)
    assert.ok(queue[0].userStoppedAt > 0)
    assert.equal(queue[1].userStoppedAt, undefined)
    assert.equal(queue[2].userStoppedAt, undefined)
    assert.equal(queue[3].userStoppedAt, undefined)
    assert.equal(boss.oldUnsentGreetingCount(), 0)
    assert.equal(audit.length, 1)
    assert.equal(audit[0].status, 'blocked')
    assert.match(audit[0].lastError, /结果未确认/)
})

test('actual new-run greeting reservation keeps old UNKNOWN and ACK evidence under the same lock', async () => {
    const key = makeGreetingTaskKey('boss-token')
    let queue = [], audit = [], lockHeld = false, sends = 0
    const Type = actualMethods('BossPlatform', ['enqueueGreeting', 'pushAfterSendMsg'], {
        navigator: {locks: {request() {}}},
        userStore: {user: {preference: {greetingDeliveryMode: 'custom-queued', cgE: true, cg: '您好'}}},
        normalizeGreetingDeliveryMode: value => value, customGreetingEnabled: () => true,
        greetingRequiresReadyChannel: () => false, greetingLockIdentity, makeGreetingTaskKey,
        makeConversationKey: (boss, security) => `${boss}:${security}`,
        PushRunStore: () => ({runId: 'new-run'}),
        Tools: {window: {_PAGE: {uid: '40'}}, isHardBlockedCompany: () => false},
        Message: {createClientMid: () => 'new-mid'},
        readDeliveryAudit: () => audit, recordDeliveryAudit: item => audit.push(item),
        reserveNewGreetingTask, Date,
        runWithOptionalDeliveryLock: async (_locks, scope, identity, callback) => {
            assert.equal(scope, 'greeting'); assert.equal(identity, key)
            lockHeld = true
            try { return {acquired: true, value: await callback()} }
            finally { lockHeld = false }
        },
    })
    const boss = new Type()
    boss._pushMock = false
    boss.logRecorder = {warn() {}}
    boss.getJobKey = () => 'job'
    boss.greetingRunAuthorized = () => true
    boss.readGreetingQueue = () => queue
    boss.writeGreetingQueue = value => { assert.equal(lockHeld, true); queue = value }
    boss.deliverPendingGreeting = async () => { sends++; return true }
    const job = {encryptBossId: 'boss-token', securityId: 'security', brandName: 'brand'}
    for (const previous of [
        {key, runId: 'old-run', clientMid: 'old-mid', dispatchedAt: 1},
        {key, runId: 'old-run', clientMid: 'old-mid', serverMid: 'server-mid'},
    ]) {
        queue = [previous]; audit = []
        await boss.pushAfterSendMsg(job)
        assert.equal(queue[0], previous)
        assert.equal(queue[0].clientMid, 'old-mid')
        assert.equal(sends, 0)
    }
    queue = []; audit = [{kind: 'greeting', key, status: 'receipt'}]
    await boss.pushAfterSendMsg(job)
    assert.equal(queue.length, 0, 'a prior receipt is not a new-send permission')
    queue = []; audit = []
    await boss.pushAfterSendMsg(job)
    assert.equal(queue.length, 1)
    assert.equal(queue[0].clientMid, 'new-mid')
    assert.equal(sends, 1)
})
