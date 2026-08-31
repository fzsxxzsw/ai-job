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
