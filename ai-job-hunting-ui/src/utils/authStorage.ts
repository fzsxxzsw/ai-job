import {GM_getValue, GM_setValue} from "$";

const AUTHORIZATION_KEY = 'ai-job-authorization-v1'
const LEGACY_AUTHORIZATION_KEY = 'Authorization'

let memoryAuthorization: string | null = null

function normalizeAuthorization(value: unknown): string | null {
    const normalized = typeof value === 'string' ? value.trim() : ''
    return normalized || null
}

function removeLegacyAuthorization(): void {
    try {
        localStorage.removeItem(LEGACY_AUTHORIZATION_KEY)
    } catch (_) {
        // A full or unavailable localStorage must not break authentication.
    }
}

function readManagedAuthorization(): string | null {
    try {
        return normalizeAuthorization(GM_getValue(AUTHORIZATION_KEY, ''))
    } catch (_) {
        return null
    }
}

function readLegacyAuthorization(): string | null {
    try {
        return normalizeAuthorization(localStorage.getItem(LEGACY_AUTHORIZATION_KEY))
    } catch (_) {
        return null
    }
}

function persistAuthorization(value: string): boolean {
    memoryAuthorization = value
    try {
        GM_setValue(AUTHORIZATION_KEY, value)
        removeLegacyAuthorization()
        return true
    } catch (_) {
        // Keep the current page usable even if the userscript storage is unavailable.
        return false
    }
}

export function getAuthorization(): string | null {
    if (memoryAuthorization) return memoryAuthorization

    const managedAuthorization = readManagedAuthorization()
    if (managedAuthorization) {
        memoryAuthorization = managedAuthorization
        removeLegacyAuthorization()
        return managedAuthorization
    }

    // One-time migration for users upgrading from the localStorage-based build.
    const legacyAuthorization = readLegacyAuthorization()
    if (!legacyAuthorization) return null
    persistAuthorization(legacyAuthorization)
    return memoryAuthorization
}

export function setAuthorization(value: unknown): boolean {
    const authorization = normalizeAuthorization(value)
    if (!authorization) {
        clearAuthorization()
        return false
    }
    return persistAuthorization(authorization)
}

export function clearAuthorization(): void {
    memoryAuthorization = null
    try {
        GM_setValue(AUTHORIZATION_KEY, '')
    } catch (_) {
        // Best effort only; clearing the legacy key below is still safe.
    }
    removeLegacyAuthorization()
}
