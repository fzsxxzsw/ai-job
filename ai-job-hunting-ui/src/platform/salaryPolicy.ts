function parseSalaryRange(value: string): [number, number] | null {
    const match = String(value || '').match(/(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?/)
    if (!match) return null

    const start = Number(match[1])
    const end = match[2] ? Number(match[2]) : start
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null
    return start <= end ? [start, end] : [end, start]
}

/**
 * A configured salary range is a hard application boundary. Unknown or
 * unparsable job salaries fail closed so the assistant cannot apply outside it.
 */
export function isSalaryWithinConfiguredRange(configuredRange: string, jobSalary: string): boolean {
    const configured = parseSalaryRange(configuredRange)
    if (!configured) return true

    const offered = parseSalaryRange(jobSalary)
    if (!offered) return false
    return !(configured[1] < offered[0] || offered[1] < configured[0])
}
