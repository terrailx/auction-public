"use strict";
const $ = id => document.getElementById(id);
const node = (tag, text, cls) => {
  const el = document.createElement(tag);
  if (text != null) el.textContent = text;
  if (cls) el.className = cls;
  return el;
};
const btn = (text, action, cls) => {
  const el = node("button", text, cls);
  el.type = "button";
  el.addEventListener("click", action);
  return el;
};
const badges = {partial:"부분 확보", ambiguous:"동일성 확인 보류", not_found:"검색 당시 미발견", verified:"확보 확인"};
const publicArchive=document.documentElement.hasAttribute("data-public-archive");
const hostedArchive=document.documentElement.hasAttribute("data-hosted-archive");
const states = {read_full:"기록상 전체 열람",read_partial:"일부 확보",shared:"공통 자료",blocked:"미확보·차단",no_result:"결과 없음",not_applicable:"해당 없음"};
const labels = {detail:"기본정보·물건 현황", history:"사건내역", service:"문건·송달", court_docs:"법원 문서·기일", transactions:"실거래", land:"토지이용", planning:"도시계획", map:"지도·사진", near_active:"인근 진행", near_sold:"인근 매각", same_parcel:"동일 지번", near_public:"인근 공매", priority_deposit:"최우선변제금 자료"};
const tabs = [
  ["기본정보",["detail"]],["사건내역",["history"]],["문건·송달",["service"]],
  ["법원 문서",["court_docs"]],["토지이용계획",["land"]],["도시계획",["planning"]],["사진·입지",["map"]],
  ["실거래·인근 사례",["transactions","near_active","near_sold","same_parcel","near_public","priority_deposit"]]
];
let data, mode="cases", selected=null, group=null, map=null, points=[], markers=[], previewRequest=0, buildings3d=false, mapReady=false, basemap="road";
const loadedBasemaps=new Set();
let kakaoSdk=null, kakaoView=null, mapArea=false;
const mapHost=()=>$("map");
const kakaoPoint=(sdk,[lng,lat])=>new sdk.LatLng(lat,lng);
const kakaoLevel=zoom=>Math.min(14,Math.max(1,19-Math.round(zoom)));
const still=matchMedia("(prefers-reduced-motion: reduce)");
const number = n => Number(n).toLocaleString("ko-KR");
const capturedTime = value => typeof value==="string"
  ? value.replace(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}).*$/, "$1 $2 KST") : "";
