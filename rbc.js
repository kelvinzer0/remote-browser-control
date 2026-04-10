#!/usr/bin/env node
/**
 * Remote Browser Control — CLI
 * Direct commands, no LLM.
 *
 * Usage:
 *   node rbc.js devices                       — list online devices
 *   node rbc.js status                        — device status
 *   node rbc.js navigate "https://..."        — open URL
 *   node rbc.js click "Sign In"               — click by text
 *   node rbc.js type "#email" "me@mail.com"   — type into input
 *   node rbc.js select "country" "Indonesia"  — select dropdown
 *   node rbc.js scroll                        — scroll down
 *   node rbc.js getText                       — get page text
 *   node rbc.js getLinks linkedin.com         — get filtered links
 *   node rbc.js screenshot                    — take screenshot
 *   node rbc.js newTab "https://..."          — open new tab
 *   node rbc.js jobs-search "Python"          — LinkedIn job search
 *   node rbc.js jobs-apply "https://..."      — LinkedIn Easy Apply
 */

import mqtt from 'mqtt';

const BROKER = process.env.MQTT_BROKER || 'wss://broker.hivemq.com:8884/mqtt';
const DEVICE_ID = process.env.DEVICE_ID || null;
const TIMEOUT = parseInt(process.env.TIMEOUT || '30000');

// ── Main ────────────────────────────────────
async function main() {
  const [cmd, ...args] = process.argv.slice(2);

  if (!cmd || cmd === '--help' || cmd === '-h') {
    help();
    process.exit(0);
  }

  const client = mqtt.connect(BROKER, {
    clientId: `cli_${Math.random().toString(36).substr(2, 6)}`,
    clean: true,
    connectTimeout: 10000,
  });

  await once(client, 'connect');

  // ── Devices ───────────────────────────────
  if (cmd === 'devices') {
    console.log('🔍 Scanning...');
    client.subscribe('rbc/+/status', { qos: 1 });
    const found = [];
    client.on('message', (_t, raw) => {
      try {
        const m = JSON.parse(raw.toString());
        if (m.extId && m.status === 'online') found.push(m);
      } catch {}
    });
    await sleep(2500);
    if (found.length === 0) {
      console.log('  ❌ No extensions online');
    } else {
      for (const d of found) {
        console.log(`  ✅ ext: ${d.extId} | bridge: ${d.deviceId || '—'}`);
      }
    }
    client.end();
    return;
  }

  // ── Discover target device ────────────────
  let targetExtId = null;

  if (DEVICE_ID) {
    // Bridge mode — send to bridge's extId
    // Subscribe to bridge status to get extId
    client.subscribe(`rbc/${DEVICE_ID}/status`, { qos: 1 });
    targetExtId = await new Promise((resolve) => {
      const handler = (_t, raw) => {
        try {
          const m = JSON.parse(raw.toString());
          if (m.extId) { client.off('message', handler); resolve(m.extId); }
        } catch {}
      };
      client.on('message', handler);
      setTimeout(() => { client.off('message', handler); resolve(null); }, 3000);
    });
  }

  if (!targetExtId) {
    // Auto-discover any extension
    client.subscribe('rbc/+/status', { qos: 1 });
    targetExtId = await new Promise((resolve) => {
      const handler = (_t, raw) => {
        try {
          const m = JSON.parse(raw.toString());
          if (m.extId && m.status === 'online') { client.off('message', handler); resolve(m.extId); }
        } catch {}
      };
      client.on('message', handler);
      setTimeout(() => { client.off('message', handler); resolve(null); }, 3000);
    });
  }

  if (!targetExtId) {
    console.error('❌ No extension found. Install & activate the extension.');
    client.end();
    process.exit(1);
  }

  console.log(`📌 Target: ${targetExtId}`);

  // ── Build command ─────────────────────────
  const command = buildCommand(cmd, args);
  if (!command) {
    client.end();
    process.exit(1);
  }

  command.commandId = `cli_${Date.now()}`;

  // ── Send & wait ───────────────────────────
  const resultTopic = `rbc/${targetExtId}/result`;
  client.subscribe(resultTopic, { qos: 1 });

  const resultPromise = new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve({ ok: false, error: 'timeout' });
    }, TIMEOUT);

    const handler = (_t, raw) => {
      try {
        const m = JSON.parse(raw.toString());
        if (m.commandId === command.commandId) {
          clearTimeout(timeout);
          client.off('message', handler);
          resolve(m);
        }
      } catch {}
    };
    client.on('message', handler);
  });

  client.publish(`rbc/${targetExtId}/cmd`, JSON.stringify(command), { qos: 1 });
  console.log(`🚀 ${command.action} ${JSON.stringify(command.params || {}).slice(0, 80)}`);
  console.log('⏳ Waiting...');

  const result = await resultPromise;

  if (result.ok) {
    console.log('\n✅ OK');
    if (result.data !== undefined) {
      const out = typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2);
      console.log(out.length > 2000 ? out.slice(0, 2000) + '\n...' : out);
    }
  } else {
    console.error(`\n❌ ${result.error || 'failed'}`);
  }

  client.end();
}

