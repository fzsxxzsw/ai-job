const text = (value: unknown) => typeof value === 'string' ? value : ''
const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0
const flag = (value: unknown) => value === true
const texts = (value: unknown) => Array.isArray(value) ? value.map(text).filter(Boolean) : []

/**
 * BOSS job cards can be Vue proxies and may expose methods/getters from the page.
 * Unified automation persists this context, so copy only the inert fields used by
 * the executor instead of cloning the page-owned object.
 */
export type SerializableBossJobDetail = Omit<BossJobDetail, 'getJobKey'>

export function serializableBossJobDetail(job: BossJobDetail): SerializableBossJobDetail {
    return {
        securityId: text(job.securityId), bossAvatar: text(job.bossAvatar), bossCert: number(job.bossCert),
        encryptBossId: text(job.encryptBossId), bossName: text(job.bossName), bossTitle: text(job.bossTitle),
        goldHunter: number(job.goldHunter), bossOnline: flag(job.bossOnline), encryptJobId: text(job.encryptJobId),
        expectId: number(job.expectId), jobName: text(job.jobName), lid: text(job.lid), salaryDesc: text(job.salaryDesc),
        jobLabels: texts(job.jobLabels), jobValidStatus: number(job.jobValidStatus), iconWord: text(job.iconWord),
        skills: texts(job.skills), jobExperience: text(job.jobExperience), daysPerWeekDesc: text(job.daysPerWeekDesc),
        leastMonthDesc: text(job.leastMonthDesc), jobDegree: text(job.jobDegree), cityName: text(job.cityName),
        areaDistrict: text(job.areaDistrict), businessDistrict: text(job.businessDistrict), jobType: number(job.jobType),
        proxyJob: number(job.proxyJob), proxyType: number(job.proxyType), anonymous: number(job.anonymous),
        outland: number(job.outland), optimal: number(job.optimal), iconFlagList: [], itemId: number(job.itemId),
        city: number(job.city), isShield: number(job.isShield), atsDirectPost: flag(job.atsDirectPost), gps: null,
        lastModifyTime: number(job.lastModifyTime), encryptBrandId: text(job.encryptBrandId), brandName: text(job.brandName),
        brandLogo: text(job.brandLogo), brandStageName: text(job.brandStageName), brandIndustry: text(job.brandIndustry),
        brandScaleName: text(job.brandScaleName), welfareList: texts(job.welfareList), industry: number(job.industry),
        contact: flag(job.contact), processed: flag(job.processed),
    }
}
