const BOSS_CLIENT_MID_OFFSET = 68256432452609n

/**
 * BOSS requires a positive int64 clientMid. Date.now() alone can return the same
 * value for several messages created in one tick, so keep a monotonic sequence
 * while preserving the timestamp-shaped ids accepted by the chat service.
 */
export function createClientMidGenerator(now: () => number = Date.now): () => string {
    let last = 0n
    return () => {
        const timestamp = BigInt(Math.max(0, Math.trunc(now())))
        const candidate = timestamp + BOSS_CLIENT_MID_OFFSET
        last = candidate > last ? candidate : last + 1n
        return last.toString()
    }
}

export const nextClientMid = createClientMidGenerator()
