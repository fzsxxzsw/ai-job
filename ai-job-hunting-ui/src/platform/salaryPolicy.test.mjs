import assert from 'node:assert/strict'
import test from 'node:test'
import {isSalaryWithinConfiguredRange} from './salaryPolicy.ts'

test('configured 13-18K salary range rejects a 25-50K job', () => {
    assert.equal(isSalaryWithinConfiguredRange('13-18', '25-50K·16薪'), false)
})

test('partial overlap is rejected when the advertised maximum is excessive', () => {
    assert.equal(isSalaryWithinConfiguredRange('13-18', '15-30K·13薪'), false)
    assert.equal(isSalaryWithinConfiguredRange('13-18', '18-25K'), false)
})

test('a salary band fully contained by the configured range remains eligible', () => {
    assert.equal(isSalaryWithinConfiguredRange('13-18', '15-18K'), true)
})

test('an unknown job salary fails closed when a hard range is configured', () => {
    assert.equal(isSalaryWithinConfiguredRange('13-18', '面议'), false)
})

test('an empty configured range does not filter jobs', () => {
    assert.equal(isSalaryWithinConfiguredRange('', '25-50K'), true)
})
