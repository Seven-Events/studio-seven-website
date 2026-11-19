(async function(){
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const money=c=>"$"+(c/100).toFixed(2);
const short=c=>c%100?money(c):"$"+(c/100);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const store={get(k,d){try{const v=localStorage.getItem("s7-"+k);return v?JSON.parse(v):d}catch(e){return d}},set(k,v){try{localStorage.setItem("s7-"+k,JSON.stringify(v))}catch(e){}}};
const SPRIG="/img/sprig.webp", SPRIGF="/img/sprigf.webp";

/* ---------- MENU: read live from the shop's Square Item Library (api/menu.js) ---------- */
let M;
try{const r=await fetch("/api/menu");if(!r.ok)throw 0;M=await r.json()}catch(e){document.body.insertAdjacentHTML("afterbegin",'<p style="padding:16px;background:#f1ddd3">The menu didn\'t load. Please refresh the page.</p>');return}
const C=M.coffee, F=M.flowers;
const COFFEE=Object.fromEntries(C.categories.map(c=>[c.name,c.items]));
const FLOWERS=F.items;
const allDrinks=()=>C.categories.flatMap(c=>c.items);
const item=id=>allDrinks().find(x=>x.id===id)||FLOWERS.find(x=>x.id===id);
const minP=i=>Math.min(...i.v.map(v=>v.p));
const fromP=i=>(new Set(i.v.map(v=>v.p)).size>1||i.mods.some(m=>m.o.some(o=>o.d&&!o.def)))?"from "+money(minP(i)):money(minP(i));

/* ---------- CART: stores Square ids and choices only; Square prices the order itself ---------- */
let cart=store.get("cart3",[]).filter(l=>{const i=l&&item(l.id);return i&&i.v.some(v=>v.id===l.v&&!v.out)});
function describe(l){
  const i=item(l.id),v=i.v.find(x=>x.id===l.v),o=[];let p=v.p;
  if(i.v.length>1)o.push(v.n);
  i.mods.forEach(m=>m.o.forEach(x=>{if((l.mods||[]).includes(x.id)){p+=x.d;o.push(m.n.toLowerCase()==="milk"&&!/milk/i.test(x.n)?x.n+" milk":x.n)}}));
  if(i.kind==="coffee"){if(l.note)o.push(`"${l.note}"`)}
  else{o.push(F.occasions[l.occasion||0]);
    if(l.card)o.push(`card: "${l.card}"`)}
  return {n:i.n,unit:p,opts:o.join(", "),kind:i.kind};
}
const fmtDay=d=>new Date(d+"T12:00").toLocaleDateString("en-CA",{weekday:"long",month:"long",day:"numeric"});
function day(days){const d=new Date();d.setDate(d.getDate()+days);return d.toLocaleDateString("en-CA")}
/* Christmas pickup/delivery days (set in shop-settings.json). Each one stops taking orders orderAheadDays before. */
const XMAS=F.christmas;
const xmasOpen=()=>XMAS?XMAS.dates.filter(d=>d>=day(XMAS.orderAheadDays)):[];
const isXmas=i=>!!(XMAS&&i&&i.xmas);
const save=()=>{store.set("cart3",cart);$("#cartN").textContent=cart.reduce((a,l)=>a+l.q,0)};

/* ---------- ROUTING ---------- */
const VIEWS=["home","coffee","flowers","holiday"];
const TITLE=document.title;
function route(){
  const raw=(location.hash||"#home").slice(1);
  const prod=raw.startsWith("p/")?FLOWERS.find(f=>f.id===decodeURIComponent(raw.slice(2))):null;
  const h=prod?"product":VIEWS.includes(raw)?raw:"home";
  if($("#sheet").classList.contains("on")&&!paying)closeSheet();
  document.title=prod?`${prod.n} · ${TITLE}`:TITLE;
  if(prod)openProduct(prod);
  $$("[data-view]").forEach(v=>v.hidden=v.dataset.view!==h);
  $$("[data-tab]").forEach(a=>{if(a.dataset.tab===(h==="product"||h==="holiday"?"flowers":h))a.setAttribute("aria-current","page");else a.removeAttribute("aria-current")});
  if(raw==="cart-booking")$("#cart-booking").scrollIntoView({behavior:"smooth"});else window.scrollTo(0,0);
}
window.addEventListener("hashchange",route);

/* ---------- RIBBON ---------- */
const once=["Fresh flowers","Coffee bar","Downtown Omemee","Pre-orders open"].map(w=>`<span>${w} ✿</span>`).join("");
$("#ribbon").innerHTML=once+once+once+once;

/* ---------- TILES ---------- */
const tile=(f,i)=>`<a class="tile" href="#p/${encodeURIComponent(f.id)}"><span class="pic">${f.out?`<span class="flag out">Sold out</span>`:f.tag?`<span class="flag">${esc(f.tag)}</span>`:isXmas(f)?`<span class="flag">Christmas</span>`:""}${f.img?`<img class="photo" src="${esc(f.img)}" style="object-position:${esc(f.focus||"50% 50%")}" alt="" loading="lazy">`:`<img src="${i%4===0||i%4===3?SPRIGF:SPRIG}" alt="">`}</span><b>${esc(f.n)}</b><span class="pr">${fromP(f).replace(/\.00$/,"")}</span></a>`;
/* product page photo gallery: swipe on phones, thumbnails underneath */
const gallery=i=>`<div class="gallery"><div class="g-track">${i.imgs.map((u,k)=>`<img class="sheet-pic" src="${esc(u)}" style="object-position:${k?"50% 50%":esc(i.focus||"50% 50%")}" alt="${esc(i.n)}, photo ${k+1} of ${i.imgs.length}"${k?' loading="lazy"':""}>`).join("")}</div><div class="g-thumbs">${i.imgs.map((u,k)=>`<button type="button" data-g="${k}" aria-label="Show photo ${k+1}"${k?"":' aria-current="true"'}><img src="${esc(u)}" alt=""></button>`).join("")}</div></div>`;
document.addEventListener("click",e=>{const b=e.target.closest("[data-g]");if(!b)return;const t=b.closest(".gallery").querySelector(".g-track");t.scrollTo({left:+b.dataset.g*t.clientWidth,behavior:"smooth"})});
document.addEventListener("scroll",e=>{const t=e.target;if(!t.classList||!t.classList.contains("g-track"))return;const k=Math.round(t.scrollLeft/t.clientWidth);t.parentNode.querySelectorAll("[data-g]").forEach(b=>{if(+b.dataset.g===k)b.setAttribute("aria-current","true");else b.removeAttribute("aria-current")})},true);

/* hero tiles with the shop's own photos (public/img/): the wrap opens all flowers, Pre-orders opens the holiday page */
const photoTile=(sel,img,alt,label,href)=>{const c=$(sel);c.href=href;c.classList.add("has-photo");c.innerHTML=`<img class="photo" src="${img}" style="object-position:50% 45%" alt="${esc(alt)}"><span>${esc(label)}</span>`};
photoTile(".collage .c1","/img/signature-wrap.webp","Signature wrap bouquet","Signature wrap","#flowers");
photoTile(".collage .c3","/img/preorder.webp","Christmas pre-order flowers","Pre-orders","#holiday");

/* holiday page: the Christmas items from shop-settings.json, plus anything named "Holiday" */
const HOLIDAY=FLOWERS.filter(f=>f.xmas||/holiday/i.test(f.n));
$("#holidayTiles").innerHTML=HOLIDAY.map(tile).join("");
if(!HOLIDAY.length)$("#holidayTiles").insertAdjacentHTML("beforebegin",'<p class="empty">Holiday flowers are coming soon.</p>');
$("#featTiles").innerHTML=FLOWERS.filter(f=>!f.out).slice(0,4).map(tile).join("");
if(!FLOWERS.length)$("#flowerTiles").insertAdjacentHTML("beforebegin",'<p class="empty">Flowers are coming soon.</p>');
$("#flowerTiles").innerHTML=FLOWERS.map(tile).join("");

/* ---------- COFFEE ---------- */
const priceLabel=i=>i.out?"Sold out":fromP(i);
const feat=allDrinks().filter(d=>d.tag&&!d.out);
$("#featDrinks").innerHTML=feat.concat(allDrinks().filter(d=>!d.tag&&!d.out)).slice(0,4).map(d=>`<button class="drink" type="button" data-id="${d.id}"><span class="nm">${esc(d.n)}</span><span class="dots"></span><span class="pr">${money(minP(d))}</span></button>`).join("");
const cats=Object.keys(COFFEE);
$("#coffeeTabs").innerHTML=cats.map((c,i)=>`<button class="cat" type="button" aria-pressed="${i===0}" data-cat="${i}">${esc(c)}</button>`).join("");
$("#coffeeList").innerHTML=cats.map((c,ci)=>`<h2 id="cat-${ci}">${esc(c)}</h2>`+COFFEE[c].map(i=>`<button class="dish${i.out?" out":""}" type="button" data-id="${i.id}"><span class="r"><span class="nm">${esc(i.n)}${i.tag?`<span class="tagx">${esc(i.tag)}</span>`:""}</span><span class="dots"></span><span class="pr">${priceLabel(i)}</span></span>${i.d?`<span class="ds">${esc(i.d)}</span>`:""}</button>`).join("")).join("");
if(!cats.length)$("#coffeeList").innerHTML='<p class="empty">Our coffee menu is coming soon.</p>';
$("#coffeeTabs").addEventListener("click",e=>{const b=e.target.closest("[data-cat]");if(!b)return;
  $$("#coffeeTabs .cat").forEach(x=>x.setAttribute("aria-pressed",x===b));
  const t=$("#cat-"+b.dataset.cat);window.scrollTo({top:t.getBoundingClientRect().top+scrollY-130,behavior:"smooth"})});
document.addEventListener("click",e=>{const b=e.target.closest(".dish[data-id],.drink[data-id]");if(b)openDrink(item(b.dataset.id))});

/* ---------- SHEET ---------- */
let lastFocus=null;
function openSheet(html){lastFocus=document.activeElement;$("#sheetBody").innerHTML=`<div class="grab"></div>`+html;$("#scrim").classList.add("on");$("#sheet").classList.add("on");$("#sheet").scrollTop=0;document.body.style.overflow="hidden";setTimeout(()=>{const f=$("#sheet .x");f&&f.focus({preventScroll:true})},60)}
let pageMode=false;
const body=()=>pageMode?$("#pBody"):$("#sheetBody");
function show(html){if(pageMode)$("#pBody").innerHTML=html;else openSheet(html)}
function added(msg){if(pageMode){toast(msg);openProduct(item(location.hash.slice(3)?decodeURIComponent(location.hash.slice(3)):""))}else{closeSheet();toast(msg)}}
function closeSheet(){$("#scrim").classList.remove("on");$("#sheet").classList.remove("on");document.body.style.overflow="";destroyPayments();lastFocus&&lastFocus.focus&&lastFocus.focus({preventScroll:true})}
$("#scrim").addEventListener("click",()=>{if(!paying)closeSheet()});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!paying)closeSheet()});
$("#sheet").addEventListener("click",e=>{if(e.target.closest("[data-close]")&&!paying)closeSheet()});
const pic=i=>pageMode&&(i.imgs||[]).length>1?gallery(i):i.img?`<img class="sheet-pic" src="${esc(i.img)}" style="object-position:${esc(i.focus||"50% 50%")}" alt="">`:"";
const head=(t,sub,price)=>`<div class="sheet-h"><div>${pageMode?`<h1>${t}</h1>`:`<h2 id="sheetTitle">${t}</h2>`}${pageMode&&price?`<p class="pdp-price">${price}</p>`:""}${sub?`<p>${sub}</p>`:""}</div>${pageMode?"":`<button class="x" type="button" data-close aria-label="Close">×</button>`}</div>`;
const choice=(name,opts,sel=0,key=name)=>`<div class="field"><span class="legend">${esc(name)}</span><div class="choice${opts.length>5?" many":""}" data-seg="${esc(key)}">${opts.map((o,i)=>`<button type="button" aria-pressed="${i===sel}" data-i="${i}"${o.off?" disabled":""}>${esc(o.n)}${o.d?`<small>+${money(o.d)}</small>`:""}${o.off?`<small>Sold out</small>`:""}</button>`).join("")}</div></div>`;
function wire(root,cb){root.querySelectorAll("[data-seg]").forEach(g=>g.addEventListener("click",e=>{const b=e.target.closest("button");if(!b||b.disabled)return;g.querySelectorAll("button").forEach(x=>x.setAttribute("aria-pressed",x===b));cb&&cb()}))}
const val=(root,name)=>+root.querySelector(`[data-seg="${name}"] [aria-pressed="true"]`).dataset.i;
const qtyHtml=`<div class="field"><span class="legend">How many</span><div class="qty"><button type="button" data-q="-1" aria-label="One fewer">−</button><output id="q">1</output><button type="button" data-q="1" aria-label="One more">+</button></div></div>`;

