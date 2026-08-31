import type {
    BossJobCollectionResult,
    BossJobSource,
    BossJobSourceDiagnostic,
} from './contracts'

type RecordLike = Record<string, any>

type ElementLike = {
    __vue__?: any
    __vueParentComponent?: any
    dataset?: Record<string, string | undefined>
    textContent?: string | null
    querySelector?: (selector: string) => ElementLike | null
    getAttribute?: (name: string) => string | null
}

const SEARCH_API_PATH = '/wapi/zpgeek/search/joblist.json'
const MAX_CAPTURED_JOBS = 300
let capturedApiJobs: BossJobDetail[] = []

function asRecord(value: unknown): RecordLike {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordLike : {}
}

function firstString(...values: unknown[]): string {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) return value.trim()
        if (typeof value === 'number' && Number.isFinite(value)) return String(value)
    }
    return ''
}

function firstNumber(fallback: number, ...values: unknown[]): number {
    for (const value of values) {
        const parsed = Number(value)
        if (Number.isFinite(parsed)) return parsed
    }
    return fallback
}

function firstBoolean(...values: unknown[]): boolean {
    for (const value of values) {
        if (typeof value === 'boolean') return value
        if (value === 1 || value === '1') return true
        if (value === 0 || value === '0') return false
    }
    return false
}

function firstArray(...values: unknown[]): any[] {
    for (const value of values) {
        if (Array.isArray(value)) return value
    }
    return []
}

function textFrom(element: ElementLike | undefined, selectors: string[]): string {
    if (!element?.querySelector) return ''
    for (const selector of selectors) {
        const value = element.querySelector(selector)?.textContent?.trim()
        if (value) return value
    }
    return ''
}

function readHref(element?: ElementLike): string {
    if (!element) return ''
    const direct = element.getAttribute?.('href') || ''
    if (direct) return direct
    return element.querySelector?.('a[href]')?.getAttribute?.('href') || ''
}

function parseLinkIdentity(href: string): {encryptJobId: string, securityId: string, lid: string} {
    if (!href) return {encryptJobId: '', securityId: '', lid: ''}
    try {
        const url = new URL(href, 'https://www.zhipin.com')
        const pathJobId = url.pathname.match(/\/job_detail\/([^/.?]+)/)?.[1] || ''
        return {
            encryptJobId: firstString(url.searchParams.get('jobId'), url.searchParams.get('encryptJobId'), pathJobId),
            securityId: firstString(url.searchParams.get('securityId')),
            lid: firstString(url.searchParams.get('lid')),
        }
    } catch (_) {
        return {encryptJobId: '', securityId: '', lid: ''}
    }
}

function unwrapRawJob(value: unknown): RecordLike {
    const root = asRecord(value)
    const jobInfo = asRecord(root.jobInfo)
    return Object.keys(jobInfo).length > 0 ? {...root, ...jobInfo} : root
}

