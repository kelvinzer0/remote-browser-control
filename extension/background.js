/**
 * Background — Cloudflare Workers Relay Extension
 *
 * Replaces MQTT with WebSocket to CF Workers Durable Object.
 * Direct DOM commands, no LLM.
 */

// ── Config ──────────────────────────────────
// Set your Cloudflare Worker URL here or via extension options
const DEFAULT_RELAY_URL = 'https://rbc-relay.yourname.workers.dev';

let RELAY_URL = DEFAULT_RELAY_URL;
let EXT_ID = null;
let ws = null;
let connected = false;
let reconnectTimer = null;
let heartbeatTimer = null;

// ── Extension ID (persist across service worker restarts) ──
async function initExtId() {
  const data = await chrome.storage.local.get(['extId', 'relayUrl']);
  if (data.extId) {
    EXT_ID = data.extId;
  } else {
    EXT_ID = 'ext_' + Math.random().toString(36).substr(2, 8);
    await chrome.storage.local.set({ extId: EXT_ID });
  }
  if (data.relayUrl) {
    RELAY_URL = data.relayUrl;
  }
  return EXT_ID;
}

// ── WebSocket Connection ────────────────────
function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  const wsUrl = RELAY_URL.replace(/^http/, 'ws') + `/device/${EXT_ID}?role=ext`;
  console.log('[RBC] Connecting:', wsUrl);

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    connected = true;
    chrome.storage.local.set({ connected: true });
    console.log('[RBC] Connected:', EXT_ID);

    // Send initial status
    sendStatus();

    // Start heartbeat
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(sendHeartbeat, 30000);
  };

  ws.onmessage = async (event) => {
    try {
      const msg = JSON.parse(event.data);
      console.log('[RBC] CMD:', msg.action, JSON.stringify(msg.params || {}).slice(0, 100));

      if (msg.type === 'command') {
        const result = await exec(msg);
        console.log('[RBC] Result:', JSON.stringify(result).slice(0, 200));
        send({ type: 'result', commandId: msg.commandId, ...result });
      }
    } catch (e) {
      console.error('[RBC] Error:', e.message);
      try {
        send({ type: 'result', commandId: msg?.commandId, ok: false, error: e.message });
      } catch {}
    }
  };

  ws.onclose = () => {
    connected = false;
    chrome.storage.local.set({ connected: false });
    ws = null;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    console.log('[RBC] Disconnected');

    // Reconnect after 3s
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 3000);
  };

  ws.onerror = (err) => {
    console.error('[RBC] WS Error:', err.message || 'connection error');
  };
}

function send(data) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

async function sendStatus() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabs = await chrome.tabs.query({});
    send({
      type: 'status',
      status: 'online',
      extId: EXT_ID,
      url: tab?.url || '',
      title: tab?.title || '',
      tabs: tabs.length,
      ts: Date.now(),
    });
  } catch {
    send({ type: 'status', status: 'online', extId: EXT_ID, ts: Date.now() });
  }
}

function sendHeartbeat() {
  send({ type: 'heartbeat', extId: EXT_ID, ts: Date.now() });
}

