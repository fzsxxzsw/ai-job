import assert from 'node:assert/strict'
import test from 'node:test'
import {modelRequestTimeout} from './modelRequestTimeout.ts'

test('allows the full bounded fallback window only for model generation requests', () => {
    assert.equal(modelRequestTimeout('api/job/filter/one', 15000), 130000)
    assert.equal(modelRequestTimeout('/api/user/ai/config/debug', 16000), 130000)
    assert.equal(modelRequestTimeout('/api/job/ai/rejections/analyze?x=1', 16000), 130000)
    assert.equal(modelRequestTimeout('/api/user/ai/config/current', 10000), 10000)
    assert.equal(modelRequestTimeout('/api/job/seeker/cloned/change/session/status', 10000), 10000)
})