export function normalizeBossJob(
    value: unknown,
    source: BossJobSource,
    element?: ElementLike,
): BossJobDetail | null {
    const raw = unwrapRawJob(value)
    const boss = asRecord(raw.bossInfo || raw.recruiterInfo)
    const brand = asRecord(raw.brandComInfo || raw.brandInfo || raw.companyInfo)
    const dataset = element?.dataset || {}
    const link = parseLinkIdentity(readHref(element))

    const encryptJobId = firstString(
        raw.encryptJobId,
        raw.jobId,
        dataset.encryptJobId,
        dataset.jobId,
        link.encryptJobId,
    )
    const securityId = firstString(raw.securityId, dataset.securityId, link.securityId)
    const lid = firstString(raw.lid, dataset.lid, link.lid)
    const jobName = firstString(
        raw.jobName,
        raw.positionName,
        raw.title,
        textFrom(element, ['.job-name', '.job-title', '[class*="job-name"]']),
    )

    // All three values are required by job/card and friend/add. Returning a
    // partial object would merely move the failure deeper into the pipeline.
    if (!encryptJobId || !securityId || !jobName) return null

    const brandName = firstString(
        raw.brandName,
        raw.companyName,
        brand.brandName,
        brand.companyName,
        textFrom(element, ['.company-name', '.company-text', '[class*="company-name"]']),
    )
    const salaryDesc = firstString(
        raw.salaryDesc,
        raw.salary,
        textFrom(element, ['.salary', '[class*="salary"]']),
    )

    const result = {
        securityId,
        bossAvatar: firstString(raw.bossAvatar, boss.bossAvatar, boss.avatar),
        bossCert: firstNumber(0, raw.bossCert, boss.bossCert),
        encryptBossId: firstString(raw.encryptBossId, boss.encryptBossId, boss.encryptUid),
        bossName: firstString(raw.bossName, boss.bossName, boss.name),
        bossTitle: firstString(raw.bossTitle, boss.bossTitle, boss.title),
        goldHunter: firstNumber(0, raw.goldHunter, boss.goldHunter),
        bossOnline: firstBoolean(raw.bossOnline, boss.bossOnline, boss.online),
        encryptJobId,
        expectId: firstNumber(0, raw.expectId),
        jobName,
        lid,
        salaryDesc,
        jobLabels: firstArray(raw.jobLabels, raw.labels).map(String),
        jobValidStatus: firstNumber(0, raw.jobValidStatus),
        iconWord: firstString(raw.iconWord),
        skills: firstArray(raw.skills).map(String),
        jobExperience: firstString(raw.jobExperience, raw.experienceName),
        daysPerWeekDesc: firstString(raw.daysPerWeekDesc),
        leastMonthDesc: firstString(raw.leastMonthDesc),
        jobDegree: firstString(raw.jobDegree, raw.degreeName),
        cityName: firstString(raw.cityName, raw.city, textFrom(element, ['.job-area', '[class*="job-area"]'])),
        areaDistrict: firstString(raw.areaDistrict, raw.districtName),
        businessDistrict: firstString(raw.businessDistrict),
        jobType: firstNumber(0, raw.jobType),
        proxyJob: firstNumber(0, raw.proxyJob),
        proxyType: firstNumber(0, raw.proxyType),
        anonymous: firstNumber(0, raw.anonymous),
        outland: firstNumber(0, raw.outland),
        optimal: firstNumber(0, raw.optimal),
        iconFlagList: firstArray(raw.iconFlagList),
        itemId: firstNumber(0, raw.itemId),
        city: firstNumber(0, raw.city),
        isShield: firstNumber(0, raw.isShield),
        atsDirectPost: firstBoolean(raw.atsDirectPost),
        gps: raw.gps || null,
        lastModifyTime: firstNumber(0, raw.lastModifyTime),
        encryptBrandId: firstString(raw.encryptBrandId, brand.encryptBrandId),
        brandName,
        brandLogo: firstString(raw.brandLogo, brand.brandLogo, brand.logo),
        brandStageName: firstString(raw.brandStageName, brand.brandStageName),
        brandIndustry: firstString(raw.brandIndustry, brand.brandIndustry),
        brandScaleName: firstString(raw.brandScaleName, brand.brandScaleName),
        welfareList: firstArray(raw.welfareList, raw.welfare).map(String),
        industry: firstNumber(0, raw.industry),
        contact: firstBoolean(raw.contact, raw.friendStatus, raw.hasContact),
        processed: firstBoolean(raw.processed),
        getJobKey: () => `${jobName}:${brandName}`,
        __source: source,
    }
    return result as unknown as BossJobDetail
}

function rawFromVue3(element: ElementLike): unknown {
    const component = element.__vueParentComponent
    return component?.props?.data
        || component?.props?.job
        || component?.props?.item
        || component?.ctx?.data
        || component?.ctx?.job
        || component?.setupState?.data
        || component?.setupState?.job
        || component?.vnode?.props?.data
        || component?.vnode?.props?.job
}

function collectCandidateObjects(payload: unknown): unknown[] {
    const result: unknown[] = []
    const visited = new WeakSet<object>()
    const visit = (value: unknown, depth: number) => {
        if (!value || typeof value !== 'object' || depth > 8) return
        if (visited.has(value as object)) return
        visited.add(value as object)
        if (Array.isArray(value)) {
            for (const item of value) visit(item, depth + 1)
            return
        }
        const record = value as RecordLike
        const job = unwrapRawJob(record)
        if (firstString(job.encryptJobId, job.jobId) && firstString(job.securityId)) {
            result.push(record)
            return
        }
        for (const child of Object.values(record)) visit(child, depth + 1)
    }
    visit(payload, 0)
    return result
}

export function rememberBossJobSearchResponse(payload: unknown): BossJobDetail[] {
    const jobs = collectCandidateObjects(payload)
        .map(item => normalizeBossJob(item, 'search-api'))
        .filter((job): job is BossJobDetail => !!job)
    const unique = new Map<string, BossJobDetail>()
    for (const job of jobs) unique.set(job.encryptJobId, job)
    capturedApiJobs = Array.from(unique.values()).slice(0, MAX_CAPTURED_JOBS)
    return [...capturedApiJobs]
}

export function clearRememberedBossJobs(): void {
    capturedApiJobs = []
}

