"use strict";
const $ = id => document.getElementById(id);
const hostedArchive = document.documentElement.hasAttribute("data-hosted-archive");
const publicMap = document.documentElement.hasAttribute("data-public-map");
const totalUnits = units => units.reduce((count, unit) => count + (unit.publicCount || 1), 0);
const node = (tag, text, cls) => {
  const el = document.createElement(tag);
  if (text != null) el.textContent = text;
  if (cls) el.className = cls;
  return el;
};
const button = (text, handler, cls) => {
  const el = node("button",text,cls);
  el.type = "button";
  el.addEventListener("click",handler);
  return el;
};
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const status = $("mapStatus");
const format = n => n == null ? "평수 미기재" : n + "평";
let map, groups, records, selected, activeGroup, markers = [], show3d = false, loaded = false;
let firstTiles = false, focusedUnits=null;
let kakaoSdk=null, kakaoView=null, mapType="sky";
const kakaoPoint=([lng,lat])=>new kakaoSdk.LatLng(lat,lng);
const kakaoLevel=zoom=>Math.min(14,Math.max(1,19-Math.round(zoom)));
const style = {
  version:8,
  sources:{
    road:{type:"raster",tiles:[location.origin+"/tiles/Base/{z}/{y}/{x}"],tileSize:256,minzoom:5,maxzoom:19,attribution:"일반지도 · 브이월드"},
    satellite:{type:"raster", tiles:[location.origin+"/tiles/Satellite/{z}/{y}/{x}"],tileSize:256,minzoom:5,maxzoom:19,attribution:'위성영상 · <a href="https://www.vworld.kr/" target="_blank" rel="noopener">브이월드</a>'},
    hybrid:{type:"raster",tiles:[location.origin+"/tiles/Hybrid/{z}/{y}/{x}"],tileSize:256,minzoom:5,maxzoom:19},
    buildings:{type:"geojson",data:"/auction-public/buildings.geojson",attribution:"건물 외곽선 · 브이월드"}
  },
  layers:[
    {id:"base",type:"background",paint:{"background-color":"#223940"}},
    {id:"road",type:"raster",source:"road",layout:{visibility:"none"}},
    {id:"satellite",type:"raster",source:"satellite",paint:{"raster-fade-duration":100}},
    {id:"hybrid",type:"raster",source:"hybrid",layout:{visibility:"none"}},
    {id:"building-footprint",type:"line",source:"buildings",minzoom:14.5,paint:{"line-color":"#7eebcc","line-opacity":0.78,"line-width":2},filter:["==",["get","target"],true]},
    {id:"buildings",type:"fill-extrusion",source:"buildings",minzoom:14.5,paint:{
      "fill-extrusion-color":["case",["get","target"],"#79d8b9",["get","estimated"],"#9cabb5","#c7dbdf"],
      "fill-extrusion-height":["get","height"],"fill-extrusion-opacity":0.86
    }}
  ]
};
function filtered() {
  const q = $("query").value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const caseLink = $("case-link").value;
  return records.filter(r => {
    const regions = r.options.map(o=>o.g.region);
    const text = [r.n,r.label,r.kind,r.unit,format(r.pyeong),...r.options.map(o=>o.g.name+" "+o.g.address)].join(" ").toLowerCase();
    return (!focusedUnits||focusedUnits.has(r.n))
      && (!$("region").value || regions.includes($("region").value))
      && (!$("kind").value || r.kind === $("kind").value)
      && (!$("certainty").value || r.status === $("certainty").value)
      && (!caseLink || (caseLink === "linked" ? r.caseCount > 0 : !r.caseCount))
      && q.every(s=>text.includes(s));
  });
}
function updateList() {
  const visible = filtered();
  $("count").textContent = totalUnits(visible) + "건";
  $("map-guide").textContent = activeGroup
    ? activeGroup.name+" · 지도에서 선택한 위치"
    : focusedUnits ? "선택한 지역입니다. 지도에서 물건 핀을 누르세요."
    : "지도에서 지역을 누른 뒤 물건 핀을 선택하세요.";
  const fragment = document.createDocumentFragment();
  for (const r of visible) {
    const item=button(null,()=>select(r), "row"+(selected?.n===r.n?" active":""));
    item.dataset.state=r.status;
    item.dataset.number=r.n;
    item.append(node("span",String(r.n).padStart(2,"0"),"idx"));
    const name=node("span");
    name.append(node("strong",r.label),node("small",r.kind+" · "+stateLabel(r.status)+(publicMap?"":" · "+caseLabel(r))));
    item.append(name,node("span",publicMap?r.publicCount+"건":format(r.pyeong),"stamp"));
    fragment.append(item);
  }
  if (!visible.length) fragment.append(node("p","조건에 맞는 물건이 없습니다.","empty"));
  $("list").replaceChildren(fragment);
  refreshMarkers();
}
function stateLabel(value) {
  return {확인:"위치 확인",후보:"주소 후보",지역:"지역만 확인",미확인:"좌표 미확인"}[value]||"위치 미확인";
}
function caseLabel(record) {
  return record.caseCount ? "저장 사건 "+record.caseCount+"건" : "저장 사건 미연결";
}
function recordLink(label, url) {
  const link=node("a",label);
  link.href=url;
  link.target="_blank";
  link.rel="noopener";
  return link;
}
async function showStoredRecords(summary, propertyId) {
  try {
    const response=await fetch("/auction-public/archive/holding/"+encodeURIComponent(propertyId)+".json");
    if(!response.ok)throw new Error();
    const data=await response.json();
    if(!summary.isConnected)return;
    const records=node("div",null,"pin-record-list");
    if(data.events.length) {
      const captions={history:"사건내역",service:"문건·송달",court_docs:"법원 문서"};
      for(const event of data.events) {
        const card=node("div",null,"pin-record");
        const params=new URLSearchParams({property:propertyId,case:event.id||""});
        const url="/auction-public/auction/detail/?"+params;
        card.append(event.id?recordLink(event.number+" ↗",url):node("strong",event.number));
        card.append(node("p",[event.court,event.stage].filter(Boolean).join(" · ")));
        const review=event.review;
        if(review) {
          const dates=[review.nextDate?"다음 매각기일 "+review.nextDate:"매각기일 미확인"];
          if(review.paymentDue)dates.push("대금지급기한 "+review.paymentDue);
          if(review.paid)dates.push("완납 기록 "+review.paid);
          card.append(node("p",dates.join(" · ")));
        }
        const docs=node("div",null,"pin-docs");
        for(const file of review?.files||[]) {
          if(captions[file.key])docs.append(recordLink(captions[file.key]+" ↗",url+"&section="+file.key));
        }
        if(docs.children.length)card.append(docs);
        records.append(card);
      }
    } else {
      records.append(node("p","저장 사건 미연결"));
      records.append(node("p","현재 법원의 경매 진행 여부는 별도 확인이 필요합니다."));
    }
    if(data.followup)records.append(node("p","후속 등기 재확인 · "+data.followup.case,"pin-recheck"));
    const rent=data.scenarioArchive;
    if(typeof rent?.monthlyReference==="number"&&rent.monthlyReference>0) {
      records.append(node("p","월세 연구 가정 "+rent.monthlyReference.toLocaleString("ko-KR")+"원 · "+rent.basis));
    }
    summary.replaceChildren(records);
  } catch {
    if(summary.isConnected)summary.textContent="저장 자료를 불러오지 못했습니다.";
  }
}
function bankStatementCard(statement) {
  const card=node("section",null,"bank-statement");
  card.append(node("h4","은행제출용 물건명세"));
  const facts=node("dl");
  const rows=[
    ["명세서 호실",[statement.unit]],
    ["명세서 주소",[statement.address]],
    ["전용면적·비고",statement.notes],
    ["자료상 명의",[statement.owner]],
    ["경매 기재",statement.auction],
    ["임대차 기재",statement.lease],
  ];
  for (const [label,values] of rows) {
    if (!values || values.every(value=>value==null)) continue;
    facts.append(node("dt",label));
    const detail=node("dd");
    for(const value of values.length?values:["미기재"])detail.append(node("div",value));
    facts.append(detail);
  }
  card.append(facts,node("p",statement.sourceDate+" 기준 · "+statement.kind+" 명세서 "+statement.page+"쪽"),
    node("p",document.documentElement.hasAttribute("data-public-archive")?"명세서의 면적과 경매 기재를 표시합니다.":"현재 명의·경매·임대차 상태는 별도 확인이 필요합니다."));
  return card;
}
function selectPublicGroup(record, option) {
  selected=record;
  activeGroup=option.g;
  const panel=$("detail");
  const close=button("닫기",()=>{panel.hidden=true;selected=null;activeGroup=null;focusedUnits=null;updateList();},"close");
  close.setAttribute("aria-label","물건 정보 닫기");
  panel.replaceChildren(close,node("h3",option.g.name),
    node("p",option.g.region+" · 지도 위치는 단지 또는 지역 기준"),
    ...option.g.units.map(unit=>node("p",unit.kind+" · "+unit.publicCount+"건")));
  panel.hidden=false;
  panel.scrollTop=0;
  updateList();
  if(map&&option.g.point)map.flyTo({center:option.g.point,zoom:15,speed:1.7,duration:reduceMotion?0:850});
}
function select(record, option=record.options[0]) {
  if(publicMap)return selectPublicGroup(record,option);
  selected=record;
  activeGroup=option.g;
  const d=$("detail");
  const close=button("닫기",()=>{d.hidden=true;selected=null;activeGroup=null;focusedUnits=null;updateList();},"close");
  close.setAttribute("aria-label","물건 정보 닫기");
  d.replaceChildren(close,node("h3",record.label+" · "+format(record.pyeong)));
  d.scrollTop=0;
  d.append(node("p",option.g.name+" · "+stateLabel(option.u.status)),
    node("p",(option.u.address||option.g.address||"원장 주소 미기재")+(option.u.dong?" · "+option.u.dong+"동":"")));
  const workId=option.u.auctionId||"holding-"+option.u.n;
  const summary=node("div",null,"pin-summary");
  summary.append(node("p",caseLabel(option.u)));
  if (!option.u.caseCount) summary.append(node("p","현재 법원의 경매 진행 여부는 별도 확인이 필요합니다."));
  if(option.u.bankStatement)d.append(bankStatementCard(option.u.bankStatement));
  d.append(summary);
  showStoredRecords(summary,workId);
  if(option.u.location&&option.u.location!==option.u.address)d.append(node("p","지도 주소 "+option.u.location));
  if(option.u.locationNote)d.append(node("p",option.u.locationNote));
  if(!option.g.point)d.append(node("p","좌표 미확인 · 원장 목록에서 열람 가능"));
  if (option.u.area) d.append(node("p","전용 "+option.u.area+" · 평수는 원본 표기"));
  if (option.u.status==="확인" && !option.u.point) d.append(node("p","단지 핀 · 해당 동의 좌표는 추가 대조 필요"));
  if (option.u.status==="지역") d.append(node("p","표시는 용두동 권역 기준점입니다. 건물 주소 확인이 필요합니다."));
  if (record.options.length>1) {
    const options=node("div",null,"choices");
    for (const o of record.options) options.append(button(o.g.name,()=>select(record,o),o===option?"active":null));
    d.append(options);
  } else if (option.u.status==="후보") d.append(node("p","받은 자료의 약칭과 공개 주소를 대조한 후보입니다."));
  const shown=new Set(filtered().map(r=>r.n));
  const same=option.g.units.filter(u=>u.n!==record.n&&shown.has(u.n));
  if (same.length) {
    const choices=node("div",null,"choices");
    for (const u of same) {
      const r=records.find(r=>r.n===u.n);
      const o=r.options.find(o=>o.g.id===option.g.id);
      choices.append(button(u.label+" · "+format(u.pyeong)+(u.status==="후보"?" 후보":""),()=>select(r,o)));
    }
    summary.before(node("p","같은 핀의 다른 호실","pin-units"),choices);
  }
  if (option.u.source) {
    const a=node("a",option.u.status==="확인"?"주소 확인 근거 ↗":"후보 검색 자료 ↗");
    a.href=option.u.source;a.target="_blank";a.rel="noopener";
    const line=node("p");line.append(a);d.append(line);
  }
  if(option.u.caseCount&&option.u.auctionId){
    const link=node("a","경매 원장에서 보기 ↗");link.href="/auction-public/auction/?property="+encodeURIComponent(option.u.auctionId);
    const doctor=node("a","경매박사 ↗");doctor.href=link.href+"&panel=doctor";doctor.target="_blank";doctor.rel="noopener";
    const line=node("p");line.append(link);
    if(!hostedArchive)line.append(document.createTextNode(" · "),doctor);
    d.append(line);
  }
  const work=node("a","이 물건의 대응실 ↗");
  work.href="/auction-public/auction/workbench?property="+encodeURIComponent(workId);
  if(!hostedArchive){const workLine=node("p");workLine.append(work);d.append(workLine);}
  d.hidden=false;
  updateList();
  if (map && option.g.point) {
    map.flyTo({center:option.u.point||option.g.point,zoom:option.u.status==="지역"?14.5:16.9,pitch:show3d?54:0,
      speed:1.7,duration:reduceMotion?0:850});
  }
}
function fit(pts,zoom=12) {
  if (!map||!pts.length) return;
  if(kakaoView){
    const bounds=new kakaoSdk.LatLngBounds();
    for(const point of pts)bounds.extend(kakaoPoint(point));
    const instance=kakaoView.instance;
    instance.setBounds(bounds,55,35,55,35);
    if(instance.getLevel()<kakaoLevel(zoom))instance.setLevel(kakaoLevel(zoom));
    refreshMarkers();
    return;
  }
  const bounds = new maplibregl.LngLatBounds();
  for (const p of pts) bounds.extend(p);
  map.fitBounds(bounds,{padding:{top:76,bottom:65,left:42,right:42},maxZoom:zoom,duration:reduceMotion?0:600,pitch:0,bearing:0});
}
function activeGroups() {
  const ids=new Set(filtered().map(r=>r.n));
  return groups.filter(g=>g.point).map(g=>({g,u:g.units.filter(u=>ids.has(u.n))})).filter(o=>o.u.length);
}
function refreshMarkers() {
  if (!loaded) return;
  for (const m of markers) m.remove();
  markers=[];
  const items=activeGroups();
  const clustered=map.getZoom()<11.25;
  function marker(p, el, offset=[0,0]) {
    if(kakaoView){
      el.style.transform="translate("+offset[0]+"px,"+offset[1]+"px)";
      const overlay=new kakaoSdk.CustomOverlay({map:kakaoView.instance,position:kakaoPoint(p),content:el,
        xAnchor:0.5,yAnchor:1,clickable:true});
      markers.push({remove:()=>overlay.setMap(null)});
    }else{
      markers.push(new maplibregl.Marker({element:el,anchor:"bottom",pitchAlignment:"viewport",offset}).setLngLat(p).addTo(map));
    }
  }
  if (clustered) {
    const labels=[];
    const area=o=>{
      const name=o.g.region.split(" ")[0];
      return {서울시:"서울",화성:"동탄",평택시:"평택",정관:"부산"}[name]||name;
    };
    for (const region of [...new Set(items.map(area))]) {
      const local=items.filter(o=>area(o)===region);
      const ids=new Set(local.flatMap(o=>o.u.map(u=>u.n)));
      const center=[0,1].map(i=>local.reduce((sum,o)=>sum+o.g.point[i],0)/local.length);
      const screen=map.project(center);
      let dy=0;
      while(labels.some(p=>Math.abs(p.x-screen.x)<91&&Math.abs(p.y-screen.y-dy)<35)) dy+=35;
      labels.push({x:screen.x,y:screen.y+dy});
      marker(center,button(region+" · "+totalUnits(records.filter(record=>ids.has(record.n)))+"건",()=>{
        focusedUnits=ids;
        selected=null;activeGroup=null;$("detail").hidden=true;
        updateList();$("list").scrollTop=0;
        fit(local.map(o=>o.g.point),13);
      },"pin cluster"),[0,dy]);
    }
    return;
  }
  const placed=[];
  const ordered=items.sort((a,b)=>Number(b.g===activeGroup)-Number(a.g===activeGroup)
    ||Number(b.u.some(u=>u.status==="확인"))-Number(a.u.some(u=>u.status==="확인")));
  for (const {g,u} of ordered) {
    const current=g===activeGroup;
    const selectedUnit=current ? u.find(x=>x.n===selected?.n):null;
    const p=selectedUnit?.point||g.point;
    const screen=map.project(p);
    const state=selectedUnit?.status|| (u.some(x=>x.status==="확인")?"확인":u[0].status);
    const pyeongs=[...new Set(u.map(x=>x.pyeong).filter(x=>x!==null))].sort((a,b)=>a-b);
    const areaText=publicMap?totalUnits(u)+"건":selectedUnit?format(selectedUnit.pyeong):(pyeongs.length?pyeongs.join("·")+"평":"평수 미기재");
    const name=g.name.length>17?g.name.slice(0,16)+"…":g.name;
    const width= Math.min(220,35+name.length*12+areaText.length*8);
    let offset=0;
    while(placed.some(x=>Math.abs(x.x-screen.x)<(width+x.w)/2&&Math.abs(x.y-screen.y-offset)<29))offset+=30;
    placed.push({x:screen.x,y:screen.y+offset,w:width});
    const el=button(name,()=>{
      const choice=selectedUnit||u.find(x=>x.status==="확인")||u[0];
      const record=records.find(x=>x.n===choice.n);
      focusedUnits=new Set(u.map(unit=>unit.n));
      select(record,record.options.find(o=>o.g.id===g.id));
      $("list").scrollTop=0;
    },"pin"+(current?" current":""));
    el.dataset.state=state;
    el.setAttribute("aria-label",g.name+" "+areaText+" "+stateLabel(state));
    el.append(node("b",!publicMap&&u.length>1?u.length+"건":areaText));
    marker(p,el,[0,offset]);
  }
}
const allPoints=()=>groups.flatMap(g=>g.point?[g.point]:[]);

