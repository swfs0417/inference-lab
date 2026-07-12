(() => {
  if (window.__gptEduTimerLoaded) return;
  window.__gptEduTimerLoaded = true;

  const state = {
    enabled: true,
    quietMs: 1800,
    pending: null,
    observer: null,
    settleTimer: null,
    badge: null
  };

  const assistantNodes = () => [...document.querySelectorAll(
    '[data-message-author-role="assistant"], article[data-turn="assistant"], [data-testid^="conversation-turn-"] [data-message-author-role="assistant"]'
  )];

  function responseText(node) {
    if (!node) return '';
    const markdown = node.querySelector('.markdown, [class*="markdown"], [data-message-author-role="assistant"]');
    return (markdown || node).innerText?.trim() || '';
  }

  function stopButtonVisible() {
    return Boolean(document.querySelector(
      'button[data-testid="stop-button"], button[aria-label*="Stop" i], button[aria-label*="중지"], button svg[data-icon="stop"]'
    ));
  }

  function ensureBadge() {
    if (state.badge?.isConnected) return state.badge;
    const badge = document.createElement('div');
    badge.id = 'gpt-edu-response-timer-badge';
    Object.assign(badge.style, {
      position: 'fixed', right: '14px', bottom: '14px', zIndex: '2147483647',
      padding: '7px 10px', borderRadius: '999px', background: '#17352e', color: 'white',
      font: '11px ui-monospace, monospace', boxShadow: '0 4px 16px #0003', pointerEvents: 'none'
    });
    badge.textContent = 'EDU TIMER · READY';
    document.documentElement.appendChild(badge);
    state.badge = badge;
    return badge;
  }

  function badge(text, error = false) {
    const el = ensureBadge();
    el.textContent = `EDU TIMER · ${text}`;
    el.style.background = error ? '#9c3d32' : '#17352e';
  }

  function beginMeasurement() {
    if (!state.enabled || state.pending) return;
    state.pending = {
      startedPerf: performance.now(),
      startedEpoch: Date.now(),
      assistantCountAtStart: assistantNodes().length,
      firstVisiblePerf: null,
      responseNode: null,
      lastText: '',
      lastChangePerf: null
    };
    badge('WAITING');
    watch();
  }

  function findNewResponse() {
    if (!state.pending) return null;
    const nodes = assistantNodes();
    if (nodes.length > state.pending.assistantCountAtStart) return nodes[nodes.length - 1];
    return null;
  }

  function inspect() {
    const p = state.pending;
    if (!p) return;
    const node = p.responseNode || findNewResponse();
    const text = responseText(node);
    if (text && !p.firstVisiblePerf) {
      p.responseNode = node;
      p.firstVisiblePerf = performance.now();
      p.lastChangePerf = p.firstVisiblePerf;
      badge(`TTFT ${Math.round(p.firstVisiblePerf - p.startedPerf)}ms`);
    }
    if (!p.firstVisiblePerf) return;
    if (text !== p.lastText) {
      p.lastText = text;
      p.lastChangePerf = performance.now();
    }
    clearTimeout(state.settleTimer);
    state.settleTimer = setTimeout(() => {
      if (!state.pending || stopButtonVisible()) {
        inspect();
        return;
      }
      if (performance.now() - state.pending.lastChangePerf >= state.quietMs) finishMeasurement();
      else inspect();
    }, state.quietMs + 100);
  }

  function watch() {
    state.observer?.disconnect();
    state.observer = new MutationObserver(inspect);
    state.observer.observe(document.body, {subtree: true, childList: true, characterData: true});
    inspect();
  }

  function finishMeasurement() {
    const p = state.pending;
    if (!p?.firstVisiblePerf) return;
    const ended = performance.now();
    const chars = p.lastText.length;
    const estimatedTokens = chars ? Math.max(1, Math.round(chars / 3.5)) : 0;
    const generationMs = ended - p.firstVisiblePerf;
    const sample = {
      sequence: 1,
      measured_at: new Date(p.startedEpoch).toISOString(),
      ttft_ms: Number((p.firstVisiblePerf - p.startedPerf).toFixed(2)),
      total_ms: Number((ended - p.startedPerf).toFixed(2)),
      generation_ms: Number(generationMs.toFixed(2)),
      response_chars: chars,
      output_tokens: estimatedTokens,
      output_tokens_per_sec: generationMs > 0 ? Number((estimatedTokens / (generationMs / 1000)).toFixed(2)) : null,
      error: null
    };
    state.observer?.disconnect();
    clearTimeout(state.settleTimer);
    state.pending = null;
    badge('SAVING');
    chrome.runtime.sendMessage({type: 'SAVE_MEASUREMENT', sample, pageHost: location.host}, (result) => {
      if (chrome.runtime.lastError || !result?.ok) badge('SAVE ERROR', true);
      else badge(`SAVED · ${Math.round(sample.total_ms)}ms`);
      setTimeout(() => badge('READY'), 5000);
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    const composer = event.target.closest?.('textarea, [contenteditable="true"]');
    if (!composer) return;
    setTimeout(beginMeasurement, 0);
  }, true);

  document.addEventListener('click', (event) => {
    const button = event.target.closest?.('button');
    if (!button) return;
    const looksLikeSend = button.matches('[data-testid="send-button"]') ||
      /send|전송/i.test(button.getAttribute('aria-label') || '');
    if (looksLikeSend) setTimeout(beginMeasurement, 0);
  }, true);

  chrome.storage.local.get({enabled: true, completionQuietMs: 1800}, config => {
    state.enabled = config.enabled;
    state.quietMs = Math.max(800, Number(config.completionQuietMs) || 1800);
    if (state.enabled) ensureBadge();
  });

  chrome.storage.onChanged.addListener(changes => {
    if (changes.enabled) state.enabled = changes.enabled.newValue;
    if (changes.completionQuietMs) state.quietMs = Math.max(800, Number(changes.completionQuietMs.newValue) || 1800);
    if (state.enabled) badge('READY'); else state.badge?.remove();
  });
})();
