type GreetingIdentitySource = {
    key?: string,
    toName?: string,
    createdAt?: number,
    clientMid?: string,
    serverMid?: string,
    acknowledgedAt?: number,
    bossLookup?: {encryptBossId?: string},
}

function normalizeIdentity(value: unknown): string {
    return String(value || '').normalize('NFKC').trim()
}

/** securityId is request-scoped and must never participate in delivery idempotency. */
export function makeGreetingTaskKey(encryptBossId: unknown): string {
    const stableBossIdentity = normalizeIdentity(encryptBossId)
    return stableBossIdentity ? `greeting:${stableBossIdentity}` : ''
}

function deliveryStrength(entry: GreetingIdentitySource): number {
    if (String(entry.serverMid || '').trim()) return 3
    if (entry.acknowledgedAt) return 2
    if (String(entry.clientMid || '').trim()) return 1
    return 0
}

/** Migrates old encryptBossId:securityId keys and collapses duplicate tasks per recruiter. */
export function migrateAndDedupeGreetingTasks<T extends GreetingIdentitySource>(entries: T[]): T[] {
    const deduped = new Map<string, T>()
    for (const original of entries) {
        const stableKey = makeGreetingTaskKey(original.bossLookup?.encryptBossId || original.toName)
        if (!stableKey) continue
        const entry = {...original, key: stableKey} as T
        const current = deduped.get(stableKey)
        if (!current
            || deliveryStrength(entry) > deliveryStrength(current)
            || (deliveryStrength(entry) === deliveryStrength(current)
                && Number(entry.createdAt || 0) > Number(current.createdAt || 0))) {
            deduped.set(stableKey, entry)
        }
    }
    return Array.from(deduped.values())
}

/** Reserving a new conversation greeting must never replace an earlier send record. */
export function reserveNewGreetingTask<T extends {key: string}>(queue: T[], entry: T): {queue: T[]; reserved: boolean} {
    if (queue.some(current => current.key === entry.key)) return {queue, reserved: false}
    return {queue: [...queue, entry], reserved: true}
}

/** A greeting keeps one lock while its recipient ID is learned asynchronously. */
export function greetingLockIdentity(entry: {key: string}): string {
    return entry.key
}
