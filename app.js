const CATS=[
  {id:'thesis',name:'碩論',group:'main'},
  {id:'job',name:'求職',group:'main'},
  {id:'toefl',name:'托福單字',group:'invest'},
  {id:'french',name:'法文',group:'invest'},
  {id:'read',name:'課外書',group:'invest'},
  {id:'chores',name:'生活雜事',group:'life'},
  {id:'rest',name:'休息娛樂',group:'life'},
  {id:'drift',name:'滑手機／拖延',group:'drift'}
];
const GROUPS=[
  {id:'main',name:'主線',color:'var(--c-thesis)'},
  {id:'invest',name:'長期投資',color:'var(--c-toefl)'},
  {id:'life',name:'生活',color:'var(--c-chores)'},
  {id:'drift',name:'逃避',color:'var(--c-drift)'}
];
const SLOT=30*60000, N=48, DAY_START=14; // 07:00
const catById=Object.fromEntries(CATS.map(c=>[c.id,c]));
const col=id=>`var(--c-${id})`;
const tint=id=>`color-mix(in srgb, var(--c-${id}) 34%, var(--surface))`;
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad=n=>String(n).padStart(2,'0');
const keyOf=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const todayKey=()=>keyOf(new Date());
const parseKey=k=>{const[y,m,d]=k.split('-').map(Number);return new Date(y,m-1,d)};
const addDays=(k,n)=>{const d=parseKey(k);d.setDate(d.getDate()+n);return keyOf(d)};
const WD=['日','一','二','三','四','五','六'];
const fmtH=min=>{if(min<1)return '0h';const h=Math.floor(min/60),m=Math.round(min%60);return h?(m?`${h}h ${pad(m)}m`:`${h}h`):`${m}m`};
const hm=ts=>{const d=new Date(ts);return `${pad(d.getHours())}:${pad(d.getMinutes())}`};
const slotLabel=i=>`${pad(Math.floor(i/2))}:${i%2?'30':'00'}`;

let S={days:{},running:null};
let mode='local',db=null,base=null;
let view='today',cursor=todayKey();
let brush='thesis',showNight=false;
try{brush=localStorage.getItem('tl-brush')||'thesis';showNight=localStorage.getItem('tl-night')==='1'}catch(e){}

/* ---------- storage ---------- */
const LS='time-ledger-v1';
function loadLocal(){try{const raw=localStorage.getItem(LS);if(raw){const o=JSON.parse(raw);S.days=o.days||{};S.running=o.running||null}}catch(e){}}
function saveLocal(){try{localStorage.setItem(LS,JSON.stringify(S))}catch(e){}}
const chains={};
function write(id,data){
  chains[id]=(chains[id]||Promise.resolve()).then(()=>db.collection(base).doc(id).set(data))
    .catch(e=>toast(e&&e.code==='quota_exceeded'?'儲存空間已滿，請刪掉一些舊紀錄':'同步失敗，請稍後再試'));
}
function persistDay(k){if(mode==='cloud')write(k,JSON.parse(JSON.stringify(S.days[k])));else saveLocal()}
function persistState(){if(mode==='cloud')write('state',{running:S.running});else saveLocal()}
const dayOf=k=>S.days[k]||{mit:'',mitDone:false};
function setDay(k,d){S.days[k]=d;persistDay(k)}

/* slots: array of 48 category ids (or null); older timer entries are converted on read */
function slotsOf(k){
  const d=dayOf(k);
  if(Array.isArray(d.slots)&&d.slots.length===N)return d.slots;
  const arr=Array(N).fill(null);
  if(Array.isArray(d.entries)){const d0=parseKey(k).getTime();
    d.entries.forEach(e=>{for(let i=0;i<N;i++){const s=d0+i*SLOT,ov=Math.min(e.end,s+SLOT)-Math.max(e.start,s);if(ov>=SLOT/2)arr[i]=e.cat}})}
  return arr;
}
function saveSlots(k,slots){const d={...dayOf(k),slots};delete d.entries;setDay(k,d)}

async function connect(){
  if(!window.claude||!window.claude.use)return;
  try{
    const [d,u]=await Promise.all([claude.use('db'),claude.use('user')]);
    if(!d||!u)return;
    const id=await u.id();
    if(!id)return;
    db=d;base='data/users/'+id;
    db.collection(base).onSnapshot(snap=>{
      if(mode!=='cloud'){mode='cloud';$('sync').classList.add('cloud');$('syncText').textContent='已同步到你的帳號'}
      const days={};let running=null;
      snap.docs.forEach(doc=>{const v=doc.data();if(doc.id==='state')running=v.running||null;else if(/^\d{4}-\d{2}-\d{2}$/.test(doc.id))days[doc.id]=v});
      S.days=days;S.running=running;render();
    },()=>{toast('連線中斷，重新整理頁面即可恢復')});
  }catch(e){}
}

