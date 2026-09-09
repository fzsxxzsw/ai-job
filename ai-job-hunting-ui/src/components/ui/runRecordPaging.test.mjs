import test from 'node:test'
import assert from 'node:assert/strict'
import {resolveLiveLogPage} from './runRecordPaging.ts'

test('live log view follows newly created pages while the user is at the tail', () => {
    assert.equal(resolveLiveLogPage(265, 10, 2650, 2651), 266)
})

test('live log view refreshes in place without interrupting historical browsing', () => {
    assert.equal(resolveLiveLogPage(264, 10, 2650, 2660), 264)
    assert.equal(resolveLiveLogPage(265, 10, 2650, 2650), 265)
})

test('live log view clamps safely after logs are cleared', () => {
    assert.equal(resolveLiveLogPage(265, 10, 2650, 0), 1)
})
