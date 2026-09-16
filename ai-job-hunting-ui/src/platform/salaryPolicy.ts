function parseSalaryRange(value: string): [number, number] | null {
    const match = String(value || '').match(/(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?/)
    if (!match) return null

    const start = Number(match[1])
    const end = match[2] ? Number(match[2]) : start
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null
    return start <= end ? [start, end] : [end, start]
}

export type SalaryFit = 'UNRESTRICTED' | 'PREFERRED' | 'TOLERATED' | 'STRETCH' | 'OUTSIDE' | 'UNKNOWN'

export const SALARY_TOLERANCE_K = 3

export function evaluateSalaryRange(
    configuredRange: string,
    jobSalary: string,
    toleranceK = SALARY_TOLERANCE_K,
): SalaryFit {
    const configured = parseSalaryRange(configuredRange)
    if (!configured) return 'UNRESTRICTED'

    const offered = parseSalaryRange(jobSalary)
    if (!offered) return 'UNKNOWN'
    const lowerBoundary = configured[0] - toleranceK
    const upperBoundary = configured[1] + toleranceK
    if (offered[1] < lowerBoundary || offered[0] > upperBoundary) return 'OUTSIDE'
    if (offered[1] > upperBoundary) return 'STRETCH'
    if (configured[0] <= offered[0] && offered[1] <= configured[1]) return 'PREFERRED'
    return 'TOLERATED'
}

/** Compatibility wrapper for callers that only need a safe yes/no gate. */
export function isSalaryWithinConfiguredRange(configuredRange: string, jobSalary: string): boolean {
    return !['OUTSIDE', 'UNKNOWN'].includes(evaluateSalaryRange(configuredRange, jobSalary))
}