/* ---------- painting ---------- */
let drag=null,pendingRender=false;
function paint(i){
  if(!drag)return;
  const from=drag.last==null?i:drag.last;
  for(let j=Math.min(from,i);j<=Math.max(from,i);j++){drag.slots[j]=drag.val;const c=document.querySelector(`.cell[data-i="${j}"]`);if(c)styleCell(c,j,drag.slots)}
  drag.last=i;
}
function endDrag(){
  if(!drag)return;
  const changed=drag.slots.some((v,i)=>v!==drag.orig[i]);
  const slots=drag.slots;drag=null;
  if(changed)saveSlots(cursor,slots);
  render();
}
$('grid').addEventListener('pointerdown',e=>{
  const c=e.target.closest('[data-i]');if(!c)return;
  e.preventDefault();
  const i=+c.dataset.i,orig=slotsOf(cursor);
  const val=brush==='erase'?null:(orig[i]===brush?null:brush);
  drag={val,orig,slots:[...orig],last:null};
  try{$('grid').setPointerCapture(e.pointerId)}catch(err){}
  paint(i);
});
$('grid').addEventListener('pointermove',e=>{
  if(!drag)return;
  const el=document.elementFromPoint(e.clientX,e.clientY);const c=el&&el.closest&&el.closest('[data-i]');
  if(c)paint(+c.dataset.i);
});
['pointerup','pointercancel','lostpointercapture'].forEach(t=>$('grid').addEventListener(t,endDrag));

function styleCell(c,i,slots){
  const v=slots[i];
  c.style.background=v?tint(v):'';
  c.style.borderLeftColor=v?col(v):'transparent';
  const start=v&&(i===0||slots[i-1]!==v);
  c.textContent=start?catById[v].name:'';
  c.setAttribute('aria-label',`${slotLabel(i)} ${v?catById[v].name:'空白'}`);
}

/* ---------- timer ---------- */
function fillRange(start,end,cat){
  let k=keyOf(new Date(start)),filled=0;
  while(true){
    const d0=parseKey(k).getTime();if(d0>=end)break;
    const slots=[...slotsOf(k)];let changed=false;
    for(let i=0;i<N;i++){const s=d0+i*SLOT,ov=Math.min(end,s+SLOT)-Math.max(start,s);if(ov>=SLOT/2){slots[i]=cat;changed=true;filled++}}
    if(changed)saveSlots(k,slots);
    k=addDays(k,1);
  }
  return filled;
}
function startTimer(){
  if(brush==='erase'){toast('先選一個類別顏色');return}
  if(S.running&&S.running.cat===brush)return;
  if(S.running)stopTimer(true);
  S.running={cat:brush,start:Date.now()};persistState();render();
}
function stopTimer(silent){
  const r=S.running;if(!r)return;
  const end=Date.now();S.running=null;persistState();
  const n=fillRange(r.start,end,r.cat);
  if(!silent)toast(n?`已填入 ${catById[r.cat].name} ${fmtH(n*30)}`:'不到 15 分鐘，沒有填進格子');
  render();
}

/* ---------- derived ---------- */
function totals(keys){
  const byCat=Object.fromEntries(CATS.map(c=>[c.id,0]));
  keys.forEach(k=>slotsOf(k).forEach(v=>{if(v&&byCat[v]!=null)byCat[v]+=30}));
  const byGroup=Object.fromEntries(GROUPS.map(g=>[g.id,0]));
  CATS.forEach(c=>byGroup[c.group]+=byCat[c.id]);
  const all=Object.values(byCat).reduce((a,b)=>a+b,0);
  return {byCat,byGroup,all};
}
function groupTiles(t){
  return GROUPS.map(g=>`<div class="g" style="border-left-color:${g.color}"><span class="n">${g.name}</span><span class="v">${fmtH(t.byGroup[g.id])}</span></div>`).join('');
}
function catBars(t,divisor){
  const max=Math.max(1,...Object.values(t.byCat));
  return CATS.map(c=>{const v=t.byCat[c.id];return `<div class="bar"><span>${c.name}</span><div class="track"><div class="fill" style="width:${v/max*100}%;background:${col(c.id)}"></div></div><span class="m">${fmtH(v)}${divisor?`<br><small>日均 ${fmtH(v/divisor)}</small>`:''}</span></div>`}).join('');
}
function nowIdx(){const n=new Date();return n.getHours()*2+(n.getMinutes()>=30?1:0)}

