import type {BossJobCard} from './contracts'

export type BossContractErrorCode =
    | 'DETAIL_RESPONSE_INVALID'
    | 'DETAIL_CODE_REJECTED'
    | 'DETAIL_CARD_MISSING'
    | 'DETAIL_JD_MISSING'

export class BossContractError extends Error {
    readonly code: BossContractErrorCode
    readonly retryable: boolean

    constructor(code: BossContractErrorCode, message: string, retryable = true) {
        super(message)
        this.name = 'BossContractError'
        this.code = code
        this.retryable = retryable
    }
}

function asRecord(value: unknown): Record<string, any> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, any>
        : null
}

function asText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
}

export function parseBossJobCardResponse(payload: unknown): BossJobCard {
    const root = asRecord(payload)
    if (!root) {
        throw new BossContractError('DETAIL_RESPONSE_INVALID', '岗位详情响应不是对象')
    }
    if (Number(root.code) !== 0) {
        const message = asText(root.message) || asText(root.msg) || `code=${String(root.code)}`
        throw new BossContractError('DETAIL_CODE_REJECTED', `岗位详情接口拒绝请求：${message}`)
    }

    const zpData = asRecord(root.zpData)
    const card = asRecord(zpData?.jobCard)
    if (!card) {
        throw new BossContractError('DETAIL_CARD_MISSING', '岗位详情响应缺少 zpData.jobCard')
    }
    const postDescription = asText(card.postDescription)
    if (!postDescription) {
        throw new BossContractError('DETAIL_JD_MISSING', '岗位详情缺少完整 JD')
    }

    return {
        ...card,
        postDescription,
        activeTimeDesc: asText(card.activeTimeDesc),
        address: asText(card.address),
        friendStatus: Number.isFinite(Number(card.friendStatus)) ? Number(card.friendStatus) : 0,
    }
}

export function buildBossJobCardQuery(job: Pick<BossJobDetail, 'lid' | 'securityId'>): string {
    const params = new URLSearchParams()
    params.set('lid', String(job.lid || ''))
    params.set('securityId', String(job.securityId || ''))
    params.set('sessionId', '')
    return params.toString()
}
