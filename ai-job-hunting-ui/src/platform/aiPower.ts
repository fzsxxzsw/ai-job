import axios from "../axios";


export class AiPower {

    public static async ask(question: string, jobKey: string, bossUserInfo: any): Promise<any> {
        return axios.post("/api/job/seeker/cloned/ask", {
                question: question,
                jobKey: jobKey,
                jobInfo: {
                    jobTitle: bossUserInfo.jobTitle,
                    brandName: bossUserInfo.brandName,
                    positionTitle: bossUserInfo.positionTitle,
                    recruiterName: bossUserInfo.recruiterName,
                }
            },
            {
                // 后端模型调用上限为15秒；额外1秒用于返回结构化超时结果。
                timeout: 16000
            })
    }
    public static async filter(prompt: string, jobBaseInfo: string, jobExtInfo: string,
                               resumeMatchEnabled: boolean, minMatchScore: number,
                               titleRuleStatus?: string, titleMatchedKeywords: string[] = []): Promise<any> {
        return axios.post("api/job/filter/one", {
                prompt: prompt,
                jobBaseInfo: jobBaseInfo,
                jobExtInfo: jobExtInfo,
                resumeMatchEnabled: resumeMatchEnabled,
                minMatchScore: minMatchScore,
                titleRuleStatus: titleRuleStatus,
                titleMatchedKeywords: titleMatchedKeywords
            },
            {
                // 本地规则通常毫秒级完成；附加 AI 条件最多等待 15 秒，避免阻塞投递循环。
                timeout: 15000
            })
    }

    public static async updateAskStatus(jobKey: string, stop: boolean): Promise<any> {
        return axios.post(`/api/job/seeker/cloned/change/session/status?jobKey=${jobKey}&stop=${stop}`)
    }
}