/* Size = the item's variations in Square. Other choices = its modifier lists (milk, add-ons, a vase...). */
function sizeHtml(i,label){if(i.v.length<2)return"";const first=Math.max(0,i.v.findIndex(v=>!v.out));
  return choice("Size",i.v.map(v=>({n:label?`${v.n} ${short(v.p)}`:v.n,d:label?0:v.p-minP(i),off:v.out})),first,"v")}
function modsHtml(i){return i.mods.map((m,k)=>{
  if(!m.multi){const o=(m.req?[]:[{id:"",n:"None",d:0}]).concat(m.o),def=o.findIndex(x=>x.def);return choice(m.n,o,def<0?0:def,"m"+k)}
  return `<div class="field"><span class="legend">${esc(m.n)}${m.max<m.o.length?` <small>(up to ${m.max})</small>`:""}</span><div class="opts" data-multi="${k}">${m.o.map(x=>`<label class="opt"><input type="checkbox" value="${esc(x.id)}"${x.def?" checked":""}><span>${esc(x.n)}${x.d?` +${money(x.d)}`:""}</span></label>`).join("")}</div></div>`}).join("")}
function readSel(root,i){
  const v=i.v.length>1?i.v[val(root,"v")].id:i.v[0].id,mods=[];
  i.mods.forEach((m,k)=>{if(!m.multi){const o=(m.req?[]:[{id:""}]).concat(m.o)[val(root,"m"+k)];if(o.id)mods.push(o.id)}
    else root.querySelectorAll(`[data-multi="${k}"] input:checked`).forEach(c=>mods.push(c.value))});
  return {v,mods}}
