import axios from '../axios'
import {captureAutomationScope, prepareAutomationIdentity} from './unifiedRuntime'
import {automationRequestId, type AutomationJob} from './unifiedAutomation'
import type {ResumeVersion, CareerApplication, CareerAnalytics, CareerReview, CareerDeletion, CareerProposal, CareerPreview, CareerStrategy, CareerSelection, CareerEventInput} from './careerProtocol'

type Request = (path: string, body?: unknown, method?: 'GET' | 'POST' | 'DELETE') => Promise<any>
/** Named, fixed business routes. No platform credentials, arbitrary URL or executable action. */
export function createCareerClient(request: Request) {
    const path = (value: string) => '/api/job/career' + value
    const id = encodeURIComponent
    return {
        selection: () => request(path('/selection')) as Promise<CareerSelection>,
        versions: (offset = 0) => request(path(`/resumes/versions?limit=20&offset=${offset}`)) as Promise<ResumeVersion[]>,
        version: (versionId: string) => request(path(`/resumes/versions/${id(versionId)}`)) as Promise<ResumeVersion>,
        async createVersion(content: string, facts: ResumeVersion['facts']) {
            const payload = {content, parentVersionId: null, source: 'USER_TEXT', facts}
            return request(path('/resumes/versions'), {requestId: await automationRequestId(['resume-version', payload]), ...payload}) as Promise<ResumeVersion>
        },
        selectVersion: async (versionId: string, baseActiveVersionId: string | null, requestId: string = crypto.randomUUID()) => request(path(`/resumes/versions/${id(versionId)}/select`),
            {requestId, baseActiveVersionId}),
        applications: (offset = 0) => request(path(`/applications?limit=20&offset=${offset}`)) as Promise<CareerApplication[]>,
        application: (applicationId: string) => request(path(`/applications/${id(applicationId)}`)) as Promise<CareerApplication>,
        appendEvent: (applicationId: string, event: CareerEventInput) => request(path(`/applications/${id(applicationId)}/events`), event),
        importLegacy: async (requestId: string = crypto.randomUUID()) => request(path('/imports/legacy'), {requestId}) as Promise<{importedApplications: number; importedVersions: number; reusedApplications: number; importedContacts: number; importedSessionApplications: number; importedSessionContacts: number; importedSessionReplies: number; importedSessionOutcomes: number; ambiguousSessions: number}>,
        analytics: (windowDays: 7 | 14 | 30, cutoff: number, resumeVersionId = '', strategyPlanId = '') => {
            const query = new URLSearchParams({windowDays: String(windowDays), cutoff: String(cutoff)})
            if (resumeVersionId) query.set('resumeVersionId', resumeVersionId)
            if (strategyPlanId) query.set('strategyPlanId', strategyPlanId)
            return request(path('/analytics?' + query)) as Promise<CareerAnalytics>
        },
        reviews: () => request('/api/job/automation/jobs?kind=CAREER_REVIEW&limit=20&offset=0') as Promise<AutomationJob[]>,
        createReview: (input: {requestId: string; windowDays: 7 | 14 | 30; cutoff: number; resumeVersionId: string | null; objective: string; budget: number; hardConstraints: Record<string, unknown>}) =>
            request(path('/reviews'), input) as Promise<AutomationJob>,
        review: (jobId: string) => request(path(`/reviews/${id(jobId)}`)) as Promise<CareerReview | CareerDeletion>,
        confirmReview: async (job: AutomationJob, decision: 'CONFIRM' | 'IGNORE') => request(path(`/reviews/${id(job.jobId)}/confirmation`),
            {requestId: await automationRequestId(['review-confirmation', job.jobId, decision, job.revision, job.inputHash]), decision, revision: job.revision, inputHash: job.inputHash}),
        deleteReview: (jobId: string) => request(path(`/reviews/${id(jobId)}`), undefined, 'DELETE') as Promise<CareerDeletion>,
        preview: (proposal: CareerProposal, selectedPatchIds: string[]) => request(path(`/proposals/${id(proposal.proposalId)}/preview`), {selectedPatchIds}) as Promise<CareerPreview>,
        accept: async (preview: CareerPreview) => request(path(`/proposals/${id(preview.proposalId)}/accept`),
            {requestId: await automationRequestId(['accept-preview', preview.proposalId, preview.previewHash, preview.selectedPatchIds]),
                baseVersionId: preview.baseVersionId, previewHash: preview.previewHash, selectedPatchIds: preview.selectedPatchIds}) as Promise<{proposalId: string; version: ResumeVersion}>,
        strategies: () => request(path('/strategies?limit=20&offset=0')) as Promise<CareerStrategy[]>,
        strategy: (strategyId: string) => request(path(`/strategies/${id(strategyId)}`)) as Promise<CareerStrategy>,
        approveStrategy: async (strategy: CareerStrategy) => request(path(`/strategies/${id(strategy.strategyId)}/approve`),
            {requestId: await automationRequestId(['approve-strategy', strategy.strategyId, strategy.previewHash, strategy.basePreferenceHash]),
                previewHash: strategy.previewHash, basePreferenceHash: strategy.basePreferenceHash}) as Promise<CareerStrategy>,
        applyStrategy: async (strategy: CareerStrategy, requestId: string = crypto.randomUUID()) => request(path(`/strategies/${id(strategy.strategyId)}/apply`),
            {requestId,
                previewHash: strategy.previewHash, basePreferenceHash: strategy.basePreferenceHash}) as Promise<CareerStrategy>,
    }
}
export async function scopedCareerClient() {
    const scope = await prepareAutomationIdentity()
    const client = createCareerClient(async (path, body, method = body === undefined ? 'GET' : 'POST') => {
        if (!scope || scope !== captureAutomationScope()) throw new Error('CAREER_SCOPE_CHANGED')
        const response = await axios.request({url: path, method, data: body, suppressGlobalErrorToast: true,
            jobHelperScopeGuard: () => scope === captureAutomationScope()} as any)
        if (scope !== captureAutomationScope()) throw new Error('CAREER_SCOPE_CHANGED')
        return response.data.data
    })
    return {scope, client}
}
