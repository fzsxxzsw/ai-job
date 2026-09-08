import assert from 'node:assert/strict'
import test from 'node:test'
import {serializableBossJobDetail} from './automationJob.ts'

test('page-owned job methods and nested values never enter persisted automation context', () => {
    const pageJob = {
        encryptJobId: 'JobA', encryptBossId: 'BossA', securityId: 'SecA', lid: 'LidA',
        jobName: 'AI 应用开发工程师', brandName: '合成公司', cityName: '杭州',
        jobLabels: ['双休'], skills: ['Python'], welfareList: ['五险一金'],
        getJobKey: () => 'page-owned-function', iconFlagList: [{render: () => 'page-owned-function'}],
    }
    const result = serializableBossJobDetail(pageJob)
    assert.doesNotThrow(() => structuredClone(result))
    assert.equal(result.encryptJobId, 'JobA')
    assert.equal(result.securityId, 'SecA')
    assert.deepEqual(result.skills, ['Python'])
    assert.equal('getJobKey' in result, false)
    assert.deepEqual(result.iconFlagList, [])
})
