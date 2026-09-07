import {normalizeHeadhunterFilterEnabled} from '../stores/preferencePolicy.ts'

export type EmploymentExclusionPreference = {
    fhE?: unknown
    employmentExcludeE?: unknown
    employmentExcludeKeywords?: unknown
}

const HUNTER_MARKER = '平台猎头标记'
const HUNTER_WORDS = ['猎头', '猎聘顾问', 'headhunter', 'head hunter']
const NEGATED = /(?:不是|并非|不属于|非|没有|不接受|不考虑|拒绝)\s*$/i

export function employmentExclusionKeywords(pref: EmploymentExclusionPreference): string[] {
    const values = normalizeHeadhunterFilterEnabled(pref.employmentExcludeE)
        && Array.isArray(pref.employmentExcludeKeywords) ? pref.employmentExcludeKeywords : []
    return [...new Set([
        ...values.filter((value): value is string => typeof value === 'string'),
        ...(normalizeHeadhunterFilterEnabled(pref.fhE) ? HUNTER_WORDS : []),
    ].map(value => value.normalize('NFKC').trim().toLowerCase()).filter(Boolean))]
}

/** Literal, bounded keyword rules; explicit adjacent negations are ignored. */
export function matchEmploymentExclusion(pref: EmploymentExclusionPreference, ...sources: unknown[]): string | null {
    const words = employmentExclusionKeywords(pref)
    const visit = (value: unknown, depth = 0): string | null => {
        if (depth > 8 || value == null) return null
        if (typeof value === 'string') {
            const text = value.normalize('NFKC').toLowerCase()
            for (const word of words) {
                let start = 0
                while (start < text.length) {
                    const index = text.indexOf(word, start)
                    if (index < 0) break
                    start = index + word.length
                    const latin = /^[a-z ]+$/.test(word)
                    if (latin && (/[a-z]/.test(text[index - 1] || '') || /[a-z]/.test(text[start] || ''))) continue
                    if (NEGATED.test(text.slice(Math.max(0, index - 12), index))) continue
                    return word
                }
            }
        } else if (Array.isArray(value)) {
            for (const item of value) {
                const hit = visit(item, depth + 1)
                if (hit) return hit
            }
        } else if (typeof value === 'object') {
            const record = value as Record<string, unknown>
            if (normalizeHeadhunterFilterEnabled(pref.fhE)
                && normalizeHeadhunterFilterEnabled(record.goldHunter)) return HUNTER_MARKER
            for (const item of Object.values(record)) {
                const hit = visit(item, depth + 1)
                if (hit) return hit
            }
        }
        return null
    }
    return visit(sources)
}

/** Store only matched words, never conversation text. Rules remain reversible. */
export function checkConversationExclusion(
    storage: Pick<Storage, 'getItem' | 'setItem'>,
    key: string,
    pref: EmploymentExclusionPreference,
    ...sources: unknown[]
): string | null {
    const storageKey = `job-helper-employment-exclusion-v1:${key}`
    let previous: unknown = []
    try { previous = JSON.parse(storage.getItem(storageKey) || '[]') } catch { /* Fresh check still applies. */ }
    const remembered = Array.isArray(previous) ? previous.filter(value => typeof value === 'string') : []
    const current = matchEmploymentExclusion(pref, ...sources)
    const enabled = employmentExclusionKeywords(pref)
    const hit = current || remembered.find(word => enabled.includes(word)
        || (word === HUNTER_MARKER && normalizeHeadhunterFilterEnabled(pref.fhE))) || null
    if (current && !remembered.includes(current)) {
        // A persistence error must not turn a blocked message into a sendable one.
        try { storage.setItem(storageKey, JSON.stringify([...remembered, current].slice(-100))) } catch { /* Block this turn. */ }
    }
    return hit
}
