import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {build, transformSync} from 'esbuild'
import {parse, compileScript} from 'vue/compiler-sfc'
import * as Vue from 'vue'
import {modelAssistanceLabel, metricRateLabel, previewMatchesSelection} from './careerProtocol.ts'

const require = createRequire(import.meta.url)
const apiBundle = await build({entryPoints:[new URL('./careerApi.ts',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1')],bundle:true,write:false,format:'cjs',platform:'node',plugins:[{name:'local-boundaries',setup(builder){
    builder.onResolve({filter:/^(\.\.\/axios|\.\/unifiedRuntime)$/},args=>({path:args.path,namespace:'stub'}))
    builder.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export default {}; export const captureAutomationScope=()=>"scope-A"; export const prepareAutomationIdentity=async()=>"scope-A"'}))
}}]})
const box={exports:{}}
new Function('require','module','exports',apiBundle.outputFiles[0].text)(require,box,box.exports)
const {createCareerClient}=box.exports
const source=readFileSync(new URL('../components/ui/CareerWorkspace.vue',import.meta.url),'utf8')
const exposed='load,reset,selectVersion,importHistory,applyStrategy,openEvent,saveEvent,createReview,pollReview,openReview,confirmReview,previewProposal,togglePatch,acceptProposal,review,selection,versions,applications,analytics,objective,budget,eventTime,eventQuote,eventType,eventVersionId,eventConfirmation,selectedPatches,previews,error,resumeText,resumeFacts'
const descriptor=parse(source.replace('</script>',`defineExpose({${exposed}})\n</script>`)).descriptor
const compiled=transformSync(compileScript(descriptor,{id:'career-test'}).content,{loader:'ts',format:'cjs'}).code
function view(client) {
    let scope='scope-A', state
    const module={exports:{}}
    const mocks={
        vue:{...Vue,onMounted:()=>{},onUnmounted:()=>{}},'element-plus':{ElMessageBox:{confirm:async()=>{}}},
        '../../utils/tools':{ElMessage:{success:()=>{},warning:()=>{}}},
        '../../platform/careerApi':{scopedCareerClient:async()=>({scope,client})},
        '../../platform/unifiedRuntime':{captureAutomationScope:()=>scope},
        '../../platform/automationPresentation':{automationJobLabel:()=>'',automationPhaseLabel:()=>''},
        '../../platform/careerProtocol':{CAREER_EVENT_TYPES:[],metricRateLabel,previewMatchesSelection},
    }
    new Function('require','module','exports',compiled)(name=>mocks[name]||require(name),module,module.exports)
    module.exports.default.setup({}, {expose:value=>{state=value}})
    return {state,switchScope:()=>{scope='scope-B'}}
}
const emptyMetric={numerator:0,denominator:0,rate:null,excludedCount:0,sampleIds:{numerator:[],denominator:[],excluded:[]}}
function backend() {
    const calls=[],requests=new Map(), snapshots=new Set(['old-1']), imported=new Set()
    let selected='A', activeStrategy='sA', next=0, failSelection=false
    const versions=['A','B'].map(versionId=>({versionId,content:'真实简历 '+versionId,contentHash:versionId.repeat(64),createdAt:1,facts:[]}))
    const application={applicationId:'application-A',jobTitle:'合成岗位',events:[],resumeExposure:{state:'UNKNOWN'},status:'CONTACT_INITIATED'}
    const client=createCareerClient(async(path,body)=>{
        calls.push({path,body:structuredClone(body)})
        if(path.endsWith('/selection')) {if(failSelection){failSelection=false;throw Error('offline')};return {preparedResumeVersionId:selected,strategyPlanId:activeStrategy}}
        if(path.includes('/versions?'))return versions
        if(path.endsWith('/select')) {if(!requests.has(body.requestId)){assert.equal(body.baseActiveVersionId,selected);selected=decodeURIComponent(path.split('/').at(-2));requests.set(body.requestId,{})}return requests.get(body.requestId)}
        if(path.endsWith('/imports/legacy')) {if(!requests.has(body.requestId)){const fresh=[...snapshots].filter(x=>!imported.has(x));fresh.forEach(x=>imported.add(x));requests.set(body.requestId,{importedApplications:fresh.length,reusedApplications:imported.size-fresh.length,importedVersions:0})}return requests.get(body.requestId)}
        if(path.endsWith('/apply')){if(!requests.has(body.requestId)){activeStrategy=path.split('/').at(-2);requests.set(body.requestId,{strategyId:activeStrategy,status:'APPLIED'})}return requests.get(body.requestId)}
        if(path.endsWith('/events')){if(!requests.has(body.requestId)){application.events.push({...body,eventId:'event-'+(++next)});requests.set(body.requestId,{})}return {}}
        if(path.endsWith('/applications/application-A'))return structuredClone(application)
        if(path.includes('/applications?'))return [structuredClone(application)]
        if(path.includes('/analytics?'))return {metrics:{replyRate:emptyMetric}}
        if(path.includes('/strategies?')||path.includes('/automation/jobs?'))return []
        throw Error('Unexpected '+path)
    })
    return {client,calls,versions,application,snapshots,imported,selected:()=>selected,activeStrategy:()=>activeStrategy,failNextSelection:()=>{failSelection=true}}
}
test('actual view A/B/A/B selections are separate intents; failed refresh retries the same pending intent',async()=>{
    const api=backend(),{state}=view(api.client);await state.load()
    for(const id of ['B','A','B'])await state.selectVersion(api.versions.find(x=>x.versionId===id))
    assert.equal(api.selected(),'B')
    const calls=api.calls.filter(x=>x.path.endsWith('/select'))
    assert.equal(new Set(calls.map(x=>x.body.requestId)).size,3)
    api.failNextSelection();await state.selectVersion(api.versions[0]);await state.selectVersion(api.versions[0])
    assert.equal(api.selected(),'A')
    assert.equal(api.calls.filter(x=>x.path.endsWith('/select')).at(-1).body.requestId,api.calls.filter(x=>x.path.endsWith('/select')).at(-2).body.requestId)
})
test('actual view new import sees snapshots created after previous successful import',async()=>{
    const api=backend(),{state}=view(api.client);await state.load();await state.importHistory()
    api.snapshots.add('new-2');await state.importHistory()
    assert.equal(api.imported.size,2)
    const calls=api.calls.filter(x=>x.path.endsWith('/imports/legacy'));assert.notEqual(calls[0].body.requestId,calls[1].body.requestId)
})
test('strategy reselection is a new intent and only calls fixed career routes',async()=>{
    const api=backend(),{state}=view(api.client);await state.load()
    for(const strategyId of ['sB','sA','sB'])await state.applyStrategy({strategyId,previewHash:'a'.repeat(64),basePreferenceHash:'b'.repeat(64)})
    assert.equal(api.activeStrategy(),'sB');assert.equal(new Set(api.calls.filter(x=>x.path.endsWith('/apply')).map(x=>x.body.requestId)).size,3)
    assert.equal(api.calls.some(x=>/start|dispatch|platform/.test(x.path)),false)
})
test('actual manual event form appends correction and sends known version hash as user confirmation only',async()=>{
    const api=backend(),{state}=view(api.client);await state.load()
    state.openEvent(api.application,'old-event');state.eventType.value='RESUME_SENT';state.eventTime.value=new Date(Date.now()-60000)
    state.eventQuote.value='我已核对当时附件文本';state.eventVersionId.value='A';await state.saveEvent()
    const call=api.calls.find(x=>x.path.endsWith('/events'))
    assert.equal(call.body.supersedesEventId,'old-event');assert.equal(call.body.evidence.source,'USER_CONFIRMATION')
    assert.equal(call.body.evidence.contentHash,'A'.repeat(64));assert.equal(call.body.confirmation,'USER_CONFIRMED')
    assert.equal(state.applications.value[0].events.length,1)
})
test('actual scope guard clears drafts and prevents an old-view mutation after account switch',async()=>{
    const api=backend(),{state,switchScope}=view(api.client);await state.load();state.objective.value='旧账号私密目标';state.resumeText.value='旧简历'
    switchScope();await state.selectVersion(api.versions[1])
    assert.equal(api.calls.some(x=>x.path.endsWith('/select')),false);assert.equal(state.objective.value,'');assert.equal(state.resumeText.value,'')
})
test('zero denominator is unknown; changed patch choice invalidates exact preview',()=>{
    assert.equal(metricRateLabel(emptyMetric),'暂无可计算比例')
    assert.equal(previewMatchesSelection({proposalId:'p',baseVersionId:'v',selectedPatchIds:['a']},{proposalId:'p',baseVersionId:'v'},['b']),false)
})

