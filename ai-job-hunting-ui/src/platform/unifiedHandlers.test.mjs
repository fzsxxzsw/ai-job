import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import {createRequire} from 'node:module'
import {build} from 'esbuild'

const require = createRequire(import.meta.url)
const mocks = {
    runtime: `export const registerAutomationExecutor=(kind,executor)=>fixture.executors.set(kind,executor);
        export const unifiedAutomationEnabled=async()=>{if(fixture.offline)throw Error('offline');return fixture.enabled};
        export const currentAutomationPolicy=()=>fixture.policy;
        export const captureAutomationScope=()=>fixture.scope;
        export const observeUnifiedContacts=(...args)=>fixture.naturalContacts.push(args);
        export const saveAutomationSnapshot=async value=>fixture.snapshots.push(value);
        export const browserAutomationReady=(ctx,a)=>fixture.allowed&&ctx.policy===fixture.policy&&(!['SEND_RESUME','ACCEPT_PHONE','ACCEPT_WECHAT','ACCEPT_RESUME'].includes(a.kind)||a.approvalStatus==='APPROVED');
        export const submitAutomation=async(body,context)=>{fixture.submissions.push({body,context});if(fixture.submitFailure){fixture.submitFailure=false;throw Error('response lost')}return {jobId:'graph-job'}};
        export const getAutomationJob=async(id)=>fixture.getJob(id);
        export const bindAutomationContact=async(...args)=>fixture.bindings.push(args);
        export const holdUnifiedAutomation=reason=>fixture.holds.push(reason);
        export const cancelAutomationJob=async id=>fixture.cancels.push(id);
        export const unresolvedAutomationApplication=async()=>null;`,
    tools: `export const Tools=fixture.Tools; export const TampermonkeyApi=fixture.gm;
        export const scrollElementToBottom=()=>{}; export const simulateScrollToEnd=()=>{};
        export class MessageCache {isMessageProcessed(peer,mid){return fixture.processed.some(x=>x[0]===peer&&x[1]===mid)} markMessageAsProcessed(...args){fixture.processed.push(args)}}`,
    stores: `export const UserStore=()=>fixture.store; export const pushResultCount=()=>fixture.counter`,
    push: `export const PushRunStore=()=>fixture.push`,
    logger: `export default fixture.log; export const LogLevel={Debug:0}`,
    record: `export class LogRecorder {constructor(){return fixture.log}}`,
    ui: `export const ElMessage=fixture.log; export const isProdEnv=()=>true; export const ElNotification=()=>{}`,
    ai: `export class AiPower {static async ask(){fixture.legacy.push('ask');throw Error('legacy ask')}static async filter(){fixture.legacy.push('filter');throw Error('legacy filter')}static async updateAskStatus(){fixture.legacy.push('stop')}}`,
    gm: `export const GM_getValue=(k,d)=>fixture.gm.GmGetValue(k,d); export const GM_setValue=(k,v)=>fixture.gm.GmSetValue(k,v); export const GM_addValueChangeListener=()=>{};`,
    risk: `export const getBossRiskStop=()=>fixture.risk; export const tripBossRiskCircuit=()=>fixture.risk`,
    remote: `export const userRemoteLoad=async()=>{}`,
    outcomes: `export const captureOutcomeContext=()=>fixture.scope; export const observeOutcomeContacts=(...args)=>fixture.contacts.push(args);export const observeOutcomePeerAssociation=(...args)=>{if(args[4]())fixture.associations.push(args)};export const observeOutcomeApplication=(...args)=>fixture.appObservations.push(args);`,
    axios: `const http=async config=>fixture.http(config);http.get=async(url)=>fixture.http({url,method:'GET'});http.post=async(url,data,config)=>fixture.http({url,data,...config,method:'POST'});export default http;`,
    protobuf: `export class Message {static createClientMid(){return '90071992547409931'}constructor(args){this.args=args;this.msgObj={cmid:args.clientMid}}async send(){fixture.sends.push(this.args);this.msgObj.__serverMid=fixture.ack;return !!fixture.ack}}
        export class MessageRead {constructor(args){this.args=args}send(){fixture.reads.push(this.args)}}`,
    audit: `export const makeConversationKey=(b,s)=>b+':'+s; export const stableDeliveryKey=(...x)=>x.join(':');
        export const recordDeliveryAudit=x=>fixture.audits.push(x);export const readDeliveryAudit=()=>fixture.audits;
        export const hasBossDeliveryReceipt=()=>true;export const setConversationIdentityResolver=()=>{};
        export const conversationIdentityFromElement=()=>null;export const reconcileDeliveryAuditFromDom=()=>{};`,
    snapshot: `export const saveApplicationSnapshotWithRetry=async value=>fixture.snapshots.push(value);`,
    career: `export const scopedCareerClient=async()=>({client:{selection:async()=>({preparedResumeVersionId:'prepared-A',strategyPlanId:'strategy-A'})}});`,
}
function mocked(path) {
    if (path.endsWith('/unifiedRuntime') || path === './unifiedRuntime') return 'runtime'
    if (path === './utils' || path === '../platform/utils') return 'tools'
    if (/(^|\/)stores$/.test(path)) return 'stores'
    if (path.endsWith('/stores/pushRun')) return 'push'
    if (path.endsWith('/stores/remote')) return 'remote'
    if (/\/logging$/.test(path)) return 'logger'
    if (path.endsWith('/logging/record')) return 'record'
    if (path.endsWith('/utils/tools') || path === 'element-plus') return 'ui'
    if (path === './aiPower') return 'ai'
    if (path === '$') return 'gm'
    if (path === './bossRiskControl') return 'risk'
    if (path.endsWith('/boss/outcomeRuntime')) return 'outcomes'
    if (path === 'axios' || path.endsWith('/axios')) return 'axios'
    if (path.endsWith('/webSocket/protobuf')) return 'protobuf'
    if (path === './deliveryAudit') return 'audit'
    if (path.endsWith('/boss/rejectionAnalysis')) return 'snapshot'
    if (path === './careerApi') return 'career'
    return null
}
const result = await build({stdin: {contents: `export {BossOption} from './bossPlatform'; export {default as PlatformFactory} from './platform'`,
    resolveDir: import.meta.dirname, loader: 'ts'}, bundle: true, write: false, platform: 'node', format: 'cjs',
    plugins: [{name: 'isolated-platform-boundaries', setup(builder) {
        builder.onResolve({filter: /\.vue$/}, args => ({path:args.path,external:true}))
        builder.onResolve({filter: /.*/}, args => {const key=mocked(args.path);return key?{path:key,namespace:'synthetic'}:undefined})
        builder.onLoad({filter: /.*/, namespace: 'synthetic'}, args => ({contents: mocks[args.path], loader: 'js'}))
    }}]})