/* ---------- render ---------- */
function render(){
  if(drag){pendingRender=true;return}
  const tk=todayKey(),isToday=cursor===tk;
  $('tabToday').setAttribute('aria-selected',view==='today');
  $('tabWeek').setAttribute('aria-selected',view==='week');
  $('viewToday').hidden=view!=='today';$('viewWeek').hidden=view!=='week';

  const dd=parseKey(cursor);
  $('dateLabel').textContent=`${dd.getMonth()+1} 月 ${dd.getDate()} 日（${WD[dd.getDay()]}）`;
  $('nextDay').disabled=cursor>=tk;$('goToday').hidden=isToday;
  const day=dayOf(cursor);
  if(document.activeElement!==$('mitText'))$('mitText').value=day.mit||'';
  $('mitDone').checked=!!day.mitDone;$('mitRow').classList.toggle('done',!!day.mitDone);

  // brushes
  $('chips').innerHTML=CATS.map(c=>`<button class="chip" data-brush="${c.id}" aria-pressed="${brush===c.id}"><span class="sw" style="background:${col(c.id)}"></span><span>${c.name}</span></button>`).join('')
    +`<button class="chip" data-brush="erase" aria-pressed="${brush==='erase'}"><span class="sw erase"></span><span>清除</span></button>`;

  // grid
  const slots=slotsOf(cursor),ni=isToday?nowIdx():-1;
  const nightFilled=slots.slice(0,DAY_START).filter(Boolean).length;
  $('nightBtn').textContent=showNight?'收起 00:00–07:00':`顯示 00:00–07:00${nightFilled?`（有 ${nightFilled} 格紀錄）`:''}`;
  const h0=showNight?0:DAY_START/2;
  let html='';
  for(let h=h0;h<24;h++){
    html+=`<div class="hr"><span class="h">${pad(h)}:00</span>`;
    for(const i of [h*2,h*2+1])html+=`<button class="cell${isToday&&i>ni?' future':''}${i===ni?' now':''}" data-i="${i}"></button>`;
    html+='</div>';
  }
  $('grid').innerHTML=html;
  document.querySelectorAll('.cell').forEach(c=>styleCell(c,+c.dataset.i,slots));

  // gap nudge
  const until=isToday?ni:N;
  const blanks=slots.slice(DAY_START,Math.max(DAY_START,until)).filter(v=>!v).length;
  $('gapText').innerHTML=until<=DAY_START?'':blanks?`07:00 到${isToday?'現在':'午夜'}還有 <b>${fmtH(blanks*30)}</b> 空白`:'這段時間都填滿了';

  // summary
  const t=totals([cursor]);
  $('dayGroups').innerHTML=groupTiles(t);
  $('dayBars').innerHTML=t.all?catBars(t):'<p class="empty">這天還沒有紀錄。選一個顏色，從上面的格子開始塗。</p>';

  // timer
  const r=S.running;
  $('stopBtn').disabled=!r;
  $('startBtn').textContent=brush==='erase'?'先選一個類別':(r&&r.cat===brush?'正在計時中':`開始：${catById[brush].name}`);
  $('startBtn').disabled=brush==='erase'||!!(r&&r.cat===brush);
  if(r)$('timerBox').open=true;
  tick();

  if(view==='week')renderWeek(tk);
}

