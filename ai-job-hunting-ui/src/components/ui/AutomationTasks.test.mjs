import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'

const source = readFileSync(new URL('./AutomationTasks.vue', import.meta.url), 'utf8')

test('automation tasks use a compact collapsed summary and bounded details area', () => {
    assert.match(source, /<details class="automation-overview" @toggle="onOverviewToggle">/)
    assert.match(source, /<summary class="automation-summary">/)
    assert.match(source, /服务在线/)
    assert.match(source, /待浏览器/)
    assert.match(source, /待确认/)
    assert.match(source, /待核实/)
    assert.match(source, /自动求职助手/)
    assert.match(source, /查看详情/)
    assert.match(source, /listAutomationJobs\(/)
    assert.match(source, /上一页/)
    assert.match(source, /下一页/)
    assert.match(source, /全部历史/)
    assert.doesNotMatch(source, /state\.value\.jobs\.filter/)
    assert.match(source, /v-for="action in job\.actions"/)
    assert.match(source, /automationApprovalAvailable\(job, action\)/)
    assert.doesNotMatch(source, /v-for="task in state\.status\.outcomes\.tasks\.items"/)
    assert.match(source, /\.automation-details\{[^}]*max-height:[^;}]+;[^}]*overflow-y:auto/)
    assert.doesNotMatch(source, /:open="task\.status === 'WAITING_CONFIRMATION'"/)
})
