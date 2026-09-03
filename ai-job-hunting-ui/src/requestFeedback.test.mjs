import assert from 'node:assert/strict'
import test from 'node:test'

import {shouldShowGlobalErrorToast} from './requestFeedback.ts'

test('request errors keep their normal global toast unless explicitly suppressed', () => {
    assert.equal(shouldShowGlobalErrorToast(), true)
    assert.equal(shouldShowGlobalErrorToast({}), true)
    assert.equal(shouldShowGlobalErrorToast({suppressGlobalErrorToast: false}), true)
    assert.equal(shouldShowGlobalErrorToast({suppressGlobalErrorToast: true}), false)
})
