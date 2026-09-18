import {openDB, type DBSchema, type IDBPDatabase} from 'idb'
import pRetry from 'p-retry'

export type ReliableStorageRecord = {
    key: string
    value: string | null
    deleted: boolean
    updatedAt: number
}

export type ReliableStorageBackend = {
    get(key: string): Promise<ReliableStorageRecord | undefined>
    put(record: ReliableStorageRecord): Promise<void>
    list(prefix: string): Promise<ReliableStorageRecord[]>
}

type ReliableStorageOptions = {
    backend?: ReliableStorageBackend
    now?: () => number
    retryDelayMs?: number
    onError?: (error: unknown) => void
}

interface ReliableStorageDb extends DBSchema {
    records: {
        key: string
        value: ReliableStorageRecord
    }
}

const DATABASE_NAME = 'ai-job-helper-reliable-storage-v1'
const STORE_NAME = 'records'
const META_PREFIX = 'ai-job-reliable-meta-v1:'
let databasePromise: Promise<IDBPDatabase<ReliableStorageDb>> | null = null
let defaultBackend: ReliableStorageBackend | null = null
const valueWriteTails = new WeakMap<ReliableStorageBackend, Map<string, Promise<void>>>()

function database(): Promise<IDBPDatabase<ReliableStorageDb>> {
    if (!databasePromise) {
        databasePromise = openDB<ReliableStorageDb>(DATABASE_NAME, 1, {
            upgrade(db) {
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, {keyPath: 'key'})
                }
            },
        })
    }
    return databasePromise
}

function indexedDbBackend(): ReliableStorageBackend {
    if (defaultBackend) return defaultBackend
    defaultBackend = {
        async get(key) {
            return (await database()).get(STORE_NAME, key)
        },
        async put(record) {
            await (await database()).put(STORE_NAME, record)
        },
        async list(prefix) {
            const records = await (await database()).getAll(STORE_NAME)
            return records.filter(record => record.key.startsWith(prefix))
        },
    }
    return defaultBackend
}

async function withPersistenceRetry<T>(operation: () => Promise<T>, retryDelayMs = 40): Promise<T> {
    return pRetry(operation, {
        retries: 4,
        factor: 2,
        minTimeout: Math.max(0, retryDelayMs),
        maxTimeout: Math.max(0, retryDelayMs) * 8,
        randomize: true,
    })
}

function metadataKey(key: string): string {
    return META_PREFIX + encodeURIComponent(key)
}

function readRevision(storage: Pick<Storage, 'getItem'>, key: string): number {
    let raw: string | null = null
    try { raw = storage.getItem(metadataKey(key)) } catch { /* The durable copy can still recover this record. */ }
    const value = Number(raw || 0)
    return Number.isFinite(value) && value > 0 ? value : 0
}

export async function persistReliableValue(
    key: string,
    value: string | null,
    options: ReliableStorageOptions = {},
): Promise<void> {
    const backend = options.backend || indexedDbBackend()
    const updatedAt = (options.now || Date.now)()
    let tails = valueWriteTails.get(backend)
    if (!tails) {
        tails = new Map()
        valueWriteTails.set(backend, tails)
    }
    const previous = tails.get(key) || Promise.resolve()
    const pending = previous.catch(() => undefined).then(() => withPersistenceRetry(
        () => backend.put({key, value, deleted: value === null, updatedAt}),
        options.retryDelayMs,
    ))
    tails.set(key, pending)
    try {
        await pending
    } finally {
        if (tails.get(key) === pending) tails.delete(key)
    }
}

/**
 * Existing GM/localStorage data wins during migration. IndexedDB is only restored
 * when the synchronous stores have no value, so an old durable snapshot cannot
 * resurrect an intentionally emptied delivery queue.
 */
export async function recoverReliableValue(
    key: string,
    currentValue: string | null,
    options: ReliableStorageOptions = {},
): Promise<string | null> {
    if (currentValue !== null && currentValue !== '') {
        await persistReliableValue(key, currentValue, options)
        return currentValue
    }
    const backend = options.backend || indexedDbBackend()
    const record = await withPersistenceRetry(() => backend.get(key), options.retryDelayMs)
    return record && !record.deleted ? record.value : currentValue
}

/**
 * Keep the existing synchronous Storage contract while mirroring every scoped
 * mutation to IndexedDB. Hydration completes before callers that await ready(),
 * and per-key generations prevent a concurrent browser write from being replaced
 * by an older durable snapshot.
 */
