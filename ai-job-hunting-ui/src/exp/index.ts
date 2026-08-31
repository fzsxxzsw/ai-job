import {PlatformTypeEnum} from "../platform/platform";

export class AIJobHuntingError extends Error {
    constructor(message: string) {
        super(message);
    }
}

export class PlatformError extends AIJobHuntingError {
    private platform: PlatformTypeEnum;

    constructor(platformType: PlatformTypeEnum, message: string) {
        super(message);
        this.platform = platformType
    }
}

/**
 * 投递异常
 */
export class PushException extends AIJobHuntingError {

}

/**
 * 投递是不匹配异常
 */
export class NotMatchException extends PushException {
    jobTitle: string;
    data: any;


    constructor(jobTitle: string, data: any, message: string = '') {
        super(message);
        this.jobTitle = jobTitle;
        this.data = data;
    }
}

/**
 * 投递接口请求异常
 */
export class PushReqException extends PushException {
    jobTitle: string;


    constructor(jobTitle: string, message: string = '') {
        super(message);
        this.jobTitle = jobTitle;
    }

}


export class FetchJobBossFailExp extends PushException {
    jobTitle: string;

    constructor(jobTitle: string, message: string = '') {
        super(message);
        this.jobTitle = jobTitle;
    }
}

/**
 * 岗位详情暂时不可用。与业务不匹配不同，这类错误不能把岗位标记为已处理，
 * 用户稍后重试时仍应有机会重新获取完整 JD。
 */
export class JobDetailUnavailableExp extends PushException {
    jobTitle: string
    code: string

    constructor(jobTitle: string, code: string, message: string = '') {
        super(message)
        this.jobTitle = jobTitle
        this.code = code
    }
}

/**
 * AI/backend did not produce a verifiable decision. This is not a business
 * rejection and must not permanently mark the job as processed.
 */
export class AiDecisionUnknownExp extends PushException {
    jobTitle: string

    constructor(jobTitle: string, message: string = '') {
        super(message)
        this.jobTitle = jobTitle
    }
}


/**
 * 投递停止，手动暂停
 */
export class PublishStopExp extends PushException {

}

/**
 * 投递限制
 */
export class PublishLimitExp extends PushException {

}