function renderWeek(tk){
  const keys=[...Array(7)].map((_,i)=>addDays(tk,i-6));
  const prev=[...Array(7)].map((_,i)=>addDays(tk,i-13));
  const t=totals(keys),tp=totals(prev);
  $('weekGroups').innerHTML=groupTiles(t);
  const perDay=keys.map(k=>totals([k]));
  const maxH=Math.max(2,...perDay.map(p=>p.all/60));
  const top=Math.ceil(maxH/2)*2,steps=top<=6?top/2:top<=12?top/4:top/6;
  let y='',g='';for(let v=0;v<=top+1e-9;v+=steps){const p=v/top*100;y+=`<span style="bottom:${p}%">${Math.round(v*10)/10}h</span>`;g+=`<div class="gl" style="bottom:${p}%"></div>`}
  $('yax').innerHTML=y;
  $('plot').innerHTML=g+perDay.map((p,i)=>`<div class="col${keys[i]===tk?' today':''}" title="${fmtH(p.all)}">${GROUPS.map(gr=>p.byGroup[gr.id]>0?`<i style="height:${p.byGroup[gr.id]/60/top*100}%;background:${gr.color}"></i>`:'').join('')}</div>`).join('');
  $('xax').innerHTML=keys.map(k=>{const d=parseKey(k);return `<span><b>${WD[d.getDay()]}</b>${d.getMonth()+1}/${d.getDate()}</span>`}).join('');
  $('legend').innerHTML=GROUPS.map(gr=>`<span><i style="background:${gr.color}"></i>${gr.name}</span>`).join('');
  $('weekBars').innerHTML=catBars(t,7);

  const ins=[];
  if(!t.all){ins.push('這 7 天還沒有紀錄。先填滿一週，這裡就會開始有東西可以看。')}
  else{
    const th=t.byCat.thesis,thp=tp.byCat.thesis;
    ins.push(`碩論 ${fmtH(th)}，平均每天 ${fmtH(th/7)}`+(thp?`，上週是 ${fmtH(thp)}（${th>=thp?'多了':'少了'} ${fmtH(Math.abs(th-thp))}）。`:'。'));
    const mainPct=Math.round(t.byGroup.main/t.all*100),driftPct=Math.round(t.byGroup.drift/t.all*100);
    ins.push(`有記錄的時間裡，主線佔 ${mainPct}%，逃避佔 ${driftPct}%。`);
    if(t.byGroup.invest>t.byGroup.main)ins.push('長期投資（單字、法文、閱讀）比主線還多。如果碩論這週有進度目標，可以考慮把它們移到碩論之後做。');
    const mitSet=keys.filter(k=>dayOf(k).mit).length,mitDone=keys.filter(k=>dayOf(k).mitDone).length;
    if(mitSet)ins.push(`有寫「最重要的一件事」的天數 ${mitSet} 天，完成 ${mitDone} 天。`);
    const starts=[];keys.forEach(k=>{const s=slotsOf(k);s.forEach((v,i)=>{if(v==='thesis'&&(i===0||s[i-1]!=='thesis'))starts.push(Math.floor(i/2))})});
    if(starts.length>=3){const c={};starts.forEach(h=>c[h]=(c[h]||0)+1);const best=Object.entries(c).sort((a,b)=>b[1]-a[1])[0][0];ins.push(`你最常在 ${pad(best)}:00 左右開始做碩論，這可能是你最容易進入狀態的時段。`)}
    const empty=keys.filter(k=>!slotsOf(k).some(Boolean)).length;
    if(empty)ins.push(`有 ${empty} 天完全沒記錄。漏記也是一種資訊：那幾天通常在做什麼？`);
  }
  $('insights').innerHTML=ins.map(s=>`<li>${esc(s)}</li>`).join('');
}

function tick(){
  const r=S.running;
  if(!r){$('clock').textContent='00:00:00';$('clockLabel').textContent='選上面的顏色，再按開始';$('staleWarn').hidden=true;return}
  const s=Math.floor((Date.now()-r.start)/1000);
  $('clock').textContent=`${pad(Math.floor(s/3600))}:${pad(Math.floor(s%3600/60))}:${pad(s%60)}`;
  $('clockLabel').textContent=`${catById[r.cat]?.name||''} · 從 ${hm(r.start)} 開始`;
  $('staleWarn').hidden=s<43200;
}

let toastT;
function toast(msg){const t=$('toast');t.textContent=msg;t.hidden=false;clearTimeout(toastT);toastT=setTimeout(()=>t.hidden=true,2600)}

/* ---------- wiring ---------- */
$('tabToday').onclick=()=>{view='today';render()};
$('tabWeek').onclick=()=>{view='week';render()};
$('prevDay').onclick=()=>{cursor=addDays(cursor,-1);render()};
$('nextDay').onclick=()=>{if(cursor<todayKey()){cursor=addDays(cursor,1);render()}};
$('goToday').onclick=()=>{cursor=todayKey();render()};
$('chips').onclick=e=>{const b=e.target.closest('[data-brush]');if(!b)return;brush=b.dataset.brush;try{localStorage.setItem('tl-brush',brush)}catch(err){}render()};
$('nightBtn').onclick=()=>{showNight=!showNight;try{localStorage.setItem('tl-night',showNight?'1':'0')}catch(err){}render()};
$('startBtn').onclick=startTimer;
$('stopBtn').onclick=()=>stopTimer(false);
$('mitText').onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();$('mitText').blur()}};
$('mitText').onchange=()=>{const v=$('mitText').value.trim();setDay(cursor,{...dayOf(cursor),mit:v});toast(v?'已儲存，做完記得回來打勾':'已清空')};
$('mitDone').onchange=()=>{const done=$('mitDone').checked;setDay(cursor,{...dayOf(cursor),mitDone:done});render();if(done)toast('完成這天最重要的事')};
setInterval(()=>{if(S.running)tick()},1000);
let lastIdx=nowIdx(),lastDay=todayKey();
setInterval(()=>{const k=todayKey(),i=nowIdx();if(k!==lastDay){if(cursor===lastDay)cursor=k;lastDay=k;lastIdx=i;render()}else if(i!==lastIdx){lastIdx=i;render()}},30000);
document.addEventListener('pointerup',()=>{if(!drag&&pendingRender){pendingRender=false;render()}});

loadLocal();render();connect();