const stamp = (s, tone="") => node("span",s,"badge "+tone);
function detailLink(id, asset, eventIndex) {
  const params=new URLSearchParams();
  if(asset)params.set("property",asset.id);
  if(id)params.set("case",id);
  else if(eventIndex!=null)params.set("entry",String(eventIndex));
  return "/auction-public/auction/detail/?"+params;
}
function caseLink(text, id, asset, eventIndex, cls) {
  const a=node("a",text,cls);
  a.href=detailLink(id,asset,eventIndex);
  a.target="_blank";a.rel="noopener";
  return a;
}
function photo(url, alt, eager=false) {
  const view=node("span",null,"photo-view");
  const img=node("img");img.alt=alt;img.decoding="async";img.loading=eager?"eager":"lazy";
  img.addEventListener("load",()=>{
    view.style.setProperty("--native-width",img.naturalWidth+"px");
    if(img.naturalWidth<1000||img.naturalHeight<720)return;
    const canvas=node("canvas"),w=canvas.width=Math.round(img.naturalWidth/3),h=canvas.height=Math.round(img.naturalHeight/3);
    const ctx=canvas.getContext("2d",{willReadFrequently:true});
    ctx.drawImage(img,0,0,w,h);
    const rgba=ctx.getImageData(0,0,w,h).data;
    const at=(x,y)=>(Math.floor(y)*w+Math.floor(x))*4;
    const gray=(x,y)=>{
      const i=at(x,y);
      return [0,1,2].every(k=>Math.abs(rgba[i+k]-51)<=2);
    };
    if(![.42,.56,.70,.84,.92].every(y=>gray(w*.18,h*y)&&gray(w*.96,h*y)))return;
    const longest=(start,end,hit)=>{
      let best=[],run=null;
      for(let i=start;i<=end;i++){
        if(i<end&&hit(i)){if(run===null)run=i;}
        else if(run!==null){if(!best.length||i-run>best[1]-best[0])best=[run,i];run=null;}
      }
      return best;
    };
    const x0=Math.round(w*.23),x1=Math.round(w*.91),y0=Math.round(h*.36),y1=Math.round(h*.92);
    const [top,bottom]=longest(y0,y1,y=>{
      let count=0;
      for(let x=x0;x<x1;x+=3)if(!gray(x,y))count++;
      return count>(x1-x0)*.035;
    });
    if(!(bottom-top>h*.10))return;
    const [left,right]=longest(x0,x1,x=>{
      let count=0;
      for(let y=top+2;y<bottom-2;y+=3)if(!gray(x,y))count++;
      return count>(bottom-top)*.1;
    });
    if(!(right-left>w*.14))return;
    const cw=right-left,ch=bottom-top;
    view.style.aspectRatio=cw+"/"+ch;
    view.style.setProperty("--native-width",Math.round(cw*img.naturalWidth/w)+"px");
    img.style.cssText="position:absolute;width:"+100*w/cw+"%;height:"+100*h/ch+"%;max-width:none;max-height:none;left:"+(-100*left/cw)+"%;top:"+(-100*top/ch)+"%;aspect-ratio:auto;object-fit:fill";
    view.dataset.cropped="true";
  },{once:true});
  img.src=url;view.append(img);return view;
}
function row(asset) {
  const item=node("div",null,"asset"+(selected?.id===asset.id?" selected":""));
  const button=btn(null,()=>select(asset,true),"asset-select");
  const info=node("span"), title=node("strong",asset.name), event=asset.cases[0];
  info.append(title,node("small",[asset.region,asset.kind,!asset.point&&"좌표 미확인"].filter(Boolean).join(" · ")));
  if(event){
    info.append(node("small",[event.case,event.stage].filter(Boolean).join(" · "),"asset-stage"));
    const facts=node("span",null,"asset-facts");
    for(const [label,value] of [["감정",event.amounts?.["감정가"]],["최저",event.amounts?.["최저가"]],["기일·관측",event.date]]){
      if(value){const line=node("span");line.append(node("b",label),document.createTextNode(" "+value));facts.append(line);}
    }
    info.append(facts);
  }
  button.append(node("span",asset.id,"seq"),info);
  if(event?.thumbnail){
    button.append(photo(event.thumbnail,""));
  }
  if(selected?.id===asset.id)button.setAttribute("aria-current","true");
  item.append(button);
  if(event){
    const links=node("div",null,"asset-case-links");
    for(const [index,record] of asset.cases.entries()){
      const link=caseLink((record.case||"사건 상세")+" ↗",record.id,asset,index,"asset-open");
      link.title="사건 상세를 새 탭에서 열기";
      links.append(link);
    }
    item.append(links);
  }
  return item;
}
const favoriteKey="auction-favorites-v1";
function legacyFavorites() {
  try {
    const entries=JSON.parse(localStorage.getItem(favoriteKey)||"[]");
    return Array.isArray(entries)?entries.filter(e=>e&&typeof e.id==="string"):[];
  } catch { return []; }
}
let savedFavorites=[];
let favoriteRequest=0;
async function refreshFavorites() {
  const sequence=++favoriteRequest;
  const response=await fetch("/auction-public/archive/favorites.json");
  if(!response.ok)throw new Error();
  const entries=await response.json();
  if(sequence===favoriteRequest)savedFavorites=entries;
}
function visibleAssets() {
  const region=$("region").value;
  const saved=mode==="favorites"?new Set(savedFavorites.map(e=>e.property).filter(Boolean)):null;
  return data.assets.filter(a=>(!region||a.region===region)
    &&(mode!=="cases"||a.cases.length)&&(!saved||saved.has(a.id)||savedFavorites.some(e=>!e.property&&a.cases.some(c=>c.id===e.id))));
}
function list() {
  const host=$("asset-list");
  $("list-title").textContent=mode==="archive"?"수집 사건":mode==="favorites"?"관심물건":group?"선택 위치의 물건":mapArea?"현재 지도 범위":"물건 목록";
  $("clear-group").hidden=!group&&!mapArea;
  for(const b of document.querySelectorAll("button[data-mode]")) b.setAttribute("aria-pressed",b.dataset.mode===mode);
  if(mode==="archive"||mode==="favorites"){
    const saved=mode==="favorites";
    const byId=new Map(data.cases.map(c=>[c.id,c]));
    const cases=saved?savedFavorites.filter(e=>byId.has(e.id)):data.cases.map(c=>({id:c.id}));
    $("list-count").textContent=cases.length+(saved?"건 · 운영 원장에 저장":"건 · 주소 확인 보류 포함");
    host.replaceChildren(...cases.map(entry=>{
      const c=byId.get(entry.id);
      const asset=entry&&data.assets.find(a=>a.id===entry.property&&a.cases.some(e=>e.id===c.id));
      const link=caseLink(null,c.id,asset,null,"archive-row");
      const item=node("span");item.append(node("strong",c.case),node("small",
        [entry?.group,entry?.title||c.items.map(i=>i.name+" "+i.unit).join(" · ")].filter(Boolean).join(" · ")));
      link.append(node("span",c.id.slice(0,3),"seq"),item,stamp(badges[c.status]||c.status,c.status==="partial"?"":"warn"));
      return link;
    }));
    if(saved&&!cases.length)host.append(node("p","저장한 관심물건이 없습니다.","empty"));
    return;
  }
  const visible=group||(mapArea&&map?visibleAssets().filter(a=>a.point&&isOnMap(map.project(a.point))):visibleAssets());
  $("list-count").textContent=visible.length+(group||mapArea?"행":"행 · 좌표 미확인 포함");
  host.replaceChildren(...visible.map(row));
  if(!visible.length)host.append(node("p","해당 지역에 표시할 물건이 없습니다.","empty"));
}
function saveLocation() {
  const url=new URL(location.href);
  if(selected)url.searchParams.set("property",selected.id);else url.searchParams.delete("property");
  if(url.href!==location.href)history.replaceState(null,"",url);
}
function select(asset, center) {
  selected=asset;property();list();saveLocation();
  if(center&&map&&asset.point)map.easeTo({center:asset.point,zoom:Math.max(map.getZoom(),buildings3d?16:14),duration:still.matches?0:300});
  drawMarkers();
}
function property() {
  const host=$("property");host.hidden=!selected;
  if(!selected){host.replaceChildren();return;}
  const h=node("header",null,"paperhead");
  const name=node("div");name.append(node("h2",selected.name),node("small",selected.address||"주소 미기재"));
  h.append(name,btn("닫기",()=>{selected=null;property();list();drawMarkers();saveLocation();},"quiet"));
  const items=node("div",null,"case-list");
  const matched=selected.cases.find(e=>e.id);
  const doctor=node("a","경매박사 ↗","doctor-entry");
  if(hostedArchive)doctor.hidden=true;
  doctor.href=doctorLink(matched?.id,selected,matched?null:selected.cases.length?0:null);
  doctor.target="_blank";doctor.rel="noopener";
  h.append(doctor);
  const work=node("a","대응실 ↗","doctor-entry");
  if(hostedArchive)work.hidden=true;
  work.href="/auction-public/auction/workbench?property="+encodeURIComponent(selected.id);
  h.append(work);
  if(!selected.cases.length)items.append(node("p","이 원장에 연결된 사건 기록이 없습니다.","empty"));
  for(const [index,e] of selected.cases.entries()){
    const a=caseLink(null,e.id,selected,index,"case-card");
    a.append(node("strong",(e.case||"사건번호 미확인")+" ↗"),node("small",[e.court,e.stage].filter(Boolean).join(" · ")),
      node("small",e.id?"저장 사건 상세":e.link==="review"?"주소 대조 필요 · 원장 정보":"원장 정보"));
    items.append(a);
  }
  host.replaceChildren(h,items);
}
function summary(values) {
  const grid=node("dl",null,"summary");
  for(const [label,value] of values){
    const d=node("div"); d.append(node("dt",label),node("dd",value||"미확인"));grid.append(d);
  }
  return grid;
}
function timeline(e) {
  if(!e)return [];
  return [["원장 단계",e.stage],["기일·관측일",e.date],["매각결정기일",e.decision],["대금지급기한",e.paymentDue],["완납일",e.paid]];
}
function header(caseNo, court, state, tone) {
  const h=node("header",null,"paperhead"), d=node("div");
  d.append(node("h2",caseNo||"사건번호 미확인"),node("small",court||"법원 미확인"));h.append(d,stamp(state,tone));return h;
}
const factRows=[
  ["물건종류","개시결정","경매구분"],["대지권","소유자","감정가"],
  ["건물면적","채무자","최저가"],["매각물건","채권자","보증금"]
];
function caseFacts(c,asset) {
  const table=node("table",null,"case-facts");
  table.setAttribute("aria-label","사건 기본정보");
  const columns=node("colgroup");columns.append(...Array.from({length:6},()=>node("col")));table.append(columns);
  const address=table.insertRow(), label=node("th","소재지"), value=node("td");
  label.scope="row";value.colSpan=5;
  value.textContent=c.facts["소재지"]||asset?.address||c.items.map(x=>x.address).filter(Boolean).join(" · ")||"미확인";
  address.append(label,value);
  const rows=c.facts["물건상태"]==="예정물건"
    ?[factRows[0],["소유자","채무자","채권자"],["물건상태","배당요구종기일"]]:c.facts["매각가"]
      ?[...factRows.slice(0,-1),["매각물건","채권자","매각가"]]:factRows;
  for(const labels of rows){
    const row=table.insertRow();
    for(const key of labels){
      const label=node("th",key);label.scope="row";
      const amount=c.amounts[key]&&c.amounts[key]+"원";
      const value=node("td",c.facts[key]||amount||(key==="물건종류"&&asset?.kind)||(publicArchive&&["소유자","채무자","채권자"].includes(key)?"공개 제외":"미확인"));
      if(key==="최저가")value.className="minimum";
      if(key==="매각가")value.className="sale-price";
      row.append(label,value);
    }
    if(labels.length===2)row.insertCell().colSpan=2;
  }
  return table;
}
function recordBlocks(c) {
  return c.blocks.map(b=>{
    const block=node("section",null,"case-record");
    const planned=c.facts["물건상태"]==="예정물건"&&b.title==="매각 물건 현황";
    block.append(node("h3",b.title),planned&&plannedBuildingTable(b.text)||displayTranscript(b.text,null));
    return block;
  });
}
function plannedBuildingTable(text){
  const rows=[...text.matchAll(/^(.+?\[\d+층\])\r?\n[\t ]*(\d+(?:\.\d+)?㎡)\r?\n[\t ]*(\([\d.]+평\))/gm)];
  if(!rows.length)return null;
  const table=node("table",null,"case-facts planned-building-table");
  const head=table.createTHead().insertRow();
  for(const label of ["목록","소재지·구조","면적","감정가","비고"]){
    const th=node("th",label);th.scope="col";head.append(th);
  }
  const body=table.createTBody();
  for(const [,address,square,py] of rows){
    const row=body.insertRow();
    for(const value of ["건물",address,square+" "+py,"",""])row.insertCell().textContent=value;
  }
  const total=text.match(/^감정가 합계\t([^\t]+)\t([^\t\r\n]+)/m);
  if(total){
    const row=table.createTFoot().insertRow();
    row.insertCell().textContent="감정가 합계";
    const area=row.insertCell();area.colSpan=2;area.textContent=total[1];
    row.insertCell().textContent=total[2];row.insertCell();
  }
  return table;
}

function linkedRecord(asset,id) {return asset?.cases.find(e=>e.id===id);}
async function showRelatedRecord(host,params){
  const parent=params.get("reference"), key=params.get("section"), index=params.get("row");
  if(!data.cases.some(c=>c.id===parent)||!/^\d+$/.test(index||"")){
    host.replaceChildren(node("p","참고 사건을 확인할 수 없습니다.","empty"));return;
  }
  const response=await fetch("/auction-public/archive/case/"+encodeURIComponent(parent)+".json");
  if(!response.ok)throw Error("참고 사건을 불러오지 못했습니다.");
  const c=await response.json();
  const source=c.sections.find(s=>s.key===key);
  const table=source?.tables.find(t=>t.file===params.get("file"));
  const record=table?.rows[Number(index)];
  if(!record){
    host.replaceChildren(node("p","저장된 참고 사건을 확인할 수 없습니다.","empty"));return;
  }
  document.title=record[0]+" · "+labels[key];
  const caseBack=node("a","원래 사건 보기");caseBack.href=detailLink(parent,null);
  const file=source.files.find(f=>f.name===table.file);
  const original=node("a","저장 원문 열기 ↗");
  if(file){original.href=file.url;original.target="_blank";original.rel="noopener";}
  host.replaceChildren(header(record[0],labels[key],"수집 목록 자료","ok"),
    node("p","이 페이지에는 수집 당시의 목록 정보가 표시됩니다.","case-meta"),
    summary(table.columns.map((label,i)=>[label,record[i]])),
    node("p",source.scope||"","case-meta"),caseBack);
  if(file){host.append(document.createTextNode(" · "),original);}
}

