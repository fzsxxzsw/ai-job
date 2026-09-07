import type {AutomationJob} from './unifiedAutomation'
export type ResumeVersion = {versionId: string; content: string; contentHash: string; parentVersionId: string | null
    source: 'USER_TEXT' | 'LEGACY_IMPORT' | 'ACCEPTED_PATCH'; status: 'PREPARED'; selected: boolean; createdAt: number
    sections: {sectionId: string; title: string; text: string}[]
    facts: {factId: string; text: string; verificationStatus: 'USER_CONFIRMED' | 'SOURCE_PRESENT'}[]}
export type ApplicationEvent = {eventId: string; eventType: string; occurredAt: number; confirmation: 'OBSERVED' | 'USER_CONFIRMED' | 'INFERRED'
    evidence: {source: string; referenceId: string | null; quote: string; resumeVersionId?: string; contentHash?: string}
    supersedesEventId: string | null; createdAt: number}
export const CAREER_EVENT_TYPES = ['CONTACT_INITIATED', 'RESUME_SENT', 'HR_REPLIED', 'INTERVIEW_INVITED', 'INTERVIEW_COMPLETED', 'REJECTED', 'OFFER_RECEIVED', 'WITHDRAWN', 'CORRECTION'] as const
export type CareerEventInput = {requestId: string; eventType: typeof CAREER_EVENT_TYPES[number]; occurredAt: number
    evidence: {source: 'USER_CONFIRMATION' | 'USER_NOTE'; referenceId: string | null; quote: string; resumeVersionId?: string; contentHash?: string}
    confirmation: 'USER_CONFIRMED' | 'INFERRED'; supersedesEventId: string | null}
export type CareerApplication = {applicationId: string; platformAccount: string; encryptJobId: string; conversationKey: string | null
    bossId: string | null; cycleKey: string; jobTitle: string; createdAt: number; contactedAt: number | null; status: string
    currentStage: 'UNKNOWN' | 'CONTACT_INITIATED' | 'HR_REPLIED' | 'INTERVIEW_INVITED' | 'INTERVIEW_COMPLETED' | 'OFFER_RECEIVED'
    outcome: 'OPEN' | 'REJECTED' | 'OFFER_RECEIVED' | 'WITHDRAWN'
    preparedResumeVersionId: string | null; strategyPlanId: string | null
    resumeExposure: {state: 'UNKNOWN' | 'VERIFIED' | 'MIXED'; resumeVersionId: string | null; verificationKind: 'USER_CONFIRMED' | null}; events: ApplicationEvent[]
    jobBaseInfo?: string; jobExtInfo?: string}
export type CareerMetric = {numerator: number; denominator: number; rate: number | null; excludedCount: number
    windowDays: 7 | 14 | 30; cutoff: number; metricVersion: 'career-cohort-v1'
    cohortFilters: {resumeVersionId: string | null; strategyPlanId: string | null; jobGroup: string | null}
    sampleIds: {numerator: string[]; denominator: string[]; excluded: string[]}}
export type CareerAnalytics = {metricVersion: 'career-cohort-v1'; windowDays: 7 | 14 | 30; cutoff: number
    comparability: {status: 'UNVERIFIED'; sampleThresholdMet: boolean; missingEvidence: string[]}
    cohortFilters: CareerMetric['cohortFilters']; sampleSize: number; descriptiveOnly: boolean; noCausalClaim: true
    metrics: {replyRate: CareerMetric; interviewRate: CareerMetric; offerRate: CareerMetric; resumeInterviewRate: CareerMetric}; withdrawnCount: number; everInterviewedCount: number
    excludedCounts: {immature: number; unverifiedContact: number; unknownExposure: number; mixedExposure: number}; uncertainties: string[]}
export type CareerPatch = {patchId: string; sectionId: string; originalText: string; proposedText: string; reasonType: string
    factIds: string[]; feedbackEventIds: string[]; jdRefs: string[]; unansweredQuestions: string[]
    verificationStatus: 'SOURCE_SUPPORTED' | 'NEEDS_USER_INPUT'}