// ── Command Builder ─────────────────────────
function buildCommand(cmd, args) {
  switch (cmd) {
    case 'status':
      return { action: 'status' };

    case 'ping':
      return { action: 'ping' };

    // ── Navigation ──────────────────────────
    case 'navigate':
    case 'goto':
    case 'open':
      return { action: 'navigate', params: { url: args[0] } };

    case 'back':
      return { action: 'back' };

    case 'forward':
      return { action: 'forward' };

    case 'reload':
      return { action: 'reload' };

    // ── Interaction ─────────────────────────
    case 'click':
      if (args[0]?.startsWith('#') || args[0]?.startsWith('.') || args[0]?.startsWith('[')) {
        return { action: 'click', params: { selector: args[0] } };
      }
      if (args[0]?.startsWith('//')) {
        return { action: 'click', params: { xpath: args[0] } };
      }
      return { action: 'click', params: { text: args.join(' ') } };

    case 'click-selector':
      return { action: 'click', params: { selector: args[0] } };

    case 'click-id':
      return { action: 'click', params: { id: args[0] } };

    case 'click-index':
      return { action: 'click', params: { index: parseInt(args[0]) } };

    case 'type':
    case 'input':
      return { action: 'type', params: { selector: args[0], value: args.slice(1).join(' ') } };

    case 'type-text':
      // type into field by text content (label)
      return { action: 'type', params: { label: args[0], value: args.slice(1).join(' ') } };

    case 'type-placeholder':
      return { action: 'type', params: { placeholder: args[0], value: args.slice(1).join(' ') } };

    case 'type-name':
      return { action: 'type', params: { name: args[0], value: args.slice(1).join(' ') } };

    case 'clear':
      return { action: 'clear', params: { selector: args[0] } };

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

    // ── Scroll ──────────────────────────────
    case 'scroll':
      if (args[0] === 'top') return { action: 'scroll', params: { to: 'top' } };
      if (args[0] === 'bottom') return { action: 'scroll', params: { to: 'bottom' } };
      if (args[0] === 'into') return { action: 'scroll', params: { into: true, text: args.slice(1).join(' ') } };
      return { action: 'scroll', params: { y: parseInt(args[0]) || 500 } };

    // ── Read ────────────────────────────────
    case 'getText':
    case 'text':
      return { action: 'getText', params: args[0] ? { selector: args[0] } : {} };

    case 'getHTML':
    case 'html':
      return { action: 'getHTML', params: args[0] ? { selector: args[0] } : {} };

    case 'getLinks':
    case 'links':
      return { action: 'getLinks', params: args[0] ? { filter: args[0] } : {} };

    case 'getInputs':
    case 'inputs':
      return { action: 'getInputs', params: {} };

    case 'getAttr':
      return { action: 'getAttr', params: { selector: args[0], attr: args[1] } };

    case 'getValue':
      return { action: 'getValue', params: { selector: args[0] } };

    // ── Wait ────────────────────────────────
    case 'wait':
      return { action: 'wait', params: { ms: parseInt(args[0]) || 1000 } };

    case 'waitFor':
      return { action: 'waitFor', params: { selector: args[0], timeout: parseInt(args[1]) || 10000 } };

    // ── Screenshot ──────────────────────────
    case 'screenshot':
    case 'ss':
      return { action: 'screenshot' };

    // ── Tabs ────────────────────────────────
    case 'tabs':
    case 'getTabs':
      return { action: 'getTabs' };

    case 'newTab':
      return { action: 'newTab', params: { url: args[0] } };

    case 'closeTab':
      return { action: 'closeTab', params: args[0] ? { tabId: parseInt(args[0]) } : {} };

    case 'switchTab':
      return { action: 'switchTab', params: { tabId: parseInt(args[0]) } };

    // ── Eval (advanced) ─────────────────────
    case 'eval':
      return { action: 'eval', params: { code: args.join(' ') } };

    // ── LinkedIn Job Shortcuts ──────────────
    case 'jobs-search':
      return {
        action: 'navigate',
        params: { url: `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(args.join(' '))}&location=Indonesia` },
      };

    case 'jobs-apply':
      return {
        action: 'navigate',
        params: { url: args[0] },
      };

    // ── Batch: multiple actions ─────────────
    case 'batch':
      // Read from stdin or file
      console.error('batch mode: read JSON array from stdin');
      return null;

    default:
      console.error(`❌ Unknown command: ${cmd}`);
      console.error('Run: node rbc.js --help');
      return null;
  }
}

