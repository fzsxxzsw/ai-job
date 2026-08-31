export type BossDailyLimitSignal = {
    reason: string,
    matchedText: string,
}

const MESSAGE_KEYS = new Set([
    'message',
    'msg',
    'content',
    'title',
    'subTitle',
    'subtitle',
    'tip',
    'tips',
    'toast',
    'description',
])

const DAILY_LIMIT_PATTERNS = [
    /(?:今日|今天|当天|本日|每日)(?:的)?.{0,18}(?:沟通|开聊|投递|打招呼|发起沟通|联系).{0,18}(?:(?:已?达(?:到)?|超过|超出).{0,6}(?:上限|限制)|(?:人数|次数|数量|名额|额度).{0,8}(?:已满|用完|耗尽|无剩余|没有剩余))/i,
    /(?:沟通|开聊|投递|打招呼|发起沟通|联系).{0,14}(?:人数|次数|数量|名额|额度).{0,16}(?:(?:已?达(?:到)?|超过|超出).{0,8}(?:(?:今日|今天|当天|本日|每日)(?:的)?)?.{0,6}(?:上限|限制)|(?:已满|用完|耗尽|无剩余|没有剩余))/i,
    /(?:今日|今天|当天|本日).{0,12}已与.{0,12}(?:位|名)?\s*(?:BOSS|招聘者|联系人).{0,12}(?:沟通|开聊).{0,12}(?:上限|已满|不能继续|无法继续|明日再试|明天再(?:来|试))/i,
    /(?:daily).{0,12}(?:chat|contact|application).{0,16}(?:limit).{0,8}(?:reached|exceeded)/i,
]

/**
 * 只从常见消息字段收集 BOSS 返回文案，避免把职位描述等业务正文误判为平台上限。
 */
export function collectBossLimitTexts(value: unknown): string[] {
    const texts: string[] = []
    const seen = new Set<object>()

    const visit = (input: unknown, depth: number, key = '') => {
        if (depth > 7 || input == null) return
        if (typeof input === 'string') {
            if (!key || MESSAGE_KEYS.has(key)) {
                const text = input.trim()
                if (text) texts.push(text)
            }
            return
        }
        if (typeof input !== 'object' || seen.has(input as object)) return
        seen.add(input as object)

        if (Array.isArray(input)) {
            input.slice(0, 20).forEach(item => visit(item, depth + 1, key))
            return
        }
        Object.entries(input as Record<string, unknown>).forEach(([childKey, child]) => {
            if (typeof child === 'string') {
                visit(child, depth + 1, childKey)
            } else {
                visit(child, depth + 1, childKey)
            }
        })
    }

    visit(value, 0)
    return [...new Set(texts)]
}

/** 纯判定函数：只有明确表示“当日额度已耗尽”的返回才触发停机。 */
export function detectBossDailyLimit(value: unknown): BossDailyLimitSignal | null {
    for (const text of collectBossLimitTexts(value)) {
        if (DAILY_LIMIT_PATTERNS.some(pattern => pattern.test(text))) {
            return {
                reason: `BOSS 当日沟通上限：${text.slice(0, 160)}`,
                matchedText: text,
            }
        }
    }
    return null
}

/**
 * Versions that briefly shipped with a fixed local cap wrote this value into the
 * same daily key as a real BOSS limit. Ignore it so an upgrade takes effect
 * immediately instead of leaving the current day falsely blocked.
 */
export function isLegacyLocalDailyLimit(value: unknown): boolean {
    return typeof value === 'string' && value.startsWith('本地安全日上限')
}

export function formatLocalDay(date: Date = new Date()): string {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

/** 与既有 Tampermonkey PUSH_LIMIT 标记保持同一键格式，并让它按本地自然日失效。 */
export function makeBossDailyLimitKey(date: Date = new Date()): string {
    return `push_limit${formatLocalDay(date)}`
}

export function makePushSuccessCountKey(date: Date = new Date()): string {
    return `pushSuccessCount:${formatLocalDay(date)}`
}

export function makePushFailCountKey(date: Date = new Date()): string {
    return `pushFailCount:${formatLocalDay(date)}`
}

/** Merge the tab-local value with shared storage before incrementing to avoid stale overwrites. */
export function nextSharedDailyCounterValue(localValue: unknown, persistedValue: unknown): number {
    const normalize = (value: unknown) => {
        const count = Number(value)
        return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
    }
    return Math.max(normalize(localValue), normalize(persistedValue)) + 1
}
