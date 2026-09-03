import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('./Preference.vue', import.meta.url), 'utf8')

function formItem(label) {
    const start = source.indexOf(`<el-form-item label="${label}"`)
    assert.notEqual(start, -1, `${label} form item should exist`)
    const end = source.indexOf('</el-form-item>', start)
    assert.notEqual(end, -1, `${label} form item should close`)
    return source.slice(start, end)
}

test('company exclusion accepts locally created keywords instead of remote options', () => {
    const companyExclusion = formItem('公司名排除')

    assert.match(companyExclusion, /\bfilterable\b/)
    assert.match(companyExclusion, /\ballow-create\b/)
    assert.doesNotMatch(companyExclusion, /\bremote\b/)
    assert.doesNotMatch(companyExclusion, /请输入公司名/)
    assert.match(companyExclusion, /按 Enter/)
})
test('benefit, commute, and local resume filters remain visible in the preference form', () => {
    for (const label of ['周末双休', '五险一金', '通勤位置', '位置要求', '简历-JD本地匹配', '匹配参考线', '附加AI筛选条件']) {
        assert.notEqual(source.indexOf(label), -1, `${label} should be rendered`)
    }
    for (const model of ['weekendMode', 'insuranceMode', 'commuteLocations', 'commuteMode', 'resumeMatchE', 'resumeMatchMinScore', 'afE']) {
        assert.equal(source.includes(`userStore.user.preference.${model}`), true)
    }
})