export type CareerProposal = {proposalId: string; baseVersionId: string; status: 'DRAFT' | 'ACCEPTED'; patches: CareerPatch[]
    createdAt: number; acceptedVersionId: string | null}
export type CareerStrategy = {strategyId: string; status: 'DRAFT' | 'APPROVED' | 'APPLIED'; previewHash: string; basePreferenceHash: string
    objective: string | null; budget: number | null; hardConstraints: Record<string, unknown>
    allocations: {group: string; category: 'MAIN' | 'EXPLORE' | 'PAUSE'; count: number; resumeVersionId: string | null}[]
    measurementWindowDays: 7 | 14 | 30; uncertainties: string[]; missingInputs: string[]; createdAt: number}
export type CareerRationale = {kind: string; summary: string; evidenceIds: string[]; question: string | null
    basis?: 'DATA_EVIDENCE' | 'STATIC_MATCH'; jdRefs?: string[]; factIds?: string[]}
export type CareerModelCoverage = {selectionPolicy: string; inputByteLimit: number; inputBytes: number; eventIds: string[]; jdRefs: string[]
    resumeVersionId: string | null; resumeIncluded: boolean; frozenEventCount: number; frozenJobCount: number; resumeAvailable: boolean
    excludedReasons: Record<string, number>; metricSampleIdsOmitted: true
    snapshotCoverage: {eventCount: number | null; includedEventCount: number | null; applicationCount: number | null; includedJobCount: number | null}}
export type CareerModelAssistance = {schemaVersion: 1; coverage: CareerModelCoverage} &
    ({status: 'VALIDATED'; modelName: string; selection: unknown} | {status: 'FALLBACK'; failureCode: string})
export type CareerReview = {job: AutomationJob; confirmation: {confirmationId: string; decision: 'CONFIRM' | 'IGNORE'; createdAt: number} | null
    review: null | {reviewId: string; metricBundle: CareerAnalytics; evidence: {eventId: string; applicationId: string; quote: string; confirmation: string}[]
        gaps: CareerRationale[]; strategyRationale?: CareerRationale[]; modelAssistance?: CareerModelAssistance
        resumeProposals: CareerProposal[]; strategy: CareerStrategy | null; uncertainties: string[]; analysisSource: 'RULES_ONLY' | 'MODEL_ASSISTED'}}
export type CareerDeletion = {jobId: string; status: 'DELETING' | 'DELETED'; checkpointDeleted: boolean}
export type CareerPreview = {proposalId: string; baseVersionId: string; selectedPatchIds: string[]; content: string; previewHash: string}
export type CareerSelection = {preparedResumeVersionId: string | null; strategyPlanId: string | null}
export const metricRateLabel = (metric: Pick<CareerMetric, 'denominator' | 'rate'>) => metric.denominator === 0 || metric.rate === null ? '暂无可计算比例' : `${(metric.rate * 100).toFixed(1)}%`
export const previewMatchesSelection = (preview: CareerPreview | null, proposal: CareerProposal, selected: string[]) =>
    !!preview && preview.proposalId === proposal.proposalId && preview.baseVersionId === proposal.baseVersionId
    && JSON.stringify([...preview.selectedPatchIds].sort()) === JSON.stringify([...selected].sort())
export function modelAssistanceLabel(assistance: CareerModelAssistance): string {
    if (assistance.status === 'VALIDATED') return `模型辅助意见已通过证据校验 · ${assistance.modelName}`
    return ({MODEL_UNAVAILABLE: '模型不可用，保留规则复盘', MODEL_TIMEOUT: '模型超时，保留规则复盘',
        INVALID_MODEL_OUTPUT: '模型输出未通过证据校验，保留规则复盘', INPUT_BUDGET: '材料超出本次处理范围，保留规则复盘',
        NO_MODEL_MATERIALS: '缺少可核实的模型材料，保留规则复盘', OWNER_MISMATCH: '资料归属尚未核实，保留规则复盘'} as Record<string, string>)[assistance.failureCode] || '模型辅助未确认，保留规则复盘'
}
