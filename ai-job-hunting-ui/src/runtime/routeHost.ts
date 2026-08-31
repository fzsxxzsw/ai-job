export const AI_JOB_ROUTE_CHANGE_EVENT = 'ai-job-helper:route-change'

type HistoryMethod = 'pushState' | 'replaceState'

export type RouteHostWindow = Pick<Window,
    'location' | 'history' | 'addEventListener' | 'removeEventListener' | 'dispatchEvent'> & {
    Event: typeof Event
    __AI_JOB_HELPER_ROUTE_HOST__?: RouteHostState
}

type RouteHostState = {
    href: string
    listeners: Set<(href: string) => void>
    originals: Partial<Record<HistoryMethod, History[HistoryMethod]>>
    popstateHandler: () => void
    hashchangeHandler: () => void
}

export type RouteHostSubscription = {
    currentHref: () => string
    dispose: () => void
}

export type BossViewKey = 'chat' | 'jobs' | 'job-recommend' | 'job' | 'overseas' | 'unsupported'

export type BossMountTarget = {
    el: Element
    p?: string
    provisional?: boolean
}

export function getBossViewKey(url: string): BossViewKey {
    let parsed: URL
    try {
        parsed = new URL(url, 'https://www.zhipin.com')
    } catch (_) {
        return 'unsupported'
    }
    if (parsed.pathname.startsWith('/overseas/')) return 'overseas'
    if (parsed.pathname.startsWith('/web/geek/chat')) return 'chat'
    if (parsed.pathname.startsWith('/web/geek/job-recommend')) return 'job-recommend'
    if (parsed.pathname.startsWith('/web/geek/jobs')) return 'jobs'
    if (parsed.pathname.startsWith('/web/geek/job')) return 'job'
    return 'unsupported'
}

export function findBossMountTarget(
    targetDocument: Pick<Document, 'querySelector' | 'body'>,
    url: string,
    allowFallback = false,
): BossMountTarget | null {
    let selector = ''
    let p = ''
    switch (getBossViewKey(url)) {
        case 'chat':
            selector = '.chat-conversation'
            break
        case 'job-recommend':
            selector = '.recommend-search-inner'
            p = 'end'
            break
        case 'jobs':
            selector = '.job-recommend-result'
            break
        case 'job':
            selector = '.page-job-inner'
            break
        case 'overseas':
            selector = '.mod-header'
            break
    }
    const preferred = selector ? targetDocument.querySelector(selector) : null
    if (preferred) return {el: preferred, p}
    if (!allowFallback) return null
    const fallback = targetDocument.querySelector('.page-jobs-main')
        ?? targetDocument.querySelector('#wrap')
        ?? targetDocument.body
    return fallback ? {el: fallback, p: 'end', provisional: true} : null
}

export function shouldRecoverBossMount(
    rootConnected: boolean,
    provisional: boolean,
    placementActive: boolean,
): boolean {
    return (!rootConnected || provisional) && !placementActive
}

/**
 * BOSS is a SPA. It changes routes through history.pushState/replaceState, so
 * popstate alone cannot keep the userscript view and mount target current.
 * One shared host is installed per page and supports multiple subscribers.
 */
export function observeBossRoute(
    target: RouteHostWindow,
    listener: (href: string) => void,
): RouteHostSubscription {
    let state = target.__AI_JOB_HELPER_ROUTE_HOST__
    if (!state) {
        const listeners = new Set<(href: string) => void>()
        const notify = () => {
            const nextHref = String(target.location.href)
            if (nextHref === state?.href) return
            if (state) state.href = nextHref
            for (const callback of listeners) callback(nextHref)
            target.dispatchEvent(new target.Event(AI_JOB_ROUTE_CHANGE_EVENT))
        }
        const popstateHandler = () => notify()
        const hashchangeHandler = () => notify()
        state = {
            href: String(target.location.href),
            listeners,
            originals: {},
            popstateHandler,
            hashchangeHandler,
        }
        target.__AI_JOB_HELPER_ROUTE_HOST__ = state

        for (const method of ['pushState', 'replaceState'] as HistoryMethod[]) {
            const original = target.history[method]
            state.originals[method] = original
            target.history[method] = function (this: History, ...args: Parameters<History[HistoryMethod]>) {
                const result = original.apply(this, args as any)
                notify()
                return result
            } as History[HistoryMethod]
        }
        target.addEventListener('popstate', popstateHandler)
        target.addEventListener('hashchange', hashchangeHandler)
    }

    state.listeners.add(listener)
    listener(state.href)

    return {
        currentHref: () => String(target.location.href),
        dispose: () => {
            const liveState = target.__AI_JOB_HELPER_ROUTE_HOST__
            if (!liveState) return
            liveState.listeners.delete(listener)
            if (liveState.listeners.size > 0) return
            for (const method of ['pushState', 'replaceState'] as HistoryMethod[]) {
                const original = liveState.originals[method]
                if (original) target.history[method] = original
            }
            target.removeEventListener('popstate', liveState.popstateHandler)
            target.removeEventListener('hashchange', liveState.hashchangeHandler)
            delete target.__AI_JOB_HELPER_ROUTE_HOST__
        },
    }
}