// ── Command Executor (same logic as original) ──
async function exec(msg) {
  const { action, params = {} } = msg;

  // Get active tab
  let tab;
  if (params.tabId) {
    tab = await chrome.tabs.get(params.tabId);
  } else {
    const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = t;
  }
  if (!tab) return { ok: false, error: 'no tab' };

  switch (action) {

    // ── Navigation ──────────────────────────
    case 'navigate':
      await chrome.tabs.update(tab.id, { url: params.url });
      await waitLoad(tab.id);
      const updated = await chrome.tabs.get(tab.id);
      return { ok: true, data: { url: updated.url, title: updated.title } };

    case 'back':
      await chrome.tabs.goBack(tab.id);
      await waitLoad(tab.id);
      return { ok: true };

    case 'forward':
      await chrome.tabs.goForward(tab.id);
      await waitLoad(tab.id);
      return { ok: true };

    case 'reload':
      await chrome.tabs.reload(tab.id);
      await waitLoad(tab.id);
      return { ok: true };

    // ── Click ───────────────────────────────
    case 'click':
      return await run(tab.id, (p) => {
        let el;
        if (p.selector) el = document.querySelector(p.selector);
        else if (p.xpath) {
          const r = document.evaluate(p.xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
          el = r.singleNodeValue;
        }
        else if (p.id) el = document.getElementById(p.id);
        else if (p.name) el = document.querySelector(`[name="${p.name}"]`);
        else if (p.text) {
          const all = document.querySelectorAll('a, button, [role="button"], input[type="submit"], span, div, li');
          for (const e of all) {
            const t = e.textContent?.trim();
            if (t && (t === p.text || t.includes(p.text)) && e.offsetParent !== null) {
              el = e; break;
            }
          }
        }
        else if (p.index != null) {
          el = document.querySelectorAll('a, button, [role="button"]')[p.index];
        }

        if (!el) return { ok: false, error: `element not found: ${JSON.stringify(p)}` };
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        el.click();
        return { ok: true, data: { tag: el.tagName, text: el.textContent?.trim().slice(0, 100) } };
      }, params);

    // ── Type / Fill ─────────────────────────
    case 'type':
      return await run(tab.id, (p) => {
        let el;
        if (p.selector) el = document.querySelector(p.selector);
        else if (p.id) el = document.getElementById(p.id);
        else if (p.name) el = document.querySelector(`[name="${p.name}"]`);
        else if (p.placeholder) el = document.querySelector(`[placeholder*="${p.placeholder}"]`);
        else if (p.ariaLabel) el = document.querySelector(`[aria-label*="${p.ariaLabel}"]`);
        else if (p.label) {
          const labels = document.querySelectorAll('label');
          for (const l of labels) {
            if (l.textContent.trim().includes(p.label)) {
              el = document.getElementById(l.htmlFor) || l.querySelector('input, textarea');
              if (el) break;
            }
          }
        }
        else el = document.activeElement;

        if (!el) return { ok: false, error: 'input not found' };
        el.focus();
        el.value = p.value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
        return { ok: true, data: { name: el.name || el.id, value: p.value } };
      }, params);

    case 'clear':
      return await run(tab.id, (p) => {
        const el = p.selector ? document.querySelector(p.selector) : document.activeElement;
        if (!el) return { ok: false, error: 'element not found' };
        el.value = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return { ok: true };
      }, params);

    // ── Select / Dropdown ───────────────────
    case 'select':
      return await run(tab.id, (p) => {
        let el;
        if (p.selector) el = document.querySelector(p.selector);
        else if (p.name) el = document.querySelector(`select[name="${p.name}"]`);
        else if (p.id) el = document.getElementById(p.id);
        if (!el) return { ok: false, error: 'select not found' };
        for (const opt of el.options) {
          if (opt.value === p.value || opt.text.includes(p.value)) {
            el.value = opt.value;
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return { ok: true, data: { selected: opt.text } };
          }
        }
        return { ok: false, error: `option "${p.value}" not found` };
      }, params);

    // ── Checkbox / Radio ────────────────────
    case 'check':
      return await run(tab.id, (p) => {
        let el;
        if (p.selector) el = document.querySelector(p.selector);
        else if (p.name) el = document.querySelector(`[name="${p.name}"]`);
        else if (p.label) {
          const labels = document.querySelectorAll('label');
          for (const l of labels) {
            if (l.textContent.trim().includes(p.label)) {
              el = l.querySelector('input[type="checkbox"], input[type="radio"]') ||
                   document.getElementById(l.htmlFor);
              if (el) break;
            }
          }
        }
        if (!el) return { ok: false, error: 'checkbox/radio not found' };
        el.checked = p.checked !== false;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, data: { name: el.name, checked: el.checked } };
      }, params);

    // ── Scroll ──────────────────────────────
    case 'scroll':
      return await run(tab.id, (p) => {
        if (p.to === 'top') window.scrollTo({ top: 0, behavior: 'smooth' });
        else if (p.to === 'bottom') window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
        else if (p.selector) {
          const el = document.querySelector(p.selector);
          if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
        else if (p.into && p.text) {
          const all = document.querySelectorAll('*');
          for (const e of all) {
            if (e.textContent?.trim().includes(p.text) && e.offsetParent !== null) {
              e.scrollIntoView({ block: 'center', behavior: 'smooth' });
              break;
            }
          }
        }
        else window.scrollBy({ top: p.y || 500, behavior: 'smooth' });
        return { ok: true };
      }, params);

    // ── Read / Extract ──────────────────────
    case 'getText':
      return await run(tab.id, (p) => {
        if (p.selector) return { ok: true, data: document.querySelector(p.selector)?.textContent?.trim() || '' };
        return { ok: true, data: document.body.innerText.slice(0, 5000) };
      }, params);

    case 'getHTML':
      return await run(tab.id, (p) => {
        if (p.selector) return { ok: true, data: document.querySelector(p.selector)?.outerHTML || '' };
        return { ok: true, data: document.body.innerHTML.slice(0, 10000) };
      }, params);

    case 'getLinks':
      return await run(tab.id, (p) => {
        const filter = p.filter || '';
        const links = Array.from(document.querySelectorAll('a[href]'))
          .filter(a => !filter || a.href.includes(filter))
          .map(a => ({ text: a.textContent?.trim().slice(0, 100), href: a.href }));
        return { ok: true, data: links.slice(0, 50) };
      }, params);

    case 'getInputs':
      return await run(tab.id, () => {
        const inputs = Array.from(document.querySelectorAll('input, textarea, select'))
          .map(el => ({ tag: el.tagName, type: el.type, name: el.name, id: el.id, placeholder: el.placeholder, label: el.labels?.[0]?.textContent?.trim(), value: el.value?.slice(0, 100), required: el.required }));
        return { ok: true, data: inputs };
      });

    case 'getAttr':
      return await run(tab.id, (p) => {
        const el = document.querySelector(p.selector);
        if (!el) return { ok: false, error: 'element not found' };
        return { ok: true, data: el.getAttribute(p.attr) };
      }, params);

    case 'getValue':
      return await run(tab.id, (p) => {
        const el = document.querySelector(p.selector);
        if (!el) return { ok: false, error: 'element not found' };
        return { ok: true, data: el.value };
      }, params);

    // ── Wait ────────────────────────────────
    case 'wait':
      await new Promise(r => setTimeout(r, params.ms || 1000));
      return { ok: true };

    case 'waitFor':
      return await run(tab.id, (p) => {
        return new Promise((resolve) => {
          const timeout = p.timeout || 10000;
          const start = Date.now();
          const check = () => {
            const el = document.querySelector(p.selector);
            if (el) resolve({ ok: true, data: { found: true } });
            else if (Date.now() - start > timeout) resolve({ ok: false, error: 'timeout waiting for element' });
            else setTimeout(check, 200);
          };
          check();
        });
      }, params);

    // ── Eval ────────────────────────────────
    case 'eval':
      return await run(tab.id, (p) => {
        const result = eval(p.code);
        return { ok: true, data: result };
      }, params);

    // ── Screenshot ──────────────────────────
    case 'screenshot':
      const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png', quality: 80 });
      return { ok: true, data: dataUrl };

    // ── Tabs ────────────────────────────────
    case 'getTabs':
      const allTabs = await chrome.tabs.query({});
      return { ok: true, data: allTabs.map(t => ({ id: t.id, url: t.url, title: t.title, active: t.active })) };

    case 'newTab':
      const nt = await chrome.tabs.create({ url: params.url || 'about:blank', active: true });
      await waitLoad(nt.id);
      return { ok: true, data: { id: nt.id, url: nt.url } };

    case 'closeTab':
      await chrome.tabs.remove(params.tabId || tab.id);
      return { ok: true };

    case 'switchTab':
      await chrome.tabs.update(params.tabId, { active: true });
      return { ok: true };

    // ── Storage ─────────────────────────────
    case 'clearLocalStorage':
      return await run(tab.id, () => {
        const count = localStorage.length;
        localStorage.clear();
        return { ok: true, data: { cleared: count } };
      });

    case 'clearSessionStorage':
      return await run(tab.id, () => {
        const count = sessionStorage.length;
        sessionStorage.clear();
        return { ok: true, data: { cleared: count } };
      });

    // ── Cookies ─────────────────────────────
    case 'cookiejar':
    case 'cookiefile': {
      const url = params.url || tab.url;
      let domain = params.domain || null;
      try { if (!domain) domain = new URL(url).hostname; } catch {}
      const cookies = await chrome.cookies.getAll({ domain: domain || undefined, url: domain ? undefined : url });
      const jar = ['# Netscape HTTP Cookie File', `# Generated by RBC — ${new Date().toISOString()}`, '# Domain\tIncludeSubdomains\tPath\tSecure\tExpiry\tName\tValue'];
      for (const c of cookies) {
        jar.push([c.domain, c.domain.startsWith('.') ? 'TRUE' : 'FALSE', c.path, c.secure ? 'TRUE' : 'FALSE', c.expirationDate ? Math.floor(c.expirationDate) : '0', c.name, c.value].join('\t'));
      }
      const jarText = jar.join('\n');
      if (action === 'cookiefile') {
        const blob = `data:text/plain;charset=utf-8,${encodeURIComponent(jarText)}`;
        const filename = params.filename || `cookies_${domain || 'all'}.txt`;
        const dlId = await chrome.downloads.download({ url: blob, filename, saveAs: false });
        return { ok: true, data: { file: filename, cookies: cookies.length, downloadId: dlId } };
      }
      return { ok: true, data: { cookies: cookies.length, jar: jarText } };
    }

    // ── Status ──────────────────────────────
    case 'ping':
      return { ok: true, data: 'pong' };

    case 'status':
      const tabs = await chrome.tabs.query({});
      return { ok: true, data: { extId: EXT_ID, connected, tabs: tabs.length, url: tab.url, title: tab.title } };

    default:
      return { ok: false, error: `unknown action: ${action}` };
  }
}

// ── Helpers ─────────────────────────────────
function run(tabId, fn, params) {
  return new Promise((resolve) => {
    chrome.scripting.executeScript({
      target: { tabId },
      func: fn,
      args: [params || {}],
    }, (results) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(results?.[0]?.result || { ok: false, error: 'no result' });
      }
    });
  });
}

function waitLoad(tabId, timeout = 15000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = async () => {
      try {
        const t = await chrome.tabs.get(tabId);
        if (t.status === 'complete' || Date.now() - start > timeout) resolve();
        else setTimeout(check, 300);
      } catch { resolve(); }
    };
    check();
  });
}

// ── Init ────────────────────────────────────
async function init() {
  await initExtId();
  chrome.storage.local.set({ connected: false });
  connect();
}

chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);
init();

// Handle popup request
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'getId') {
    sendResponse({ extId: EXT_ID, connected, relayUrl: RELAY_URL });
  }
  if (msg.type === 'setRelayUrl') {
    RELAY_URL = msg.url;
    chrome.storage.local.set({ relayUrl: msg.url });
    if (ws) ws.close(); // will auto-reconnect with new URL
    connect();
    sendResponse({ ok: true });
  }
});
