import assert from 'node:assert/strict'
import test from 'node:test'

import {
    arrayBufferToBase64,
    base64ToArrayBuffer,
    BRIDGE_PROTOCOL_VERSION,
    DELIVERY_AUDIT_URL,
    ISOLATED_WORLD_SOURCE,
    MAIN_WORLD_SOURCE,
    MAX_AUDIT_BODY_BYTES,
    normalizeGmPrivilegedRequest,
    parsePageBridgeRequest,
    RESUME_DOWNLOAD_URL,
} from './bridgeProtocol.ts'

const auditReport = (overrides = {}) => ({
    auditId: 'greeting:job-1',
    deliveryKey: 'job-1',
    kind: 'greeting',
    status: 'acknowledged',
    jobTitle: 'Java 工程师',
    contentHash: '24:abcd',
    contentLength: 24,
    attempts: 1,
    createdAt: 1_788_000_000_000,
    updatedAt: 1_788_000_000_100,
    ...overrides,
})

const auditOptions = (overrides = {}) => ({
    method: 'POST',
    url: DELIVERY_AUDIT_URL,
    headers: {
        Authorization: 'session-token',
        'Content-Type': 'application/json; charset=utf-8',
    },
    data: JSON.stringify(auditReport()),
    timeout: 5_000,
    ...overrides,
})

test('GM compatibility maps the two legitimate requests to named operations', () => {
    assert.deepEqual(normalizeGmPrivilegedRequest({
        method: 'GET',
        url: `${RESUME_DOWNLOAD_URL}?resumeId=resume-123`,
        headers: {Zp_token: 'boss-session'},
        responseType: 'arraybuffer',
    }), {
        operation: 'resume.download',
        payload: {resumeId: 'resume-123', zpToken: 'boss-session', timeout: 30_000},
    })

    const audit = normalizeGmPrivilegedRequest(auditOptions())
    assert.equal(audit?.operation, 'deliveryAudit.report')
    assert.deepEqual(audit?.payload.report, auditReport())
    assert.equal(audit?.payload.authorization, 'session-token')
})

test('GM compatibility rejects arbitrary local routes, 9101, query/header expansion and oversized bodies', () => {
    const invalid = [
        auditOptions({url: 'http://127.0.0.1:9100/api/user/ai/config/disable'}),
        auditOptions({url: 'http://127.0.0.1:9100/api/job/delivery/cancel'}),
        auditOptions({url: 'http://127.0.0.1:9101/api/job/delivery/audit'}),
        auditOptions({url: `${DELIVERY_AUDIT_URL}?force=true`}),
        auditOptions({headers: {
            Authorization: 'session-token',
            'Content-Type': 'application/json; charset=utf-8',
            'X-Forwarded-Host': 'evil.example',
        }}),
        auditOptions({data: JSON.stringify({...auditReport(), padding: 'x'.repeat(MAX_AUDIT_BODY_BYTES)})}),
        {
            method: 'GET',
            url: `${RESUME_DOWNLOAD_URL}?resumeId=resume-123&next=https://evil.example`,
            headers: {Zp_token: 'boss-session'},
            responseType: 'arraybuffer',
        },
        {
            method: 'GET',
            url: `${RESUME_DOWNLOAD_URL}?resumeId=resume-123`,
            headers: {Zp_token: 'boss-session', Authorization: 'unexpected'},
            responseType: 'arraybuffer',
        },
    ]
    invalid.forEach(value => assert.equal(normalizeGmPrivilegedRequest(value), null))
})

test('page bridge accepts named schemas and rejects the former arbitrary HTTP proxy', () => {
    const envelope = {
        protocol: BRIDGE_PROTOCOL_VERSION,
        source: MAIN_WORLD_SOURCE,
        target: ISOLATED_WORLD_SOURCE,
        requestId: 'request-1',
    }
    assert.equal(parsePageBridgeRequest({...envelope, operation: 'http-request', payload: auditOptions()}), null)
    assert.equal(parsePageBridgeRequest({
        ...envelope,
        operation: 'resume.download',
        payload: {resumeId: 'resume-123', zpToken: 'boss-session', timeout: 5_000, url: 'https://evil.example'},
    }), null)
    assert.equal(parsePageBridgeRequest({
        ...envelope,
        operation: 'deliveryAudit.report',
        payload: {authorization: 'session-token', report: {...auditReport(), unexpected: true}, timeout: 5_000},
    }), null)
})

test('arraybuffer transport survives base64 round-trip without byte loss', () => {
    const source = Uint8Array.from([0, 1, 2, 127, 128, 254, 255]).buffer
    const restored = base64ToArrayBuffer(arrayBufferToBase64(source))
    assert.deepEqual([...new Uint8Array(restored)], [...new Uint8Array(source)])
})
