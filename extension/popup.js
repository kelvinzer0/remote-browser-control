document.addEventListener('DOMContentLoaded', async () => {
  const dot = document.getElementById('dot');
  const statusText = document.getElementById('statusText');
  const extIdEl = document.getElementById('extId');
  const urlEl = document.getElementById('url');
  const copyBtn = document.getElementById('copyBtn');
  const topicsEl = document.getElementById('topics');

  let extId = null;
  let isConnected = false;

  try {
    // Method 1: ask background directly
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'getId' });
      if (resp?.extId) {
        extId = resp.extId;
        isConnected = resp.connected;
      }
    } catch {}

    // Method 2: fallback to storage
    if (!extId) {
      const data = await chrome.storage.local.get(['extId', 'connected']);
      if (data.extId) {
        extId = data.extId;
        isConnected = data.connected;
      }
    }

    if (extId) {
      extIdEl.textContent = extId;
      topicsEl.textContent = 'rbc/' + extId + '/cmd';
    } else {
      extIdEl.textContent = 'Loading...';
      // Retry once after a short delay (service worker might still be initializing)
      setTimeout(async () => {
        const data = await chrome.storage.local.get(['extId', 'connected']);
        if (data.extId) {
          extIdEl.textContent = data.extId;
          topicsEl.textContent = 'rbc/' + data.extId + '/cmd';
          if (data.connected) {
            dot.className = 'dot on';
            statusText.textContent = 'Connected to MQTT';
          }
        }
      }, 1000);
    }

    // Status dot
    dot.className = isConnected ? 'dot on' : 'dot off';
    statusText.textContent = isConnected ? 'Connected to MQTT' : 'Disconnected';
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
});