async function showDetail() {
  const host=$("case-view"), params=new URLSearchParams(location.search);
  if(params.has("reference")){
    try{await showRelatedRecord(host,params);}catch(e){host.replaceChildren(node("p",e.message,"empty"));}
    return;
  }
  const id=params.get("case"), propertyId=params.get("property"), entry=params.get("entry");
  const asset=data.assets.find(a=>a.id===propertyId);
  const event=linkedRecord(asset,id);
  if(asset)$("back-map").href="/auction-public/auction/?property="+encodeURIComponent(asset.id);
  const doctorRequested=params.get("panel")==="doctor";
  if(!hostedArchive&&!id&&asset&&doctorRequested&&entry===null&&!asset.cases.length){
    const doctor=caseDoctor(null,asset);
    host.replaceChildren(header(asset.name,asset.address,"저장 사건 미연결","warn"),doctor.button,doctor.panel);
    doctor.open();
    return;
  }
  if(!id&&asset&&entry!==null&&/^\d+$/.test(entry)&&asset.cases[Number(entry)]&&!asset.cases[Number(entry)].id){
    const e=asset.cases[Number(entry)];
    const doctor=caseDoctor(null,asset,e);
    host.replaceChildren(header(e.case,e.court,"저장본 연결 미확인","warn"),doctor.button,summary(timeline(e)),
      node("p","이 페이지에는 물건 원장 정보가 표시됩니다. 저장본 연결에는 법원·사건번호·주소 대조가 필요합니다.","empty"),doctor.panel);
    if(doctorRequested&&!hostedArchive)doctor.open();
    return;
  }
  if(!id||!data.cases.some(c=>c.id===id)||(propertyId&&!event)){
    host.replaceChildren(node("p","요청한 사건이나 물건 연결을 확인할 수 없습니다.","empty"));return;
  }
  try{
    const response=await fetch("/auction-public/archive/case/"+encodeURIComponent(id)+".json");
    if(!response.ok)throw new Error("사건 파일을 불러오지 못했습니다.");
    const c=await response.json();
    document.title=c.case+" · 경매 사건 상세";
    const head=node("header",null,"detail-head");
    const identity=node("div");
    identity.append(node("h1",c.case||"사건번호 미확인"),node("p",c.sale||[c.court,event?.date].filter(Boolean).join(" · ")));
    const actions=node("div",null,"detail-actions");
    const printSheet=node("div",null,"case-print-sheet");
    const printDialog=casePrintDialog(printSheet,c,asset,event,identity);
    const doctor=caseDoctor(id,asset,event);
    const tools=caseTools(id,c.case,c.court,asset);
    actions.append(stamp(badges[c.status]||c.status,c.status==="partial"?"":"warn"),
      ...tools.buttons,btn("인쇄 / PDF",()=>printDialog.showModal(),"quiet"));
    if(!hostedArchive)actions.append(doctor.button);
    head.append(identity,actions);
    const grid=node("div",null,"detail-grid");
    const main=node("div",null,"detail-main");
    const aside=node("aside",null,"detail-rail");
    const nav=node("nav",null,"detail-menu");nav.setAttribute("aria-label","관련자료 보기");
    nav.append(node("h2","관련자료 보기"));
    const navExtra=node("nav",null,"detail-menu related-links");navExtra.setAttribute("aria-label","지도자료 보기");
    navExtra.append(node("h2","지도자료 보기"));
    const point=asset?.point;
    const planned=c.facts["물건상태"]==="예정물건";
    const mapLink=node("a","경매 지도");mapLink.href=$("back-map").href;navExtra.append(mapLink);
    if(point){
      const kakao=node("a","카카오맵에서 위치 보기 ↗");
      kakao.href="https://map.kakao.com/link/map/"+point[1]+","+point[0];
      kakao.target="_blank";kakao.rel="noopener";navExtra.append(kakao);
    }
    const official=node("nav",null,"detail-menu related-links");
    official.setAttribute("aria-label","공식 사이트");
    official.append(node("h2","공식 사이트"));
    for(const [label,url] of [
      ["법원경매정보 ↗","https://www.courtauction.go.kr/"],
      ["인터넷등기소 ↗","https://www.iros.go.kr/"],
      ["토지이음 ↗","https://www.eum.go.kr/"],
    ]){
      const link=node("a",label);
      link.href=url;link.target="_blank";link.rel="noopener noreferrer";
      official.append(link);
    }
    official.append(node("p","공식 사이트에서 직접 최신 자료를 확인하세요.","case-meta"));
    aside.append(nav,navExtra,official);
    const body=node("div",null,"sections"), preview=node("div",null,"preview");preview.hidden=true;
    const meta=node("p",["수집 "+capturedTime(c.at),event?.stage,c.items.map(x=>[x.name,x.unit].filter(Boolean).join(" ")).join(" · ")].filter(Boolean).join(" | "),"case-meta");
    if(planned)main.append(node("p","경매예정물건","case-planned"));
    main.append(head,caseFacts(c,asset),meta,body,preview);
    grid.append(main,aside);host.replaceChildren(grid,printDialog,printSheet,doctor.panel,...tools.dialogs);
    if(doctorRequested&&!hostedArchive)doctor.open();
    for(const [label,view] of [["전자지도","road"],["위성지도","sky"],["로드뷰","roadview"],["지적편집도","parcel"]]){
      navExtra.append(btn(label,()=>{
        previewRequest++;preview.hidden=true;preview.replaceChildren();
        for(const button of buttons)button.setAttribute("aria-pressed","false");
        const panel=point
          ?caseLocationMap(point,c.facts["물건종류"]||asset?.kind,planned,view)
          :node("p","이 사건에 연결된 지도 좌표가 없습니다.","empty");
        body.replaceChildren(node("h3",label),panel);
        panel.scrollIntoView({block:"nearest"});
      }));
    }
    const [relatedLabel, relatedKeys]=tabs.at(-1);
    let relatedKey=relatedKeys[0];
    const buttons=tabs.map(([label,keys])=>btn(label,()=>{
      previewRequest++;preview.hidden=true;preview.replaceChildren();
      for(const other of buttons)other.setAttribute("aria-pressed",String(other.textContent===label));
      const visible=c.sections.filter(s=>keys.includes(s.key));
      if(label===relatedLabel){
        const switcher=node("nav",null,"tabbar comparison-tabs");
        switcher.setAttribute("aria-label","실거래 및 인근 자료");
        const panel=node("div",null,"comparison-panel");
        const choices=keys.map(key=>btn(labels[key],()=>activate(key)));
        function activate(key){
          relatedKey=key;
          previewRequest++;preview.hidden=true;preview.replaceChildren();
          choices.forEach((b,i)=>b.setAttribute("aria-pressed",String(keys[i]===key)));
          const current=visible.find(s=>s.key===key);
          panel.replaceChildren(current?comparison(current,preview,c.id):node("p","수집 기록 없음","empty"));
        }
        switcher.append(...choices);
        body.replaceChildren(switcher,panel);
        activate(relatedKey);
        return;
      }
      const content=keys[0]==="detail"?[caseOverview(c,preview,event),...recordBlocks(c)]:[];
      if(keys[0]==="detail"&&planned&&point){
        const mapPanel=caseLocationMap(point,c.facts["물건종류"]||asset?.kind,true);
        content.unshift(mapPanel);
        content.push(content.splice(1,1)[0]);
      }
      if(keys[0]==="detail"&&event)content.push(summary(timeline(event)));
      const [key]=keys;
      if(key==="map"){
        if(point)content.push(caseLocationMap(point,c.facts["물건종류"]||asset?.kind,planned));
        else content.push(node("p","이 사건에 연결된 지도 좌표가 없습니다.","empty"));
      }
      body.replaceChildren(...content,...visible.map(s=>section(s,preview)));
      if(["history","service","land","planning"].includes(key)){
        const transcript=visible[0]?.files.find(f=>f.type==="txt");
        if(transcript)showFile(transcript,preview,false,key,body);
      }
      if(!visible.length&&!content.length)body.append(node("p","이 항목의 수집 기록이 없습니다.","empty"));
    }));
    const jump=(label,id)=>btn(label,()=>{
      if(!$(id))buttons[0].click();
      $(id)?.scrollIntoView({block:"start"});
    });
    const shortcuts=node("nav",null,"detail-menu related-links");
    shortcuts.setAttribute("aria-label","인근 참고자료");
    shortcuts.append(node("h2","기타 참고자료"));
    for(const key of relatedKeys){
      shortcuts.append(btn(key==="transactions"?"국토부실거래":labels[key],()=>{
        relatedKey=key;buttons.at(-1).click();
      }));
    }
    nav.append(buttons[0],jump("사진보기","case-photos"),jump("기일내역","case-schedule"),...buttons.slice(1));
    aside.append(shortcuts);
    const requestedSection=params.get("section");
    const target=tabs.findIndex(([,keys])=>keys.includes(requestedSection));
    if(target===tabs.length-1)relatedKey=requestedSection;
    buttons[Math.max(0,target)].click();
  }catch(e){host.replaceChildren(node("p",e.message,"empty"));}
}
function caseLocationMap(point, kind, planned, initialView="road"){
  const panel=node("section",null,"case-location");
  const canvas=node("div",null,"case-location-map");
  canvas.setAttribute("aria-label",initialView==="roadview"?"사건 위치 카카오 로드뷰":"사건 위치 카카오맵");
  const controls=node("div",null,"case-location-controls");
  const notice=node("p","카카오맵 불러오는 중","case-meta");
  notice.setAttribute("role","status");
  panel.append(controls,canvas,notice);
  loadKakaoSdk().then(sdk=>{
    if(!panel.isConnected)return;
    if(!sdk)throw Error("이 화면에서는 카카오맵을 불러오지 못했습니다.");
    const position=kakaoPoint(sdk,point);
    if(initialView==="roadview"){
      notice.textContent="인근 로드뷰를 찾는 중";
      new sdk.RoadviewClient().getNearestPanoId(position,100,panoId=>{
        if(!panel.isConnected)return;
        if(!panoId){
          canvas.hidden=true;
          notice.textContent="이 위치 100m 이내에 제공되는 로드뷰가 없습니다.";
          return;
        }
        const panorama=new sdk.Roadview(canvas);
        sdk.event.addListener(panorama,"init",()=>{
          notice.textContent="카카오 로드뷰 · 촬영 지점은 물건 위치와 다를 수 있습니다.";
          panel.dataset.mapView="roadview";
        });
        panorama.setPanoId(panoId,position);
      });
      return;
    }
    const instance=new sdk.Map(canvas,{center:position,level:1});
    const marker=node("span",(kind||"물건")+(planned?" · 예정":""),"map-pin has-case callout");
    new sdk.CustomOverlay({map:instance,position,content:marker,xAnchor:0.5,yAnchor:1});
    instance.addControl(new sdk.ZoomControl(),sdk.ControlPosition.TOPRIGHT);
    if(initialView==="parcel")instance.addOverlayMapTypeId(sdk.MapTypeId.USE_DISTRICT);
    const setType=sky=>{
      instance.setMapTypeId(sky?sdk.MapTypeId.HYBRID:sdk.MapTypeId.ROADMAP);
      road.setAttribute("aria-pressed",String(!sky));
      aerial.setAttribute("aria-pressed",String(sky));
      panel.dataset.mapView=initialView==="parcel"?"parcel":sky?"sky":"road";
    };
    const road=btn("일반지도",()=>setType(false),"quiet");
    const aerial=btn("스카이뷰",()=>setType(true),"quiet");
    controls.append(road,aerial);
    sdk.event.addListener(instance,"tilesloaded",()=>{
      notice.textContent=initialView==="parcel"
        ?"카카오 지적편집도 · 단지·필지 기준 위치":"카카오맵 · 단지·필지 기준 위치";
    });
    setType(initialView==="sky");
  }).catch(e=>{if(panel.isConnected){canvas.hidden=true;notice.textContent=e.message;}});
  return panel;
}

