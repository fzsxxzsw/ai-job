import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'

const source = readFileSync(new URL('./AutomationTasks.vue', import.meta.url), 'utf8')

test('automation tasks use a compact collapsed summary and bounded details area', () => {
    assert.match(source, /<details class="automation-overview">/)
    assert.match(source, /<summary class="automation-summary">/)
    assert.match(source, /运行正常/)
    assert.match(source, /需你处理/)
    assert.match(source, /自动求职助手/)
    assert.match(source, /查看详情/)
    assert.doesNotMatch(source, /v-for="task in state\.status\.outcomes\.tasks\.items"/)
    assert.match(source, /\.automation-details\{[^}]*max-height:[^;}]+;[^}]*overflow-y:auto/)
    assert.doesNotMatch(source, /:open="task\.status === 'WAITING_CONFIRMATION'"/)
})
