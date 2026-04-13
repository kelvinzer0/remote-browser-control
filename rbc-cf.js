#!/usr/bin/env node
/**
 * Remote Browser Control — CLI (Cloudflare Workers relay)
 *
 * Replaces MQTT with Cloudflare Workers + Durable Objects.
 *
 * Usage:
 *   RELAY_URL=https://rbc-relay.yourname.workers.dev DEVICE_ID=dev_xxx node rbc-cf.js navigate "https://..."
 *
 * Env:
 *   RELAY_URL    — Cloudflare Worker URL (required)
 *   DEVICE_ID    — Target device ID (required)
 *   TIMEOUT      — Command timeout in ms (default: 30000)
 */

import WebSocket from 'ws';

const RELAY_URL = process.env.RELAY_URL || 'http://localhost:8787';
const DEVICE_ID = process.env.DEVICE_ID || null;
const TIMEOUT = parseInt(process.env.TIMEOUT || '30000');

// ── Main ────────────────────────────────────
async function main() {
  const [cmd, ...args] = process.argv.slice(2);

  if (!cmd || cmd === '--help' || cmd === '-h') {
    help();
    process.exit(0);
  }

  if (!DEVICE_ID) {
    console.error('❌ DEVICE_ID required. Set DEVICE_ID=dev_xxx');
    console.error('   Or run: RELAY_URL=... node rbc-cf.js devices');
    process.exit(1);
  }

  // Build command
  const command = buildCommand(cmd, args);
  if (!command) process.exit(1);

  const commandId = `cli_${Date.now()}`;
  command.commandId = commandId;

  // Connect via WebSocket
  const wsUrl = RELAY_URL.replace(/^http/, 'ws') + `/device/${DEVICE_ID}?role=cli`;

  console.log(`🔗 Connecting: ${wsUrl}`);

  const ws = new WebSocket(wsUrl);
  let resolved = false;

  // Timeout
  const timer = setTimeout(() => {
    if (!resolved) {
      resolved = true;
      console.error('\n❌ Timeout');
      ws.close();
      process.exit(1);
    }
  }, TIMEOUT);

  ws.on('open', () => {
    console.log(`🚀 ${command.action} ${JSON.stringify(command.params || {}).slice(0, 80)}`);
    console.log('⏳ Waiting...');
    ws.send(JSON.stringify({ type: 'command', ...command }));
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      // Status message
      if (msg.type === 'status') {
        if (!msg.extOnline && !resolved) {
          // Don't fail yet, extension might connect
          console.log('⏳ Extension offline, waiting...');
        }
        return;
      }

      // Result message
      if (msg.type === 'result' && msg.commandId === commandId && !resolved) {
        resolved = true;
        clearTimeout(timer);

        if (msg.ok) {
          console.log('\n✅ OK');
          if (msg.data !== undefined) {
            const out = typeof msg.data === 'string' ? msg.data : JSON.stringify(msg.data, null, 2);
            console.log(out.length > 5000 ? out.slice(0, 5000) + '\n...' : out);
          }
        } else {
          console.error(`\n❌ ${msg.error || 'failed'}`);
        }
        ws.close();
      }
    } catch {}
  });

  ws.on('error', (err) => {
    if (!resolved) {
      resolved = true;
      clearTimeout(timer);
      console.error(`❌ WebSocket error: ${err.message}`);
      process.exit(1);
    }
  });

  ws.on('close', () => {
    if (!resolved) {
      resolved = true;
      clearTimeout(timer);
      console.error('❌ Connection closed');
      process.exit(1);
    }
  });
}

// ── HTTP API helper ─────────────────────────
async function httpApi(path, body = null) {
  const url = RELAY_URL + path;
  const opts = body ? {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  } : {};
  const res = await fetch(url, opts);
  return res.json();
}