function setMapType(type){
  mapType=type;
  for(const id of ["road","sky"])$(id).setAttribute("aria-pressed",String(id===type));
  if(!loaded)return;
  if(kakaoView){
    kakaoView.instance.setMapTypeId(type==="road"?kakaoSdk.MapTypeId.ROADMAP:kakaoSdk.MapTypeId.HYBRID);
  }else{
    map.setLayoutProperty("road","visibility",type==="road"?"visible":"none");
    map.setLayoutProperty("satellite","visibility",type==="sky"?"visible":"none");
  }
  reportMapProvider();
}

function reportMapProvider(){
  $("mapProvider").textContent=kakaoView?(mapType==="sky"?"· 카카오 스카이뷰":"· 카카오맵 일반지도")
    :show3d?"· V월드 3D":"· 카카오맵 연결 대기";
}

function clearMap(){
  for(const marker of markers)marker.remove();
  markers=[];
  if(kakaoView){
    kakaoView.resize.disconnect();kakaoView.images?.abort();kakaoView=null;
  }else if(map){
    map.remove();
  }
  map=null;loaded=false;firstTiles=false;
  $("perspective").disabled=true;
  $("map").replaceChildren();
  $("mapProvider").textContent="";
  status.textContent="지도 불러오는 중";status.hidden=false;
}

