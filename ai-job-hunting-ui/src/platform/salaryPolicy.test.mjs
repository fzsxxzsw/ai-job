import assert from 'node:assert/strict'
import test from 'node:test'
import {evaluateSalaryRange, isSalaryWithinConfiguredRange} from './salaryPolicy.ts'

test('configured 13-18K salary range rejects a 25-50K job', () => {
    assert.equal(isSalaryWithinConfiguredRange('13-18', '25-50K·16薪'), false)
    assert.equal(evaluateSalaryRange('13-18', '25-50K·16薪'), 'OUTSIDE')
})

test('three thousand tolerance keeps a nearby salary eligible', () => {
    assert.equal(evaluateSalaryRange('13-15', '13-18K'), 'TOLERATED')
    assert.equal(isSalaryWithinConfiguredRange('13-15', '13-18K'), true)
})

test('an excessive maximum becomes a high-match stretch instead of an absolute rejection', () => {
    assert.equal(evaluateSalaryRange('13-18', '15-30K·13薪'), 'STRETCH')
    assert.equal(evaluateSalaryRange('13-18', '18-25K'), 'STRETCH')
})

test('a salary band fully contained by the configured range remains eligible', () => {
    assert.equal(isSalaryWithinConfiguredRange('13-18', '15-18K'), true)
    assert.equal(evaluateSalaryRange('13-18', '15-18K'), 'PREFERRED')
})

test('an unknown job salary fails closed when a hard range is configured', () => {
    assert.equal(isSalaryWithinConfiguredRange('13-18', '面议'), false)
})

test('an empty configured range does not filter jobs', () => {
    assert.equal(isSalaryWithinConfiguredRange('', '25-50K'), true)
})
