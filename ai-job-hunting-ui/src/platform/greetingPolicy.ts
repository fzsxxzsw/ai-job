export const GREETING_DELIVERY_MODES = [
    'platform-default',
    'custom-queued',
    'custom-required',
] as const

export type GreetingDeliveryMode = typeof GREETING_DELIVERY_MODES[number]
export const GREETING_RETRY_INTERVAL_MS = 15_000

const VALID_MODES = new Set<GreetingDeliveryMode>(GREETING_DELIVERY_MODES)

/**
 * Migrates the legacy cgE switch without re-introducing the global chat-channel gate.
 * Existing custom greetings become durable background work; users can explicitly opt
 * into the strict preflight mode from preferences when every greeting must be ACKed
 * before another application is created.
 */
export function normalizeGreetingDeliveryMode(
    value: unknown,
    legacyCustomGreetingEnabled = false,
    greetingContent = '',
): GreetingDeliveryMode {
    if (VALID_MODES.has(value as GreetingDeliveryMode)) {
        return value as GreetingDeliveryMode
    }
    return legacyCustomGreetingEnabled && String(greetingContent || '').trim()
        ? 'custom-queued'
        : 'platform-default'
}

export function customGreetingEnabled(mode: GreetingDeliveryMode): boolean {
    return mode !== 'platform-default'
}

export function greetingRequiresReadyChannel(mode: GreetingDeliveryMode): boolean {
    return mode === 'custom-required'
}

export function greetingBlocksNewApplications(mode: GreetingDeliveryMode): boolean {
    return mode === 'custom-required'
}