test('model source presentation distinguishes independently validated assistance from rule fallback',()=>{
    assert.match(modelAssistanceLabel({status:'VALIDATED',modelName:'synthetic-model'}),/已通过证据校验/)
    assert.equal(modelAssistanceLabel({status:'FALLBACK',failureCode:'INVALID_MODEL_OUTPUT'}),'模型输出未通过证据校验，保留规则复盘')
    assert.match(modelAssistanceLabel({status:'FALLBACK',failureCode:'unknown'}),/未确认.*规则复盘/)
})

test('actual proposal checkbox invalidates preview; only current exact preview can be accepted',async()=>{
    const api=backend();const proposal={proposalId:'proposal-A',baseVersionId:'A',status:'DRAFT',patches:[]}
    let accepts=0
    api.client.preview=async(_proposal,selected)=>({proposalId:'proposal-A',baseVersionId:'A',selectedPatchIds:selected,previewHash:'f'.repeat(64),content:'格式整理后文本'})
    api.client.accept=async preview=>{accepts++;assert.deepEqual(preview.selectedPatchIds,['p2']);return {proposalId:'proposal-A',version:api.versions[1]}}
    const {state}=view(api.client);await state.load()
    state.togglePatch(proposal,'p1',true);await state.previewProposal(proposal)
    state.togglePatch(proposal,'p1',false);state.togglePatch(proposal,'p2',true)
    await state.acceptProposal(proposal);assert.equal(accepts,0)
    await state.previewProposal(proposal);await state.acceptProposal(proposal);assert.equal(accepts,1)
    assert.equal(api.selected(),'A','accepting a proposal does not choose or send it')
})