function wireMulti(root,i,cb){i.mods.forEach((m,k)=>{if(!m.multi)return;const g=root.querySelector(`[data-multi="${k}"]`);
  g.addEventListener("change",e=>{if(g.querySelectorAll("input:checked").length>m.max){e.target.checked=false;toast(`Up to ${m.max} for ${m.n.toLowerCase()}`)}cb()})})}
const addBtn=i=>i.out?`<button class="btn block" type="button" disabled>Sold out</button>`:`<button class="btn block" type="button" id="addBtn">Add</button>`;

function openDrink(d){
  const extra=d.v.length>1||d.mods.length;
  pageMode=false;
  show(pic(d)+head(esc(d.n),esc(d.d))+(d.out?"":sizeHtml(d)+modsHtml(d)+
    (extra?`<div class="field"><label for="dNote">Note for the barista</label><input type="text" id="dNote" maxlength="140" placeholder="Extra hot, half sweet…"></div>`:"")+qtyHtml)+addBtn(d));
  if(d.out)return;
  const root=body();let q=1;
  const line=()=>({id:d.id,...readSel(root,d),note:($("#dNote")&&$("#dNote").value.trim())||"",q});
  const upd=()=>{$("#q").textContent=q;$("#addBtn").textContent=`Add to order · ${money(describe(line()).unit*q)}`};
  wire(root,upd);wireMulti(root,d,upd);
  root.querySelectorAll("[data-q]").forEach(b=>b.addEventListener("click",()=>{q=Math.max(1,Math.min(20,q+ +b.dataset.q));upd()}));upd();
  $("#addBtn").addEventListener("click",()=>{cart.push(line());save();added(`${d.n} added to your order`)});
}

