const $ = (selector) => document.querySelector(selector);
const fmt = (v, suffix = ' ms') => v == null ? '—' : Number(v).toLocaleString(undefined, {maximumFractionDigits: 2}) + suffix;

function toast(message, error = false) {
  const el = $('#toast'); el.textContent = message; el.className = error ? 'show error' : 'show';
  setTimeout(() => el.className = '', 4000);
}

async function jsonFetch(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function fileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1]);
    reader.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
    reader.readAsDataURL(file);
  });
}

function gpuPeak(run) {
  const values = (run.gpu || []).flatMap(s => (s.gpus || []).map(g => g.gpu_util_pct));
  return values.length ? Math.max(...values) : null;
}

function renderMetrics(run) {
  if (!run) { $('#metrics').innerHTML = ''; $('#details').innerHTML = ''; renderOutputs(null); return; }
  const s = run.summary, g = s.gpu || {};
  $('#metrics').innerHTML = [
    ['TTFT p50', fmt(s.ttft_p50_ms)], ['TTFT p95', fmt(s.ttft_p95_ms)],
    ['완료 p95', fmt(s.total_p95_ms)], ['출력 속도', fmt(s.output_tps_mean, ' tok/s')],
    ['ITL p95', fmt(s.itl_p95_ms)], ['GPU 평균 / 최고', g.available ? `${fmt(g.gpu_util_mean_pct,'%')} / ${fmt(g.gpu_util_peak_pct,'%')}` : '—'],
    ['VRAM 최고', g.available ? fmt(g.memory_peak_mb,' MB') : '—'], ['에너지', g.available ? fmt(g.energy_wh,' Wh') : '—'],
    ['성공률', `${s.successes}/${s.requests}`], ['조건', run.settings?.condition || '—']
  ].map(([k,v]) => `<article><span>${k}</span><strong>${v}</strong></article>`).join('');
  const env=run.settings?.environment||{};
  $('#details').innerHTML=`<h3>상세 측정</h3><div class="detail-grid">
    <div><span>ITL 평균 / p99 / 최대</span><b>${fmt(s.itl_mean_ms)} / ${fmt(s.itl_p99_ms)} / ${fmt(s.itl_max_ms)}</b></div>
    <div><span>입력 / 출력 토큰 평균</span><b>${fmt(s.prompt_tokens_mean,'')} / ${fmt(s.output_tokens_mean,'')}</b></div>
    <div><span>GPU 전력 평균 / 최고</span><b>${g.available?`${fmt(g.power_mean_w,' W')} / ${fmt(g.power_peak_w,' W')}`:'—'}</b></div>
    <div><span>토큰당 에너지</span><b>${s.energy_per_output_token_wh==null?'—':s.energy_per_output_token_wh+' Wh/token'}</b></div>
    <div><span>환경</span><b>${env.gpus?.[0]?.name||'외부/브라우저'} · ${env.os||'환경정보 없음'}</b></div>
    <div><span>워밍업</span><b>${run.settings?.warmup_iterations||0}회 · 측정 ${s.requests}회</b></div>
  </div>`;
  renderOutputs(run);
}

function renderOutputs(run) {
  const container = $('#outputs');
  container.replaceChildren();
  const samples = (run?.samples || []).filter(sample => sample.output_text);
  if (!samples.length) return;
  const title = document.createElement('h3'); title.textContent = '모델 응답'; container.append(title);
  samples.forEach(sample => {
    const article = document.createElement('details'), label = document.createElement('summary'), output = document.createElement('pre');
    label.textContent = `요청 ${sample.sequence} · ${fmt(sample.total_ms)} · ${(sample.response_chars ?? sample.output_text.length).toLocaleString()}자`;
    output.textContent = sample.output_text;
    article.append(label, output); container.append(article);
  });
}