// ── Helpers ─────────────────────────────────
function once(emitter, event) {
  return new Promise((resolve) => emitter.once(event, resolve));
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function help() {
  console.log(`
🔗 Remote Browser Control — CLI

Usage: node rbc.js <command> [args...]

  NAVIGATION
    navigate <url>               Open URL
    back                         Go back
    forward                      Go forward
    reload                       Reload page

  CLICK
    click <text>                 Click by visible text
    click-selector <sel>         Click by CSS selector
    click-id <id>                Click by element ID
    click-index <n>              Click n-th link/button

  TYPE / FILL
    type <sel> <value>           Type into input (selector)
    type-text <label> <value>    Type into input (by label)
    type-placeholder <ph> <val>  Type into input (by placeholder)
    type-name <name> <value>     Type into input (by name)
    clear [<sel>]                Clear input value

  SELECT / CHECK
    select <name> <value>        Select dropdown option
    select-selector <sel> <val>  Select dropdown (CSS selector)
    check <name>                 Check checkbox
    check-label <text>           Check by label text
    uncheck <name>               Uncheck checkbox

  SCROLL
    scroll                       Scroll down 500px
    scroll <px>                  Scroll by N pixels
    scroll top                   Scroll to top
    scroll bottom                Scroll to bottom
    scroll into <text>           Scroll element into view

  READ
    text [<sel>]                 Get page/element text
    html [<sel>]                 Get page/element HTML
    links [<filter>]             Get links (optional filter)
    inputs                       Get all form inputs
    getAttr <sel> <attr>         Get element attribute
    getValue <sel>               Get input value

  TABS
    tabs                         List all tabs
    newTab <url>                 Open new tab
    closeTab [<id>]              Close tab
    switchTab <id>               Switch to tab

  UTILS
    status                       Device status
    ping                         Ping
    screenshot                   Take screenshot
    wait <ms>                    Wait N milliseconds
    waitFor <sel> [<timeout>]    Wait for element

  LINKEDIN
    jobs-search <keyword>        Search LinkedIn jobs
    jobs-apply <url>             Go to job listing

  ENV
    DEVICE_ID=<id>               Target device
    MQTT_BROKER=<url>            Broker URL
    TIMEOUT=<ms>                 Response timeout (default: 30000)

  Examples:
    node rbc.js devices
    node rbc.js navigate "https://linkedin.com/jobs"
    node rbc.js click "Easy Apply"
    node rbc.js type "#email" "me@mail.com"
    node rbc.js select "country" "Indonesia"
    node rbc.js scroll into "Submit"
    node rbc.js text
    node rbc.js links linkedin.com
  `);
}

main().catch(e => {
  console.error('❌', e.message);
  process.exit(1);
});