function openMap(view){
  if(kakaoSdk&&!show3d){
    try{
      const center=view?.center||[127.6,36.3];
      const instance=new kakaoSdk.Map($("map"),{center:kakaoPoint(center),level:kakaoLevel(view?.zoom??7),
        mapTypeId:mapType==="sky"?kakaoSdk.MapTypeId.HYBRID:kakaoSdk.MapTypeId.ROADMAP});
      instance.addControl(new kakaoSdk.ZoomControl(),kakaoSdk.ControlPosition.TOPRIGHT);
      const resize=new ResizeObserver(()=>{instance.relayout();refreshMarkers();});
      resize.observe($("map"));
      kakaoView={instance,resize};
      map={
        getZoom:()=>19-instance.getLevel(),
        getCenter:()=>{const p=instance.getCenter();return {lng:p.getLng(),lat:p.getLat()};},
        project:point=>instance.getProjection().containerPointFromCoords(kakaoPoint(point)),
        flyTo:({center,zoom})=>{
          const focus=kakaoPoint(center);
          instance.setCenter(focus);instance.setLevel(kakaoLevel(zoom),{anchor:focus});
        }
      };
      kakaoSdk.event.addListener(instance,"idle",()=>{if(kakaoView?.instance===instance)refreshMarkers();});
      const markTilesReady=()=>{
        if(kakaoView?.instance!==instance)return;
        firstTiles=true;status.hidden=true;
      };
      kakaoSdk.event.addListener(instance,"tilesloaded",markTilesReady);
      $("map").addEventListener("load",event=>{
        const tile=event.target;
        if(tile instanceof HTMLImageElement&&tile.naturalWidth>=128)markTilesReady();
      },{capture:true,signal:(kakaoView.images=new AbortController()).signal});
      if([...$("map").querySelectorAll("img")].some(img=>img.naturalWidth>=128))markTilesReady();
      reportMapProvider();
      loaded=true;
      $("perspective").disabled=hostedArchive;
      if(view)refreshMarkers();else fit(allPoints());
      window.propertyMap=map;
      return;
    }catch(e){
      clearMap();kakaoSdk=null;
    }
  }
  if(!show3d){
    reportMapProvider();
    const retry=button("카카오맵 다시 연결",()=>connectMap(view));
    status.replaceChildren(node("span","카카오맵에 연결하지 못했습니다. 물건 목록은 열람할 수 있습니다. "),retry);
    return;
  }
  map=new maplibregl.Map({container:"map",style,center:view?.center||[127.6,36.3],zoom:view?.zoom??7,
    pitch:show3d&&(view?.zoom??0)>=14?54:0,maxPitch:66,minZoom:5,maxZoom:19.5,attributionControl:false,
    canvasContextAttributes:{antialias:true}});
  map.addControl(new maplibregl.AttributionControl({compact:true}),"bottom-right");
  map.addControl(new maplibregl.NavigationControl({visualizePitch:true}),"top-right");
  map.addControl(new maplibregl.ScaleControl({unit:"metric"}),"bottom-right");
  map.on("load",()=>{
    loaded=true;
    $("perspective").disabled=hostedArchive;
    setMapType(mapType);
    for(const id of ["buildings","building-footprint"])map.setLayoutProperty(id,"visibility",show3d?"visible":"none");
    if(!view)fit(allPoints());
    refreshMarkers();
  });
  map.on("moveend",refreshMarkers);
  map.on("resize",refreshMarkers);
  map.on("sourcedata",e=>{
    if((e.sourceId==="satellite"||e.sourceId==="road")&&e.tile?.state==="loaded"){
      firstTiles=true;status.hidden=true;
    }
  });
  map.on("error",e=>{
    if(!firstTiles&&["satellite","road"].includes(e.sourceId))
      status.textContent="지도에 연결하지 못했습니다. 목록에서 물건을 찾을 수 있습니다.";
  });
  window.propertyMap=map;
}