const peer = {uid: '81', encryptBossId: 'BossA', encryptJobId: 'JobA', securityId: 'SecA', brandName: '合成公司', title: 'Java开发', name: '合成HR'}
const raw = (text='请介绍一下相关经验', mid='90071992547409941', type=1) => ({messages: [{mid, time: '1788757200000', type:1,
    from: {uid:'81'}, to:{uid:'40'}, body:{type,text}}]})
function environment() {
    const storage = new Map()
    const noop = () => {}
    const fixture = {executors:new Map(), policy:'policy-A',scope:'scope-A',enabled:true,allowed:true,risk:null,offline:false,
        submissions:[], legacy:[],holds:[],processed:[],sends:[],reads:[],audits:[],contacts:[],naturalContacts:[],associations:[],appObservations:[],snapshots:[],bindings:[],cancels:[],requests:[],ack:'90071992547409999',
        store:{user:{aiSeatStatus:1,resumeId:'resume-A',preference:{fhE:false,employmentExcludeE:false,resumeMatchE:true,resumeMatchMinScore:40,drE:false,cgE:true,cg:'您好，这是合成招呼',greetingDeliveryMode:'required',jti:[],jtiE:false}}},
        push:{runId:'run-A',isActive:true,stopRequested:false},
        counter:{clearOnceSuccessCount:noop,successIncr:noop,failIncr:noop,notMatchIncr:noop},
        log:{debug:noop,trace:noop,info:noop,warn:noop,error:noop,getLogLevel:()=>0},
        gm:{GmGetValue:(k,d)=>storage.has(k)?storage.get(k):d,GmSetValue:(k,v)=>storage.set(k,v)},
        http:async config=>{fixture.requests.push(config);if(config.url.includes('getGeekFriendList'))return {data:{code:0,zpData:{result:[peer]}}};return {data:{code:0,message:'Success',zpData:{data:{bossId:'81'}}}}},
        getJob:async()=>({jobId:'graph-job',status:'COMPLETED',actions:[{kind:'CONTACT_JOB',status:'ACKNOWLEDGED'}],decision:{code:'CONTACT'}}),
    }
    fixture.Tools={window:{_PAGE:{uid:'40'},setInterval:()=>1,setTimeout:()=>1,addEventListener:noop,location:{href:'https://synthetic.invalid/web/geek'},
        AIJobHelperChatBridge:{isReady:()=>false,getAcknowledgement:()=>fixture.ack}},
        sleep:async()=>{},getRandomNumber:()=>0,getCookieValue:()=> 'synthetic-platform-token',getEndChar:()=>'',
        isHardBlockedCompany:(...texts)=>texts.some(text=>String(text||'').includes('潮一')),fuzzyMatch:()=>false}
    const module={exports:{}}
    const context={module,exports:module.exports,require,fixture,crypto,TextEncoder,structuredClone,FormData,URL,Date,console,
        navigator:{},window:fixture.Tools.window,document:{querySelector:()=>null,querySelectorAll:()=>[],addEventListener:noop},
        localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
        setInterval:()=>1,clearInterval:noop,setTimeout:()=>1,clearTimeout:noop}
    vm.runInNewContext(result.outputFiles[0].text,context)
    const option=new module.exports.BossOption()
    const platform=module.exports.PlatformFactory.getInstance('/web/geek')
    return {...fixture,fixture,option,platform,Option:module.exports.BossOption}
}

