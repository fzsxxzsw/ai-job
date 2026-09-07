/** Platform time orders events; opaque MIDs are identities and are never sorted numerically. */
export type InboundWatermark = {mid: string; sentAt: number | null; uncertain: boolean; conversationKey: string | null; seen: string[]; submitted?: boolean}
export function advanceInboundWatermark(previous: InboundWatermark | undefined, mid: string, sentAt: number | null,
    processed: boolean, conversationKey: string | null): {state: InboundWatermark | undefined; accept: boolean} {
    if (processed) return {state: previous, accept: false}
    // Observation fences old drafts immediately. It is not evidence that the API accepted the job.
    if (previous?.mid === mid) return {state: previous, accept: !previous.submitted}
    if (previous?.seen.includes(mid)) return {state: previous, accept: false}
    const sameConversation = !previous?.conversationKey || !conversationKey || previous.conversationKey === conversationKey
    if (previous && sameConversation && previous.sentAt !== null && sentAt !== null && sentAt < previous.sentAt) {
        return {state: {...previous, seen: [...previous.seen, mid].slice(-200)}, accept: false}
    }
    const uncertain = !!previous && sameConversation && (previous.uncertain || previous.sentAt === null || sentAt === null || sentAt === previous.sentAt)
    return {state: {mid, sentAt, uncertain, conversationKey: conversationKey || (sameConversation ? previous?.conversationKey || null : null),
        seen: [...(sameConversation ? previous?.seen || [] : []), mid].slice(-200)}, accept: true}
}
