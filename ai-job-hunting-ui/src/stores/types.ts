import {PlatformTypeEnum} from "../platform/platform";
import {
    SAFE_DEFAULT_NEXT_PAGE_INTERVAL_SECONDS,
    SAFE_DEFAULT_PUSH_INTERVAL_SECONDS,
    SAFE_MIN_NEXT_PAGE_INTERVAL_SECONDS,
    SAFE_MIN_PUSH_INTERVAL_SECONDS,
} from "../platform/safetyLimits";
import {
    GreetingDeliveryMode,
    normalizeGreetingDeliveryMode,
} from "../platform/greetingPolicy";
import {normalizeHeadhunterFilterEnabled} from "./preferencePolicy";

export type User = {
    phone: string
    email: string
    resumeId: string
    aiSeatStatus: number,
    inviteCode: string,
    bindInviteCode: string,
    preference: PreferenceConfig
    preferenceMap: Map<PlatformTypeEnum, PreferenceConfig>

}

export type BenefitPreferenceMode = 'off' | 'prefer' | 'required'
export type JobTitleMatchMode = 'off' | 'prefer' | 'required'

export type PreferenceConfig = {
    /** 是否启用简历与 JD 的本地分层规则匹配 */
    resumeMatchE: boolean,
    /** 简历与 JD 的参考分；本地个人版不再用技能分硬过滤 */
    resumeMatchMinScore: number,
    /** JD 匹配处理方式；本地个人版固定为仅建议 */
    resumeMatchMode: 'advisory' | 'strict',
    /** 通勤位置关键词，例如区、商圈、地铁站 */
    commuteLocations: string[],
    /** 通勤位置偏好：关闭、优先、必须 */
    commuteMode: BenefitPreferenceMode,
    /** 周末双休偏好：关闭、优先、必须 */
    weekendMode: BenefitPreferenceMode,
    /** 五险一金偏好：关闭、优先、必须 */
    insuranceMode: BenefitPreferenceMode,
    /**
     * 公司名包含开关
     */
    cniE: boolean,
    /**
     * 公司名包含
     */
    cni: string[],
    /**
     * 公司名排除开关
     */
    cneE: boolean,
    /**
     * 公司名排除
     */
    cne: string[],
    /**
     * 工作名包含开关
     */
    jniE: boolean,
    /** 岗位名规则：关闭、仅排序、必须命中 */
    jobTitleMatchMode: JobTitleMatchMode,
    /**
     * 工作名包含
     */
    jni: string[],
    /**
     * 工作名排除开关
     */
    jneE: boolean,
    /**
     * 工作名排除
     */
    jne: string[],
    /**
     * 工作名内容排除开关
     */
    jceE: boolean,
    /**
     * 工作名内容排除
     */
    jce: string[],
    /**
     * 工作名内容包含开关
     */
    jciE: boolean,
    /**
     * 工作名内容包含
     */
    jci: string[],
    /**
     * 薪资范围开关
     */
    srE: boolean,
    /**
     * 薪资范围类型
     */
    srT: number,
    /**
     * 薪资范围
     */
    sr: string,
    /**
     * 公司规模范围开关
     */
    csrE: boolean,
    /**
     * 公司规模范围
     */
    csr: string,
    /**
     * 过滤猎头开关
     */
    fhE: boolean,
    /**
     * 仅投递在线boss
     */
    polE: boolean,
    /**
     * 发送自定义招呼语
     */
    cgE: boolean,
    /** 首次沟通消息策略：平台默认、后台补发或严格确认 */
    greetingDeliveryMode: GreetingDeliveryMode,
    /**
     * 自定义招呼语
     */
    cg: string,
    /**
     * ai过滤开关
     */
    afE: boolean,
    /**
     * ai过滤条件
     */
    af: string,
    /**
     * 发送自定义图片简历
     */
    cIE: boolean,
    /**
     * 自定义图片地址
     */
    cI: string,
    /**
     * 预设问题开关
     */
    ppE: boolean,
    /**
     * 预设问题
     */
    pp: string,
    /**
     * 拒绝挽留开关
     */
    rfE: boolean,
    /**
     * 拒绝挽留
     */
    rf: string,
    /**
     * 每轮邮件开启
     */
    ermE: boolean,
    /**
     * 延迟回复开关
     */
    drE: boolean,
    /**
     * 延迟回复
     */
    dr: number,
    /**
     * 高意向ai坐席停止开关
     */
    hiaE: boolean,
    /**
     * 对话聊天轮数 Chat rounds （高意向邮件开关） 开关
     */
    crE: boolean,
    /**
     * 对话聊天轮数 count
     */
    crC: string,
    /**
     * 对话聊天轮数 Key G关键字
     */
    crK: string[],
    /**
     * 投递间隔时间（秒）
     */
    pi: number,
    /**
     * 翻页间隔时间（秒）
     */
    npi: number,
}

