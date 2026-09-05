export const GM_STORAGE_PREFIX = '__ai_job_helper_gm_v1__:'

export type ValueChangeListener = (name: string, oldValue: unknown, newValue: unknown, remote: boolean) => void

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & Partial<Pick<Storage, 'key' | 'length'>>
type StorageEventLike = Pick<StorageEvent, 'key' | 'newValue' | 'oldValue'>
type StorageEventTarget = {
    addEventListener(type: 'storage', listener: (event: StorageEventLike) => void): void
    removeEventListener(type: 'storage', listener: (event: StorageEventLike) => void): void
}
type ListenerRecord = {key: string, callback: ValueChangeListener}

const SAFE_EXACT_KEYS = new Set([
    'ck_cur', 'config', 'activeEnable', 'push_lock', 'companyNameInclude', 'companyNameExclude',
    'jobNameInclude', 'jobContentExclude', 'salaryRange', 'companyScaleRange', 'sendSelfGreet',
    'sendSelfGreetMemory', 'messageCache', 'logs_data', 'custom_server_url', 'ai-job-delivery-audit-v1',
    'ai-job-pending-greetings-v1', 'ai-job-pending-ai-replies-v1', 'ai-job-conversation-replies-v1',
    'boss_last_push_at',
])
const SAFE_KEY_PATTERNS = [
    /^push_limit\d{4}-\d{2}-\d{2}$/,
    /^push(?:Success|Fail)Count:\d{4}-\d{2}-\d{2}$/,
    /^mirror_(?:ai_config|user_config)_(?:global_latest|[A-Za-z0-9_]{1,384})(?::updated_at)?$/,
]
const SECRET_NAME_PATTERN = /(?:api[_-]?key|token|secret|password|authorization|zp[_-]?token)/i
const SERIALIZED_SECRET_FIELD_PATTERN = /["'](?:api[_-]?key|token|secret|password|authorization|zp[_-]?token)["']\s*:/i
const SECRET_VALUE_PATTERN = /^(?:bearer\s+|basic\s+|sk-[A-Za-z0-9_-]{8,})/i

function encodeValue(value: unknown): string {
    return JSON.stringify({value})
}

function decodeValue(raw: string | null): unknown {
    if (raw == null) return undefined
    try {
        return JSON.parse(raw)?.value
    } catch (_) {
        return undefined
    }
}

export function isAllowedGmStorageKey(key: unknown): key is string {
    return typeof key === 'string' && key.length > 0 && key.length <= 512
        && !SECRET_NAME_PATTERN.test(key)
        && (SAFE_EXACT_KEYS.has(key) || SAFE_KEY_PATTERNS.some(pattern => pattern.test(key)))
}

function isAiConfigMirrorKey(key: string): boolean {
    return /^mirror_ai_config_/.test(key)
}

function stripSecretFields(value: unknown, seen = new WeakSet<object>()): unknown {
    if (Array.isArray(value)) return value.map(item => stripSecretFields(item, seen))
    if (!value || typeof value !== 'object') return value
    if (seen.has(value as object)) return undefined
    seen.add(value as object)
    const result: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if (SECRET_NAME_PATTERN.test(key)) continue
        result[key] = stripSecretFields(child, seen)
    }
    return result
}

function containsSecretMaterial(value: unknown, seen = new WeakSet<object>()): boolean {
    if (typeof value === 'string') {
        const trimmed = value.trim()
        return SECRET_VALUE_PATTERN.test(trimmed) || SERIALIZED_SECRET_FIELD_PATTERN.test(trimmed)
    }
    if (!value || typeof value !== 'object') return false
    if (seen.has(value as object)) return true
    seen.add(value as object)
    if (Array.isArray(value)) return value.some(item => containsSecretMaterial(item, seen))
    return Object.entries(value as Record<string, unknown>)
        .some(([key, child]) => SECRET_NAME_PATTERN.test(key) || containsSecretMaterial(child, seen))
}

function safeValueForKey(key: string, value: unknown): {ok: boolean, value: unknown} {
    if (isAiConfigMirrorKey(key)) return {ok: true, value: stripSecretFields(value)}
    return containsSecretMaterial(value) ? {ok: false, value: undefined} : {ok: true, value}
}

