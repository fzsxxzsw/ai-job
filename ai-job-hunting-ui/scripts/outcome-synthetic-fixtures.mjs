import {createPassiveOutcomeCollector} from '../src/platform/boss/outcomeCollector.ts'

// Inert synthetic producer for tests/integration only. It never fetches, logs in, or opens a browser.
export function produceSyntheticOutcomeScenario({now = 1788757200000, readState = 'READ', hrText = '很抱歉，目前不合适', suffix = 'rejected'} = {}) {
    const observations = []
    const own = '40', peer = '81', clientMid = '90071992547409931', serverMid = '90071992547409932'
    const friend = {uid: peer, encryptJobId: `SyntheticJob-${suffix}`, encryptBossId: `SyntheticBoss-${suffix}`, securityId: 'SyntheticSecurity'}
    const collector = createPassiveOutcomeCollector(value => observations.push({...value, eventId: `synthetic-${suffix}-${observations.length}`}))
    collector.bind([friend], own, now)
    collector.message({mid: clientMid, cmid: clientMid, time: now, from: {uid: own}, to: {uid: peer}}, '期待进一步沟通', own, now + 1)
    collector.acknowledge(clientMid, serverMid, now + 2)
    const status = {textContent: readState === 'READ' ? '已读' : '未读', closest: () => null}
    const row = {className: 'item-myself', getAttribute: key => ({'data-mid': serverMid, 'data-cmid': clientMid}[key] || null),
        closest: () => null, querySelectorAll: () => [status]}
    const root = {querySelector: () => ({querySelectorAll: () => [row]})}
    collector.inspectCurrent(root, {bossId: peer, conversationKey: `${friend.encryptBossId}:${friend.securityId}`}, now + 3)
    if (hrText) collector.message({mid: '90071992547409933', time: now + 4, from: {uid: peer}, to: {uid: own}}, hrText, own, now + 5)
    return observations
}
