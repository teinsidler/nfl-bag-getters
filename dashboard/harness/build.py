# Local test harness: wraps dashboard/index.html with a minimal stand-in for the dashboard framework.
from pathlib import Path
root = Path(__file__).resolve().parents[1]
page = (root / "index.html").read_text()
shim = r"""
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.8.5/d3.min.js"></script>
<style>
:root{--color-fg:#1d1d1b;--color-fg-muted:#6b6a66;--color-bg:#faf9f6;--color-panel:#fff;--color-border-line:#e4e2dc;--color-ok:#2f7d4f;--color-warn:#b7791f;--color-bad:#c0392b;
--font-anthropic-sans:system-ui;--font-anthropic-serif:Georgia,serif;--cds-font-size-caption:12px;--cds-font-size-body:14px;--cds-font-size-heading:18px;--cds-font-size-title:30px;--cds-font-weight-medium:600;
--cds-gap-xs:4px;--cds-gap-sm:8px;--cds-gap-md:12px;--cds-gap-lg:20px;--cds-gap-xl:32px;--cds-pad-md:12px;--cds-pad-lg:16px;--cds-radius:8px;--c0:#3b5b92}
body{margin:0;background:var(--color-bg);color:var(--color-fg);font:14px system-ui}
#dash-root{padding:16px}
</style>
<script>
window.DASH_DATA={};
const params={mode:'all',money:'cash',perf:'total_tds',from:1999,to:2025,minatt:500,sort:'most',qb:'',csort:'inflated_apy',view:'qbs',part:'reg',team:'',color:'role',posort:'po_wins',minstart:0,sb:'any'};
const calcs={}, draws=[], ons=[], errors=[]; window.__errors=errors;
const cache={};
function computeCalc(id){const c=calcs[id]; const ins=c.inputs.map(i=>{const d=dash.data(i); return d.data;}); if(ins.some(x=>x==null))return null; return c.fn(...ins);}
window.dash={colors:['var(--c0)','#c77','#7a7'],params:()=>({...params}),setParams(o){Object.assign(params,o); for(const k in cache) if(calcs[k]) delete cache[k]; run();},
 calc(id,o){calcs[id]=o}, loader(){}, onData(f){ons.push(f)},
 data(id){ if(calcs[id]){ if(!(id in cache)) cache[id]=computeCalc(id); return {status: cache[id]?'ok':'loading', data: cache[id]}; }
   const d=DASH_DATA[id]; return d?{status:'ok',data:d}:{status:'loading',data:[]}; },
 draw(name,f){draws.push([name,f])}, refresh(){}, setLink(){}};
function run(){ try{ons.forEach(f=>f());}catch(e){errors.push('onData:'+e.stack)}
  for(const [name,f] of draws){ document.querySelectorAll('[data-draw="'+name+'"]').forEach(el=>{ if(el.closest('[hidden]'))return; try{ if(typeof f==='function') f(el); else { if(!el.__made){el.replaceChildren(); el.__made=f.mount(el);} f.update(el,el.__made);} }catch(e){errors.push(name+': '+e.stack)} }); } }
window.addEventListener('resize',()=>run());
Promise.all(['seasons','dead_money','contracts','players','team_seasons'].map(n=>fetch('../../data/dashboard/'+n+'.json').then(r=>r.json()).then(j=>DASH_DATA[n]=j.rows))).then(()=>{run();});
</script>
"""
out = shim + '<div id="dash-root">' + page.replace('<meta name="dash-one-writer">', '') + "</div>"
(Path(__file__).parent / "index.html").write_text(out)
