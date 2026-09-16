export const PUSH_RUN_LEASE_KEY = 'ai-job-hunting-push-run-lease-v1'
export const PUSH_RUN_LEASE_MS = 6 * 60 * 60_000

export type PushRunLeaseIdentity = {
    bossAccountUid: string
    serverBaseUrl: string
    automationPolicyFingerprint: string
}

export type PushRunLease = PushRunLeaseIdentity & {
    schemaVersion: 1
    issuedAt: number
    expiresAt: number
}

const sameLocalDay = (left: number, right: number): boolean => {
    const a = new Date(left), b = new Date(right)
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

const exactIdentity = (lease: PushRunLease, identity: PushRunLeaseIdentity): boolean =>
    lease.bossAccountUid === identity.bossAccountUid
    && lease.serverBaseUrl === identity.serverBaseUrl
    && lease.automationPolicyFingerprint === identity.automationPolicyFingerprint

export function createPushRunLease(identity: PushRunLeaseIdentity, now = Date.now()): PushRunLease {
    const nextDay = new Date(now)
    nextDay.setHours(24, 0, 0, 0)
    return {...identity, schemaVersion: 1, issuedAt: now, expiresAt: Math.min(now + PUSH_RUN_LEASE_MS, nextDay.getTime() - 1)}
}

export function readPushRunLease(
    storage: Pick<Storage, 'getItem' | 'removeItem'>,
    identity: PushRunLeaseIdentity,
    now = Date.now(),
): PushRunLease | null {
    try {
        const raw = storage.getItem(PUSH_RUN_LEASE_KEY)
        if (!raw) return null
        const lease = JSON.parse(raw) as PushRunLease
        if (lease?.schemaVersion !== 1 || !Number.isFinite(lease.issuedAt) || !Number.isFinite(lease.expiresAt)
            || now < lease.issuedAt || now > lease.expiresAt || !sameLocalDay(lease.issuedAt, now)
            || !exactIdentity(lease, identity)) {
            storage.removeItem(PUSH_RUN_LEASE_KEY)
            return null
        }
        return lease
    } catch {
        storage.removeItem(PUSH_RUN_LEASE_KEY)
        return null
    }
}

export function writePushRunLease(
    storage: Pick<Storage, 'setItem'>,
    identity: PushRunLeaseIdentity,
    now = Date.now(),
): PushRunLease {
    const lease = createPushRunLease(identity, now)
    storage.setItem(PUSH_RUN_LEASE_KEY, JSON.stringify(lease))
    return lease
}

export function clearPushRunLease(storage: Pick<Storage, 'removeItem'>): void {
    storage.removeItem(PUSH_RUN_LEASE_KEY)
}
