const DEFAULTS = {
  enabled: true,
  backendUrl: 'http://127.0.0.1:8080',
  modelLabel: 'GPT Edu',
  completionQuietMs: 1800
};

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(DEFAULTS);
  await chrome.storage.local.set(current);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== 'SAVE_MEASUREMENT') return;
  (async () => {
    const settings = await chrome.storage.local.get(DEFAULTS);
    const endpoint = settings.backendUrl.replace(/\/$/, '') + '/api/browser-measurement';
    const sample = message.sample;
    const payload = {
      model: settings.modelLabel || 'GPT Edu',
      settings: {
        measurement_scope: 'browser-e2e',
        page_host: message.pageHost,
        completion_detection: `quiet-${settings.completionQuietMs}ms`,
        output_tokens_are_estimated: true
      },
      samples: [sample]
    };
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    await chrome.storage.local.set({lastMeasurement: sample, lastSavedAt: new Date().toISOString(), lastError: null});
    sendResponse({ok: true, runId: data.id});
  })().catch(async (error) => {
    await chrome.storage.local.set({lastError: error.message});
    sendResponse({ok: false, error: error.message});
  });
  return true;
});