function drawChart(run) {
  const canvas = $('#chart'), ctx = canvas.getContext('2d');
  const dpr = devicePixelRatio || 1, width = canvas.clientWidth, height = 280;
  canvas.width = width * dpr; canvas.height = height * dpr; ctx.scale(dpr,dpr); ctx.clearRect(0,0,width,height);
  const samples = run?.samples?.filter(s => !s.error) || [];
  if (!samples.length) return;
  const max = Math.max(...samples.map(s => s.total_ms), 1), left=48, right=20, top=25, bottom=35;
  ctx.font='12px ui-monospace, monospace'; ctx.fillStyle='#778079'; ctx.strokeStyle='#d9ddd8'; ctx.lineWidth=1;
  for(let i=0;i<=4;i++){ const y=top+(height-top-bottom)*i/4; ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(width-right,y);ctx.stroke();ctx.fillText(Math.round(max*(1-i/4))+'ms',2,y+4); }
  const group=(width-left-right)/samples.length;
  samples.forEach((s,i)=>{ const x=left+i*group+group*.18, w=group*.25; const totalH=(s.total_ms/max)*(height-top-bottom); const ttftH=((s.ttft_ms||0)/max)*(height-top-bottom);
    ctx.fillStyle='#1d3c34';ctx.fillRect(x,height-bottom-totalH,w,totalH);ctx.fillStyle='#d57742';ctx.fillRect(x+w+4,height-bottom-ttftH,w,ttftH);ctx.fillStyle='#66706a';ctx.fillText(String(s.sequence),x,height-12);
  });
  ctx.fillStyle='#1d3c34';ctx.fillRect(width-190,8,10,10);ctx.fillStyle='#4d5751';ctx.fillText('총 지연',width-174,17);ctx.fillStyle='#d57742';ctx.fillRect(width-100,8,10,10);ctx.fillStyle='#4d5751';ctx.fillText('TTFT',width-84,17);
}

async function load() {
  try {
    const [{runs}, health] = await Promise.all([jsonFetch('/api/runs'), jsonFetch('/api/health')]);
    $('#health').textContent = health.gpu.length ? `GPU ${health.gpu.length}개 연결` : '서버 연결 · GPU 없음';
    $('#health').classList.add('ok'); $('#empty').style.display = runs.length ? 'none' : 'block';
    $('#runs').innerHTML = runs.map(r => `<tr data-id="${r.id}"><td>${r.created_at}</td><td><b>${r.model||'—'}</b><small>${r.source}</small></td><td>${r.summary.successes}/${r.summary.requests}</td><td>${fmt(r.summary.ttft_mean_ms)}</td><td>${fmt(r.summary.ttft_p95_ms)}</td><td>${fmt(r.summary.total_mean_ms)}</td><td>${fmt(r.summary.output_tps_mean,'')}</td><td>${fmt(gpuPeak(r),'%')}</td></tr>`).join('');
    renderMetrics(runs[0]); drawChart(runs[0]);
    [...document.querySelectorAll('tbody tr')].forEach((tr,i)=>tr.onclick=()=>{renderMetrics(runs[i]);drawChart(runs[i]);});
  } catch(e) { $('#health').textContent='서버 오류'; toast(e.message,true); }
}

$('#benchmark-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const button=$('#run-button'); button.disabled=true; button.innerHTML='측정 중…';
  const payload=Object.fromEntries(new FormData(event.target));
  ['iterations','concurrency','warmup_iterations','max_tokens','temperature'].forEach(k=>payload[k]=Number(payload[k]));
  try { const run=await jsonFetch('/api/benchmark',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); toast('벤치마크가 완료되었습니다.'); await load(); renderMetrics(run); drawChart(run); }
  catch(e){toast(e.message,true)} finally {button.disabled=false;button.innerHTML='벤치마크 실행 <span>→</span>';}
});
let convertedMarkdown = null;
$('#pdf-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const file = event.target.elements.pdf.files[0], button = $('#convert-button');
  if (!file) return;
  button.disabled = true; button.innerHTML = '변환 중…';
  try {
    const result = await jsonFetch('/api/pdf-to-markdown', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({filename: file.name, data: await fileAsBase64(file)})
    });
    convertedMarkdown = result;
    $('#pdf-meta').textContent = `${result.pages}쪽 · ${result.characters.toLocaleString()}자 · ${fmt(result.elapsed_ms)}`;
    $('#markdown-preview').textContent = result.markdown.slice(0, 12000);
    $('#pdf-result').hidden = false;
    toast('Markdown 변환이 완료되었습니다.');
  } catch(e) { toast(e.message, true); }
  finally { button.disabled = false; button.innerHTML = 'Markdown 변환 <span>→</span>'; }
});
$('#download-md').onclick = () => {
  if (!convertedMarkdown) return;
  const url = URL.createObjectURL(new Blob([convertedMarkdown.markdown], {type: 'text/markdown;charset=utf-8'}));
  const link = document.createElement('a'); link.href = url; link.download = convertedMarkdown.filename; link.click();
  URL.revokeObjectURL(url);
};
$('#use-md').onclick = () => {
  if (!convertedMarkdown) return;
  const prompt = document.querySelector('[name="prompt"]');
  prompt.value = convertedMarkdown.markdown;
  prompt.focus(); prompt.scrollIntoView({behavior: 'smooth', block: 'center'});
  toast('변환 결과를 프롬프트에 넣었습니다.');
};
$('#refresh').onclick=load; addEventListener('resize',()=>load()); load();
