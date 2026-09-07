const modelPaths = new Set([
    '/api/job/filter/one', '/api/job/seeker/cloned/ask',
    '/api/job/ai/assistant/generate/greeting', '/api/user/ai/config/debug',
    '/api/job/ai/rejections/analyze', '/api/user/ai/routing/test',
])

export function modelRequestTimeout(url?: string, timeout = 10000): number {
    const path = '/' + (url || '').split('?')[0].replace(/^\/+/, '')
    // Router caps the entire fallback sequence at 120 s, not per attempt.
    return modelPaths.has(path) ? Math.max(timeout, 130000) : timeout
}
