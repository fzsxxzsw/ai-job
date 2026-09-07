import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import test from 'node:test'
import {parse, compileScript} from 'vue/compiler-sfc'
import {transformSync} from 'esbuild'

const require = createRequire(import.meta.url)
const {descriptor} = parse(readFileSync(new URL('./ModelRouting.vue', import.meta.url), 'utf8'))
const code = transformSync(compileScript(descriptor, {id:'scope-test'}).content, {loader:'ts',format:'cjs'}).code
const routing = {config: {enabled:true,models:[{id:'first',enabled:true},{id:'second',enabled:true}]},models:[],catalog:[],events:[]}

function component() {
    const server = {baseUrl:'server-A',generation:0}
    let token = 'token-A', dispose, changed, resolveRequest
    const calls = [], messages = []
    const axios = {
        post: (url,payload,config) => {calls.push({url,payload,config,server:server.baseUrl,token}); return new Promise(resolve=>resolveRequest=resolve)},
        get: async () => {calls.push({load:true}); return {data:{data:routing}}},
    }
    const module = {exports:{}}
    const stubRequire = path => path === 'vue' ? {...require('vue'),onMounted(){},onBeforeUnmount: cb=>dispose=cb,watch: (_,cb)=>changed=cb}
        : path === '../../axios' ? {default:axios,__esModule:true}
        : path === '../../utils/tools' ? {ElMessage: value=>messages.push(value)}
        : path === '../../stores/server' ? {ServerStore:()=>server}
        : require(path)
    new Function('require','module','exports','localStorage',code)(stubRequire,module,module.exports,{getItem:()=>token})
    const state = module.exports.default.setup({}, {expose(){}})
    state.apply(routing)
    return {state,calls,messages,server,dispose:()=>dispose(),
        switchServer(){server.baseUrl='server-B';server.generation++;changed()},
        switchToken(){token='token-B'},
        resolve(){resolveRequest({data:{data:routing}})},
    }
}

test('batch testing stops after a server or token switch without testing old ids on the new connection', async () => {
    for (const change of ['switchServer','switchToken']) {
        const c = component()
        const pending = c.state.testEnabled()
        assert.equal(c.calls.length,1)
        c[change]()
        assert.equal(c.calls[0].config.jobHelperScopeGuard(),false)
        c.resolve()
        await pending
        assert.equal(c.calls.length,1)
        assert.equal(c.state.data.value,null)
        assert.doesNotMatch(c.state.testProgress.value,/测试结束|测试通过/)
        assert.equal(c.state.busy.value,false)
    }
})

test('unmount aborts the current request and suppresses further requests and all completion writes', async () => {
    for (const operation of ['testEnabled','testOne','save','sendImport']) {
        const c=component()
        const pending=c.state[operation]('first')
        const progress=c.state.testProgress.value
        c.dispose()
        assert.equal(c.calls[0].config.signal.aborted,true)
        assert.equal(c.calls[0].config.jobHelperScopeGuard(),false)
        c.resolve()
        await pending
        assert.equal(c.calls.length,1)
        assert.equal(c.state.testProgress.value,progress)
        assert.equal(c.state.busy.value,true)
        assert.equal(c.messages.length,0)
    }
})

test('an old displayed catalog cannot be used to begin a test after token replacement', async () => {
    const c=component()
    c.switchToken()
    await c.state.testEnabled()
    assert.equal(c.calls.length,0)
    assert.equal(c.state.data.value,null)
})