test('actual review creation retains frozen request after response succeeds but detail read fails',async()=>{
    const api=backend(),requests=[];let first=true
    const job={jobId:'review-A',status:'READY',revision:1,inputHash:'a'.repeat(64)}
    api.client.createReview=async input=>{requests.push(structuredClone(input));return job}
    api.client.review=async()=>{if(first){first=false;throw Error('read offline')};return {job,review:null,confirmation:null}}
    const {state}=view(api.client);await state.load();state.objective.value='真实目标';state.budget.value=12
    await state.createReview();await state.createReview()
    assert.deepEqual(requests[0],requests[1]);assert.deepEqual(requests[1].hardConstraints,{})
})

test('a late review detail cannot replace the review the user selected meanwhile',async()=>{
    const api=backend();let callsA=0,release
    const make=jobId=>({job:{jobId,status:'WAITING_CONFIRMATION'},review:null,confirmation:null})
    api.client.review=async id=>id==='A'&&++callsA>1?new Promise(resolve=>{release=()=>resolve(make('A'))}):make(id)
    const {state}=view(api.client);await state.load();await state.openReview('A')
    const old=state.pollReview();await state.openReview('B');release();await old
    assert.equal(state.review.value.job.jobId,'B')
})

test('review confirmation and preview acceptance bind exact immutable revision and hashes',async()=>{
    const calls=[],client=createCareerClient(async(path,body)=>{calls.push({path,body});return {}})
    await client.confirmReview({jobId:'review/A',revision:3,inputHash:'a'.repeat(64)},'CONFIRM')
    await client.accept({proposalId:'proposal-A',baseVersionId:'version-A',selectedPatchIds:['patch-A'],previewHash:'b'.repeat(64)})
    assert.equal(calls[0].path,'/api/job/career/reviews/review%2FA/confirmation')
    assert.equal(calls[0].body.revision,3);assert.equal(calls[0].body.inputHash,'a'.repeat(64))
    assert.equal(calls[1].body.previewHash,'b'.repeat(64));assert.equal(calls[1].body.baseVersionId,'version-A')
    assert.equal(calls.length,2,'no implicit selection, strategy apply or automation start')
})