function caseTools(id, caseNumber, court, asset) {
  const makeDialog=title=>{
    const dialog=node("dialog",null,"case-print-dialog");
    dialog.setAttribute("aria-label",title);
    dialog.append(node("h2",title));
    return dialog;
  };
  const favorite=makeDialog("관심물건");
  const group=node("input"), name=node("input");
  group.maxLength=40;name.maxLength=120;
  const groupLabel=node("label","분류"),nameLabel=node("label","제목");
  groupLabel.append(group);nameLabel.append(name);
  const state=node("p",null,"case-meta");state.setAttribute("role","status");
  const propertyId=asset?.id||"";
  const findSaved=()=>savedFavorites.find(e=>e.id===id&&e.property===propertyId);
  const pressed=()=>favoriteButton.setAttribute("aria-pressed",String(Boolean(findSaved())));
  const favoriteButton=btn("찜하기",async()=>{
    state.textContent="";
    favoriteButton.disabled=true;
    try {
      await refreshFavorites();
      pressed();
      const entry=findSaved();
      const legacy=legacyFavorites().find(e=>e.id===id&&(e.property||"")===propertyId);
      group.value=entry?.group||legacy?.group||"";
      name.value=entry?.title||legacy?.title||caseNumber;
      remove.hidden=!entry;
      if(!entry&&legacy)state.textContent="이 브라우저의 이전 항목을 불러왔습니다. 저장하면 운영 원장에 추가됩니다.";
      favorite.showModal();
    } catch {
      state.textContent="운영 원장을 열지 못했습니다.";
      favorite.showModal();
    } finally {favoriteButton.disabled=false;}
  },"quiet");
  const save=async removing=>{
    state.textContent="";
    saveButton.disabled=true;
    remove.disabled=true;
    try {
      const response=await fetch("/auction-public/archive/favorites.json",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({id,property:propertyId,group:group.value.trim(),title:name.value.trim()||caseNumber,remove:removing})
      });
      if(!response.ok)throw new Error();
      const entries=await response.json();
      ++favoriteRequest;
      savedFavorites=entries;
      pressed();
      favorite.close();
    } catch {state.textContent="운영 원장에 저장하지 못했습니다. 다시 시도해 주세요.";}
    finally {saveButton.disabled=false;remove.disabled=false;}
  };
  favoriteButton.setAttribute("aria-pressed","false");
  if(!hostedArchive)refreshFavorites().then(pressed).catch(()=>{});
  const remove=btn("관심 해제",()=>save(true),"quiet");
  const saveButton=btn("저장",()=>save(false));
  const favoriteActions=node("div",null,"detail-actions");
  favoriteActions.append(btn("취소",()=>favorite.close(),"quiet"),remove,saveButton);
  favorite.append(node("p","같은 운영 웹에 접속하는 브라우저에서 이 목록을 볼 수 있습니다.","case-meta"),groupLabel,nameLabel,state,favoriteActions);

  const share=makeDialog("내부 주소 공유");
  const address=node("input");address.readOnly=true;address.setAttribute("aria-label","사건 내부 주소");
  address.value=new URL(detailLink(id,asset),location.origin).href;
  const notice=node("p",null,"case-meta");notice.setAttribute("role","status");
  const shareActions=node("div",null,"detail-actions");
  shareActions.append(btn("닫기",()=>share.close(),"quiet"),btn("주소 복사",async()=>{
    try{await navigator.clipboard.writeText(address.value);notice.textContent="주소를 복사했습니다.";}
    catch{address.focus();address.select();notice.textContent="선택된 주소를 복사해 주세요.";}
  }));
  const lookup=node("textarea");lookup.readOnly=true;lookup.rows=3;
  lookup.setAttribute("aria-label","법원 조회용 사건정보");
  lookup.value=[caseNumber,court,"법원경매정보 https://www.courtauction.go.kr/"].filter(Boolean).join("\n");
  const copyLookup=btn("법원 조회 정보 복사",async()=>{
    try{await navigator.clipboard.writeText(lookup.value);notice.textContent="법원 조회 정보를 복사했습니다.";}
    catch{lookup.focus();lookup.select();notice.textContent="선택된 법원 조회 정보를 복사해 주세요.";}
  });
  const publicActions=node("div",null,"detail-actions");
  publicActions.append(copyLookup);
  if(typeof navigator.share==="function"){
    publicActions.append(btn("기기 공유 열기",async()=>{
      try{
        await navigator.share({title:"법원 경매 사건 조회",text:lookup.value});
        notice.textContent="기기 공유를 열었습니다.";
      }catch(error){
        if(error.name!=="AbortError")notice.textContent="공유 창을 열지 못했습니다. 조회 정보 복사를 이용하세요.";
      }
    },"quiet"));
  }
  share.append(node("p",publicArchive?"공개 사건 상세 주소입니다.":hostedArchive?"허용된 팀 계정으로 로그인하면 다른 기기에서도 이 주소를 열 수 있습니다.":"이 주소는 현재 PC의 내부 열람용입니다."),address,shareActions,
    node("p","외부에서 법원 원문을 조회할 때 쓸 사건번호와 법원입니다."),lookup,publicActions,notice);
  return {
    buttons:[...(!hostedArchive?[favoriteButton]:[]),btn("공유",()=>{notice.textContent="";share.showModal();},"quiet")],
    dialogs:[favorite,share]
  };
}

