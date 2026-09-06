import assert from 'node:assert/strict'
import {readFile, mkdtemp, writeFile, rm} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {pathToFileURL} from 'node:url'
import {spawnSync} from 'node:child_process'
import {parse, compileStyle} from 'vue/compiler-sfc'

const root=resolve(import.meta.dirname,'..')
const candidates=[process.env.CHROME_BIN, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean)
const chrome=candidates.find(existsSync)
if(!chrome) throw new Error('An isolated Chrome binary is required for the layout smoke test')
const source=await readFile(resolve(root,'src/components/ui/AiJob.vue'),'utf8')
const descriptor=parse(source).descriptor
const scope='data-v-ui-layout-test'
const compiled=compileStyle({source:descriptor.styles[0].content,id:scope,scoped:true})
assert.deepEqual(compiled.errors,[])
const elementCss=await readFile(resolve(root,'node_modules/element-plus/dist/index.css'),'utf8')
const folder=await mkdtemp(resolve(tmpdir(),'job-helper-layout-'))
const fixture = width => `<section class="fixture" data-width="${width}" style="width:${width}px"><div class="el-card server-config-card" ${scope}><div class="el-card__body"><div class="server-config-container" ${scope}>
<div class="server-status" ${scope}>服务器状态 <span>检查中</span></div>
<div class="server-input" ${scope}><div class="el-input el-input-group el-input-group--prepend el-input-group--append custom-server-input">
<div class="el-input-group__prepend">服务器地址</div><div class="el-input__wrapper"><input class="el-input__inner" value="http://127.0.0.1:9100/"></div>
<div class="el-input-group__append"><div class="el-button-group btn-group"><button class="el-button test-btn"><span>连接测试</span></button><button class="el-button reset-btn"><span>↻</span></button></div></div></div></div>
<div class="server-mode-tip" ${scope}>服务未连接 · 每15秒自动重试</div></div></div></div></section>`
const html=`<!doctype html><meta charset="utf-8"><style>${elementCss}
/* Reproduce the host's conflicting table layout without loading any host-page resources. */
.el-input-group{display:inline-table!important}.el-input__wrapper{display:table-cell;width:180px}.el-input__inner{width:150px}
${compiled.code}
body{margin:0}.fixture{margin:12px}#ai-job{width:1220px}
</style><main id="ai-job">${[1170,700,360].map(fixture).join('')}</main><pre id="result"></pre><script>
const rows=[...document.querySelectorAll('.fixture')].map(el=>{
const group=el.querySelector('.el-input-group'),input=el.querySelector('input'),button=el.querySelector('.el-input-group__append'),parent=el.querySelector('.server-input');
const a=input.getBoundingClientRect(),b=button.getBoundingClientRect(),p=parent.getBoundingClientRect();
return {width:Number(el.dataset.width),display:getComputedStyle(group).display,inputWidth:a.width,gap:b.left-a.right,overflow:group.getBoundingClientRect().right-p.right};
});document.getElementById('result').textContent=JSON.stringify(rows);
</script>`
try {
    const page=resolve(folder,'layout.html');await writeFile(page,html)
    const result=spawnSync(chrome,['--headless=new','--no-sandbox','--disable-gpu','--disable-extensions','--disable-background-networking','--disable-sync',
        '--no-first-run','--no-default-browser-check',`--user-data-dir=${resolve(folder,'profile')}`,
        '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost','--window-size=1400,1000','--virtual-time-budget=1000','--dump-dom',pathToFileURL(page).href],
        {encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024})
    if(result.error) throw result.error
    const match=result.stdout?.match(/<pre id="result">([^<]+)<\/pre>/)
    assert.ok(match,'The isolated fixture must emit layout measurements')
    const rows=JSON.parse(match[1].replaceAll('&quot;','"').replaceAll('&amp;','&'))
    for(const row of rows){
        assert.equal(row.display,'flex')
        assert.ok(row.inputWidth>=20,`input collapsed: ${JSON.stringify(row)}`)
        assert.ok(row.gap>=0 && row.gap<=18,`address/button gap: ${JSON.stringify(row)}`)
        assert.ok(row.overflow<=1,`widget overflow: ${JSON.stringify(row)}`)
    }
    console.log('Isolated layout smoke PASS',JSON.stringify(rows))
    console.log('Fixture-only: no user Chrome profile, no BOSS requests, no browser actions')
} finally {
    await rm(folder,{recursive:true,force:true,maxRetries:5,retryDelay:250})
}
