import {exactPlatformId} from './outcomeCollector.ts'

function source(element: any): any {
    return element?.__vue__?.source || element?.__vue__?._props?.source
        || element?.__vueParentComponent?.props?.source || null
}
function binding(value: any) {
    const bossId = exactPlatformId(value?.uid || value?.bossId)
    if (!bossId || typeof value.encryptJobId !== 'string' || !value.encryptJobId
        || typeof value.encryptBossId !== 'string' || !value.encryptBossId
        || typeof value.securityId !== 'string' || !value.securityId) return null
    return {bossId, encryptJobId: value.encryptJobId, conversationKey: `${value.encryptBossId}:${value.securityId}`,
        encryptBossId: value.encryptBossId, securityId: value.securityId}
}
function selectedBinding(root: ParentNode) {
    let element: any = root.querySelector('.friend-content.selected, .friend-content-warp.selected, li.selected .friend-content')
    for (let depth = 0; element && depth < 7; depth++, element = element.parentElement) {
        const result = binding(source(element))
        if (result) return result
    }
    return null
}
function rawMessage(element: any): any {
    return element?.__vue__?.message || element?.__vue__?._props?.message || element?.__vueParentComponent?.props?.message || null
}
function rowFacts(row: Element, own: string, peer: string) {
    const raw = rawMessage(row)
    const mid = exactPlatformId(raw?.mid)
    const attributeMid = row.getAttribute('data-mid') || row.getAttribute('data-message-id')
    if (!mid || attributeMid !== mid || row.getAttribute('data-mid') && row.getAttribute('data-message-id')
        && row.getAttribute('data-mid') !== row.getAttribute('data-message-id')) return null
    const from = exactPlatformId(raw?.from?.uid), to = exactPlatformId(raw?.to?.uid)
    if (!(from === own && to === peer || from === peer && to === own)) return null
    const text = typeof raw?.body?.text === 'string' ? raw.body.text : null
    const visible = row.querySelector('.text, .message-text, .text-content')?.textContent
    if (text === null || visible == null || text.trim() !== visible.trim()) return null
    return {mid, cmid: exactPlatformId(raw.cmid), from: {uid: from}, to: {uid: to}, time: raw.time ?? null,
        text, encryptJobId: raw.encryptJobId ?? null, conversationKey: raw.conversationKey ?? null}
}

/** A selection is not a chat-panel identity. Missing panel/message-owned data withholds HR evidence. */
export function captureCurrentOutcomePanel(root: ParentNode, ownAccount: unknown) {
    const own = exactPlatformId(ownAccount)
    const selected = selectedBinding(root)
    const panel = root.querySelector('.chat-conversation')
    const panelBinding = binding(source(panel))
    if (!own || !panel || !selected || !panelBinding || JSON.stringify(selected) !== JSON.stringify(panelBinding)) return null
    const rows: {row: Element; fingerprint: string; message: ReturnType<typeof rowFacts>}[] = []
    for (const row of Array.from(panel.querySelectorAll('[data-mid], [data-message-id]'))) {
        if (row.closest('#ai-job, [contenteditable="true"]')) continue
        const message = rowFacts(row, own, panelBinding.bossId)
        if (!message || message.encryptJobId && message.encryptJobId !== panelBinding.encryptJobId
            || message.conversationKey && message.conversationKey !== panelBinding.conversationKey) continue
        rows.push({row, fingerprint: JSON.stringify(message), message})
    }
    const recheck = () => root.querySelector('.chat-conversation') === panel
        && JSON.stringify(selectedBinding(root)) === JSON.stringify(selected)
        && JSON.stringify(binding(source(panel))) === JSON.stringify(panelBinding)
        && rows.every(value => JSON.stringify(rowFacts(value.row, own, panelBinding.bossId)) === value.fingerprint)
    if (!recheck()) return null
    return {panel, binding: panelBinding, recheck, messages: rows.map(({message}) => ({...message!,
        encryptJobId: panelBinding.encryptJobId, conversationKey: panelBinding.conversationKey}))}
}
