import test, {after, beforeEach} from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'

const folder=await mkdtemp(resolve(tmpdir(),'job-helper-http-fixture-'))
const state={generation:0,baseUrl:'http://127.0.0.1:9100/',invalidations:0,toasts:[],purchases:0}
globalThis.__jobHelperHttpFixture=state
const storage=new Map()
globalThis.localStorage={getItem:k=>storage.get(k)??null,removeItem:k=>storage.delete(k)}
const stubs={
    './utils/tools': `export const ElMessage=o=>globalThis.__jobHelperHttpFixture.toasts.push(o)`,
    './stores': `export const LoginStore=()=>({invalidate(){globalThis.__jobHelperHttpFixture.invalidations++}});export const ProductStore=()=>({setShowProduct(){globalThis.__jobHelperHttpFixture.purchases++}})`,
    './stores/server': `export const DEFAULT_SERVER_URL='http://127.0.0.1:9100/';export const ServerStore=()=>globalThis.__jobHelperHttpFixture`,
    './deploymentMode': `export const IS_PERSONAL_MODE=true`,
}
const outfile=resolve(folder,'http.cjs')
await build({entryPoints:[resolve(import.meta.dirname,'axios.ts')],outfile,bundle:true,platform:'node',format:'cjs',
    plugins:[{name:'fixture-only',setup(api){
        api.onResolve({filter:/^\.\//},args=>stubs[args.path] ? {path:args.path,namespace:'fixture'}:null)
        api.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:stubs[args.path],loader:'js'}))
    }}]})
const loaded=await import(pathToFileURL(outfile).href)
const client=loaded.default.default
const success=(config,data)=>({config,data,status:200,statusText:'OK',headers:{}})
beforeEach(()=>{state.toasts=[];state.invalidations=0;state.generation=0;state.baseUrl='http://127.0.0.1:9100/';storage.set('Authorization','fixture-local-token')})
after(async()=>{await rm(folder,{recursive:true,force:true});delete globalThis.__jobHelperHttpFixture;delete globalThis.localStorage})

test('application 401 rejects instead of resolving undefined',async()=>{
    client.defaults.adapter=async config=>success(config,{code:401,message:'expired'})
    await assert.rejects(client.post('/api/user/userinfo',{}), e=>e instanceof Error && e.code===401)
    assert.equal(storage.has('Authorization'),false);assert.equal(state.invalidations,1)
})
test('real HTTP 401 also invalidates login and rejects',async()=>{
    client.defaults.adapter=async config=>{throw {config,response:{status:401,data:{message:'expired'}}}}
    await assert.rejects(client.post('/api/user/userinfo',{}), e=>e instanceof Error && e.code===401)
    assert.equal(state.invalidations,1)
})
test('network errors reject an Error rather than a function',async()=>{
    client.defaults.adapter=async config=>{throw {config,code:'ERR_NETWORK'}}
    await assert.rejects(client.post('/api/user/userinfo',{}), e=>e instanceof Error && typeof e.message==='string' && e.code==='ERR_NETWORK')
})
test('five same backend errors emit just one toast and do not unlock purchases',async()=>{
    client.defaults.adapter=async config=>success(config,{code:500,message:'fixture repeated 500'})
    await Promise.allSettled(Array.from({length:5},()=>client.post('/api/user/userinfo',{})))
    assert.equal(state.toasts.length,1);assert.equal(state.toasts[0].grouping,true);assert.equal(state.purchases,0)
})
test('quiet request feedback remains silent',async()=>{
    client.defaults.adapter=async config=>success(config,{code:500,message:'quiet test failure'})
    await assert.rejects(client.post('/api/job/ai/applications/snapshot',{}, {suppressGlobalErrorToast:true}))
    assert.equal(state.toasts.length,0)
})
test('AI timeout cannot mark a healthy server offline',async()=>{
    state.status='online'
    client.defaults.adapter=async config=>{throw {config,code:'ECONNABORTED'}}
    await assert.rejects(client.post('/api/job/filter/one',{}))
    assert.equal(state.status,'online')
})
test('stale replies after an address change cannot update current UI or login',async()=>{
    client.defaults.adapter=async config=>{
        state.generation++;state.baseUrl='http://127.0.0.1:9200/'
        return success(config,{code:401,message:'old-server'})
    }
    await assert.rejects(client.post('/api/user/userinfo',{}),e=>e.code==='STALE_SERVER_REQUEST')
    assert.equal(state.invalidations,0);assert.equal(state.toasts.length,0)
})
test('a late 401 for the old token cannot invalidate a renewed local login',async()=>{
    client.defaults.adapter=async config=>{
        storage.set('Authorization','new-fixture-local-token')
        return success(config,{code:401,message:'old-token'})
    }
    await assert.rejects(client.post('/api/user/userinfo',{}),e=>e.code==='STALE_AUTH_REQUEST')
    assert.equal(state.invalidations,0);assert.equal(storage.get('Authorization'),'new-fixture-local-token')
})
test('success and registration envelopes remain compatible',async()=>{
    for(const code of [200,2000]){
        client.defaults.adapter=async config=>success(config,{code,data:'ok'})
        assert.equal((await client.post('/api/user/silently/login',{})).data.code,code)
    }
})

test('a scope change between scheduling and dispatch cancels before contacting the new server',async()=>{
    let sent=0
    client.defaults.adapter=async config=>{sent++;return success(config,{code:200})}
    const scope=state.generation
    const pending=client.post('/api/user/ai/routing/test',{id:'old-model'},
        {jobHelperScopeGuard:()=>state.generation===scope})
    state.generation++
    state.baseUrl='http://127.0.0.1:9200/'
    await assert.rejects(pending,e=>e.code==='ERR_CANCELED')
    assert.equal(sent,0)
    assert.equal(state.toasts.length,0)
})