export function applyPreferenceDefaults(preference?: Partial<PreferenceConfig> | null): PreferenceConfig {
    const result = (preference || {}) as PreferenceConfig
    result.resumeMatchE = result.resumeMatchE ?? true
    result.resumeMatchMinScore = result.resumeMatchMinScore ?? 0
    // 技能、年限和普通本科差异只展示建议，绝不能恢复成分数硬拦截。
    result.resumeMatchMode = 'advisory'
    result.commuteLocations = result.commuteLocations || []
    result.commuteMode = result.commuteMode || 'prefer'
    result.weekendMode = result.weekendMode || 'prefer'
    result.insuranceMode = result.insuranceMode || 'prefer'
    result.pi = Math.max(SAFE_MIN_PUSH_INTERVAL_SECONDS,
        Number(result.pi) || SAFE_DEFAULT_PUSH_INTERVAL_SECONDS)
    result.npi = Math.max(SAFE_MIN_NEXT_PAGE_INTERVAL_SECONDS,
        Number(result.npi) || SAFE_DEFAULT_NEXT_PAGE_INTERVAL_SECONDS)
    result.dr = result.dr || 0
    // 保留本地或服务端已经保存的选择；缺失的旧配置仍默认关闭。
    result.fhE = normalizeHeadhunterFilterEnabled(result.fhE)
    result.greetingDeliveryMode = normalizeGreetingDeliveryMode(
        result.greetingDeliveryMode,
        result.cgE,
        result.cg,
    )
    // 保留旧字段供旧版脚本和服务端读取，新逻辑以三态策略为准。
    result.cgE = result.greetingDeliveryMode !== 'platform-default'
    const hasJobTitleKeywords = (result.jni || []).some(item => String(item || '').trim())
    const validJobTitleModes = new Set<JobTitleMatchMode>(['off', 'prefer', 'required'])
    if (!validJobTitleModes.has(result.jobTitleMatchMode)) {
        // 迁移旧配置：用户已经填写目标岗位词时，默认真正执行该规则。
        // 没有关键词则关闭，避免空白配置意外拦截全部岗位。
        result.jobTitleMatchMode = hasJobTitleKeywords ? 'required' : 'off'
    }
    // 保留旧字段供旧版脚本读取；新逻辑以 jobTitleMatchMode 为准。
    result.jniE = result.jobTitleMatchMode === 'required'
    // 薪资用于待遇排序和展示，不能因保存过的区间误拦更高待遇岗位。
    result.srE = false
    // “潮一”是本地个人版永久硬屏蔽关键词，同时写入可见配置便于用户确认。
    result.cneE = true
    result.cne = Array.from(new Set([...(result.cne || []).filter(item => item !== '潮一互动'), '潮一']))
    return result
}

/**
 * 回答类型枚举
 */
export enum JobSeekerClonedAnswerTypeEnum {
    MSG_TEXT = 1,
    BOSS_OPERATION = 2,
    STOP = 3,
    AI_SERVICE_EXCEPTION = 4,

}

/**
 * boss操作类型
 */
export enum BossOperationTypeEnum {
    SEND_RESUME = 1,
}
