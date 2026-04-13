document.addEventListener('DOMContentLoaded', async () => {
  const dot = document.getElementById('dot');
  const statusText = document.getElementById('statusText');
  const extIdEl = document.getElementById('extId');
  const urlEl = document.getElementById('url');
  const copyBtn = document.getElementById('copyBtn');
  const relayUrlInput = document.getElementById('relayUrl');
  const saveBtn = document.getElementById('saveBtn');
  const hintEl = document.getElementById('hint');

  let extId = null;
  let isConnected = false;
  let relayUrl = '';

  try {
    // Get from background
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'getId' });
      if (resp?.extId) {
        extId = resp.extId;
        isConnected = resp.connected;
        relayUrl = resp.relayUrl || '';
      }
    } catch {}

    // Fallback to storage
    if (!extId) {
      const data = await chrome.storage.local.get(['extId', 'connected', 'relayUrl']);
      if (data.extId) {
        extId = data.extId;
        isConnected = data.connected;
        relayUrl = data.relayUrl || '';
      }
    }

    if (extId) {
      extIdEl.textContent = extId;
    } else {
      extIdEl.textContent = 'Loading...';
      setTimeout(async () => {
        const data = await chrome.storage.local.get(['extId', 'connected', 'relayUrl']);
        if (data.extId) {
          extIdEl.textContent = data.extId;
          isConnected = data.connected;
          relayUrl = data.relayUrl || '';
          relayUrlInput.value = relayUrl;
          dot.className = isConnected ? 'dot on' : 'dot off';
          statusText.textContent = isConnected ? 'Connected (CF Workers)' : 'Disconnected';
        }
      }, 1000);
    }

    // Set relay URL input
    relayUrlInput.value = relayUrl;

    // Status
    dot.className = isConnected ? 'dot on' : 'dot off';
    statusText.textContent = isConnected ? 'Connected (CF Workers)' : 'Disconnected';
  } catch (e) {
    dot.className = 'dot off';
    statusText.textContent = 'Error: ' + e.message;
  }

  // Active tab URL
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) urlEl.textContent = tab.url;
  } catch {}

  // Copy button
  copyBtn.addEventListener('click', () => {
    const text = extIdEl.textContent;
    if (text && text !== 'Loading...') {
      navigator.clipboard.writeText(text);
      copyBtn.textContent = '✅ Copied!';
      setTimeout(() => copyBtn.textContent = '📋 Copy Extension ID', 2000);
    }
  });

  // Save relay URL
  saveBtn.addEventListener('click', async () => {
    const newUrl = relayUrlInput.value.trim();
    if (!newUrl) {
      hintEl.textContent = '⚠️ URL cannot be empty';
      return;
    }
    try {
      await chrome.runtime.sendMessage({ type: 'setRelayUrl', url: newUrl });
      hintEl.textContent = '✅ Saved! Reconnecting...';
      setTimeout(() => { hintEl.textContent = ''; }, 3000);
    } catch (e) {
      hintEl.textContent = '❌ ' + e.message;
    }
  });
});