function openFlower(f){
  const x=isXmas(f),closed=x&&!xmasOpen().length;
  if(closed){show(pic(f)+head(esc(f.n),esc(f.d),fromP(f).replace(/\.00$/,""))+`<p class="fine">Christmas orders are closed. Please call the shop and we'll see what we can do.</p><button class="btn block" type="button" disabled>Christmas orders closed</button>`);return}
  show(pic(f)+head(esc(f.n),esc(f.d),fromP(f).replace(/\.00$/,""))+(f.out?addBtn(f):sizeHtml(f,true)+modsHtml(f)+
    (x?`<p class="fine">A Christmas pre-order. You'll choose your pickup or delivery day at checkout: ${xmasOpen().map(fmtDay).map(esc).join(", ")}.</p>`:"")+
    `<div class="field"><label for="fOcc">What's it for?</label><select id="fOcc">${F.occasions.map((o,i)=>`<option value="${i}">${esc(o)}</option>`).join("")}</select></div>
    <div class="field"><label for="fCard">Card message</label><textarea id="fCard" maxlength="200" placeholder="Optional. We'll handwrite it."></textarea></div>`+
    qtyHtml+addBtn(f)));
  if(f.out)return;
  const root=body();let q=1;
  const line=()=>({id:f.id,...readSel(root,f),occasion:+$("#fOcc").value,card:$("#fCard").value.trim(),q});
  const upd=()=>{$("#q").textContent=q;$("#addBtn").textContent=`${x?"Pre-order":"Add to order"} · ${money(describe(line()).unit*q)}`};
  wire(root,upd);wireMulti(root,f,upd);root.querySelectorAll("[data-q]").forEach(b=>b.addEventListener("click",()=>{q=Math.max(1,Math.min(10,q+ +b.dataset.q));upd()}));upd();
  $("#addBtn").addEventListener("click",()=>{cart.push(line());save();added(x?"Christmas pre-order added. Choose your day at checkout.":`${f.n} added to your order`)});
}