export class SynchronousGmStorage {
    private readonly storage: StorageLike
    private readonly eventTarget: StorageEventTarget
    private nextListenerId = 1
    private readonly listeners = new Map<number, ListenerRecord>()
    private readonly handleStorageEvent = (event: StorageEventLike) => {
        if (!event.key?.startsWith(GM_STORAGE_PREFIX)) return
        const key = event.key.slice(GM_STORAGE_PREFIX.length)
        if (!isAllowedGmStorageKey(key)) return
        const oldValue = safeValueForKey(key, decodeValue(event.oldValue))
        const newValue = safeValueForKey(key, decodeValue(event.newValue))
        this.notify(key, oldValue.ok ? oldValue.value : undefined, newValue.ok ? newValue.value : undefined, true)
    }

    constructor(storage: StorageLike, eventTarget: StorageEventTarget) {
        this.storage = storage
        this.eventTarget = eventTarget
        try {
            eventTarget.addEventListener('storage', this.handleStorageEvent)
        } catch (error) {
            this.reportFailure('监听存储变化失败', error)
        }
        this.migrateAiConfigMirrors()
    }

    getValue<T>(key: string, defaultValue?: T): T {
        if (!isAllowedGmStorageKey(key)) {
            this.removeUnsafeKey(key)
            return defaultValue as T
        }
        try {
            const decoded = decodeValue(this.storage.getItem(GM_STORAGE_PREFIX + key))
            if (decoded === undefined) return defaultValue as T
            const safe = safeValueForKey(key, decoded)
            if (!safe.ok) {
                this.storage.removeItem(GM_STORAGE_PREFIX + key)
                return defaultValue as T
            }
            return safe.value as T
        } catch (error) {
            this.reportFailure(`读取 ${key} 失败`, error)
            return defaultValue as T
        }
    }

    setValue(key: string, value: unknown): boolean {
        if (!isAllowedGmStorageKey(key)) {
            this.removeUnsafeKey(key)
            this.reportFailure(`拒绝未分类或敏感键 ${key}`)
            return false
        }
        const safe = safeValueForKey(key, value)
        if (!safe.ok) {
            this.reportFailure(`拒绝向 ${key} 写入敏感值`)
            return false
        }
        const storageKey = GM_STORAGE_PREFIX + key
        try {
            const oldValue = decodeValue(this.storage.getItem(storageKey))
            if (safe.value === undefined) this.storage.removeItem(storageKey)
            else this.storage.setItem(storageKey, encodeValue(safe.value))
            this.notify(key, oldValue, safe.value, false)
            return true
        } catch (error) {
            this.reportFailure(`写入 ${key} 失败`, error)
            return false
        }
    }

    addValueChangeListener(key: string, callback: ValueChangeListener): number {
        if (!isAllowedGmStorageKey(key)) return 0
        const listenerId = this.nextListenerId++
        this.listeners.set(listenerId, {key, callback})
        return listenerId
    }

    removeValueChangeListener(listenerId: number): void {
        this.listeners.delete(listenerId)
    }

    dispose(): void {
        try {
            this.eventTarget.removeEventListener('storage', this.handleStorageEvent)
        } catch (_) {
            // Storage events are best-effort; shutdown must remain safe.
        }
        this.listeners.clear()
    }

    private migrateAiConfigMirrors(): void {
        if (typeof this.storage.length !== 'number' || typeof this.storage.key !== 'function') return
        const keys: string[] = []
        try {
            for (let index = 0; index < this.storage.length; index++) {
                const storageKey = this.storage.key(index)
                if (storageKey?.startsWith(GM_STORAGE_PREFIX + 'mirror_ai_config_')) keys.push(storageKey)
            }
            for (const storageKey of keys) {
                const raw = this.storage.getItem(storageKey)
                const value = decodeValue(raw)
                if (value === undefined) continue
                const sanitized = stripSecretFields(value)
                const encoded = encodeValue(sanitized)
                if (encoded !== raw) this.storage.setItem(storageKey, encoded)
            }
        } catch (error) {
            this.reportFailure('清理旧 AI 配置镜像失败', error)
        }
    }

    private removeUnsafeKey(key: string): void {
        if (typeof key !== 'string' || key.length > 512) return
        try {
            this.storage.removeItem(GM_STORAGE_PREFIX + key)
        } catch (_) {
            // A denied key remains unreadable even when browser storage is unavailable.
        }
    }

    private reportFailure(message: string, error?: unknown): void {
        console.warn(`[AI Job Helper storage] ${message}`, error instanceof Error ? error.name : '')
    }

    private notify(key: string, oldValue: unknown, newValue: unknown, remote: boolean): void {
        for (const listener of this.listeners.values()) {
            if (listener.key !== key) continue
            queueMicrotask(() => listener.callback(key, oldValue, newValue, remote))
        }
    }
}
