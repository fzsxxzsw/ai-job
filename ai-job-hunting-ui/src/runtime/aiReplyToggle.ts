export type AiReplyToggleDependencies<T> = {
    saveSeatStatus: (enabled: boolean) => Promise<T>
    setGlobalStop: (stopped: boolean) => Promise<unknown>
}

/**
 * Keep the user-visible AI seat and the global reply stop consistent.
 * Per-conversation stops are intentionally outside this transition.
 */
export async function applyAiReplyToggle<T>(
    enabled: boolean,
    dependencies: AiReplyToggleDependencies<T>,
): Promise<T> {
    const response = await dependencies.saveSeatStatus(enabled)
    if (!enabled) return response

    try {
        await dependencies.setGlobalStop(false)
        return response
    } catch (error) {
        try {
            await dependencies.saveSeatStatus(false)
        } catch (_) {
            // The caller still fails closed locally and surfaces the original error.
        }
        throw error
    }
}