function openProduct(f){
  pageMode=true;
  openFlower(f);
  const more=FLOWERS.filter(x=>x.id!==f.id&&!x.out).slice(0,3);
  $("#pMore").innerHTML=more.length?`<h2>More flowers</h2><div class="tiles">${more.map(tile).join("")}</div>`:"";
}

/* ---------- SQUARE PAYMENTS ---------- */
let CFG=null, payMethods=[], paying=false;
async function config(){if(!CFG){try{CFG=await (await fetch("/api/config")).json()}catch(e){CFG={appId:""}}}return CFG}
function loadSquare(env){return new Promise((res,rej)=>{if(window.Square)return res();const s=document.createElement("script");
  s.src=env==="production"?"https://web.squarecdn.com/v1/square.js":"https://sandbox.web.squarecdn.com/v1/square.js";s.onload=res;s.onerror=()=>rej(new Error("load"));document.head.appendChild(s)})}
function destroyPayments(){payMethods.forEach(m=>{try{m.destroy()}catch(e){}});payMethods=[]}

function times(){const out=[],t=new Date();t.setMinutes(Math.ceil((t.getMinutes()+15)/5)*5,0,0);for(let i=0;i<14;i++){out.push({iso:t.toISOString(),label:t.toLocaleTimeString("en-CA",{hour:"numeric",minute:"2-digit"})});t.setMinutes(t.getMinutes()+15)}return out}
function totals(deliver){const s=cart.reduce((a,l)=>a+describe(l).unit*l.q,0),d=deliver?M.deliveryFee:0,t=Math.round((s+d)*Number(M.taxPercent)/100);return{s,d,t,a:s+d+t}}

