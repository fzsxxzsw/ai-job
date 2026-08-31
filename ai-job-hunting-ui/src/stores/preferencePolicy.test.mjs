import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'

import {normalizeHeadhunterFilterEnabled} from './preferencePolicy.ts'

const preferenceDefaultsSource = readFileSync(new URL('./types.ts', import.meta.url), 'utf8')

test('preserves an enabled headhunter filter loaded from persisted preferences', () => {
    assert.equal(normalizeHeadhunterFilterEnabled(true), true)
    assert.equal(normalizeHeadhunterFilterEnabled('true'), true)
    assert.equal(normalizeHeadhunterFilterEnabled(1), true)
})

test('defaults a missing or explicitly disabled headhunter filter to false', () => {
    assert.equal(normalizeHeadhunterFilterEnabled(undefined), false)
    assert.equal(normalizeHeadhunterFilterEnabled(false), false)
    assert.equal(normalizeHeadhunterFilterEnabled('false'), false)
    assert.equal(normalizeHeadhunterFilterEnabled(0), false)
})

test('the shared preference loading path no longer forces the headhunter filter off', () => {
    assert.match(
        preferenceDefaultsSource,
        /result\.fhE\s*=\s*normalizeHeadhunterFilterEnabled\(result\.fhE\)/,
    )
    assert.doesNotMatch(preferenceDefaultsSource, /result\.fhE\s*=\s*false/)
})