// ── Command Builder (same as original rbc.js) ──
function buildCommand(cmd, args) {
  switch (cmd) {
    case 'status':
      return { action: 'status' };
    case 'ping':
      return { action: 'ping' };

    // Navigation
    case 'navigate': case 'goto': case 'open':
      return { action: 'navigate', params: { url: args[0] } };
    case 'back':
      return { action: 'back' };
    case 'forward':
      return { action: 'forward' };
    case 'reload':
      return { action: 'reload' };

    // Click
    case 'click':
      if (args[0]?.startsWith('#') || args[0]?.startsWith('.') || args[0]?.startsWith('['))
        return { action: 'click', params: { selector: args[0] } };
      if (args[0]?.startsWith('//'))
        return { action: 'click', params: { xpath: args[0] } };
      return { action: 'click', params: { text: args.join(' ') } };
    case 'click-selector':
      return { action: 'click', params: { selector: args[0] } };
    case 'click-id':
      return { action: 'click', params: { id: args[0] } };
    case 'click-index':
      return { action: 'click', params: { index: parseInt(args[0]) } };

    // Type
    case 'type': case 'input':
      return { action: 'type', params: { selector: args[0], value: args.slice(1).join(' ') } };
    case 'type-text':
      return { action: 'type', params: { label: args[0], value: args.slice(1).join(' ') } };
    case 'type-placeholder':
      return { action: 'type', params: { placeholder: args[0], value: args.slice(1).join(' ') } };
    case 'type-name':
      return { action: 'type', params: { name: args[0], value: args.slice(1).join(' ') } };
    case 'clear':
      return { action: 'clear', params: { selector: args[0] } };

    // Select / Check
    case 'select':
      return { action: 'select', params: { name: args[0], value: args.slice(1).join(' ') } };
    case 'select-selector':
      return { action: 'select', params: { selector: args[0], value: args.slice(1).join(' ') } };
    case 'check':
      return { action: 'check', params: { name: args[0], checked: args[1] !== 'false' } };
    case 'check-label':
      return { action: 'check', params: { label: args.join(' '), checked: true } };
    case 'uncheck':
      return { action: 'check', params: { name: args[0], checked: false } };

    // Scroll
    case 'scroll':
      if (args[0] === 'top') return { action: 'scroll', params: { to: 'top' } };
      if (args[0] === 'bottom') return { action: 'scroll', params: { to: 'bottom' } };
      if (args[0] === 'into') return { action: 'scroll', params: { into: true, text: args.slice(1).join(' ') } };
      return { action: 'scroll', params: { y: parseInt(args[0]) || 500 } };

    // Read
    case 'getText': case 'text':
      return { action: 'getText', params: args[0] ? { selector: args[0] } : {} };
    case 'getHTML': case 'html':
      return { action: 'getHTML', params: args[0] ? { selector: args[0] } : {} };
    case 'getLinks': case 'links':
      return { action: 'getLinks', params: args[0] ? { filter: args[0] } : {} };
    case 'getInputs': case 'inputs':
      return { action: 'getInputs', params: {} };
    case 'getAttr':
      return { action: 'getAttr', params: { selector: args[0], attr: args[1] } };
    case 'getValue':
      return { action: 'getValue', params: { selector: args[0] } };

    // Wait
    case 'wait':
      return { action: 'wait', params: { ms: parseInt(args[0]) || 1000 } };
    case 'waitFor':
      return { action: 'waitFor', params: { selector: args[0], timeout: parseInt(args[1]) || 10000 } };

    // Screenshot
    case 'screenshot': case 'ss':
      return { action: 'screenshot' };

    // Tabs
    case 'tabs': case 'getTabs':
      return { action: 'getTabs' };
    case 'newTab':
      return { action: 'newTab', params: { url: args[0] } };
    case 'closeTab':
      return { action: 'closeTab', params: args[0] ? { tabId: parseInt(args[0]) } : {} };
    case 'switchTab':
      return { action: 'switchTab', params: { tabId: parseInt(args[0]) } };

    // Storage
    case 'clear-localstorage': case 'clearLocalStorage':
      return { action: 'clearLocalStorage' };
    case 'clear-sessionstorage': case 'clearSessionStorage':
      return { action: 'clearSessionStorage' };

    // Cookies
    case 'cookiejar':
      return { action: 'cookiejar', params: args[0] ? { domain: args[0] } : {} };
    case 'cookiefile':
      return { action: 'cookiefile', params: {
        ...(args[0] ? { domain: args[0] } : {}),
        ...(args[1] ? { filename: args[1] } : {}),
      } };

    // Eval
    case 'eval':
      return { action: 'eval', params: { code: args.join(' ') } };

    // LinkedIn
    case 'jobs-search':
      return { action: 'navigate', params: { url: `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(args.join(' '))}&location=Indonesia` } };
    case 'jobs-apply':
      return { action: 'navigate', params: { url: args[0] } };

    default:
      console.error(`❌ Unknown command: ${cmd}`);
      return null;
  }
}

function help() {
  console.log(`
🔗 Remote Browser Control — CLI (CF Workers relay)

Usage: DEVICE_ID=dev_xxx node rbc-cf.js <command> [args...]

Env:
  RELAY_URL=https://rbc-relay.yourname.workers.dev  (CF Worker URL)
  DEVICE_ID=dev_xxx                                  (target device)
  TIMEOUT=30000                                      (ms, default 30000)

Commands (same as original rbc.js):
  navigate <url>           click <text>
  type <sel> <value>       scroll [top|bottom|into <text>]
  text [<sel>]             links [<filter>]
  screenshot               tabs / newTab / closeTab / switchTab
  status / ping            wait <ms> / waitFor <sel>
  ...and all other original commands
`);
}

main().catch(e => {
  console.error('❌', e.message);
  process.exit(1);
});
