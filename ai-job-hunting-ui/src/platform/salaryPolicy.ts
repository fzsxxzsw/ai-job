function parseSalaryRange(value: string): [number, number] | null {
    const match = String(value || '').match(/(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?/)
    if (!match) return null

    const start = Number(match[1])
    const end = match[2] ? Number(match[2]) : start
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null
    return start <= end ? [start, end] : [end, start]
}

/**
 * A configured salary range is a hard application boundary for the complete
 * advertised band. A partial overlap is not enough: 15-30K is outside 13-18K.
 * Unknown or unparsable job salaries fail closed.
 */
export function isSalaryWithinConfiguredRange(configuredRange: string, jobSalary: string): boolean {
    const configured = parseSalaryRange(configuredRange)
    if (!configured) return true

    const offered = parseSalaryRange(jobSalary)
    if (!offered) return false
    return configured[0] <= offered[0] && offered[1] <= configured[1]
}