async function connectMap(view){
  status.textContent="카카오맵 불러오는 중";status.hidden=false;
  try{kakaoSdk=await loadKakaoSdk();}catch(e){kakaoSdk=null;}
  openMap(view);
}

async function init() {
  try {
    const response=await fetch("/auction-public/archive/holdings.json");
    if (!response.ok) throw new Error("locations");
    const portfolio=await response.json();
    groups=portfolio.groups;
    $("portfolioTotal").replaceChildren(document.createTextNode(String(portfolio.total)),node("span","건"));
    $("portfolioCoverage").replaceChildren(document.createTextNode("지도 "+portfolio.mapped+"건 · 좌표 미확인 "+(portfolio.total-portfolio.mapped)+"건"),node("br"),document.createTextNode("자료 기준 2026.11.06"));
    const byNumber=new Map();
    for (const g of groups) for (const u of g.units) {
      if (!byNumber.has(u.n)) byNumber.set(u.n,{...u,options:[]});
      const record=byNumber.get(u.n);
      record.options.push({g,u});
      if (u.status==="확인") record.status="확인";
    }
    records=[...byNumber.values()].sort((a,b)=>String(a.n).localeCompare(String(b.n),"ko",{numeric:true}));
    for(const r of records) r.options.sort((a,b)=>Number(b.u.status==="확인")-Number(a.u.status==="확인"));
    for(const region of [...new Set(groups.map(g=>g.region))].sort((a,b)=>a.localeCompare(b,"ko"))) $("region").append(node("option",region));
    for(const kind of [...new Set(records.map(r=>r.kind).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"ko"))) $("kind").append(node("option",kind));
    const filterIds = ["query","region","kind","certainty","case-link"];
    for (const id of filterIds) $(id).addEventListener(id==="query"?"input":"change",()=>{
      focusedUnits=null;
      if(id==="case-link"){selected=null;activeGroup=null;$("detail").hidden=true;}
      updateList();
      if (id!=="query") fit(activeGroups().map(o=>o.g.point),13);
    });
    updateList();
    $("overview").onclick=()=>{
      for(const id of filterIds) $(id).value="";
      selected=null;activeGroup=null;focusedUnits=null;$("detail").hidden=true;
      updateList();fit(allPoints());
    };
    $("road").onclick=()=>setMapType("road");
    $("sky").onclick=()=>setMapType("sky");
    $("perspective").onclick=()=>{
      if(!loaded)return;
      const center=map.getCenter(), view={center:[center.lng,center.lat],zoom:map.getZoom()};
      show3d=!show3d;
      $("perspective").setAttribute("aria-pressed",String(show3d));
      clearMap();
      if(show3d)openMap(view);else connectMap(view);
    };
    await connectMap();
  } catch(e) {
    status.hidden=false;
    status.textContent="전국 원장을 불러오지 못했습니다. 서버를 확인한 후 다시 열어 주세요.";
    $("portfolioCoverage").textContent="원장 연결 실패";
    console.error(e);
  }
}
init();