export function createReliableStorage(
    storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>,
    prefix: string,
    options: ReliableStorageOptions = {},
) {
    const backend = options.backend || indexedDbBackend()
    const now = options.now || Date.now
    const generations = new Map<string, number>()
    const overlay = new Map<string, string | null>()
    let writeTail: Promise<void> = Promise.resolve()
    let lastWriteError: unknown = null

    const rawGet = (key: string): string | null => {
        try { return storage.getItem(key) } catch { return null }
    }
    const rawSet = (key: string, value: string): boolean => {
        try {
            storage.setItem(key, value)
            return true
        } catch {
            return false
        }
    }
    const rawRemove = (key: string): boolean => {
        try {
            storage.removeItem(key)
            return true
        } catch {
            return false
        }
    }
    const visibleKeys = (): string[] => {
        const keys: string[] = []
        const seen = new Set<string>()
        let length = 0
        try { length = storage.length } catch { /* Continue with the overlay. */ }
        for (let index = 0; index < length; index++) {
            let key: string | null = null
            try { key = storage.key(index) } catch { /* Continue with the overlay. */ }
            if (key !== null && !seen.has(key)) {
                seen.add(key)
                keys.push(key)
            }
        }
        for (const [key, value] of overlay) {
            if (value === null) {
                const index = keys.indexOf(key)
                if (index >= 0) keys.splice(index, 1)
                continue
            }
            if (!seen.has(key)) {
                seen.add(key)
                keys.push(key)
            }
        }
        return keys
    }

    const queueRecord = (record: ReliableStorageRecord) => {
        writeTail = writeTail.catch(() => undefined).then(async () => {
            try {
                await withPersistenceRetry(() => backend.put(record), options.retryDelayMs)
                lastWriteError = null
            } catch (error) {
                lastWriteError = error
                options.onError?.(error)
            }
        })
    }

    const durableStorage = {
        get length() { return visibleKeys().length },
        key(index: number) { return visibleKeys()[index] ?? null },
        getItem(key: string) { return overlay.has(key) ? overlay.get(key) ?? null : rawGet(key) },
        setItem(key: string, value: string) {
            if (!key.startsWith(prefix)) {
                storage.setItem(key, value)
                return
            }
            if (rawSet(key, value)) overlay.delete(key)
            else overlay.set(key, value)
            const updatedAt = now()
            generations.set(key, (generations.get(key) || 0) + 1)
            rawSet(metadataKey(key), String(updatedAt))
            queueRecord({key, value, deleted: false, updatedAt})
        },
        removeItem(key: string) {
            if (!key.startsWith(prefix)) {
                storage.removeItem(key)
                return
            }
            if (rawRemove(key)) overlay.delete(key)
            else overlay.set(key, null)
            const updatedAt = now()
            generations.set(key, (generations.get(key) || 0) + 1)
            rawSet(metadataKey(key), String(updatedAt))
            queueRecord({key, value: null, deleted: true, updatedAt})
        },
    } satisfies Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>

    const readyPromise = (async () => {
        try {
            const records = await withPersistenceRetry(() => backend.list(prefix), options.retryDelayMs)
            const durableKeys = new Set(records.map(record => record.key))
            for (const record of records) {
                if (generations.has(record.key)) continue
                const localValue = rawGet(record.key)
                const localRevision = readRevision(storage, record.key)
                if (localValue !== null && localRevision === 0) {
                    durableStorage.setItem(record.key, localValue)
                    continue
                }
                if (localRevision >= record.updatedAt) {
                    queueRecord({
                        key: record.key,
                        value: localValue,
                        deleted: localValue === null,
                        updatedAt: localRevision,
                    })
                    continue
                }
                if (record.deleted) {
                    if (rawRemove(record.key)) overlay.delete(record.key)
                    else overlay.set(record.key, null)
                } else if (record.value !== null) {
                    if (rawSet(record.key, record.value)) overlay.delete(record.key)
                    else overlay.set(record.key, record.value)
                }
                rawSet(metadataKey(record.key), String(record.updatedAt))
            }
            const localKeys: string[] = []
            let localLength = 0
            try { localLength = storage.length } catch { /* No synchronous keys to migrate. */ }
            for (let index = 0; index < localLength; index++) {
                let key: string | null = null
                try { key = storage.key(index) } catch { /* Skip an unreadable entry. */ }
                if (key?.startsWith(prefix) && !durableKeys.has(key)) localKeys.push(key)
            }
            for (const key of localKeys) {
                const value = rawGet(key)
                if (value !== null) durableStorage.setItem(key, value)
            }
            await writeTail
        } catch (error) {
            options.onError?.(error)
        }
    })()

    return {
        storage: durableStorage,
        ready: () => readyPromise,
        async flush() {
            await readyPromise
            await writeTail
            if (lastWriteError) throw lastWriteError
        },
    }
}