function casePrintDialog(sheet,c,asset,event,identity){
  const dialog=node("dialog",null,"case-print-dialog");
  dialog.setAttribute("aria-label","선택 인쇄");
  const field=(type,text,value)=>{
    const label=node("label"), input=node("input");
    input.type=type;input.value=value;input.name=type==="radio"?"photos":"";
    label.append(input,document.createTextNode(" "+text));
    return {label,input};
  };
  const all=field("checkbox","전체인쇄","all");
  const parts=[["기본목록","facts"],["입찰일정","schedule"],["물건내용","property"],["추가내용","extra"]]
    .map(([text,key])=>field("checkbox",text,key));
  const modes=[["대표사진","cover"],["전체사진","all"],["인쇄안함","none"]]
    .map(([text,key])=>field("radio",text,key));
  const sections=node("fieldset");sections.append(node("legend","인쇄 항목"),all.label,...parts.map(p=>p.label));
  const photos=node("fieldset");photos.append(node("legend","사진인쇄"),...modes.map(p=>p.label));
  const memoLabel=node("label","인쇄 시 메모사항");
  const memo=node("textarea");memo.rows=3;memoLabel.append(memo);
  const notice=node("p",null,"case-meta");notice.setAttribute("role","status");
  const print=btn("인쇄하기",async()=>{
    const chosen=new Set(parts.filter(p=>p.input.checked).map(p=>p.input.value));
    const photoMode=modes.find(p=>p.input.checked).input.value;
    if(!chosen.size&&photoMode==="none"&&!memo.value.trim()){
      notice.textContent="인쇄할 항목을 하나 이상 선택해 주세요.";
      return;
    }
    const overview=caseOverview(c,node("div"),event,photoMode==="all");
    const blocks=recordBlocks(c);
    const property=/^(매각\s*물건|임차인|등기부|목록내역|주의사항)/;
    const selected=[identity.cloneNode(true)];
    if(chosen.has("facts"))selected.push(caseFacts(c,asset));
    if(chosen.has("schedule"))selected.push(overview.querySelector("#case-schedule"));
    if(photoMode!=="none"){
      const gallery=overview.querySelector("#case-photos");
      const buttons=[...gallery.querySelectorAll(".gallery button")];
      if(photoMode==="cover")buttons.slice(1).forEach(button=>button.remove());
      gallery.querySelector(".photo-head button")?.remove();
      selected.push(gallery);
    }
    selected.filter(el=>el.id).forEach(el=>el.removeAttribute("id"));
    if(chosen.has("property"))selected.push(...blocks.filter(b=>property.test(b.firstChild.textContent)));
    if(chosen.has("extra")){
      selected.push(...blocks.filter(b=>!property.test(b.firstChild.textContent)));
      if(event)selected.push(summary(timeline(event)));
    }
    if(memo.value.trim()){
      const notes=node("section",null,"case-print-notes");
      notes.append(node("h2","인쇄 메모"),node("p",memo.value.trim()));
      selected.push(notes);
    }
    sheet.replaceChildren(...selected);
    print.disabled=true;
    try{
      const images=[...sheet.querySelectorAll("img")];
      await Promise.all(images.map(img=>img.decode().catch(()=>{})));
      dialog.close();
      document.body.classList.add("case-print-selected");
      window.print();
    }finally{print.disabled=false;}
  });
  all.input.checked=true;
  parts.forEach(p=>{p.input.checked=true;p.input.addEventListener("change",()=>{
    all.input.checked=parts.every(part=>part.input.checked);
    all.input.indeterminate=!all.input.checked&&parts.some(part=>part.input.checked);
  });});
  all.input.addEventListener("change",()=>parts.forEach(p=>{p.input.checked=all.input.checked;}));
  modes[0].input.checked=true;
  const actions=node("div",null,"detail-actions");
  actions.append(btn("취소",()=>dialog.close(),"quiet"),print);
  dialog.append(node("h2","선택 인쇄"),sections,photos,memoLabel,notice,actions);
  window.addEventListener("afterprint",()=>document.body.classList.remove("case-print-selected"));
  return dialog;
}

function caseOverview(c, preview, event, allPhotos=false) {
  const overview=node("div",null,"case-overview");
  const schedule=node("section",null,"overview-block");schedule.id="case-schedule";
  const title=node("h3","입찰 진행 내용");
  const days=String(event?.days??"");
  if(/^\d+$/.test(days))title.append(node("small"," · 수집 기준 D-"+days));
  schedule.append(title);
  if(c.schedule.length){
    const table=node("table");const head=table.createTHead().insertRow();
    for(const label of ["회차","매각기일","최저매각가격","결과"])head.append(node("th",label));
    const body=table.createTBody();
    for(const row of c.schedule){const tr=body.insertRow();for(const cell of row)tr.insertCell().textContent=cell||"미기재";}
    schedule.append(table);
    for(const line of c.scheduleNotes||[])schedule.append(node("p",line,"schedule-note"));
  }else {
    if(event?.date)schedule.append(node("p","물건 원장 기일·관측일 "+event.date));
    schedule.append(node("p","이 수집본에는 입찰 진행표가 없습니다."));
  }
  const photos=node("section",null,"overview-block");photos.id="case-photos";
  const photoHead=node("div",null,"photo-head");photoHead.append(node("h3","물건 사진"));
  photos.append(photoHead);
  const gallery=node("div",null,"gallery");
  const files=c.status==="partial"||c.status==="verified"
    ? c.sections.filter(s=>s.key==="detail"||s.key==="map").flatMap(s=>s.files).filter(f=>/^photo[_-]/i.test(f.name)) : [];
  const addPhoto=f=>{
    const b=btn(null,()=>showFile(f,preview,true,null,null,true));b.setAttribute("aria-label",f.name+" 열기");
    b.append(photo(f.url,f.name,true));gallery.append(b);
  };
  (allPhotos?files:files.slice(0,9)).forEach(addPhoto);
  if(!allPhotos&&files.length>9)photoHead.append(btn("사진 더보기",e=>{files.slice(9).forEach(addPhoto);e.currentTarget.remove();},"quiet"));
  photos.append(files.length?gallery:node("p",publicArchive?"물건 사진은 사건번호로 법원경매정보에서 확인하세요.":"이 수집본에 구분해 저장한 물건 사진이 없습니다."));
  overview.append(schedule,photos);
  return overview;
}
function section(s,preview) {
  const d=node("details",null,"source-section");d.open=!["detail","land","planning","map"].includes(s.key);
  d.append(node("summary",(s.key==="detail"?"기본정보 원본 파일":labels[s.key]||s.key)+" · "+(states[s.status]||s.status)));
  if(s.note)d.append(node("p",s.note));
  const files=node("div",null,"files");
  for(const f of s.files) files.append(btn(f.name,()=>showFile(f,preview)));
  if(s.files.length)d.append(files);else if(!publicArchive)d.append(node("p","이 항목에 연결된 저장 파일이 없습니다."));
  return d;
}
function comparison(s,preview,caseId) {
  const panel=node("section",null,"case-record comparison-record");
  panel.append(node("h3",labels[s.key]));
  if(s.scope)panel.append(node("p",s.scope,"case-meta"));
  if(s.sharedFrom)panel.append(node("p","공통 자료 출처 "+s.sharedFrom,"case-meta"));
  const tables=s.tables||[];
  for(const table of tables){
    if(table.label)panel.append(node("h4",table.label));
    if(table.empty){
      panel.append(node("p","저장된 조회 조건의 결과가 없습니다.","comparison-empty"));
    }else{
      panel.append(comparisonTable(table,s.key,caseId));
    }
  }
  const shown=tables.reduce((n,t)=>n+t.rows.length,0);
  if(shown&&Number.isInteger(s.rows)&&shown!==s.rows)
    panel.append(node("p","웹 표 "+shown+"행 · 수집 기록 "+s.rows+"행 · 원문에서 나머지를 확인할 수 있습니다.","case-meta"));
  const textFiles=s.files.filter(f=>f.type==="txt"&&!tables.some(t=>t.file===f.name));
  for(const f of textFiles){
    const inline=node("div",null,"comparison-transcript");
    inline.append(node("h4",f.name),node("p","저장 자료 읽는 중"));
    panel.append(inline);
    fetch(f.url).then(r=>{if(!r.ok)throw Error();return r.text();})
      .then(text=>inline.lastChild.replaceWith(displayTranscript(text,null)))
      .catch(()=>{inline.lastChild.textContent="저장 원문을 불러오지 못했습니다.";});
  }
  if(!s.files.length)panel.append(node("p",s.status==="no_result"?"수집 기록에 검색 결과가 없습니다.":"표시할 저장 원문이 없습니다.","comparison-empty"));
  const original=section(s,preview);
  original.open=false;
  original.querySelector("summary").textContent="조회 범위 및 원본 자료 · "+(states[s.status]||s.status);
  panel.append(original);
  return panel;
}

