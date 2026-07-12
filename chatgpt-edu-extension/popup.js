const defaults={enabled:true,backendUrl:'http://127.0.0.1:8080',modelLabel:'GPT Edu',completionQuietMs:1800};
const ids=['enabled','backendUrl','modelLabel','completionQuietMs'];

async function load(){
  const data=await chrome.storage.local.get({...defaults,lastMeasurement:null,lastSavedAt:null,lastError:null});
  ids.forEach(id=>document.getElementById(id)[id==='enabled'?'checked':'value']=data[id]);
  const status=document.getElementById('status');
  if(data.lastError) status.textContent=`최근 저장 오류: ${data.lastError}`;
  else if(data.lastMeasurement) status.innerHTML=`최근 측정<br>TTFT ${Math.round(data.lastMeasurement.ttft_ms)}ms · 전체 ${Math.round(data.lastMeasurement.total_ms)}ms`;
}

document.getElementById('save').onclick=async()=>{
  await chrome.storage.local.set({
    enabled:document.getElementById('enabled').checked,
    backendUrl:document.getElementById('backendUrl').value.trim(),
    modelLabel:document.getElementById('modelLabel').value.trim(),
    completionQuietMs:Number(document.getElementById('completionQuietMs').value)
  });
  document.getElementById('status').textContent='설정을 저장했습니다. ChatGPT 탭을 새로고침하세요.';
};
load();
