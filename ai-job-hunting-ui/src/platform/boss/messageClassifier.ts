export type BossMessageKind =
    | 'USER_TEXT'
    | 'RECRUITER_TEXT'
    | 'RECRUITER_REQUEST'
    | 'PLATFORM_SYSTEM'
    | 'NON_TEXT'
    | 'UNVERIFIABLE'

export type BossMessageClassification = {kind: BossMessageKind; reason: string}

const SYSTEM_BODY_TYPES = new Set([4, 8, 12, 14, 15])
const RECRUITER_REQUEST_TEXT = new Set([
    '交换微信',
    '交换联系方式',
    '我想要一个您的电话号码,您是否同意',
    '我想要一份您的附件简历,您是否同意',
])
const PLATFORM_TEXT = [
    /^你与该职位竞争者(?:的)?pk情况/i,
    /^对方拒绝了您的发送请求[。！!]?$/,
    /^您正在与boss/i,
    /^您对本职位的求职过程满意吗[？?]?$/,
    /^已发送给对方/,
    /^对方已同意/,
]

function exactId(value: unknown): string {
    if (typeof value === 'number' && !Number.isSafeInteger(value)) return ''
    if (value == null) return ''
    const id = String((value as any)?.toString?.() ?? value)
    return /^\d+$/.test(id) && BigInt(id) > 0n ? id : ''
}

function normalizedText(value: unknown): string {
    return typeof value === 'string' ? value.normalize('NFKC').trim() : ''
}

/**
 * Classify a decoded BOSS packet using only platform-owned message facts.
 * Display text alone is never enough to prove that a recruiter replied.
 */
export function classifyBossMessage(raw: any, ownAccount: unknown): BossMessageClassification {
    const own = exactId(ownAccount)
    const from = exactId(raw?.from?.uid)
    const to = exactId(raw?.to?.uid)
    const messageId = exactId(raw?.mid) || exactId(raw?.cmid)
    if (!own || !from || !to || !messageId || from === to
        || !(from === own || to === own)) {
        return {kind: 'UNVERIFIABLE', reason: '消息缺少可靠编号或参与者关系'}
    }

    const text = normalizedText(raw?.body?.text)
    const messageType = Number(raw?.type)
    const bodyType = Number(raw?.body?.type)
    if (messageType === 4 || SYSTEM_BODY_TYPES.has(bodyType)) {
        return {kind: 'PLATFORM_SYSTEM', reason: '平台系统消息或卡片'}
    }
    if (PLATFORM_TEXT.some(pattern => pattern.test(text))) {
        return {kind: 'PLATFORM_SYSTEM', reason: '平台生成的状态提示'}
    }
    if (from === own) {
        return bodyType === 1 && text && (messageType === 1 || messageType === 3)
            ? {kind: 'USER_TEXT', reason: '本人发送的可核实文本'}
            : {kind: 'NON_TEXT', reason: '本人非文本消息'}
    }
    if (to !== own) return {kind: 'UNVERIFIABLE', reason: '消息未发往当前账号'}
    if (bodyType === 7) {
        return RECRUITER_REQUEST_TEXT.has(text)
            ? {kind: 'RECRUITER_REQUEST', reason: '招聘者发起的明确交换请求'}
            : {kind: 'PLATFORM_SYSTEM', reason: '未识别的平台交互卡片'}
    }
    if (bodyType !== 1 || !text) return {kind: 'NON_TEXT', reason: '非文本消息'}
    if (messageType !== 1 && messageType !== 3) {
        return {kind: 'UNVERIFIABLE', reason: '未知消息类型'}
    }
    return {kind: 'RECRUITER_TEXT', reason: '招聘者发送的可核实文本'}
}

export function isOutcomeMessage(kind: BossMessageKind): boolean {
    return kind === 'USER_TEXT' || kind === 'RECRUITER_TEXT' || kind === 'RECRUITER_REQUEST'
}
