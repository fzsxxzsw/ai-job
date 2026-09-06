export class ApiRequestError extends Error {
    code: string | number
    response?: unknown
    constructor(message: string, code: string | number, response?: unknown) {
        super(message)
        this.name = 'ApiRequestError'
        this.code = code
        this.response = response
    }
}
export function responseErrorMessage(value: unknown, fallback = '服务返回异常，请稍后重试'): string {
    return typeof value === 'string' && value.trim() ? value.trim().slice(0, 600) : fallback
}
