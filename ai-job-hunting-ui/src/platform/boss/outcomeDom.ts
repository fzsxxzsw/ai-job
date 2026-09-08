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
export function captureCurrentOutcomePanel(root: ParentNode, ownAccount: unknown, diagnose: (message: string) => void = () => {}) {
    const own = exactPlatformId(ownAccount)
    const selected = selectedBinding(root)
    const panel = root.querySelector('.chat-conversation')
    const panelBinding = binding(source(panel))
    if (!panel) { diagnose(''); return null }
    if (!own) { diagnose('当前账号尚未识别，已有消息暂未采集'); return null }
    if (!selected) { diagnose('当前联系人缺少可靠的岗位和会话关联，已有消息暂未采集'); return null }
    if (panelBinding && JSON.stringify(selected) !== JSON.stringify(panelBinding)) {
        diagnose('聊天面板与所选联系人不一致，等待页面完成切换'); return null
    }
    const current = panelBinding || selected
    const reasons = new Set<string>()
    const rows: {row: Element; fingerprint: string; message: ReturnType<typeof rowFacts>}[] = []
    for (const row of Array.from(panel.querySelectorAll('[data-mid], [data-message-id]'))) {
        if (row.closest('#ai-job, [contenteditable="true"]')) continue
        const message = rowFacts(row, own, current.bossId)
        if (!message) { reasons.add('消息原始编号、参与者或正文未能与页面对应'); continue }
        if (message.encryptJobId && message.encryptJobId !== current.encryptJobId
            || message.conversationKey && message.conversationKey !== current.conversationKey) {
            reasons.add('消息与当前岗位或会话不一致'); continue
        }
        // Without panel-owned identity, every message must independently own both bindings.
        if (!panelBinding && (message.encryptJobId !== current.encryptJobId || message.conversationKey !== current.conversationKey)) {
            reasons.add('聊天面板缺少会话关联，消息自身也没有完整岗位和会话标识'); continue
        }
        rows.push({row, fingerprint: JSON.stringify(message), message})
    }
    const recheck = () => root.querySelector('.chat-conversation') === panel
        && JSON.stringify(selectedBinding(root)) === JSON.stringify(selected)
        && JSON.stringify(binding(source(panel))) === JSON.stringify(panelBinding)
        && rows.every(value => JSON.stringify(rowFacts(value.row, own, current.bossId)) === value.fingerprint)
    if (!recheck()) { diagnose('采集时会话发生变化，等待稳定后重新核对'); return null }
    diagnose(reasons.size ? `已有消息采集受限：${[...reasons].join('；')}` : rows.length ? '' : '当前面板没有可核实原始编号的消息，尚未补充历史分析')
    return {panel, binding: current, recheck, messages: rows.map(({message}) => ({...message!,
        encryptJobId: current.encryptJobId, conversationKey: current.conversationKey}))}
}

/** Recover only the exact final row so an older inbound is never answered. */
export function captureCurrentReplyCandidate(root: ParentNode, ownAccount: unknown) {
    const own = exactPlatformId(ownAccount)
    const selected = selectedBinding(root)
    const panel = root.querySelector('.chat-conversation')
    const panelBinding = binding(source(panel))
    if (!own || !selected || !panel || panelBinding && JSON.stringify(selected) !== JSON.stringify(panelBinding)) return null
    const current = panelBinding || selected
    const finalRow = () => Array.from(panel.querySelectorAll('[data-mid], [data-message-id]'))
        .filter(row => !row.closest('#ai-job, [contenteditable="true"]'))
        .at(-1)
    const row = finalRow()
    const message = row ? rowFacts(row, own, current.bossId) : null
    if (!message || message.from.uid !== current.bossId || message.to.uid !== own || !message.text.trim()
        || message.encryptJobId && message.encryptJobId !== current.encryptJobId
        || message.conversationKey && message.conversationKey !== current.conversationKey
        || !panelBinding && (message.encryptJobId !== current.encryptJobId || message.conversationKey !== current.conversationKey)) return null
    const fingerprint = JSON.stringify(message)
    const recheck = () => root.querySelector('.chat-conversation') === panel
        && JSON.stringify(selectedBinding(root)) === JSON.stringify(selected)
        && JSON.stringify(binding(source(panel))) === JSON.stringify(panelBinding)
        && finalRow() === row && JSON.stringify(rowFacts(row!, own, current.bossId)) === fingerprint
    return recheck() ? {binding: current, message: {...message, encryptJobId: current.encryptJobId,
        conversationKey: current.conversationKey}, recheck} : null
}
