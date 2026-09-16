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
        export const browserAutomationReady=(ctx,a)=>{const autoResume=ctx.kind==='REPLY'&&a.approvalStatus==='NOT_REQUIRED'&&['SEND_RESUME','ACCEPT_RESUME'].includes(a.kind);
            return fixture.allowed&&ctx.policy===fixture.policy&&(!['SEND_RESUME','ACCEPT_PHONE','ACCEPT_WECHAT','ACCEPT_RESUME'].includes(a.kind)||a.approvalStatus==='APPROVED'||autoResume)};
        export const submitAutomation=async(body,context)=>{fixture.submissions.push({body,context});if(fixture.submitFailure){fixture.submitFailure=false;throw Error('response lost')}
            if(fixture.submitGate)await fixture.submitGate;
            const job=fixture.makeAutomationJob(body);fixture.automationJobs.set(job.jobId,job);fixture.publishAutomation(job);
            if(body.kind==='APPLICATION'&&fixture.autoExecuteApplication&&job.decision?.code==='CONTACT'){
                const action=job.actions.find(item=>item.kind==='CONTACT_JOB');const executor=fixture.executors.get('APPLICATION');
                const receipt=await executor.perform(context,action,null);action.status=receipt.status;action.lastErrorCode=receipt.errorCode;
                if(receipt.status==='ACKNOWLEDGED')await executor.acknowledged?.(context,action,receipt);
                const greeting=job.actions.find(item=>item.kind==='SEND_GREETING');
                if(greeting&&context.bossId){greeting.payload.bossId=context.bossId;greeting.payload.conversationKey=context.conversationKey}
                if(greeting&&receipt.status==='ACKNOWLEDGED'&&fixture.autoExecuteApplicationGreeting){
                    if(!executor.ready(context,greeting))throw Error('greeting executor was not ready after exact contact binding');
                    const greetingReceipt=await executor.perform(context,greeting,'90071992547409931');fixture.applicationGreetingExecutions++;
                    greeting.status=greetingReceipt.status;greeting.lastErrorCode=greetingReceipt.errorCode;
                    if(greetingReceipt.status==='ACKNOWLEDGED')await executor.acknowledged?.(context,greeting,greetingReceipt);
                }else if(greeting&&fixture.applicationGreetingStatus)greeting.status=fixture.applicationGreetingStatus;
                job.status=receipt.status==='ACKNOWLEDGED'?(greeting?(greeting.status==='FAILED'?'FAILED':greeting.status==='UNKNOWN'?'UNCERTAIN':greeting.status==='ACKNOWLEDGED'?'COMPLETED':'WAITING_EXECUTION'):'COMPLETED'):receipt.status==='FAILED'?'FAILED':'UNCERTAIN';
                fixture.publishAutomation(job);
            }
            return job};
        export const getAutomationJob=async(id)=>fixture.getJob(id);
        export const subscribeUnifiedAutomation=listener=>{fixture.automationListeners.add(listener);listener(fixture.automationSnapshot);return()=>fixture.automationListeners.delete(listener)};
        export const bindAutomationContact=async(...args)=>fixture.bindings.push(args);
        export const holdUnifiedAutomation=reason=>fixture.holds.push(reason);
        export const cancelAutomationJob=async id=>{fixture.cancels.push(id);const job=fixture.automationJobs.get(id);if(job){job.status='CANCELLED';for(const action of job.actions){if(['QUEUED','LEASED'].includes(action.status))action.status='CANCELLED'}fixture.publishAutomation(job)}return job};
        export const unresolvedAutomationApplication=async()=>fixture.unresolvedApplication;`,
    tools: `export const Tools=fixture.Tools; export const TampermonkeyApi=fixture.gm;
        export const scrollElementToBottom=()=>{}; export const simulateScrollToEnd=()=>{};
        export class MessageCache {isMessageProcessed(peer,mid){return fixture.processed.some(x=>x[0]===peer&&x[1]===mid)} markMessageAsProcessed(...args){fixture.processed.push(args)}}`,
    stores: `export const UserStore=()=>fixture.store; export const pushResultCount=()=>fixture.counter`,
    push: `export const PUSH_RUN_LOCK_NAME='synthetic-push-run';export const PushRunStore=()=>fixture.push`,
    deliveryWait: `export const waitForPushDelay=async ms=>{fixture.waits.push(ms);await fixture.Tools.sleep(ms);return true};
        export const greetingDispatchAuthorized=(entry,run,account,stopped,risk)=>!!entry.runId&&entry.runId===run.runId&&entry.account===account&&run.isActive&&!run.stopRequested&&!stopped&&!risk`,
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
    if (path === './deliveryRunWait') return 'deliveryWait'
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
        submissions:[], legacy:[],holds:[],processed:[],sends:[],reads:[],audits:[],contacts:[],naturalContacts:[],associations:[],appObservations:[],snapshots:[],bindings:[],cancels:[],requests:[],infos:[],waits:[],ack:'90071992547409999',
        automationListeners:new Set(),automationJobs:new Map(),automationSnapshot:{status:null,jobs:[],error:'',held:0,updatedAt:0},
        unresolvedApplication:null,autoExecuteApplication:true,autoExecuteApplicationGreeting:false,applicationGreetingExecutions:0,
        applicationDecision:null,applicationGreetingStatus:null,applicationTimeout:null,submitGate:null,
        store:{user:{aiSeatStatus:1,resumeId:'resume-A',preference:{fhE:false,employmentExcludeE:false,resumeMatchE:true,resumeMatchMinScore:40,drE:false,cgE:true,cg:'您好，这是合成招呼',greetingDeliveryMode:'custom-required',afE:false,af:'',jti:[],jtiE:false}}},
        push:{runId:'run-A',isActive:true,stopRequested:false,status:'running',startedAt:Date.now(),setPhase:noop},
        counter:{clearOnceSuccessCount:noop,successIncr:noop,failIncr:noop,notMatchIncr:noop},
        log:{debug:noop,trace:noop,info:(...args)=>fixture.infos.push(args),warn:noop,error:noop,getLogLevel:()=>0},
        gm:{GmGetValue:(k,d)=>storage.has(k)?storage.get(k):d,GmSetValue:(k,v)=>storage.set(k,v)},
        http:async config=>{fixture.requests.push(config);if(config.url.includes('getGeekFriendList'))return {data:{code:0,zpData:{result:[peer]}}};return {data:{code:0,message:'Success',zpData:{data:{bossId:'81'}}}}},
        getJob:async id=>fixture.automationJobs.get(id)??({jobId:id,status:'COMPLETED',actions:[{kind:'CONTACT_JOB',status:'ACKNOWLEDGED'}],decision:{code:'CONTACT'}}),
    }
    fixture.makeAutomationJob=body=>{
        const decision=fixture.applicationDecision||(body.kind==='APPLICATION'?{code:'CONTACT',reason:'合成匹配'}:{code:'SEND',reason:'合成回复'})
        const base={jobId:'graph-job',kind:body.kind,status:decision.code==='CONTACT'?'WAITING_EXECUTION':'COMPLETED',phase:'EXECUTION',revision:1,inputHash:'input-hash',createdAt:Date.now(),updatedAt:Date.now(),lastErrorCode:null,decision,actions:[],phaseHistory:[],result:null}
        if(body.kind==='APPLICATION'&&decision.code==='CONTACT'){
            base.actions.push({actionId:'contact-action',jobId:base.jobId,kind:'CONTACT_JOB',status:'QUEUED',sequence:1,clientMid:null,payloadHash:'contact-hash',approvalStatus:'NOT_REQUIRED',payload:{encryptJobId:body.encryptJobId,bossId:null,conversationKey:null},lastErrorCode:null})
            if(body.input.greeting.enabled&&body.input.greeting.text.trim())base.actions.push({actionId:'greeting-action',jobId:base.jobId,kind:'SEND_GREETING',status:'QUEUED',sequence:2,clientMid:null,payloadHash:'greeting-hash',approvalStatus:'NOT_REQUIRED',payload:{encryptJobId:body.encryptJobId,bossId:null,conversationKey:null,text:body.input.greeting.text},lastErrorCode:null})
        }
        return base
    }
    fixture.publishAutomation=job=>{fixture.automationSnapshot={...fixture.automationSnapshot,jobs:[job],updatedAt:Date.now()};for(const listener of fixture.automationListeners)listener(fixture.automationSnapshot)}
    fixture.Tools={window:{_PAGE:{uid:'40'},setInterval:()=>1,setTimeout:()=>1,addEventListener:noop,location:{href:'https://synthetic.invalid/web/geek'},
        AIJobHelperChatBridge:{isReady:()=>false,getAcknowledgement:()=>fixture.ack}},
        sleep:async()=>{},getRandomNumber:()=>0,getCookieValue:()=> 'synthetic-platform-token',getEndChar:()=>'',
        isHardBlockedCompany:(...texts)=>texts.some(text=>String(text||'').includes('潮一')),fuzzyMatch:()=>false}
    const module={exports:{}}
    const context={module,exports:module.exports,require,fixture,crypto,TextEncoder,structuredClone,FormData,URL,Date,console,AbortController,
        navigator:{locks:{request:async (_name,_options,callback)=>callback({})}},window:fixture.Tools.window,document:{querySelector:()=>null,querySelectorAll:()=>[],addEventListener:noop},
        location:fixture.Tools.window.location,
        localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
        setInterval:()=>1,clearInterval:noop,setTimeout:(callback,ms)=>{if(ms===360000)fixture.applicationTimeout=callback;return 1},clearTimeout:noop}
    vm.runInNewContext(result.outputFiles[0].text,context)
    const option=new module.exports.BossOption()
    const platform=module.exports.PlatformFactory.getInstance('/web/geek')
    return {...fixture,fixture,option,platform,Option:module.exports.BossOption,navigator:context.navigator,storage}
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
test('exact resume invitation is automatically accepted while phone and WeChat still require approval', async () => {
    const env=environment();await env.option.handlerBossMessage(raw('我想要一份您的附件简历，您是否同意',undefined,7),81,'我想要一份您的附件简历，您是否同意')
    const ctx=env.submissions[0].context
    const action={actionId:'resume-action',kind:'ACCEPT_RESUME',approvalStatus:'NOT_REQUIRED',payload:{encryptJobId:'JobA',bossId:'81',
        conversationKey:'BossA:SecA',requestMessageId:ctx.inboundMessageMid,platformResumeId:'resume-A',resumeVersionId:null}}
    const executor=env.executors.get('REPLY');assert.equal(executor.ready(ctx,action),true)
    const receipt=await executor.perform(ctx,action,null);assert.equal(receipt.status,'ACKNOWLEDGED')
    const request=env.requests.find(r=>r.url.endsWith('/exchange/accept'))
    assert.equal(request.data.type,4);assert.equal(request.data.mid,'90071992547409941');assert.equal(request.data.encryptResumeId,'resume-A')
})
test('actual legacy reply and exchange exits remain held in enabled mode', async () => {
    const env=environment()
    assert.equal(await env.option.deliverPendingAiReplyLocked({}),false)
    assert.equal(await env.option.sendResumeFile(81),false)
    assert.equal(await env.option.sendMsg(81,'hello',undefined),null)
    await env.option.preReplyMsg(raw(),{},'交换微信')
    assert.equal(env.sends.length,0);assert.equal(env.requests.filter(request=>request.url.includes('/exchange/')||request.url.includes('/friend/add')).length,0)
})
test('actual matchJob preserves hard filters and captures graph FilterInput without legacy model call', async () => {
    const env=environment()
    env.store.user.preference.afE=true;env.store.user.preference.af='不接受外包或纯运维岗位'
    const job={encryptJobId:'JobA',encryptBossId:'BossA',securityId:'SecA',lid:'LidA',brandName:'合成公司',jobName:'Python后端开发',salaryDesc:'10-15K',cityName:'测试市'}
    env.platform.obtainBossJobDetailExt=async()=>({postDescription:'Python、FastAPI 和 MySQL',friendStatus:0,activeTimeDesc:'今日活跃'})
    await env.platform.matchJob(job)
    assert.equal(env.legacy.length,0);assert.match(env.platform.unifiedFilterInputs.get('JobA').input.jobExtInfo,/Python、FastAPI 和 MySQL/)
    assert.equal(env.platform.unifiedFilterInputs.get('JobA').input.prompt,'不接受外包或纯运维岗位')
    assert.equal(env.platform.unifiedFilterInputs.get('JobA').policy,'policy-A')
    await assert.rejects(env.platform.matchJob({...job,brandName:'潮一'}))
    env.platform.pushStatus='PUSHING'
})
test('actual startPush submits APPLICATION, accepts CONTACT ACK and leaves greeting solely to the graph', async () => {
    const env=environment()
    env.store.user.preference.greetingDeliveryMode='custom-queued'
    env.fixture.autoExecuteApplicationGreeting=true
    const job={encryptJobId:'JobA',encryptBossId:'BossA',securityId:'SecA',lid:'LidA',brandName:'合成公司',jobName:'Python后端开发',salaryDesc:'10-15K',cityName:'测试市'}
    env.platform.obtainBossJobDetailExt=async()=>({postDescription:'Python、FastAPI 和 MySQL',friendStatus:0,activeTimeDesc:'今日活跃'})
    env.platform.waitForDeliveryGate=async()=>{};env.platform.startPreHandler=()=>{};env.platform.preMatchJob=()=>{}
    env.platform.getJobList=()=>[job];env.platform.next=async()=>false;env.platform.isLimit=()=>({limit:false})
    env.fixture.Tools.window.AIJobHelperChatBridge.isReady=()=>true
    await env.platform.startPush()
    assert.equal(env.submissions.length,1)
    assert.equal(env.submissions[0].body.kind,'APPLICATION')
    assert.equal(env.submissions[0].body.input.preparedResumeVersionId,'prepared-A')
    assert.equal(env.submissions[0].body.input.strategyPlanId,'strategy-A')
    assert.equal(env.submissions[0].body.input.greeting.enabled,true)
    assert.equal(env.automationJobs.get('graph-job').actions.some(action=>action.kind==='SEND_GREETING'),true)
    assert.equal(env.requests.filter(request=>request.url.includes('/friend/add.json')).length,1)
    assert.equal(env.snapshots.length,1)
    assert.equal(job.contact,true)
    assert.equal(env.fixture.applicationGreetingExecutions,1)
    assert.equal(env.sends.length,1,'the graph executor sends exactly once and the legacy path must not resend');assert.equal(env.sends[0].content,'您好，这是合成招呼');assert.equal(env.legacy.length,0)
    assert.equal(env.platform.unifiedFilterInputs.size,0)
    assert.equal(env.platform.applicationSnapshotContexts.size,0)
})
test('APPLICATION rejects a filter snapshot after preferences change and never falls back to BOSS', async () => {
    const env=environment()
    const job={encryptJobId:'JobA',encryptBossId:'BossA',securityId:'SecA',lid:'LidA',brandName:'合成公司',jobName:'Python后端开发',salaryDesc:'10-15K',cityName:'测试市'}
    env.platform.obtainBossJobDetailExt=async()=>({postDescription:'Python、FastAPI 和 MySQL',friendStatus:0,activeTimeDesc:'今日活跃'})
    await env.platform.matchJob(job);env.platform.pushStatus=1;env.fixture.policy='policy-B'
    await assert.rejects(env.platform.doPush(job),/投递设置已变化/)
    assert.equal(env.submissions.length,0)
    assert.equal(env.requests.filter(request=>request.url.includes('/friend/add.json')).length,0)
    assert.equal(env.platform.unifiedFilterInputs.size,1,'retry evidence stays available until the job is terminal')
})
test('APPLICATION rechecks the captured policy immediately before the platform action', async () => {
    const env=environment()
    const job={encryptJobId:'JobA',encryptBossId:'BossA',securityId:'SecA',lid:'LidA',brandName:'合成公司',jobName:'Python后端开发',salaryDesc:'10-15K',cityName:'测试市'}
    env.platform.obtainBossJobDetailExt=async()=>({postDescription:'Python、FastAPI 和 MySQL',friendStatus:0,activeTimeDesc:'今日活跃'})
    await env.platform.matchJob(job);env.platform.pushStatus=1
    let releaseSubmit
    env.fixture.submitGate=new Promise(resolve=>{releaseSubmit=resolve})
    const pending=assert.rejects(env.platform.doPush(job),/沟通动作已被平台明确拒绝/)
    for(let attempt=0;attempt<200&&env.submissions.length===0;attempt++)await new Promise(resolve=>setTimeout(resolve,1))
    assert.equal(env.submissions[0].context.policy,'policy-A')
    env.fixture.policy='policy-B';releaseSubmit();await pending
    assert.equal(env.requests.filter(request=>request.url.includes('/friend/add.json')).length,0)
    assert.equal(env.platform.unifiedFilterInputs.size,0)
    assert.equal(env.platform.applicationSnapshotContexts.size,0)
})
test('APPLICATION deduplicates an unresolved job before any new submission or BOSS write', async () => {
    const env=environment()
    const job={encryptJobId:'JobA',encryptBossId:'BossA',securityId:'SecA',lid:'LidA',brandName:'合成公司',jobName:'Python后端开发',salaryDesc:'10-15K',cityName:'测试市'}
    env.platform.obtainBossJobDetailExt=async()=>({postDescription:'Python、FastAPI 和 MySQL',friendStatus:0,activeTimeDesc:'今日活跃'})
    await env.platform.matchJob(job);env.platform.pushStatus=1
    env.fixture.unresolvedApplication={jobId:'existing-graph-job',status:'UNCERTAIN',actions:[{kind:'CONTACT_JOB',status:'UNKNOWN'}]}
    await assert.rejects(env.platform.doPush(job),/同一岗位已有已派发或待核实任务/)
    assert.equal(env.submissions.length,0)
    assert.equal(env.requests.filter(request=>request.url.includes('/friend/add.json')).length,0)
})
test('APPLICATION maps a graph rejection without contacting BOSS', async () => {
    const env=environment()
    const job={encryptJobId:'JobA',encryptBossId:'BossA',securityId:'SecA',lid:'LidA',brandName:'合成公司',jobName:'Python后端开发',salaryDesc:'10-15K',cityName:'测试市'}
    env.platform.obtainBossJobDetailExt=async()=>({postDescription:'Python、FastAPI 和 MySQL',friendStatus:0,activeTimeDesc:'今日活跃'})
    await env.platform.matchJob(job);env.platform.pushStatus=1
    env.fixture.applicationDecision={code:'REJECT',reason:'服务端筛选不匹配'}
    await assert.rejects(env.platform.doPush(job),/LangGraph 岗位决策/)
    assert.equal(env.requests.filter(request=>request.url.includes('/friend/add.json')).length,0)
    assert.equal(env.platform.unifiedFilterInputs.size,0)
    assert.equal(env.platform.applicationSnapshotContexts.size,0)
})
test('APPLICATION timeout is bounded, cancels the graph job and never falls back to a direct POST', async () => {
    const env=environment()
    const job={encryptJobId:'JobA',encryptBossId:'BossA',securityId:'SecA',lid:'LidA',brandName:'合成公司',jobName:'Python后端开发',salaryDesc:'10-15K',cityName:'测试市'}
    env.platform.obtainBossJobDetailExt=async()=>({postDescription:'Python、FastAPI 和 MySQL',friendStatus:0,activeTimeDesc:'今日活跃'})
    await env.platform.matchJob(job);env.platform.pushStatus=1;env.fixture.autoExecuteApplication=false
    const pending=assert.rejects(env.platform.doPush(job),/统一投递任务等待超时/)
    for(let attempt=0;attempt<20&&!env.fixture.applicationTimeout;attempt++)await new Promise(resolve=>setImmediate(resolve))
    assert.equal(typeof env.fixture.applicationTimeout,'function')
    env.fixture.applicationTimeout()
    await pending
    assert.deepEqual(env.cancels,['graph-job'])
    assert.equal(env.requests.filter(request=>request.url.includes('/friend/add.json')).length,0)
    assert.equal(env.platform.unifiedFilterInputs.size,1,'an uncertain timeout must preserve data needed for reconciliation')
    assert.equal(env.platform.applicationSnapshotContexts.size,1)
})
test('strict greeting failure preserves the CONTACT success, stops the run and skips legacy resend', async () => {
    const env=environment()
    const job={encryptJobId:'JobA',encryptBossId:'BossA',securityId:'SecA',lid:'LidA',brandName:'合成公司',jobName:'Python后端开发',salaryDesc:'10-15K',cityName:'测试市'}
    env.platform.obtainBossJobDetailExt=async()=>({postDescription:'Python、FastAPI 和 MySQL',friendStatus:0,activeTimeDesc:'今日活跃'})
    await env.platform.matchJob(job);env.platform.pushStatus=1;env.fixture.applicationGreetingStatus='FAILED'
    const result=await env.platform.doPush(job)
    assert.equal(result.automationStopKind,'blocked')
    await assert.rejects(env.platform.pushAfterHandler(result,job),/严格招呼未送达/)
    assert.equal(job.contact,true)
    assert.equal(env.sends.length,0)
})
test('custom greeting checks cross-tab lock support before the first BOSS contact', async () => {
    const job={encryptJobId:'JobA',encryptBossId:'BossA',securityId:'SecA',lid:'LidA',brandName:'合成公司',jobName:'开发'}
    const guarded=environment();guarded.fixture.enabled=false;guarded.platform.pushStatus=1;guarded.platform.isLimit=()=>({limit:false})
    delete guarded.navigator.locks
    await assert.rejects(guarded.platform.doPush(job), /浏览器无法保护跨标签招呼队列/)
    assert.equal(guarded.requests.filter(request=>request.url.includes('/friend/add.json')).length,0)
    const defaultMode=environment();defaultMode.fixture.enabled=false;defaultMode.platform.pushStatus=1;defaultMode.platform.isLimit=()=>({limit:false})
    defaultMode.store.user.preference.greetingDeliveryMode='platform-default'
    delete defaultMode.navigator.locks
    await defaultMode.platform.doPush(job)
    assert.equal(defaultMode.requests.filter(request=>request.url.includes('/friend/add.json')).length,1)
})
test('actual next reports the safety wait before loading another batch', async () => {
    const env=environment()
    env.platform.pushStatus=1
    env.platform.acquireDataPre=async()=>false
    assert.equal(await env.platform.next(),false)
    assert.match(env.infos.flat().join('\n'),/安全等待 90 秒后加载下一批职位/)
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
test('automatic follow-up executor requires the exact live conversation and active reply authority', () => {
    const env=environment()
    const context={kind:'FOLLOW_UP',account:'40',policy:'policy-A',encryptJobId:'JobA',bossId:'81',
        conversationKey:'BossA:SecA',applicationId:'application-A',anchorOutboundMessageId:'outbound-A',
        anchorOutboundAt:1788757200000,contact:{...peer,bossId:'81',jobTitle:'Java开发'}}
    const action={kind:'SEND_TEXT',approvalStatus:'NOT_REQUIRED',
        payload:{encryptJobId:'JobA',bossId:'81',conversationKey:'BossA:SecA',text:'您好，想礼貌询问一下岗位进展。'}}
    const executor=env.executors.get('FOLLOW_UP')
    assert.equal(typeof executor?.ready,'function')
    assert.equal(executor.ready(context,action),true)
    env.fixture.allowed=false
    assert.equal(executor.ready(context,action),false)
    env.fixture.allowed=true;action.payload.conversationKey='BossB:SecB'
    assert.equal(executor.ready(context,action),false)
})
test('automatic follow-up scanner resolves an eligible durable candidate missing from the live contact cache', async () => {
    const env=environment()
    env.Option.bossUserInfoMap.clear()
    env.fixture.Tools.window.location.pathname='/web/geek/chat'
    env.fixture.Tools.window.AIJobHelperChatBridge.isReady=()=>true
    const candidate={applicationId:'application-A',platformAccount:'40',encryptJobId:'JobA',conversationKey:'BossA:SecA',bossId:'81',
        jobTitle:'Python后端开发',companyName:'合成公司',recruiterName:'合成HR',salaryText:'10-15K',jdText:'Python、FastAPI 和 MySQL',
        applicationValidity:'VALID',applicationStatus:'APPLIED',readState:'READ',evidenceTrack:'EXACT_READ_NO_REPLY',requiredAgeHours:24,
        anchorOutboundMessageId:'90071992547409980',anchorOutboundAt:1788757200000,eligible:true,blocker:null}
    env.fixture.http=async config=>{
        env.requests.push(config)
        if(config.url==='/api/job/career/follow-ups/candidates')return {data:{data:{items:[candidate]}}}
        if(config.url.includes('getGeekFriendList'))return {data:{code:0,zpData:{result:[peer]}}}
        throw Error(`unexpected request: ${config.url}`)
    }
    await env.option.scanAutomaticFollowUps()
    assert.equal(env.requests.some(request=>request.url.includes('getGeekFriendList')),true)
    assert.equal(env.submissions.length,1)
    assert.equal(env.submissions[0].body.kind,'FOLLOW_UP')
    assert.equal(env.submissions[0].body.input.applicationId,'application-A')
    assert.equal(env.submissions[0].context.conversationKey,'BossA:SecA')
})
test('automatic follow-up scanner refreshes a stale BOSS securityId and safely rebinds the durable candidate', async () => {
    const env=environment()
    env.Option.bossUserInfoMap.set(81,{...peer,securityId:'OldSec'})
    env.fixture.Tools.window.location.pathname='/web/geek/chat'
    env.fixture.Tools.window.AIJobHelperChatBridge.isReady=()=>true
    const candidate={applicationId:'application-A',platformAccount:'40',encryptJobId:'JobA',conversationKey:'BossA:OldSec',bossId:'81',
        jobTitle:'Python后端开发',companyName:'合成公司',recruiterName:'合成HR',salaryText:'10-15K',jdText:'Python、FastAPI 和 MySQL',
        applicationValidity:'VALID',applicationStatus:'APPLIED',readState:'UNREAD',evidenceTrack:'EXACT_UNREAD_NO_REPLY',requiredAgeHours:48,
        anchorOutboundMessageId:'90071992547409980',anchorOutboundAt:1788757200000,eligible:true,blocker:null}
    env.fixture.http=async config=>{
        env.requests.push(config)
        if(config.url==='/api/job/career/follow-ups/candidates')return {data:{data:{items:[candidate]}}}
        if(config.url.includes('getGeekFriendList'))return {data:{code:0,zpData:{result:[peer]}}}
        if(config.url.endsWith('/follow-up-binding'))return {data:{data:{applicationId:'application-A',conversationKey:'BossA:SecA',updated:true}}}
        throw Error(`unexpected request: ${config.url}`)
    }
    await env.option.scanAutomaticFollowUps()
    const rebound=env.requests.find(request=>request.url.endsWith('/follow-up-binding'))
    assert.equal(rebound.data.oldConversationKey,'BossA:OldSec');assert.equal(rebound.data.newConversationKey,'BossA:SecA')
    assert.equal(env.submissions.length,1);assert.equal(env.submissions[0].body.conversationKey,'BossA:SecA')
})
test('manual takeover waits for activation, blocks M1 and clears only after accepted newer M2', async () => {
    const env=environment()
    const key='ai-job-manual-takeover-v1:fence:40:81'
    env.storage.set(key,JSON.stringify({schemaVersion:1,status:'CONFIRMED',account:'40',bossId:'81',clientMid:'9101',serverMid:'9201',
        manualText:'人工回答',manualSentAt:1788757200100,throughInboundMessageId:'90071992547409941',throughInboundSentAt:1788757200000,
        throughInboundText:'第一条',conversationKey:null,uncertain:false,createdAt:Date.now(),updatedAt:Date.now()}))
    const originalHttp=env.fixture.http
    let releaseActivation
    env.fixture.http=async config=>{
        if(config.url==='/api/job/automation/sessions/manual-takeover'){
            env.requests.push(config)
            return new Promise(resolve=>{releaseActivation=()=>resolve({data:{data:{permanentPaused:false}}})})
        }
        return originalHttp(config)
    }
    const first=raw('第一条')
    const pendingFirst=env.option.handlerBossMessage(first,81,'第一条')
    for(let attempt=0;attempt<200&&!releaseActivation;attempt++)await new Promise(resolve=>setImmediate(resolve))
    assert.equal(typeof releaseActivation,'function')
    assert.equal(env.submissions.length,0)
    releaseActivation();await pendingFirst
    assert.equal(env.submissions.length,0,'M1 was already handled by the human')
    assert.equal(JSON.parse(env.storage.get(key)).status,'ACTIVE')
    assert.equal(JSON.parse(env.storage.get(key)).jobKey,'JobA:40','restart gap binds the confirmed fence before retry')

    let releaseSubmit
    env.fixture.submitGate=new Promise(resolve=>{releaseSubmit=resolve})
    const second=raw('第二条','90071992547409942');second.messages[0].time='1788757201000'
    const pendingSecond=env.option.handlerBossMessage(second,81,'第二条')
    for(let attempt=0;attempt<200&&env.submissions.length===0;attempt++)await new Promise(resolve=>setImmediate(resolve))
    assert.equal(env.submissions.length,1)
    assert.equal(JSON.parse(env.storage.get(key)).status,'ACTIVE','fence remains until server accepts M2')
    releaseSubmit();await pendingSecond
    assert.equal(env.storage.has(key),false)
})
test('processed replay cannot roll back a newer ready draft; opaque MID order is irrelevant', async () => {
    const env=environment()
    const manualInboundKey='ai-job-manual-takeover-v1:inbound:40:81'
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
    assert.equal(JSON.parse(env.storage.get(manualInboundKey)).mid,'100')
    assert.equal(JSON.parse(env.storage.get(manualInboundKey)).text,'第二条','processed replay cannot corrupt latest inbound text')
    const older=raw('迟到旧消息','90000000');older.messages[0].time='1788757199000'
    await env.option.handlerBossMessage(older,81,'迟到旧消息')
    assert.equal(env.executors.get('REPLY').ready(current,a),true)
    assert.equal(JSON.parse(env.storage.get(manualInboundKey)).mid,'100')
    assert.equal(JSON.parse(env.storage.get(manualInboundKey)).text,'第二条','out-of-order inbound cannot corrupt latest inbound text')
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
