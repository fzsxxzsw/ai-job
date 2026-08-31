export type DeliveryLockExecution<T> = {
    acquired: boolean,
    value?: T,
}

const DELIVERY_LOCK_PREFIX = 'ai-job-hunting-delivery-v1'

function stableHash(value: string): string {
    let hash = 2166136261
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index)
        hash = Math.imul(hash, 16777619)
    }
    return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * Web Lock names are observable by other scripts in the same origin. Hash the
 * delivery identity so recruiter/conversation identifiers are not exposed.
 */
export function makeDeliveryLockName(scope: string, identity: string): string {
    const normalizedScope = String(scope || 'delivery').replace(/[^a-z0-9_-]+/gi, '-').slice(0, 32)
    const normalizedIdentity = String(identity || 'unknown')
    return `${DELIVERY_LOCK_PREFIX}:${normalizedScope}:${stableHash(`${normalizedScope}:${normalizedIdentity}`)}`
}

/**
 * Acquire a non-blocking, cross-tab delivery lock. Browsers without Web Locks
 * retain the existing single-tab behavior; a broken/contended lock manager is
 * treated as "not acquired" so we never fall back to an unsafe duplicate send.
 */
export async function runWithOptionalDeliveryLock<T>(
    lockManager: any,
    scope: string,
    identity: string,
    executor: () => Promise<T>,
): Promise<DeliveryLockExecution<T>> {
    if (!lockManager?.request) return {acquired: true, value: await executor()}
    let executorStarted = false
    try {
        return await lockManager.request(
            makeDeliveryLockName(scope, identity),
            {mode: 'exclusive', ifAvailable: true},
            async (lock: unknown) => {
                if (!lock) return {acquired: false}
                executorStarted = true
                return {acquired: true, value: await executor()}
            },
        )
    } catch (error) {
        // Never disguise a send/persistence failure as simple lock contention.
        if (executorStarted) throw error
        return {acquired: false}
    }
}
