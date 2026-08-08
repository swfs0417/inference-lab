const defaults = {enabled: true, backendUrl: 'http://127.0.0.1:8080', modelLabel: 'GPT Edu', completionQuietMs: 1800};
const ids = ['enabled', 'backendUrl', 'modelLabel', 'completionQuietMs'];
const $ = id => document.getElementById(id);
const fmt = (value, suffix = 'ms') => value == null ? '—' : `${Number(value).toLocaleString(undefined, {maximumFractionDigits: 1})}${suffix}`;

function normalizeBackendUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('대시보드 주소는 http 또는 https여야 합니다.');
  return url.origin;
}

function setDashboardUrl(backendUrl) {
  $('dashboard').href = normalizeBackendUrl(backendUrl) + '/';
}

function addMetric(parent, label, value) {
  const item = document.createElement('div');
  item.className = 'metric';
  const name = document.createElement('span');
  name.textContent = label;
  const amount = document.createElement('strong');
  amount.textContent = value;
  item.append(name, amount);
  parent.append(item);
}

function renderRuns(runs) {
  const container = $('runs');
  container.replaceChildren();
  if (!runs.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = '저장된 실험 결과가 없습니다.';
    container.append(empty);
    return;
  }
  runs.slice(0, 8).forEach(run => {
    const card = document.createElement('article');
    card.className = 'run';
    const head = document.createElement('div');
    head.className = 'run-head';
    const model = document.createElement('b');
    model.textContent = run.model || '모델 미지정';
    const time = document.createElement('time');
    time.textContent = run.created_at || '';
    head.append(model, time);
    const source = document.createElement('div');
    source.className = 'source';
    source.textContent = run.source === 'gpt-edu-browser-e2e' ? 'Browser E2E' : run.source || 'API';
    const metrics = document.createElement('div');
    metrics.className = 'metrics';
    const summary = run.summary || {};
    addMetric(metrics, '성공', `${summary.successes ?? 0}/${summary.requests ?? 0}`);
    addMetric(metrics, 'TTFT 평균', fmt(summary.ttft_mean_ms));
    addMetric(metrics, 'TTFT p95', fmt(summary.ttft_p95_ms));
    addMetric(metrics, '총시간 평균', fmt(summary.total_mean_ms));
    addMetric(metrics, '출력 TPS', fmt(summary.output_tps_mean, ''));
    card.append(head, source, metrics);
    container.append(card);
  });
}

async function loadRuns() {
  const {backendUrl} = await chrome.storage.local.get(defaults);
  try {
    const baseUrl = normalizeBackendUrl(backendUrl);
    setDashboardUrl(baseUrl);
    const response = await fetch(baseUrl + '/api/runs');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    renderRuns(data.runs || []);
  } catch (error) {
    const container = $('runs');
    container.replaceChildren();
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = `대시보드 연결 실패: ${error.message}`;
    container.append(empty);
  }
}

async function load() {
  const data = await chrome.storage.local.get({...defaults, lastMeasurement: null, lastSavedAt: null, lastError: null});
  ids.forEach(id => $(id)[id === 'enabled' ? 'checked' : 'value'] = data[id]);
  if (data.lastError) $('status').textContent = `최근 저장 오류: ${data.lastError}`;
  else if (data.lastMeasurement) $('status').textContent = `최근 측정 · TTFT ${fmt(data.lastMeasurement.ttft_ms)} · 전체 ${fmt(data.lastMeasurement.total_ms)}`;
  await loadRuns();
}

$('save').onclick = async () => {
  try {
    const settings = {
      enabled: $('enabled').checked,
      backendUrl: normalizeBackendUrl($('backendUrl').value.trim()),
      modelLabel: $('modelLabel').value.trim(),
      completionQuietMs: Math.max(800, Number($('completionQuietMs').value) || defaults.completionQuietMs)
    };
    await chrome.storage.local.set(settings);
    $('backendUrl').value = settings.backendUrl;
    $('completionQuietMs').value = settings.completionQuietMs;
    $('status').textContent = '설정을 저장했습니다. ChatGPT 탭을 새로고침하세요.';
    await loadRuns();
  } catch (error) {
    $('status').textContent = `설정 오류: ${error.message}`;
  }
};

$('refresh').onclick = loadRuns;
load();
