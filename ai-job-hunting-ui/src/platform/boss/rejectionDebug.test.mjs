import assert from 'node:assert/strict'
import test from 'node:test'

import {
    buildSafeRejectionDiagnosticReport,
    classifyRejectionDebugError,
    clearRejectionDebugEvents,
    getRejectionDebugSnapshot,
    installRejectionDebugBridge,
    recordRejectionDebugEvent,
    REJECTION_DEBUG_BRIDGE_KEY,
    REJECTION_DEBUG_EVENT_LIMIT,
} from './rejectionDebug.ts'

test('keeps a memory-only 200-event ring and returns a deep copy', () => {
    clearRejectionDebugEvents()
    for (let index = 0; index < REJECTION_DEBUG_EVENT_LIMIT + 7; index++) {
        recordRejectionDebugEvent('MESSAGE_BUFFER', 'SUCCEEDED', {
            bufferSize: index,
            conversationKey: `secret-conversation-${index}`,
            messages: [{text: `secret-message-${index}`}],
        })
    }

    const snapshot = getRejectionDebugSnapshot()
    assert.equal(snapshot.events.length, REJECTION_DEBUG_EVENT_LIMIT)
    assert.equal(snapshot.events[0].sequence, 8)
    assert.equal('conversationKey' in snapshot.events[0], false)
    assert.equal('messages' in snapshot.events[0], false)

    snapshot.events[0].stage = 'ANALYSIS'
    snapshot.events.push({sequence: 999, timestamp: '', stage: 'ANALYSIS', outcome: 'FAILED'})
    const freshSnapshot = getRejectionDebugSnapshot()
    assert.equal(freshSnapshot.events.length, REJECTION_DEBUG_EVENT_LIMIT)
    assert.equal(freshSnapshot.events[0].stage, 'MESSAGE_BUFFER')
})

test('classifies errors from fixed transport metadata without reading private fields', () => {
    const response = new Proxy({status: 429}, {
        get(target, property) {
            if (property === 'data' || property === 'config') throw new Error(`read forbidden ${String(property)}`)
            return Reflect.get(target, property)
        },
    })
    const error = new Proxy({code: 'ERR_NETWORK', response}, {
        get(target, property) {
            if (property === 'message' || property === 'config') throw new Error(`read forbidden ${String(property)}`)
            return Reflect.get(target, property)
        },
    })

    assert.equal(classifyRejectionDebugError(error), 'RATE_LIMITED')
    assert.equal(classifyRejectionDebugError({code: 'ECONNABORTED'}), 'TIMEOUT')
    assert.equal(classifyRejectionDebugError({code: 'ERR_NETWORK'}), 'NETWORK')
    assert.equal(classifyRejectionDebugError(new Error('private model response')), 'UNKNOWN')
})

test('safe diagnostic report uses an explicit whitelist and drops sensitive content', () => {
    clearRejectionDebugEvents()
    recordRejectionDebugEvent('ANALYSIS', 'SUCCEEDED', {
        analysisId: 12,
        applicationSnapshotId: 34,
        model: 'gpt-safe/model',
        analysisSource: 'privateSourceToken',
        analysisStatus: 'privateStatusToken',
        reason: 'private reason text',
        evidence: [{text: 'private evidence text'}],
    })

    const report = buildSafeRejectionDiagnosticReport({
        runtime: {version: '1.2.3', buildId: 'build-9', apiKey: 'secret-api-key'},
        analysis: {
            id: 12,
            applicationSnapshotId: 34,
            status: 'ANALYZED',
            analysisSource: 'RULES_ONLY',
            conversationCompleteness: 'POSSIBLY_INCOMPLETE',
            model: 'gpt-safe/model',
            promptVersion: 'rejection-v1',
            reason: 'private reason text',
            correctedReason: 'private corrected reason',
            evidence: [{text: 'private evidence text'}],
            messages: [{text: 'private conversation text'}],
            conversationKey: 'private-conversation-key',
            encryptJobId: 'private-job-id',
        },
    })
    const serialized = JSON.stringify(report)

    assert.match(serialized, /gpt-safe\/model/)
    assert.match(serialized, /rejection-v1/)
    for (const privateValue of [
        'secret-api-key',
        'private reason text',
        'private corrected reason',
        'private evidence text',
        'private conversation text',
        'private-conversation-key',
        'private-job-id',
        'privateSourceToken',
        'privateStatusToken',
    ]) assert.equal(serialized.includes(privateValue), false)
})

test('window bridge exposes only snapshot and clear operations', () => {
    clearRejectionDebugEvents()
    const targetWindow = {}
    const bridge = installRejectionDebugBridge(targetWindow)

    assert.deepEqual(Object.keys(bridge).sort(), ['clear', 'getSnapshot'])
    assert.equal(targetWindow[REJECTION_DEBUG_BRIDGE_KEY], bridge)
    assert.equal(Object.isFrozen(bridge), true)
    bridge.clear()
    assert.deepEqual(bridge.getSnapshot().events, [])
})
