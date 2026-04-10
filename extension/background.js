// Background — MQTT Bridge Extension
// Direct DOM commands, no LLM.

importScripts('mqtt.min.js');

// ── Config ──────────────────────────────────
const BROKER = 'wss://broker.hivemq.com:8884/mqtt';
const EXT_ID = 'ext_' + Math.random().toString(36).substr(2, 8);

const TOPICS = {
  cmd:      `rbc/${EXT_ID}/cmd`,
  result:   `rbc/${EXT_ID}/result`,
  status:   `rbc/${EXT_ID}/status`,
  broadcast:'rbc/cmd`,
};

let mqttClient = null;
let connected = false;

// ── MQTT ────────────────────────────────────
function connect() {
  mqttClient = mqtt.connect(BROKER, {
    clientId: EXT_ID,
    clean: true,
    connectTimeout: 10000,
    reconnectPeriod: 5000,
    keepalive: 30,
  });

  mqttClient.on('connect', () => {
    connected = true;
    chrome.storage.local.set({ connected: true });
    mqttClient.subscribe([TOPICS.cmd, TOPICS.broadcast], { qos: 1 });
    publish(TOPICS.status, { status: 'online', extId: EXT_ID, ts: Date.now() });
    console.log('[RBC] Connected:', EXT_ID);
  });

  mqttClient.on('message', async (topic, raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.from === EXT_ID) return;

      const result = await exec(msg);
      publish(TOPICS.result, { commandId: msg.commandId, ...result });

    } catch (e) {
      publish(TOPICS.result, { commandId: msg?.commandId, ok: false, error: e.message });
    }
  });

  mqttClient.on('close', () => {
    connected = false;
    chrome.storage.local.set({ connected: false });
  });
  mqttClient.on('error', () => {});
}

function publish(topic, data) {
  if (mqttClient?.connected) {
    data.from = EXT_ID;
    mqttClient.publish(topic, JSON.stringify(data), { qos: 1 });
  }
}

// ── Command Executor (no LLM) ──────────────
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
          // Find by visible text
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
          // Find label and its input
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

        // Match by value or text
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

    // ── File Upload ─────────────────────────
    case 'upload':
      // Note: Chrome extensions can't directly set file input values
      // Use fetch to get file and inject via executeScript
      return await run(tab.id, async (p) => {
        const input = document.querySelector(p.selector || 'input[type="file"]');
        if (!input) return { ok: false, error: 'file input not found' };
        // Can't programmatically set files in content scripts
        // User must trigger upload manually or use data transfer
        return { ok: false, error: 'use manual upload or data-transfer method' };
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
        if (p.selector) {
          const el = document.querySelector(p.selector);
          return { ok: true, data: el?.textContent?.trim() || '' };
        }
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
          .map(a => ({
            text: a.textContent?.trim().slice(0, 100),
            href: a.href,
          }));
        return { ok: true, data: links.slice(0, 50) };
      }, params);

    case 'getInputs':
      return await run(tab.id, () => {
        const inputs = Array.from(document.querySelectorAll('input, textarea, select'))
          .map(el => ({
            tag: el.tagName,
            type: el.type,
            name: el.name,
            id: el.id,
            placeholder: el.placeholder,
            label: el.labels?.[0]?.textContent?.trim(),
            value: el.value?.slice(0, 100),
            required: el.required,
          }));
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
      // Wait for element to appear
      return await run(tab.id, (p) => {
        return new Promise((resolve) => {
          const timeout = p.timeout || 10000;
          const start = Date.now();
          const check = () => {
            const el = document.querySelector(p.selector);
            if (el) {
              resolve({ ok: true, data: { found: true } });
            } else if (Date.now() - start > timeout) {
              resolve({ ok: false, error: 'timeout waiting for element' });
            } else {
              setTimeout(check, 200);
            }
          };
          check();
        });
      }, params);

    // ── Execute ─────────────────────────────
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
      return { ok: true, data: allTabs.map(t => ({
        id: t.id, url: t.url, title: t.title, active: t.active,
      })) };

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

    // ── Status ──────────────────────────────
    case 'ping':
      return { ok: true, data: 'pong' };

    case 'status':
      const tabs = await chrome.tabs.query({});
      return { ok: true, data: {
        extId: EXT_ID,
        connected,
        tabs: tabs.length,
        url: tab.url,
        title: tab.title,
      }};

    default:
      return { ok: false, error: `unknown action: ${action}` };
  }
}

// ── Helpers ─────────────────────────────────
function run(tabId, fn, params) {
  return new Promise((resolve, reject) => {
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
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ extId: EXT_ID, connected: false });
  connect();
});
chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.set({ extId: EXT_ID });
  connect();
});
connect();

// Handle popup request for ID
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'getId') {
    sendResponse({ extId: EXT_ID, connected });
  }
});

// Heartbeat every 30s
setInterval(() => {
  if (connected) {
    publish(TOPICS.status, { status: 'online', extId: EXT_ID, ts: Date.now() });
  }
}, 30000);
