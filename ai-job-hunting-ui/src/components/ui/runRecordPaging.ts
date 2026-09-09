export function resolveLiveLogPage(
    currentPage: number,
    pageSize: number,
    previousTotal: number,
    nextTotal: number,
): number {
    const safePageSize = Math.max(1, Math.floor(pageSize) || 1)
    const previousLastPage = Math.max(1, Math.ceil(previousTotal / safePageSize))
    const nextLastPage = Math.max(1, Math.ceil(nextTotal / safePageSize))

    if (currentPage >= previousLastPage) {
        return nextLastPage
    }
    return Math.min(Math.max(1, currentPage), nextLastPage)
}
