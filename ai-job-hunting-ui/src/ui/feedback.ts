export const UI_PANEL_Z_INDEX = 10010
export const UI_FEEDBACK_Z_INDEX = 10050

/** Clone caller options; never turn a VNode into '[object Object]' or parse text as HTML. */
export function feedbackOptions(value: any, type?: string): any {
    const options = typeof value === 'string' ? {message: value} : {...(value || {})}
    if (typeof options.message === 'string' && !options.message.startsWith('[AI助理] ')) {
        options.message = '[AI助理] ' + options.message
    }
    return {...options, ...(type ? {type} : {}), grouping: true,
        dangerouslyUseHTMLString: false,
        duration: options.duration ?? 3000,
        customClass: ['job-helper-toast', options.customClass].filter(Boolean).join(' '),
        zIndex: UI_FEEDBACK_Z_INDEX}
}

export function createToastGate(intervalMs = 3000, now = Date.now) {
    const shown = new Map<string, number>()
    return (message: string, type = 'error') => {
        const time = now()
        for (const [key, expiry] of shown) if (expiry <= time) shown.delete(key)
        const key = type + ':' + message
        if (shown.has(key)) return false
        if (shown.size >= 30) shown.delete(shown.keys().next().value!)
        shown.set(key, time + intervalMs)
        return true
    }
}

/** Kept as plain text all the way to Element Plus; no external image URL or HTML insertion. */
export function replyNoticeText(name: unknown, question: unknown, answer: unknown): string {
    const text = (value: unknown, max: number) => typeof value === 'string' ? value.slice(0, max) : ''
    return `${text(name, 100) || '联系人'}：\n${text(question, 1000)}\n\nAI助手：\n${text(answer, 2000)}`
}
