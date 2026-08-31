export type DeliveryAuditMaterialState = {
    status?: string,
    jobTitle?: string,
    content?: string,
    attempts?: number,
    lastError?: string,
    bossId?: string,
    conversationKey?: string,
    clientMid?: string,
    serverMid?: string,
}

const MATERIAL_FIELDS: ReadonlyArray<keyof DeliveryAuditMaterialState> = [
    'status',
    'jobTitle',
    'content',
    'attempts',
    'lastError',
    'bossId',
    'conversationKey',
    'clientMid',
    'serverMid',
]

/** Polling the same state is not a delivery transition and must not be persisted/reported again. */
export function hasMaterialDeliveryAuditChange(
    previous: DeliveryAuditMaterialState | undefined,
    next: DeliveryAuditMaterialState,
): boolean {
    return !previous || MATERIAL_FIELDS.some(field => previous[field] !== next[field])
}