function selectorForUrl(url: string): string {
    let pathname = ''
    try {
        pathname = new URL(url, 'https://www.zhipin.com').pathname
    } catch (_) {
        return '.job-card-wrapper, .job-card-wrap'
    }
    if (pathname.startsWith('/overseas/')) return '.job-card-box'
    if (pathname.startsWith('/web/geek/job-recommend')) return '.job-card-wrap'
    if (pathname.startsWith('/web/geek/jobs')) return '.job-card-wrap, .job-card-wrapper'
    return '.job-card-wrapper, .job-card-wrap'
}

function createDiagnostic(source: BossJobSource): BossJobSourceDiagnostic {
    return {source, inspected: 0, accepted: 0, rejected: 0, errors: []}
}

export function collectBossJobs(
    documentLike: Pick<Document, 'querySelectorAll'>,
    url: string,
): BossJobCollectionResult {
    const diagnostics = new Map<BossJobSource, BossJobSourceDiagnostic>([
        ['search-api', createDiagnostic('search-api')],
        ['vue3', createDiagnostic('vue3')],
        ['vue2', createDiagnostic('vue2')],
        ['dom', createDiagnostic('dom')],
    ])
    const elements = Array.from(documentLike.querySelectorAll(selectorForUrl(url))) as unknown as ElementLike[]
    const jobs = new Map<string, BossJobDetail>()

    const accept = (source: BossJobSource, raw: unknown, element?: ElementLike) => {
        const diagnostic = diagnostics.get(source)!
        diagnostic.inspected++
        try {
            const job = normalizeBossJob(raw, source, element)
            if (!job) {
                diagnostic.rejected++
                return null
            }
            diagnostic.accepted++
            if (!jobs.has(job.encryptJobId)) jobs.set(job.encryptJobId, job)
            return job
        } catch (error: any) {
            diagnostic.rejected++
            diagnostic.errors.push(String(error?.message || error || 'unknown error'))
            return null
        }
    }

    // Visible identifiers prevent a previous search response from leaking into
    // the current result set. If the DOM reveals none, the latest API response
    // remains the best available source.
    const visibleIds = new Set<string>()
    for (const element of elements) {
        const identity = parseLinkIdentity(readHref(element)).encryptJobId
            || firstString(element.dataset?.encryptJobId, element.dataset?.jobId)
        if (identity) visibleIds.add(identity)
    }
    for (const apiJob of capturedApiJobs) {
        if (visibleIds.size === 0 || visibleIds.has(apiJob.encryptJobId)) {
            accept('search-api', apiJob)
        }
    }

    for (const element of elements) {
        const vue3 = rawFromVue3(element)
        if (vue3 && accept('vue3', vue3, element)) continue
        const vue2 = element.__vue__?.data || element.__vue__?.job || element.__vue__?.item
        if (vue2 && accept('vue2', vue2, element)) continue
        accept('dom', {}, element)
    }

    return {jobs: Array.from(jobs.values()), diagnostics: Array.from(diagnostics.values())}
}

export function installBossJobSearchCapture(pageWindow: any = window): void {
    const marker = '__AI_JOB_HELPER_JOB_SEARCH_CAPTURE_V1__'
    if (pageWindow[marker]) return
    pageWindow[marker] = true

    const capture = (url: unknown, payload: unknown) => {
        if (String(url || '').includes(SEARCH_API_PATH)) rememberBossJobSearchResponse(payload)
    }

    if (typeof pageWindow.fetch === 'function') {
        const originalFetch = pageWindow.fetch
        pageWindow.fetch = async function (...args: any[]) {
            const response = await originalFetch.apply(this, args)
            const url = typeof args[0] === 'string' ? args[0] : args[0]?.url
            if (String(url || '').includes(SEARCH_API_PATH)) {
                void response.clone().json().then((payload: unknown) => capture(url, payload)).catch(() => undefined)
            }
            return response
        }
    }

    const xhrPrototype = pageWindow.XMLHttpRequest?.prototype
    if (xhrPrototype?.open && xhrPrototype?.send) {
        const originalOpen = xhrPrototype.open
        const originalSend = xhrPrototype.send
        xhrPrototype.open = function (_method: string, url: string, ...rest: any[]) {
            this.__aiJobHelperRequestUrl = String(url || '')
            return originalOpen.call(this, _method, url, ...rest)
        }
        xhrPrototype.send = function (...args: any[]) {
            if (String(this.__aiJobHelperRequestUrl || '').includes(SEARCH_API_PATH)) {
                this.addEventListener('loadend', () => {
                    try {
                        const payload = typeof this.response === 'object' && this.response !== null
                            ? this.response
                            : JSON.parse(this.responseText || 'null')
                        capture(this.__aiJobHelperRequestUrl, payload)
                    } catch (_) {
                        // A malformed/blocked response is reported by the normal adapter diagnostics.
                    }
                }, {once: true})
            }
            return originalSend.apply(this, args)
        }
    }
}
