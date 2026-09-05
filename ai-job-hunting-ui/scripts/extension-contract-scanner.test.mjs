import assert from 'node:assert/strict'
import test from 'node:test'
import {findForbiddenJavaScript} from './extension-contract-scanner.mjs'

const maliciousSamples = [
    ["eval('code')", 'eval'],
    ["(0, eval)('code')", 'eval'],
    ["globalThis['eval']('code')", 'eval'],
    ["Reflect.apply(eval, globalThis, ['code'])", 'indirect eval'],
    ["Function('return 1')", 'Function constructor'],
    ["new Function('return 1')", 'Function constructor'],
    ["globalThis.Function('return 1')", 'Function constructor'],
    ["new window['Function']('return 1')", 'Function constructor'],
    ["self.Function.call(null, 'return 1')", 'Function constructor'],
    ["Function['apply'](null, ['return 1'])", 'Function constructor'],
    ["Reflect.construct(Function, ['return 1'])", 'Function constructor'],
    ["setTimeout('run()', 0)", 'string setTimeout'],
    ["window.setInterval(`run()`, 10)", 'string setInterval'],
    ["self['setTimeout'].call(self, 'run()', 0)", 'string setTimeout'],
    ["Reflect.apply(setInterval, self, ['run()', 10])", 'string setInterval'],
    ["new WebAssembly.Module(bytes)", 'WebAssembly runtime'],
    ["fetch(browser.runtime.getURL('module.wasm'))", '.wasm reference'],
    ["const e = eval; e('code')", 'eval'],
    ["let e; e = globalThis.eval; e('code')", 'eval'],
    ["const [e] = [eval]; e('code')", 'eval'],
    ["const {eval: e} = globalThis; e('code')", 'eval'],
    ["const {['ev' + 'al']: e} = globalThis; e('code')", 'eval'],
    ["const e = eval.bind(globalThis); e('code')", 'eval'],
    ["const call = eval.call; call(globalThis, 'code')", 'eval'],
    ["const apply = eval.apply; apply(globalThis, ['code'])", 'eval'],
    ["const F = Function; new F('return 1')", 'Function constructor'],
    ["const {Function: F} = globalThis; F('return 1')", 'Function constructor'],
    ["const make = Function.bind(null); make('return 1')", 'Function constructor'],
    ["const F = Function; Reflect.construct(F, ['return 1'])", 'Function constructor'],
    ["const {construct} = Reflect; construct(Function, ['return 1'])", 'Function constructor'],
    ["const apply = Reflect.apply; apply(eval, globalThis, ['code'])", 'indirect eval'],
    ["(() => {}).constructor('return 1')", 'Function constructor'],
    ["([]['fil' + 'ter']['con' + 'structor'])('return 1')", 'Function constructor'],
    ["({}).constructor.constructor('return 1')", 'Function constructor'],
    ["const key = 'ev' + 'al'; globalThis[key]('code')", 'eval'],
    ["const key = 'Fun' + 'ction'; window[key]('return 1')", 'Function constructor'],
    ["const later = setTimeout; later('run()', 0)", 'string setTimeout'],
    ["let repeat = setInterval; repeat.call(window, 'run()', 10)", 'string setInterval'],
    ["const {setTimeout: later} = window; later.apply(window, ['run()', 0])", 'string setTimeout'],
    ["const later = setTimeout.bind(window, 'run()'); later(0)", 'string setTimeout'],
    ["const code = 'run(' + dynamicValue; setTimeout(code, 0)", 'string setTimeout'],
    ["setInterval(`run(${dynamicValue})`, 10)", 'string setInterval'],
    ["const WA = WebAssembly; new WA.Module(bytes)", 'WebAssembly runtime'],
    ["const {Module: M} = WebAssembly; new M(bytes)", 'WebAssembly runtime'],
    ["const key = 'Web' + 'Assembly'; new globalThis[key].Module(bytes)", 'WebAssembly runtime'],
    ["const suffix = '.' + 'wasm'; fetch('module' + suffix)", '.wasm reference'],
    ["const extension = 'wasm'; fetch(`module.${extension}`)", '.wasm reference'],
]

for (const [source, expectedRule] of maliciousSamples) {
    test(`rejects ${source}`, () => {
        const findings = findForbiddenJavaScript(source, 'malicious.js')
        assert.equal(findings.some(({rule}) => rule === expectedRule), true, JSON.stringify(findings))
    })
}

test('allows function callbacks and ordinary constructors', () => {
    const source = `
        const SafeConstructor = class {}
        const timer = setTimeout(() => console.log('safe'), 0)
        setInterval(handler, 100)
        Reflect.construct(SafeConstructor, [])
        const metadata = {WebAssembly: false, wasmFallback: true}
        clearTimeout(timer)
    `
    assert.deepEqual(findForbiddenJavaScript(source, 'normal.js'), [])
})

test('allows lexically shadowed dangerous global names', () => {
    const source = `
        function useLocalApis(Function, WebAssembly, Reflect, setTimeout, setInterval) {
            new Function('data')
            new WebAssembly.Module(bytes)
            Reflect.construct(Function, [])
            setTimeout('data', 0)
            setInterval('data', 10)
        }
        {
            const Function = class SafeFunction {}
            const WebAssembly = {Module: class SafeModule {}}
            const key = 'Function'
            new Function()
            new WebAssembly.Module()
            const metadata = {[key]: true}
            void metadata
        }
        const safe = {eval() {}, Function: class {}, setTimeout() {}, setInterval() {}}
        safe.eval('data')
        new safe.Function()
        safe.setTimeout('data', 0)
        safe.setInterval('data', 10)
        void useLocalApis
    `
    assert.deepEqual(findForbiddenJavaScript(source, 'shadowed.js'), [])
})

test('fails closed when emitted JavaScript cannot be parsed', () => {
    assert.throws(
        () => findForbiddenJavaScript('const =', 'broken.js'),
        /verification fails closed/,
    )
})
