import assert from 'node:assert/strict'
import test from 'node:test'
import {createPinia, setActivePinia} from 'pinia'

import {announcePushRunCompletion} from './completionSummary.ts'
import {PushRunStore} from '../stores/pushRun.ts'

test('a delayed summary cannot keep the delivery run active after scanning', async () => {
    setActivePinia(createPinia())
    const run = PushRunStore()
    const notices = []
    let finishSummary
    const summary = new Promise(resolve => { finishSummary = resolve })

    await run.run(async () => {
        announcePushRunCompletion(run.runId, {enabled: async () => true, summary: () => summary,
            notify: (...notice) => notices.push(notice)})
        return {status: 'completed'}
    }, () => {})

    assert.equal(run.status, 'completed')
    assert.ok(run.completedAt)
    assert.deepEqual(notices, [])
    finishSummary({contacted: 1, waitingGreeting: 2, uncertainGreeting: 0})
    await new Promise(resolve => setImmediate(resolve))
    assert.match(notices[0][0], /已联系 1，待发招呼 2/)
})

test('summary errors retain the existing safe fallback notice', async () => {
    const notices = []
    announcePushRunCompletion('run-A', {enabled: async () => true,
        summary: async () => {throw new Error('timeout')}, notify: (...notice) => notices.push(notice)})
    await new Promise(resolve => setImmediate(resolve))
    assert.match(notices[0][0], /最新沟通与招呼结果请查看分项任务/)
})
