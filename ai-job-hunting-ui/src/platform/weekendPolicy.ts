export type WeekendBenefitStatus = 'POSITIVE' | 'NEGATIVE' | 'UNKNOWN'

export function weekendBenefitStatus(text: string): WeekendBenefitStatus {
    const normalized = String(text || '').replace(/\s+/g, '')
    const strongPositive = /(周末双休|固定双休|标准双休|周休(?:二|2)日|做五休二|五天工作制|周一至周五)/.test(normalized)
    const negatedDoubleRest = /(不是|并非|不保证|非|无|没有|不提供|不固定).{0,4}双休|双休.{0,4}(?:不固定|无法保证|不保证)/.test(normalized)
    const explicitNegative = /(大小周|单双休|单休|月休(?:4|5|6)天|每周休(?:一|1)天)/.test(normalized)
    if (negatedDoubleRest || (explicitNegative && !strongPositive)) return 'NEGATIVE'
    if (strongPositive || /双休/.test(normalized)) return 'POSITIVE'
    return 'UNKNOWN'
}