function relatedCaseLink(row,source,key,caseId){
  const number=row[0].match(/^(\d{4})-(\d+)(?:\(\d+\))?$/);
  const archive=number&&data.cases.filter(c=>{
    const court=c.court.replace(/지방법원|지원|\s/g,"");
    return c.case===number[1]+"타경"+number[2]&&court.length>=2&&row.at(-1).replace(/\s/g,"").includes(court+"");
  });
  if(archive?.length===1)return caseLink(row[0]+" ↗",archive[0].id,null);
  const link=node("a",row[0]+" ↗");
  link.href="/auction-public/auction/detail/?"+new URLSearchParams({reference:caseId,section:key,file:source.file,row:String(source.rows.indexOf(row))});
  link.target="_blank";link.rel="noopener";
  return link;
}

function comparisonTable(source,key,caseId) {
  const wrap=node("div",null,"comparison-table");
  const toolbar=node("div",null,"comparison-controls");
  const search=node("input");
  search.type="search";
  search.placeholder="표에서 검색";
  search.setAttribute("aria-label",(source.label||"결과")+" 표 검색");
  const size=node("select");
  size.setAttribute("aria-label","페이지당 행 수");
  for(const n of [20,30,50,100]){
    const option=node("option",n+"개씩");option.value=String(n);size.append(option);
  }
  const selectedRows=new Set();
  let selectionOnly=false,page=0;
  const selectedButton=btn("선택보기",()=>{
    selectionOnly=!selectionOnly;
    selectedButton.setAttribute("aria-pressed",String(selectionOnly));
    page=0;render();
  },"quiet");
  selectedButton.setAttribute("aria-pressed","false");
  const count=node("span",null,"case-meta");
  count.setAttribute("aria-live","polite");
  toolbar.append(search,size,selectedButton,count);
  const paging=node("div",null,"comparison-controls");
  const previous=btn("이전",()=>{page--;render();},"quiet"),next=btn("다음",()=>{page++;render();},"quiet");
  const pageLabel=node("span",null,"case-meta");
  paging.append(previous,pageLabel,next);
  const scroll=node("div",null,"table-scroll"),table=node("table");
  const head=table.createTHead().insertRow(), body=table.createTBody();
  const compare=new Intl.Collator("ko",{numeric:true});
  let order=null;
  function render(){
    const term=search.value.trim().toLowerCase();
    const rows=source.rows.filter(row=>(!selectionOnly||selectedRows.has(row))&&row.some(value=>value.toLowerCase().includes(term)));
    if(order)rows.sort((a,b)=>order.direction*compare.compare(a[order.index],b[order.index]));
    count.textContent=rows.length.toLocaleString("ko-KR")+"건";
    const perPage=Number(size.value), pages=Math.max(1,Math.ceil(rows.length/perPage));
    page=Math.max(0,Math.min(page,pages-1));
    previous.disabled=page===0;next.disabled=page===pages-1;
    pageLabel.textContent=(page+1)+" / "+pages;
    body.replaceChildren(...rows.slice(page*perPage,(page+1)*perPage).map(row=>{
      const tr=node("tr"), td=node("td"), check=node("input");
      check.type="checkbox";check.checked=selectedRows.has(row);
      check.setAttribute("aria-label",row[0]+" 선택");
      check.addEventListener("change",()=>{
        if(check.checked)selectedRows.add(row);else selectedRows.delete(row);
        if(selectionOnly)render();
      });
      td.append(check);tr.append(td,...row.map(value=>node("td",value||"—")));
      if(["near_active","near_sold","same_parcel","near_public"].includes(key))
        tr.cells[1].replaceChildren(relatedCaseLink(row,source,key,caseId));
      return tr;
    }));
  }
  const selectHead=node("th","선택");selectHead.scope="col";head.append(selectHead);
  source.columns.forEach((label,index)=>{
    const th=node("th");th.scope="col";
    th.append(btn(label,()=>{
      const direction=order?.index===index?-order.direction:1;
      order={index,direction};
      for(const cell of head.cells)cell.removeAttribute("aria-sort");
      th.setAttribute("aria-sort",direction===1?"ascending":"descending");
      render();
    }));
    head.append(th);
  });
  search.addEventListener("input",()=>{page=0;render();});
  size.addEventListener("change",()=>{page=0;render();});
  render();
  scroll.append(table);wrap.append(toolbar,scroll,paging);
  return wrap;
}

