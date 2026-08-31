export function normalizeHeadhunterFilterEnabled(value: unknown): boolean {
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase()
        return normalized === 'true' || normalized === '1'
    }
    if (typeof value === 'number') return value === 1
    return value === true
}
