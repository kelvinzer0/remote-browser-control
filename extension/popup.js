document.addEventListener('DOMContentLoaded', async () => {
  const dot = document.getElementById('dot');
  const statusText = document.getElementById('statusText');
  const urlEl = document.getElementById('url');

  try {
    const resp = await chrome.runtime.sendMessage({ type: 'getId' });
    const isConnected = resp?.connected || false;

    dot.className = isConnected ? 'dot on' : 'dot off';
    statusText.textContent = isConnected ? 'Connected to host' : 'Disconnected';
  } catch {
    dot.className = 'dot off';
    statusText.textContent = 'Extension error';
  }

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) urlEl.textContent = tab.url;
  } catch {}
});
