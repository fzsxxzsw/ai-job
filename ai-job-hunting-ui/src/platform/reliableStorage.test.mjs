import assert from 'node:assert/strict'
import test from 'node:test'
import {createReliableStorage, persistReliableValue, recoverReliableValue} from './reliableStorage.ts'

class MemoryStorage {
    values = new Map()
    get length() { return this.values.size }
    key(index) { return [...this.values.keys()][index] ?? null }
    getItem(key) { return this.values.get(key) ?? null }
    setItem(key, value) { this.values.set(key, String(value)) }
    removeItem(key) { this.values.delete(key) }
}

class MemoryBackend {
    records = new Map()
    putAttempts = 0
    failPuts = 0
    async get(key) { return structuredClone(this.records.get(key)) }
    async list(prefix) { return [...this.records.values()].filter(record => record.key.startsWith(prefix)).map(record => structuredClone(record)) }
    async put(record) {
        this.putAttempts++
        if (this.failPuts-- > 0) throw new Error('transient IndexedDB failure')
        this.records.set(record.key, structuredClone(record))
    }
}

test('durable storage restores a missing unified automation record', async () => {
    const backend = new MemoryBackend()
    backend.records.set('ai-job-unified-v1:job:1', {
        key: 'ai-job-unified-v1:job:1', value: '{"jobId":"1"}', deleted: false, updatedAt: 100,
    })
    const local = new MemoryStorage()
    const reliable = createReliableStorage(local, 'ai-job-unified-v1:', {backend, now: () => 200, retryDelayMs: 0})
    await reliable.ready()
    assert.equal(reliable.storage.getItem('ai-job-unified-v1:job:1'), '{"jobId":"1"}')
})

test('local migration data wins instead of being replaced by an older IndexedDB snapshot', async () => {
    const backend = new MemoryBackend()
    backend.records.set('ai-job-unified-v1:dispatch:1', {
        key: 'ai-job-unified-v1:dispatch:1', value: 'old', deleted: false, updatedAt: 100,
    })
    const local = new MemoryStorage()
    local.setItem('ai-job-unified-v1:dispatch:1', 'current')
    const reliable = createReliableStorage(local, 'ai-job-unified-v1:', {backend, now: () => 200, retryDelayMs: 0})
    await reliable.flush()
    assert.equal(reliable.storage.getItem('ai-job-unified-v1:dispatch:1'), 'current')
    assert.equal(backend.records.get('ai-job-unified-v1:dispatch:1').value, 'current')
})

test('a deletion is durably tombstoned and is not resurrected after restart', async () => {
    const backend = new MemoryBackend()
    const first = createReliableStorage(new MemoryStorage(), 'ai-job-unified-v1:', {backend, now: () => 100, retryDelayMs: 0})
    first.storage.setItem('ai-job-unified-v1:job:1', 'saved')
    first.storage.removeItem('ai-job-unified-v1:job:1')
    await first.flush()
    assert.equal(backend.records.get('ai-job-unified-v1:job:1').deleted, true)

    const second = createReliableStorage(new MemoryStorage(), 'ai-job-unified-v1:', {backend, now: () => 200, retryDelayMs: 0})
    await second.ready()
    assert.equal(second.storage.getItem('ai-job-unified-v1:job:1'), null)
})

test('transient IndexedDB writes are retried before the durable flush completes', async () => {
    const backend = new MemoryBackend()
    backend.failPuts = 2
    const reliable = createReliableStorage(new MemoryStorage(), 'ai-job-unified-v1:', {backend, now: () => 100, retryDelayMs: 0})
    await reliable.ready()
    reliable.storage.setItem('ai-job-unified-v1:job:retry', 'payload')
    await reliable.flush()
    assert.equal(backend.putAttempts, 3)
    assert.equal(backend.records.get('ai-job-unified-v1:job:retry').value, 'payload')
})

test('existing synchronous queue data wins while an empty queue can recover from IndexedDB', async () => {
    const backend = new MemoryBackend()
    backend.records.set('queue', {key: 'queue', value: '[{"key":"old"}]', deleted: false, updatedAt: 1})
    const current = await recoverReliableValue('queue', '[{"key":"current"}]', {backend, now: () => 2, retryDelayMs: 0})
    assert.equal(current, '[{"key":"current"}]')
    assert.equal(backend.records.get('queue').value, '[{"key":"current"}]')

    const recovered = await recoverReliableValue('queue', null, {backend, retryDelayMs: 0})
    assert.equal(recovered, '[{"key":"current"}]')
})

test('rapid queue snapshots commit in call order even when the first IndexedDB write is slow', async () => {
    const backend = new MemoryBackend()
    let releaseFirst
    const originalPut = backend.put.bind(backend)
    backend.put = async record => {
        if (record.value === 'first') await new Promise(resolve => { releaseFirst = resolve })
        await originalPut(record)
    }
    const first = persistReliableValue('queue', 'first', {backend, now: () => 1, retryDelayMs: 0})
    while (!releaseFirst) await new Promise(resolve => setImmediate(resolve))
    const second = persistReliableValue('queue', 'second', {backend, now: () => 2, retryDelayMs: 0})
    releaseFirst()
    await Promise.all([first, second])
    assert.equal(backend.records.get('queue').value, 'second')
    assert.equal(backend.records.get('queue').updatedAt, 2)
})
