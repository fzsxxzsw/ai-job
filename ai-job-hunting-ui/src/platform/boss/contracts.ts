export type BossJobSource = 'search-api' | 'vue3' | 'vue2' | 'dom'

export type BossJobSourceDiagnostic = {
    source: BossJobSource
    inspected: number
    accepted: number
    rejected: number
    errors: string[]
}

export type BossJobCollectionResult = {
    jobs: BossJobDetail[]
    diagnostics: BossJobSourceDiagnostic[]
}

export type BossJobCard = Record<string, unknown> & {
    postDescription: string
    activeTimeDesc: string
    address: string
    friendStatus: number
}