test('actual live reply handler submits exact jobKey, MID and exchange requests before old side effects', async () => {
    for (const [text,kind] of [['交换微信','ACCEPT_WECHAT'],['交换联系方式','ACCEPT_PHONE'],['我想要一份您的附件简历，您是否同意','ACCEPT_RESUME']]) {
        const env=environment(); await env.option.handlerBossMessage(raw(text,undefined,7),81,text)
        assert.equal(env.submissions.length,1);const body=env.submissions[0].body
        assert.equal(body.input.jobKey,'JobA:40');assert.equal(body.conversationKey,'BossA:SecA')
        assert.equal(body.input.inboundMessageId,'90071992547409941');assert.equal(body.input.exchangeRequest.kind,kind)
        assert.equal(env.requests.some(r=>r.url.includes('/exchange/')),false)
        assert.equal(env.legacy.length,0);assert.equal(env.sends.length,0);assert.equal(env.processed.length,0)
    }
})
test('actual handler rejects recovered identities and does not fallback when API is unavailable', async () => {
    const env=environment();await env.option.handlerBossMessage(raw(),81,'恢复内容',true)
    assert.equal(env.submissions.length,0);assert.ok(env.holds.length)
    env.fixture.offline=true
    await assert.rejects(env.option.handlerBossMessage(raw(),81,'正常内容'))
    assert.equal(env.legacy.length,0);assert.equal(env.sends.length,0)
})
test('actual fresh contact lookup is exact-peer unique and associates the original live MID', async () => {
    const env=environment();await env.option.handlerBossMessage(raw(),81,'正常内容')
    assert.equal(env.associations.length,1);assert.equal(env.associations[0][1].mid,'90071992547409941')
    const wrong=environment();wrong.fixture.http=async()=>({data:{zpData:{result:[{...peer,uid:'82'}]}}})
    assert.equal(await wrong.option.getBossUserInfoByBossId(81),undefined)
    const ambiguous=environment();ambiguous.fixture.http=async()=>({data:{zpData:{result:[peer,{...peer,encryptJobId:'JobB'}]}}})
    assert.equal(await ambiguous.option.getBossUserInfoByBossId(81),undefined)
})
test('actual registered sensitive executor holds unapproved actions and sends only the exact approved exchange payload', async () => {
    const env=environment();await env.option.handlerBossMessage(raw('交换微信',undefined,7),81,'交换微信')
    const ctx=env.submissions[0].context
    const a={actionId:'a',kind:'ACCEPT_WECHAT',approvalStatus:'PENDING',payload:{encryptJobId:'JobA',bossId:'81',conversationKey:'BossA:SecA',requestMessageId:ctx.inboundMessageMid}}
    const executor=env.executors.get('REPLY');assert.equal(executor.ready(ctx,a),false)
    a.approvalStatus='APPROVED';assert.equal(executor.ready(ctx,a),true)
    const receipt=await executor.perform(ctx,a,null)
    assert.equal(receipt.status,'ACKNOWLEDGED')
    const request=env.requests.find(r=>r.url.endsWith('/exchange/accept'))
    assert.equal(request.data.type,2);assert.equal(request.data.mid,'90071992547409941');assert.equal(request.data.securityId,'SecA')
})
test('actual legacy retry and exchange exits are held in enabled mode', async () => {
    const env=environment()
    assert.equal(await env.option.deliverPendingAiReplyLocked({}),false)
    assert.equal(await env.platform.deliverPendingGreetingLocked({},false),false)
    assert.equal(await env.option.sendResumeFile(81),false)
    assert.equal(await env.option.sendMsg(81,'hello',undefined),null)
    await env.option.preReplyMsg(raw(),{},'交换微信')
    assert.equal(env.sends.length,0);assert.equal(env.requests.filter(request=>request.url.includes('/exchange/')||request.url.includes('/friend/add')).length,0)
})
test('actual matchJob preserves hard filters and captures graph FilterInput without legacy model call', async () => {
    const env=environment()
    const job={encryptJobId:'JobA',encryptBossId:'BossA',securityId:'SecA',lid:'LidA',brandName:'合成公司',jobName:'Python后端开发',salaryDesc:'10-15K',cityName:'测试市'}
    env.platform.obtainBossJobDetailExt=async()=>({postDescription:'Python、FastAPI 和 MySQL',friendStatus:0,activeTimeDesc:'今日活跃'})
    await env.platform.matchJob(job)
    assert.equal(env.legacy.length,0);assert.match(env.platform.unifiedFilterInputs.get('JobA').jobExtInfo,/Python、FastAPI 和 MySQL/)
    await assert.rejects(env.platform.matchJob({...job,brandName:'潮一'}))
    env.platform.pushStatus='PUSHING'
})
test('actual startPush reaches APPLICATION job then original success/snapshot handler without legacy greeting', async () => {
    const env=environment()
    const job={encryptJobId:'JobA',encryptBossId:'BossA',securityId:'SecA',lid:'LidA',brandName:'合成公司',jobName:'Python后端开发',salaryDesc:'10-15K',cityName:'测试市'}
    env.platform.obtainBossJobDetailExt=async()=>({postDescription:'Python、FastAPI 和 MySQL',friendStatus:0,activeTimeDesc:'今日活跃'})
    env.platform.waitForDeliveryGate=async()=>{};env.platform.startPreHandler=()=>{};env.platform.preMatchJob=()=>{}
    env.platform.getJobList=()=>[job];env.platform.next=async()=>false;env.platform.isLimit=()=>({limit:false})
    env.fixture.getJob=async()=>({jobId:'graph-job',status:'WAITING_EXECUTION',actions:[{kind:'CONTACT_JOB',status:'ACKNOWLEDGED'},{kind:'SEND_GREETING',status:'QUEUED'}],decision:{code:'CONTACT'}})
    await env.platform.startPush()
    assert.equal(env.submissions.length,1);assert.equal(env.submissions[0].body.kind,'APPLICATION')
    assert.equal(env.submissions[0].body.input.localAssessment.passed,true)
    assert.equal(env.submissions[0].body.input.preparedResumeVersionId,'prepared-A')
    assert.equal(env.submissions[0].body.input.strategyPlanId,'strategy-A')
    assert.equal(env.submissions[0].context.snapshot.encryptJobId,'JobA')
    assert.equal(env.snapshots.length,0,'snapshot waits for the receipt hook, not the overall job result')
    assert.equal(env.sends.length,0);assert.equal(env.legacy.length,0)
})
test('actual contact action ACK precedes lookup; snapshot uses the receipt time independently of greeting', async () => {
    const env=environment();env.platform.pushStatus=1;env.platform.isLimit=()=>({limit:false})
    const job={encryptJobId:'JobA',encryptBossId:'BossA',securityId:'SecA',lid:'LidA',brandName:'合成公司',jobName:'开发'}
    const ctx={kind:'APPLICATION',account:'40',runId:'run-A',policy:'policy-A',encryptJobId:'JobA',bossId:null,conversationKey:null,job,greetingEnabled:true,
        snapshot:{encryptJobId:'JobA',jobBaseInfo:'{}',jobExtInfo:'{}',preMatchResult:{}}}
    const a={actionId:'contact-action',kind:'CONTACT_JOB',status:'QUEUED',payload:{encryptJobId:'JobA',bossId:null,conversationKey:null}}
    const executor=env.executors.get('APPLICATION')
    const receipt=await executor.perform(ctx,a,null)
    assert.equal(receipt.status,'ACKNOWLEDGED');assert.equal(env.requests.some(r=>r.url.includes('getBossData')),false)
    await executor.acknowledged(ctx,a,receipt)
    assert.equal(env.snapshots[0].appliedAt,receipt.occurredAt);assert.equal(env.bindings[0][1],'81')
    assert.equal(ctx.contact.bossId,'81');assert.equal(env.requests.filter(r=>r.url.includes('/friend/add.json')).length,1)
})
test('actual cooldown wraps the dispatch operation and rechecks a pause before any platform write', async () => {
    const env=environment();env.platform.pushStatus=1;env.platform.isLimit=()=>({limit:false})
    env.gm.GmSetValue('boss_last_push_at',Date.now())
    env.fixture.Tools.sleep=async()=>{env.platform.pushStatus=2;env.push.stopRequested=true}
    let dispatched=false
    await assert.rejects(env.executors.get('APPLICATION').run({}, {kind:'CONTACT_JOB'},async()=>{dispatched=true}))
    assert.equal(dispatched,false)
})
test('actual reply executor refuses an old draft as soon as a newer live MID is observed', async () => {
    const env=environment();await env.option.handlerBossMessage(raw(),81,'第一条')
    const previous=env.submissions[0].context
    await env.option.handlerBossMessage(raw('第二条','90071992547409942'),81,'第二条')
    const a={kind:'SEND_TEXT',payload:{encryptJobId:'JobA',bossId:'81',conversationKey:'BossA:SecA',text:'旧回复'}}
    assert.equal(env.executors.get('REPLY').ready(previous,a),false)
})
test('processed replay cannot roll back a newer ready draft; opaque MID order is irrelevant', async () => {
    const env=environment()
    const first=raw('第一条','99999');first.messages[0].time='1788757200000'
    await env.option.handlerBossMessage(first,81,'第一条')
    env.Option.messageCache.markMessageAsProcessed(81,'99999')
    const second=raw('第二条','100');second.messages[0].time='1788757201000'
    await env.option.handlerBossMessage(second,81,'第二条')
    const current=env.submissions.at(-1).context
    const a={kind:'SEND_TEXT',payload:{encryptJobId:'JobA',bossId:'81',conversationKey:'BossA:SecA',text:'新回复'}}
    assert.equal(env.executors.get('REPLY').ready(current,a),true)
    await env.option.handlerBossMessage(first,81,'第一条')
    assert.equal(env.executors.get('REPLY').ready(current,a),true)
    const older=raw('迟到旧消息','90000000');older.messages[0].time='1788757199000'
    await env.option.handlerBossMessage(older,81,'迟到旧消息')
    assert.equal(env.executors.get('REPLY').ready(current,a),true)
    const uncertain=raw('没有时间','200');uncertain.messages[0].time=null
    await env.option.handlerBossMessage(uncertain,81,'没有时间')
    assert.equal(env.executors.get('REPLY').ready(current,a),false)
})

test('current live MID retries after status failure or lost job response with the same server idempotency key', async () => {
    const env=environment();env.fixture.offline=true
    await assert.rejects(env.option.handlerBossMessage(raw(),81,'正常内容'))
    env.fixture.offline=false;await env.option.handlerBossMessage(raw(),81,'正常内容')
    assert.equal(env.submissions.length,1)
    await env.option.handlerBossMessage(raw(),81,'正常内容');assert.equal(env.submissions.length,1,'accepted job is deduplicated')
    const second=raw('第二条','90071992547409942');second.messages[0].time='1788757201000'
    env.fixture.submitFailure=true;await assert.rejects(env.option.handlerBossMessage(second,81,'第二条'))
    await env.option.handlerBossMessage(second,81,'第二条')
    assert.equal(env.submissions[1].body.requestId,env.submissions[2].body.requestId)
    const latest=env.submissions[2].context
    await env.option.handlerBossMessage(raw(),81,'旧内容')
    assert.equal(env.executors.get('REPLY').ready(latest,{kind:'SEND_TEXT',payload:{encryptJobId:'JobA',bossId:'81',conversationKey:'BossA:SecA'}}),true)
})
