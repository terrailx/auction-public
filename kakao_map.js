"use strict";
let kakaoSdkRequest;
function loadKakaoSdk(){
  kakaoSdkRequest??=requestKakaoSdk().then(sdk=>{
    if(!sdk)kakaoSdkRequest=null;
    return sdk;
  },error=>{kakaoSdkRequest=null;throw error;});
  return kakaoSdkRequest;
}

async function requestKakaoSdk(){
  const response=await fetch("/auction-public/archive/map-config.json");
  if(!response.ok)return null;
  const {kakaoJavascriptKey}=await response.json();
  if(!kakaoJavascriptKey)return null;
  return new Promise(resolve=>{
    const script=document.createElement("script");
    const timeout=setTimeout(()=>{script.remove();resolve(null);},6500);
    const finish=sdk=>{clearTimeout(timeout);resolve(sdk);};
    script.src="https://dapi.kakao.com/v2/maps/sdk.js?autoload=false&appkey="+encodeURIComponent(kakaoJavascriptKey);
    script.onload=()=>window.kakao?.maps?.load
      ?window.kakao.maps.load(()=>finish(window.kakao.maps)):finish(null);
    script.onerror=()=>finish(null);
    document.head.append(script);
  });
}