function openCart(){
  if(!cart.length){openSheet(head("Your order")+`<p class="empty">Nothing in here yet.</p><div class="btns"><a class="btn out" href="#coffee" data-close>Coffee</a><a class="btn out" href="#flowers" data-close>Flowers</a></div>`);return}
  const hasC=cart.some(l=>item(l.id).kind==="coffee"),hasF=cart.some(l=>item(l.id).kind==="flowers");
  const hasX=cart.some(l=>isXmas(item(l.id))),xd=xmasOpen();
  const draft=store.get("me",{});
  // Flowers on their own can be for a later day: one of the Christmas days if the order has Christmas items, otherwise soonest or any day in the pre-order window.
  const whenHtml=!hasF||hasC?"":hasX
    ?`<div class="field"><label for="cDay">Christmas pickup or delivery day</label><select id="cDay"><option value="">Choose a day</option>${xd.map(d=>`<option value="${d}">${esc(fmtDay(d))}</option>`).join("")}</select><small>We'll have your flowers ready that day and text you the day before.</small></div>`
    :choice("When",[{n:"Soonest",d:0},{n:"Pick a day",d:0}])+`<div class="field" id="dateF" hidden><label for="cDate">Date</label><input type="date" id="cDate" min="${day(F.preorderMinDays)}" max="${day(F.preorderMaxDays)}" value="${day(7)}"><small>We'll hold your flowers and text you the day before.</small></div>`;
  openSheet(head("Your order")+
    `<div>${cart.map((l,i)=>{const x=describe(l);return `<div class="line"><b>${l.q} × ${esc(x.n)}</b><span class="p">${money(x.unit*l.q)}</span><small>${esc(x.opts)}</small><button class="link rm" type="button" data-rm="${i}">Remove</button></div>`}).join("")}</div>`+
    (hasF&&!hasC?choice("Flowers",[{n:"I'll pick up",d:0},{n:"Deliver them",d:M.deliveryFee}])+`<div class="field" id="addrF" hidden><label for="cAddr">Delivery address</label><input type="text" id="cAddr" autocomplete="street-address" placeholder="Street and town" value="${esc(draft.addr||"")}"><small>Omemee, Lindsay and nearby.</small></div>`+whenHtml:"")+
    (hasF&&hasC?(hasX?`<p class="fine">Christmas flowers are for a later day, so they need their own order. Please remove the coffee or the Christmas flowers and order them separately.</p>`:`<p class="fine">Flowers in an order with coffee are picked up with it today. To pre-order flowers for another day, or have them delivered, order them on their own.</p>`):"")+
    (hasC?`<div class="field"><label for="cTime">Coffee ready at</label><select id="cTime"><option value="asap">As soon as you can (about 10 min)</option>${times().map(t=>`<option value="${t.iso}">${t.label}</option>`).join("")}</select></div>`:"")+
    `<div class="row2"><div class="field"><label for="cName">Name</label><input type="text" id="cName" autocomplete="name" value="${esc(draft.name||"")}"></div><div class="field"><label for="cPhone">Mobile</label><input type="tel" id="cPhone" autocomplete="tel" inputmode="tel" value="${esc(draft.phone||"")}"></div></div>
    <span class="err" id="cErr" hidden></span>
    <div class="totals" id="totals"></div>
    <div id="payArea" hidden>
      <div id="wallets" class="wallets"><div id="apple-pay" hidden></div><div id="google-pay"></div></div>
      <div id="card-container"></div>
    </div>
    <button class="btn block" type="button" id="payBtn">Continue to payment</button>
    <p class="fine" id="payNote">Card, Apple Pay and Google Pay, processed securely by Square.</p>`);
  const root=$("#sheetBody");
  const deliver=()=>hasF&&!hasC&&val(root,"Flowers")===1;
  const fDate=()=>!hasF||hasC?null:hasX?($("#cDay").value||null):val(root,"When")===1?$("#cDate").value:null;
  const upd=()=>{const t=totals(deliver());if($("#addrF"))$("#addrF").hidden=!deliver();if($("#dateF"))$("#dateF").hidden=val(root,"When")!==1;
    $("#totals").innerHTML=`<div><span>Subtotal</span><span>${money(t.s)}</span></div>${t.d?`<div><span>Delivery</span><span>${money(t.d)}</span></div>`:""}<div><span>HST</span><span>${money(t.t)}</span></div><div class="grand"><span>Total</span><span>${money(t.a)}</span></div>`};
  wire(root,()=>{upd();if(payMethods.length){destroyPayments();$("#payArea").hidden=true;$("#payBtn").textContent="Continue to payment"}});upd();
  root.querySelectorAll("[data-rm]").forEach(b=>b.addEventListener("click",()=>{cart.splice(+b.dataset.rm,1);save();openCart()}));
  const err=m=>{$("#cErr").textContent=m;$("#cErr").hidden=!m;if(m)$("#cErr").scrollIntoView({block:"center",behavior:"smooth"})};

  const details=()=>{
    const name=$("#cName").value.trim(),phone=$("#cPhone").value.trim(),digits=phone.replace(/\D/g,"");
    if(!name){err("Please add your name so we know whose order it is.");$("#cName").focus();return null}
    if(!(digits.length===10||(digits.length===11&&digits[0]==="1"))){err("Please enter a 10-digit mobile number so we can text you.");$("#cPhone").focus();return null}
    const addr=$("#cAddr")?$("#cAddr").value.trim():"";
    if(deliver()&&addr.length<5){err("Please add the delivery address.");$("#cAddr").focus();return null}
    if(hasX&&hasC){err("Christmas flowers need their own order. Please remove the coffee or the Christmas flowers.");return null}
    if(hasX&&!xd.length){err("Christmas orders are closed. Please remove the Christmas flowers, or call the shop.");return null}
    const date=fDate();
    if(hasX&&!date){err("Please choose your Christmas pickup or delivery day.");$("#cDay").focus();return null}
    if(date&&!hasX&&!(date>=day(F.preorderMinDays)&&date<=day(F.preorderMaxDays))){err(`Please pick a date ${F.preorderMinDays} to ${F.preorderMaxDays} days from today.`);$("#cDate").focus();return null}
    store.set("me",{name,phone,addr});err("");
    return {customer:{name,phone},fulfillment:{flowers:deliver()?"delivery":"pickup",address:addr,date,coffeeTime:hasC?$("#cTime").value:undefined}};
  };

  async function pay(method){
    const d=details();if(!d)return;
    paying=true;$("#payBtn").disabled=true;$("#payBtn").textContent="Placing your order…";err("");
    try{
      const r=await method.tokenize();
      if(r.status!=="OK"){throw new Error(r.errors&&r.errors[0]&&r.errors[0].message||"Please check your card details.")}
      const res=await fetch("/api/checkout",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({cart,...d,sourceId:r.token,idempotencyKey:crypto.randomUUID()})});
      const out=await res.json().catch(()=>({error:"Something went wrong. Please try again."}));
      if(!res.ok)throw new Error(out.error);
      const pre=d.fulfillment.date,when=hasC?$("#cTime").selectedOptions[0].textContent:"";
      cart=[];save();paying=false;destroyPayments();
      openSheet(head("Thanks, "+esc(d.customer.name.split(" ")[0]))+`<div class="done"><span class="kicker">Paid ${money(out.total.amount)}</span>
        <p>${hasC?`Your drinks will be on the bar under your name${when.startsWith("As soon")?" in about ten minutes":" at "+esc(when)}. `:""}${hasF?(pre?`Your flowers are on hold for ${esc(fmtDay(pre))}${d.fulfillment.flowers==="delivery"?" delivery":""}, and we'll text you the day before. `:d.fulfillment.flowers==="delivery"?"We'll text you when your flowers are on the way. ":"We'll text you when your flowers are ready. "):""}</p>
        ${out.receiptUrl?`<a class="link" href="${esc(out.receiptUrl)}" target="_blank" rel="noopener">View your receipt</a>`:""}
        <button class="btn" type="button" data-close>Done</button></div>`);
    }catch(e){paying=false;$("#payBtn").disabled=false;$("#payBtn").textContent=`Pay ${money(totals(deliver()).a)}`;err(e.message||"Something went wrong. Please try again.")}
  }

  $("#payBtn").addEventListener("click",async()=>{
    if(payMethods.length){pay(payMethods[0]);return}
    if(!details())return;
    const cfg=await config();
    if(!cfg.appId||!cfg.locationId||cfg.ordersOpen===false){err("Online ordering isn't open yet. Check back soon.");return}
    $("#payBtn").disabled=true;$("#payBtn").textContent="Loading secure payment…";
    try{
      await loadSquare(cfg.env);
      const payments=window.Square.payments(cfg.appId,cfg.locationId);
      const card=await payments.card();await card.attach("#card-container");payMethods=[card];
      $("#payArea").hidden=false;
      const t=totals(deliver());
      const req=payments.paymentRequest({countryCode:"CA",currencyCode:"CAD",total:{amount:(t.a/100).toFixed(2),label:"Studio Seven"}});
      try{const g=await payments.googlePay(req);await g.attach("#google-pay");payMethods.push(g);$("#google-pay").addEventListener("click",e=>{e.preventDefault();pay(g)})}catch(e){$("#google-pay").hidden=true}
      try{const a=await payments.applePay(req);$("#apple-pay").hidden=false;payMethods.push(a);$("#apple-pay").addEventListener("click",e=>{e.preventDefault();pay(a)})}catch(e){$("#apple-pay").hidden=true}
      $("#payBtn").disabled=false;$("#payBtn").textContent=`Pay ${money(t.a)}`;
    }catch(e){$("#payBtn").disabled=false;$("#payBtn").textContent="Continue to payment";err("The payment form didn't load. Please check your connection and try again.")}
  });
}
$("#cartBtn").addEventListener("click",openCart);

/* ---------- FORMS: saved to Square customers and emailed to the shop (api/signup.js) ---------- */
async function sendForm(type,fields){
  const res=await fetch("/api/signup",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({type,...fields,company:""})});
  if(!res.ok)throw new Error("send");
}

$("#openBooking").addEventListener("click",()=>{
  openSheet(head("Book the coffee cart","Tell us a little about it and we'll get back to you within two days with dates and a quote.")+
  `<form id="bkForm" novalidate>
    <div class="field"><label for="bkType">What's the occasion?</label><select id="bkType"><option>Wedding</option><option>Shower or birthday</option><option>Office or team event</option><option>Market or festival</option><option>Something else</option></select></div>
    <div class="row2"><div class="field"><label for="bkDate">Date</label><input type="date" id="bkDate" min="${day(7)}"></div><div class="field"><label for="bkGuests">Guests</label><select id="bkGuests"><option>Under 50</option><option>50–100</option><option>100–200</option><option>200+</option></select></div></div>
    <div class="field"><label for="bkWhere">Where</label><input type="text" id="bkWhere" placeholder="Venue or town"></div>
    <label class="opt" style="align-self:flex-start"><input type="checkbox" id="bkFl"><span>Add flowers from the shop</span></label>
    <div class="row2"><div class="field"><label for="bkName">Your name</label><input type="text" id="bkName" autocomplete="name"></div><div class="field"><label for="bkEmail">Email</label><input type="email" id="bkEmail" autocomplete="email"></div></div>
    <span class="err" id="bkErr" hidden>Add your name and email so we can write back.</span>
    <button class="btn block" type="submit">Send</button></form>`);
  $("#bkForm").addEventListener("submit",async e=>{e.preventDefault();
    const em=$("#bkEmail").value.trim();
    if(!$("#bkName").value.trim()||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)){$("#bkErr").hidden=false;return}
    const btn=$("#bkForm button[type=submit]");btn.disabled=true;btn.textContent="Sending…";
    try{
      await sendForm("cart-booking",{occasion:$("#bkType").value,date:$("#bkDate").value,guests:$("#bkGuests").value,location:$("#bkWhere").value.trim(),flowers:$("#bkFl").checked?"Yes":"No",name:$("#bkName").value.trim(),email:em});
      openSheet(head("Thanks, we'll be in touch")+`<p>We'll write to ${esc(em)} within two days.</p><button class="btn" type="button" data-close>Done</button>`);
    }catch(err){btn.disabled=false;btn.textContent="Send";$("#bkErr").textContent="That didn't go through. Please try again.";$("#bkErr").hidden=false}
  });
});

let tt;function toast(m){const t=$("#toast");t.textContent=m;t.classList.add("on");clearTimeout(tt);tt=setTimeout(()=>t.classList.remove("on"),2200)}

save();route();
})();
