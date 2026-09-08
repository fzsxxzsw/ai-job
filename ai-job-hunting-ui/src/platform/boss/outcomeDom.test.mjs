import assert from 'node:assert/strict'
import test from 'node:test'
import {createRequire} from 'node:module'
import vm from 'node:vm'
import {build} from 'esbuild'
const bundled=await build({entryPoints:[new URL('./outcomeDom.ts',import.meta.url).pathname.replace(/^\/(.:)/,'$1')],bundle:true,write:false,platform:'node',format:'cjs'})
const module={exports:{}}; vm.runInNewContext(bundled.outputFiles[0].text,{module,exports:module.exports,require:createRequire(import.meta.url)})
const {captureCurrentOutcomePanel,captureCurrentReplyCandidate}=module.exports
function fixture({job='JobA',conversation='BossA:SecA',peer='81',panelSource=null,type=1,bodyType=1,text='暂不合适'}={}) {
 const selected={uid:'81',encryptBossId:'BossA',securityId:'SecA',encryptJobId:'JobA'}
 const raw={mid:'90071992547409933',type,from:{uid:peer},to:{uid:'40'},body:{type:bodyType,text},encryptJobId:job,conversationKey:conversation}
 const row={__vue__:{message:raw},closest:()=>null,getAttribute:key=>key==='data-mid'?raw.mid:null,querySelector:()=>({textContent:raw.body.text})}
 const panel={__vue__:{source:panelSource},querySelectorAll:()=>[row]}
 const selection={__vue__:{source:selected}}
 const root={querySelector:selector=>selector==='.chat-conversation'?panel:selection}
 return {root,raw,panel,selection,row}
}
test('historical raw message with complete own binding recovers without panel component source',()=>{
 const rig=fixture(); const diagnostics=[]; const result=captureCurrentOutcomePanel(rig.root,'40',value=>diagnostics.push(value))
 assert.ok(result); assert.equal(result.messages.length,1); assert.equal(result.messages[0].mid,rig.raw.mid); assert.equal(result.recheck(),true); assert.equal(diagnostics.at(-1),'')
 rig.raw.conversationKey='BossA:Other'; assert.equal(result.recheck(),false)
})
test('missing panel source requires both message-owned binding fields and exact peer',()=>{
 for(const options of [{job:null},{conversation:null},{job:'JobB'},{conversation:'BossA:Other'},{peer:'82'}]) {
  const rig=fixture(options); const diagnostics=[]; const result=captureCurrentOutcomePanel(rig.root,'40',value=>diagnostics.push(value))
  assert.equal(result?.messages.length||0,0); assert.ok(diagnostics.at(-1))
 }
})
test('a contradictory panel identity cannot be overridden by matching message metadata',()=>{
 const rig=fixture({panelSource:{uid:'82',encryptJobId:'JobB',encryptBossId:'BossB',securityId:'SecB'}})
 assert.equal(captureCurrentOutcomePanel(rig.root,'40'),null)
})
test('selection change invalidates previously recovered historical message',()=>{
 const rig=fixture();const result=captureCurrentOutcomePanel(rig.root,'40');assert.ok(result)
 rig.selection.__vue__.source={uid:'81',encryptJobId:'OtherJob',encryptBossId:'BossA',securityId:'SecA'}
 assert.equal(result.recheck(),false)
})
test('diagnostics report absent identity and clear when panel disappears',()=>{
 const rig=fixture();const diagnostics=[]
 captureCurrentOutcomePanel(rig.root,null,value=>diagnostics.push(value));assert.match(diagnostics.at(-1),/账号/)
 captureCurrentOutcomePanel({querySelector:()=>null},'40',value=>diagnostics.push(value));assert.equal(diagnostics.at(-1),'')
})
test('reply recovery accepts only the exact newest inbound message',()=>{
 const rig=fixture();const candidate=captureCurrentReplyCandidate(rig.root,'40')
 assert.ok(candidate);assert.equal(candidate.message.mid,rig.raw.mid);assert.equal(candidate.message.text,'暂不合适')
 const later={__vue__:{message:{...rig.raw,mid:'90071992547409935'}},closest:()=>null,
  getAttribute:key=>key==='data-mid'?'90071992547409935':null,querySelector:()=>({textContent:rig.raw.body.text})}
 rig.panel.querySelectorAll=()=>[later];assert.equal(candidate.recheck(),false)
 rig.panel.querySelectorAll=()=>[rig.row]
 rig.raw.from.uid='40';rig.raw.to.uid='81'
 assert.equal(captureCurrentReplyCandidate(rig.root,'40'),null)
})
test('reply recovery uses the final exact row and rejects an unverifiable final row',()=>{
 const rig=fixture();const invalid={__vue__:{message:{...rig.raw,mid:'90071992547409934'}},closest:()=>null,
  getAttribute:()=>null,querySelector:()=>({textContent:rig.raw.body.text})}
 const valid={__vue__:{message:rig.raw},closest:()=>null,
  getAttribute:key=>key==='data-mid'?rig.raw.mid:null,querySelector:()=>({textContent:rig.raw.body.text})}
 rig.panel.querySelectorAll=()=>[invalid,valid]
 assert.ok(captureCurrentReplyCandidate(rig.root,'40'))
 rig.panel.querySelectorAll=()=>[valid,invalid]
 assert.equal(captureCurrentReplyCandidate(rig.root,'40'),null)
})
test('system cards are excluded from history and can never become reply candidates',()=>{
 for(const options of [{type:4,text:'你与该职位竞争者PK情况'},{bodyType:12,text:'附件简历预览'},
  {bodyType:1,text:'对方拒绝了您的发送请求'}]) {
  const rig=fixture(options);const result=captureCurrentOutcomePanel(rig.root,'40')
  assert.equal(result?.messages.length||0,0)
  assert.equal(captureCurrentReplyCandidate(rig.root,'40'),null)
 }
})
