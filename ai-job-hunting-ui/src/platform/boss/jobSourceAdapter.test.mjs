import assert from 'node:assert/strict'
import test from 'node:test'

import {
    clearRememberedBossJobs,
    collectBossJobs,
    normalizeBossJob,
    rememberBossJobSearchResponse,
} from './jobSourceAdapter.ts'

function rawJob(overrides = {}) {
    return {
        encryptJobId: 'job-1',
        securityId: 'sec-1',
        lid: 'lid-1',
        jobName: 'Java工程师',
        brandName: '示例公司',
        salaryDesc: '20-30K',
        ...overrides,
    }
}

function fakeElement({vue2, vue3, href, text = {}, dataset = {}} = {}) {
    const nodes = new Map(Object.entries(text).map(([selector, value]) => [selector, {
        textContent: value,
        getAttribute: () => null,
    }]))
    if (href) nodes.set('a[href]', {textContent: '', getAttribute: name => name === 'href' ? href : null})
    return {
        __vue__: vue2 ? {data: vue2} : undefined,
        __vueParentComponent: vue3 ? {props: {job: vue3}} : undefined,
        dataset,
        querySelector: selector => nodes.get(selector) || null,
        getAttribute: () => null,
    }
}

function fakeDocument(elements) {
    return {querySelectorAll: () => elements}
}

test('normalizes nested API jobInfo and boss/company records', () => {
    const job = normalizeBossJob({
        jobInfo: rawJob(),
        bossInfo: {encryptBossId: 'boss-1', bossName: 'HR'},
        brandComInfo: {brandIndustry: '软件'},
    }, 'search-api')
    assert.equal(job.encryptJobId, 'job-1')
    assert.equal(job.encryptBossId, 'boss-1')
    assert.equal(job.brandIndustry, '软件')
})

test('supports Vue 3 and Vue 2 card payloads', () => {
    clearRememberedBossJobs()
    const result = collectBossJobs(fakeDocument([
        fakeElement({vue3: rawJob({encryptJobId: 'vue3-job'})}),
        fakeElement({vue2: rawJob({encryptJobId: 'vue2-job'})}),
    ]), 'https://www.zhipin.com/web/geek/jobs')
    assert.deepEqual(result.jobs.map(job => job.encryptJobId).sort(), ['vue2-job', 'vue3-job'])
    assert.equal(result.diagnostics.find(item => item.source === 'vue3').accepted, 1)
    assert.equal(result.diagnostics.find(item => item.source === 'vue2').accepted, 1)
})

test('uses DOM links only when all action identifiers are present', () => {
    clearRememberedBossJobs()
    const valid = fakeElement({
        href: '/job_detail/dom-job.html?securityId=dom-sec&lid=dom-lid',
        text: {'.job-name': '前端工程师', '.company-name': 'DOM公司', '.salary': '15-25K'},
    })
    const invalid = fakeElement({
        href: '/job_detail/missing-security.html',
        text: {'.job-name': '缺少协议字段的岗位'},
    })
    const result = collectBossJobs(fakeDocument([valid, invalid]), 'https://www.zhipin.com/web/geek/jobs')
    assert.equal(result.jobs.length, 1)
    assert.equal(result.jobs[0].encryptJobId, 'dom-job')
    assert.equal(result.diagnostics.find(item => item.source === 'dom').rejected, 1)
})

test('prefers the latest captured search API payload and avoids duplicate cards', () => {
    clearRememberedBossJobs()
    rememberBossJobSearchResponse({zpData: {jobList: [
        rawJob({encryptJobId: 'api-job'}),
        {jobInfo: rawJob({encryptJobId: 'api-job'})},
    ]}})
    const element = fakeElement({
        vue2: rawJob({encryptJobId: 'api-job'}),
        href: '/job_detail/api-job.html?securityId=sec-1&lid=lid-1',
    })
    const result = collectBossJobs(fakeDocument([element]), 'https://www.zhipin.com/web/geek/jobs')
    assert.equal(result.jobs.length, 1)
    assert.equal(result.jobs[0].encryptJobId, 'api-job')
    assert.equal(result.diagnostics.find(item => item.source === 'search-api').accepted, 1)
})
