document.addEventListener('DOMContentLoaded', async () => {
  const dot = document.getElementById('dot');
  const statusText = document.getElementById('statusText');
  const extIdEl = document.getElementById('extId');
  const urlEl = document.getElementById('url');
  const copyBtn = document.getElementById('copyBtn');
  const topicsEl = document.getElementById('topics');

  // Read from background (it stores extensionId in a global)
  try {
    // Get the background service worker's context
    const bg = await chrome.runtime.getBackgroundPage?.();

    // Try to read extension ID from storage or background
    const data = await chrome.storage.local.get(['extId', 'connected']);

    // If not in storage, get from the background's global EXT_ID
    let extId = data.extId;
    if (!extId) {
      // Ask background directly
      try {
        const resp = await chrome.runtime.sendMessage({ type: 'getId' });
        extId = resp?.extId;
      } catch {}
    }

    if (extId) {
      extIdEl.textContent = extId;
      topicsEl.textContent = `rbc/${extId}/cmd`;
    }

    // Status
    if (data.connected) {
      dot.className = 'dot on';
      statusText.textContent = 'Connected to MQTT';
    } else {
      dot.className = 'dot off';
      statusText.textContent = 'Disconnected';
    }
  } catch (e) {
    dot.className = 'dot off';
    statusText.textContent = 'Error';
    extIdEl.textContent = '—';
  }

  // Active tab URL
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) urlEl.textContent = tab.url;
  } catch {}

  // Copy
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(extIdEl.textContent);
    copyBtn.textContent = '✅ Copied!';
    setTimeout(() => copyBtn.textContent = '📋 Copy Extension ID', 2000);
  });
});