function displayTranscript(text, kind) {
  const out=node("div",null,"transcript");
  const markers={history:"사건기본내역",service:"문건처리내역",
    land:"토지이용계획 - 소재지",planning:"시점별 도시계획 지도를 확인할 수 있는 표"};
  const begin=markers[kind]?text.indexOf(markers[kind]):-1;
  if(begin>=0){
    text=text.slice(begin);
    if(["land","planning"].includes(kind))text=text.split(/^\[표시 프레임/m,1)[0];
  }
  let table=null, columns=0;
  for(const line of text.split(/\r?\n/)){
    if(line.includes("\t")){
      if(!table){
        table=node("table");columns=line.split("\t").length;
        const scroll=node("div",null,"table-scroll");
        scroll.append(table);out.append(scroll);
      }
      const cells=line.split("\t").map(v=>v.trim());
      const tr=table.insertRow();
      if(cells.length===columns){
        for(const cell of cells)tr.insertCell().textContent=cell;
      }else{
        const td=tr.insertCell();td.colSpan=columns;
        const parts=node("div",null,"source-line");
        parts.append(...cells.filter(Boolean).map(v=>node("span",v)));td.append(parts);
      }
    }else{
      table=null;
      if(line.trim())out.append(node("p",line.trim()));
    }
  }
  return out;
}
async function showFile(f, box, scroll=true, transcript=null, inline=null, photoOnly=false) {
  if(inline){
    const run=++previewRequest;
    const content=node("section",null,"case-record");
    content.append(node("h3",labels[transcript]),node("p","저장 텍스트를 읽는 중입니다."));
    inline.prepend(content);
    try{
      const r=await fetch(f.url);if(!r.ok)throw new Error("저장 파일을 열 수 없습니다.");
      const text=await r.text();if(run===previewRequest)content.lastChild.replaceWith(displayTranscript(text,transcript));
    }catch(e){if(run===previewRequest)content.lastChild.textContent=e.message;}
    return;
  }
  const run=++previewRequest;
  const title=node("div",null,"preview-head"), link=node("a","원본 새 탭","file-open");
  link.href=f.url;link.target="_blank";link.rel="noopener";
  title.append(node("strong",f.name),link,btn("미리보기 닫기",()=>{previewRequest++;box.hidden=true;box.replaceChildren();},"quiet"));
  box.replaceChildren(title);box.hidden=false;
  if(photoOnly){
    box.append(photo(f.url,f.name,true));
  }else if(["png","jpg","jpeg","gif","webp"].includes(f.type)){
    const img=node("img");img.src=f.url;img.alt=f.name;box.append(img);
  }else if(f.type==="pdf"){
    const frame=node("iframe");frame.src=f.url;frame.title=f.name;box.append(frame);
  }else{
    const pre=node("pre","파일 여는 중");box.append(pre);
    try{
      const r=await fetch(f.url);if(!r.ok)throw new Error("저장 파일을 열 수 없습니다.");
      const text=await r.text();if(run===previewRequest){if(transcript)pre.replaceWith(displayTranscript(text,transcript));else pre.textContent=text;}
    }catch(e){if(run===previewRequest)pre.textContent=e.message;}
  }
  if(scroll)box.scrollIntoView({block:"nearest"});
}
function isOnMap(point, margin=0){
  return point.x>=-margin&&point.y>=-margin&&point.x<=mapHost().clientWidth+margin&&point.y<=mapHost().clientHeight+margin;
}

function listMapArea(){
  if(mode==="archive"||mode==="favorites")mode="all";
  mapArea=true;
  group=null;
  selected=null;
  property();
  saveLocation();
  list();
  $("asset-list").scrollTop=0;
}

function selectMapGroup(assets){
  if(mode==="archive"||mode==="favorites")mode="all";
  mapArea=false;
  group=assets;
  if(assets.length===1)select(assets[0],false);
  else{
    if(!assets.some(asset=>asset.id===selected?.id))selected=null;
    property();list();saveLocation();drawMarkers();
  }
  $("asset-list").scrollTop=0;
}

function drawMarkers() {
  if(!map)return;
  for(const marker of markers)marker.remove();
  markers=[];
  const visible=new Set(visibleAssets().map(a=>a.id)), bins=new Map();
  for(const p of points){
    const assets=p.assets.filter(a=>visible.has(a.id));
    if(!assets.length)continue;
    const xy=map.project(p.point);
    if(!isOnMap(xy,100))continue;
    const key=map.getZoom()<14?[Math.floor(xy.x/105),Math.floor(xy.y/78)].join(","):p.point.join(",");
    if(!bins.has(key))bins.set(key,[]);
    bins.get(key).push({point:p.point,assets});
  }
  for(const bin of bins.values()){
    const assets=bin.flatMap(p=>p.assets), first=assets[0], event=first.cases[0];
    const cluster=bin.length>1, multiple=assets.length>1;
    const point=bin.reduce((v,p)=>[v[0]+p.point[0]/bin.length,v[1]+p.point[1]/bin.length],[0,0]);
    const b=btn(null,e=>{
      e.stopPropagation();
      selectMapGroup(assets);
      if(cluster)map.easeTo({center:point,zoom:Math.min(map.getZoom()+2,14),duration:still.matches?0:240});
    },"map-pin"+(cluster?" cluster":multiple?" stack":" callout")+(assets.some(a=>a.cases.length)?" has-case":""));
    b.setAttribute("aria-label",cluster?assets.length+"행 위치 확대":first.name+(multiple?" 외 "+(assets.length-1)+"행":"")+" 위치 열기");
    b.title=cluster?assets.length+"행":first.location||first.name;
    if(cluster||multiple)b.append(node("span",String(assets.length)));
    else {
      b.append(node("strong",first.kind||"물건"));
      b.append(node("span",event?[event.stage,event.amounts?.["감정가"]&&"감 "+event.amounts["감정가"]+"원"].filter(Boolean).join(" · "):first.name));
    }
    b.classList.toggle("current",assets.some(a=>a.id===selected?.id));
    const centered=cluster||multiple;
    if(kakaoView){
      const overlay=new kakaoSdk.CustomOverlay({
        map:kakaoView.instance, position:kakaoPoint(kakaoSdk,point), content:b,
        xAnchor:0.5, yAnchor:centered?0.5:1, clickable:true,
        zIndex:b.classList.contains("current")?2:1
      });
      markers.push({remove:()=>overlay.setMap(null)});
    }else{
      markers.push(new maplibregl.Marker({element:b,anchor:centered?"center":"bottom"}).setLngLat(point).addTo(map));
    }
  }
}
function fit(){
  if(!map||!points.length)return;
  if(buildings3d)setBuildingView(false);
  const matches=new Set(visibleAssets().map(a=>a.id));
  const positions=points.filter(p=>p.assets.some(a=>matches.has(a.id))).map(p=>p.point);
  if(positions.length&&kakaoView){
    const bounds=new kakaoSdk.LatLngBounds();
    for(const point of positions)bounds.extend(kakaoPoint(kakaoSdk,point));
    const instance=kakaoView.instance;
    instance.setBounds(bounds,50,50,50,50);
    if(instance.getLevel()<kakaoLevel(14))instance.setLevel(kakaoLevel(14));
  }else if(positions.length){
    const bounds=new maplibregl.LngLatBounds();
    for(const point of positions)bounds.extend(point);
    map.fitBounds(bounds,{padding:50,maxZoom:14,duration:0});
  }
  drawMarkers();
}
function setBasemap(next){
  basemap=next;
  if(!mapReady)return;
  if(kakaoView){
    kakaoView.instance.setMapTypeId(next==="road"?kakaoSdk.MapTypeId.ROADMAP:kakaoSdk.MapTypeId.HYBRID);
  }else{
    for(const id of ["road","satellite","hybrid"])
      map.setLayoutProperty(id,"visibility",(next==="road"?id==="road":id!=="road")?"visible":"none");
  }
  for(const b of document.querySelectorAll("[data-basemap]"))b.setAttribute("aria-pressed",b.dataset.basemap===next);
  reportBasemap();
}
function reportBasemap(){
  if(kakaoView){
    $("map-status").textContent=kakaoView.tilesReady?(basemap==="road"?"카카오맵 일반지도":"카카오맵 스카이뷰"):"카카오맵 연결 중";
    return;
  }
  const ready=loadedBasemaps.has(basemap==="road"?"road":"satellite");
  $("map-status").textContent=ready?(basemap==="road"?"V월드 일반지도":"V월드 위성지도"):"V월드 지도 연결 중";
}
function reportBuildings() {
  if(!buildings3d)return;
  const visible=map.queryRenderedFeatures({layers:["stored-buildings-3d"]}).length;
  $("building-status").textContent=visible
    ?"건물 외곽선 · 청록: 기존 지도 대상 · 회색: 높이 추정 포함"
    :"이 화면에서 표시할 건물 외곽선 자료가 없습니다.";
}
function setBuildingView(enable) {
  if(!mapReady)return;
  if(kakaoView&&enable){
    const view=currentMapView();
    clearMap();
    buildMap(view,true);
    return;
  }
  if(!enable&&kakaoSdk&&buildings3d){
    const view=currentMapView();
    clearMap();
    buildings3d=false;
    $("toggle-3d").setAttribute("aria-pressed","false");
    $("building-status").hidden=true;
    buildKakaoMap(view);
    return;
  }
  if(enable&&!map.getSource("stored-buildings")){
    map.addSource("stored-buildings",{type:"geojson",data:"/auction-public/buildings.geojson",attribution:"건물 외곽선 · 브이월드"});
    map.addLayer({id:"stored-buildings-3d",type:"fill-extrusion",source:"stored-buildings",minzoom:14.5,paint:{
      "fill-extrusion-color":["case",["==",["get","target"],true],"#82d9bd",["==",["get","estimated"],true],"#a7b2b7","#d8e4e8"],
      "fill-extrusion-height":["coalesce",["get","height"],0],"fill-extrusion-opacity":0.82
    }});
  }
  buildings3d=enable;
  if(map.getLayer("stored-buildings-3d"))map.setLayoutProperty("stored-buildings-3d","visibility",enable?"visible":"none");
  $("toggle-3d").setAttribute("aria-pressed",enable);
  $("building-status").hidden=!enable;
  if(enable)$("building-status").textContent="기존 건물 외곽선 표시 중 · 높이 추정 포함";
  const options={pitch:enable?55:0,bearing:enable?-22:0,duration:still.matches?0:450};
  if(enable&&selected?.point)Object.assign(options,{center:selected.point,zoom:Math.max(16,map.getZoom())});
  map.easeTo(options);
}
function currentMapView(){
  const center=map.getCenter();
  return {center:[center.lng,center.lat],zoom:map.getZoom()};
}

function clearMap(){
  for(const marker of markers)marker.remove();
  markers=[];
  if(kakaoView){
    kakaoView.resize.disconnect();
    kakaoView=null;
  }else{
    map?.remove();
  }
  map=null;
  mapReady=false;
  mapHost().replaceChildren();
  $("toggle-3d").disabled=true;
}

function buildKakaoMap(view){
  const sdk=kakaoSdk;
  const center=view?.center||[127.6,36.3];
  const instance=new sdk.Map(mapHost(),{
    center:kakaoPoint(sdk,center), level:kakaoLevel(view?.zoom??6),
    mapTypeId:basemap==="road"?sdk.MapTypeId.ROADMAP:sdk.MapTypeId.HYBRID
  });
  instance.addControl(new sdk.ZoomControl(),sdk.ControlPosition.TOPRIGHT);
  const resize=new ResizeObserver(()=>{
    if(kakaoView?.instance!==instance)return;
    const focus=instance.getCenter();
    instance.relayout();
    instance.setCenter(focus);
    drawMarkers();
  });
  resize.observe(mapHost());
  kakaoView={instance,resize,tilesReady:false};
  map={
    getZoom:()=>19-instance.getLevel(),
    getCenter:()=>{const p=instance.getCenter();return {lng:p.getLng(),lat:p.getLat()};},
    project:point=>instance.getProjection().containerPointFromCoords(kakaoPoint(sdk,point)),
    easeTo:({center,zoom})=>{
      const position=kakaoPoint(sdk,center);
      instance.setCenter(position);
      instance.setLevel(kakaoLevel(zoom),{anchor:position});
    }
  };
  mapReady=true;
  $("toggle-3d").disabled=hostedArchive;
  sdk.event.addListener(instance,"idle",()=>{
    if(kakaoView?.instance!==instance)return;
    drawMarkers();
    if(mapArea&&!group)list();
  });
  sdk.event.addListener(instance,"dragend",listMapArea);
  sdk.event.addListener(instance,"click",listMapArea);
  sdk.event.addListener(instance,"tilesloaded",()=>{
    if(kakaoView?.instance!==instance)return;
    kakaoView.tilesReady=true;
    reportBasemap();
  });
  setBasemap(basemap);
  if(view)drawMarkers();else fit();
}

function buildMap(view, showBuildings=false){
  const style={version:8,sources:{
    road:{type:"raster",tiles:[location.origin+"/tiles/Base/{z}/{y}/{x}"],tileSize:256,minzoom:5,maxzoom:19,attribution:"일반지도 © VWorld"},
    satellite:{type:"raster",tiles:[location.origin+"/tiles/Satellite/{z}/{y}/{x}"],tileSize:256,minzoom:5,maxzoom:19,attribution:"위성영상 © VWorld"},
    hybrid:{type:"raster",tiles:[location.origin+"/tiles/Hybrid/{z}/{y}/{x}"],tileSize:256,minzoom:5,maxzoom:19}
  },layers:[
    {id:"base",type:"background",paint:{"background-color":"#edf0ed"}},
    {id:"road",type:"raster",source:"road"},
    {id:"satellite",type:"raster",source:"satellite",layout:{visibility:"none"}},
    {id:"hybrid",type:"raster",source:"hybrid",layout:{visibility:"none"}}
  ]};
  try{
    loadedBasemaps.clear();
    map=new maplibregl.Map({container:"map",style,center:view?.center||[127.6,36.3],zoom:view?.zoom??6,minZoom:5,maxZoom:19});
    map.addControl(new maplibregl.NavigationControl(),"top-right");
    map.on("load",()=>{
      mapReady=true;
      $("toggle-3d").disabled=hostedArchive;
      setBasemap(basemap);
      if(showBuildings)setBuildingView(true);
      drawMarkers();
    });
    map.on("idle",reportBuildings);
    map.on("moveend",()=>{
      drawMarkers();
      if(mapArea&&!group)list();
      if(buildings3d&&map.getSource("stored-buildings")&&map.isSourceLoaded("stored-buildings"))reportBuildings();
    });
    map.on("dragend",listMapArea);
    map.on("click",e=>{if(!e.originalEvent.target.closest(".map-pin"))listMapArea();});
    map.on("error",()=>{if(!loadedBasemaps.has(basemap==="road"?"road":"satellite"))$("map-status").textContent="지도 연결 확인 중 · 목록 이용 가능";});
    map.on("sourcedata",e=>{
      if(buildings3d&&e.sourceId==="stored-buildings"&&e.isSourceLoaded)reportBuildings();
      if(["road","satellite"].includes(e.sourceId)&&e.tile?.state==="loaded"){loadedBasemaps.add(e.sourceId);reportBasemap();}
    });
    if(view)drawMarkers();else fit();
  }catch(e){$("map-status").textContent="이 브라우저에서 지도를 열지 못했습니다. 물건 목록을 이용하세요.";}
}
async function start(){
  const isDetail=document.body.classList.contains("auction-detail");
  if(!isDetail&&new URLSearchParams(location.search).has("case")){
    location.replace("/auction-public/auction/detail/"+location.search);return;
  }
  try{
    const r=await fetch("/auction-public/archive/catalog.json");if(!r.ok)throw new Error();
    data=await r.json();
    if(isDetail){await showDetail();return;}
    $("asset-count").textContent=number(data.assets.length);
    $("pin-count").textContent=number(data.assets.filter(a=>a.point).length);
    $("case-count").textContent=number(data.cases.length);
    $("footer").textContent="사건 수집 종료 "+capturedTime(data.endedAt)+" · 저장 자료 기준";
    $("overview").addEventListener("click",()=>{group=null;mapArea=false;list();fit();});
    $("toggle-3d").addEventListener("click",()=>setBuildingView(!buildings3d));
    $("clear-group").addEventListener("click",()=>{group=null;mapArea=false;list();});
    for(const b of document.querySelectorAll("[data-basemap]"))b.addEventListener("click",()=>setBasemap(b.dataset.basemap));
    for(const region of [...new Set(data.assets.map(a=>a.region).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"ko"))){
      const option=node("option",region);option.value=region;$("region").append(option);
    }
    const reloadFavorites=async()=>{
      try {await refreshFavorites();}
      catch {
        if(mode==="favorites")$("asset-list").replaceChildren(node("p","관심물건 원장을 열 수 없습니다.","empty"));
        return;
      }
      if(mode==="favorites"){list();drawMarkers();}
    };
    window.addEventListener("focus",()=>{if(mode==="favorites")reloadFavorites();});
    $("region").addEventListener("change",()=>{group=null;mapArea=false;selected=null;property();saveLocation();list();fit();});
    for(const b of document.querySelectorAll("button[data-mode]"))b.addEventListener("click",()=>{
      mode=b.dataset.mode;group=null;mapArea=false;list();drawMarkers();
      if(mode==="favorites")reloadFavorites();
    });
    const asset=data.assets.find(a=>a.id===new URLSearchParams(location.search).get("property"));
    if(asset)mode="all";
    list();
    if(asset){
      select(asset,false);
      if(new URLSearchParams(location.search).get("panel")==="doctor"){
        const link=$("property").querySelector(".doctor-entry");
        if(link)location.replace(link.href);
      }
    }
    const grouped=new Map();
    for(const a of data.assets.filter(a=>a.point)){
      const key=a.point.map(v=>v.toFixed(5)).join(",");
      if(!grouped.has(key))grouped.set(key,[]);
      grouped.get(key).push(a);
    }
    points=[...grouped.values()].map(assets=>({assets,point:assets[0].point}));
    const view=asset?.point?{center:asset.point,zoom:14}:null;
    $("map-status").textContent="지도 연결 중";
    try{
      kakaoSdk=await loadKakaoSdk();
      if(kakaoSdk){buildKakaoMap(view);return;}
    }catch(e){
      clearMap();
      kakaoSdk=null;
    }
    buildMap(view);
  }catch(e){$(isDetail?"case-view":"asset-list").replaceChildren(node("p","자료 목록을 열지 못했습니다. 로컬 서버와 원장 폴더를 확인하세요.","empty"));}
}
start();
