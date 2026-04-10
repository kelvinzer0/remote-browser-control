#!/usr/bin/env node
/**
 * MQTT Bridge — Direct commands, no LLM
 *
 * Relay MQTT ↔ Chrome Extension
 *
 * Usage:
 *   node mqtt-bridge.js
 *
 * Env:
 *   MQTT_BROKER  (default: wss://broker.hivemq.com:8884/mqtt)
 *   DEVICE_ID    (auto-generated if not set)
 */

import mqtt from 'mqtt';
import http from 'node:http';

// ── Config ──────────────────────────────────
const BROKER = process.env.MQTT_BROKER || 'wss://broker.hivemq.com:8884/mqtt';
const DEVICE_ID = process.env.DEVICE_ID || `dev_${Math.random().toString(36).substr(2, 8)}`;
const API_PORT = parseInt(process.env.API_PORT || '38402');

const TOPICS = {
  cmd:       `rbc/${DEVICE_ID}/cmd`,
  result:    `rbc/${DEVICE_ID}/result`,
  status:    `rbc/${DEVICE_ID}/status`,
  broadcast: 'rbc/cmd',
};

// ── State ───────────────────────────────────
let mqttClient = null;
let extId = null;      // extension's ID (set after first status message)
let extOnline = false;

// ── MQTT ────────────────────────────────────
function connectMQTT() {
  mqttClient = mqtt.connect(BROKER, {
    clientId: `bridge_${DEVICE_ID}`,
    clean: true,
    connectTimeout: 10000,
    reconnectPeriod: 5000,
    keepalive: 30,
  });

  mqttClient.on('connect', () => {
    mqttClient.subscribe([TOPICS.cmd, TOPICS.broadcast, 'rbc/+/status'], { qos: 1 });
    pub(TOPICS.status, { status: 'bridge_online', deviceId: DEVICE_ID });
    log('✅ MQTT connected');
  });

  mqttClient.on('message', (topic, raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.from === DEVICE_ID) return;

      // Extension status messages
      if (topic.endsWith('/status') && msg.extId) {
        extId = msg.extId;
        extOnline = msg.status === 'online';
        log(`📡 Extension ${extOnline ? 'ON' : 'OFF'}: ${extId}`);
        // Re-publish bridge status with ext info
        pub(TOPICS.status, {
          status: 'bridge_online',
          deviceId: DEVICE_ID,
          extId,
          extOnline,
        });
        return;
      }

      // Extension result messages — forward to MQTT
      if (topic.endsWith('/result')) {
        return; // already published by extension
      }

      // Commands — relay to extension
      if (msg.action) {
        log(`📥 CMD: ${msg.action} ${JSON.stringify(msg.params || {}).slice(0, 80)}`);

        // Forward to extension's command topic
        if (extId) {
          msg.from = DEVICE_ID;
          mqttClient.publish(`rbc/${extId}/cmd`, JSON.stringify(msg), { qos: 1 });
        } else {
          pub(TOPICS.result, {
            commandId: msg.commandId,
            ok: false,
            error: 'no extension connected',
          });
        }
      }

    } catch {}
  });

  mqttClient.on('error', (e) => log(`❌ MQTT: ${e.message}`));
  mqttClient.on('close', () => log('⚠️ MQTT disconnected'));
}

function pub(topic, data) {
  if (mqttClient?.connected) {
    data.from = DEVICE_ID;
    mqttClient.publish(topic, JSON.stringify(data), { qos: 1 });
  }
}

// ── HTTP API ────────────────────────────────
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(200); res.end(); return;
  }

  // Health
  if (req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, deviceId: DEVICE_ID, extId, extOnline }));
    return;
  }

  // Send command (fire & forget)
  if (req.url === '/cmd' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const cmd = JSON.parse(body);
        if (!extOnline) {
          res.writeHead(503);
          res.end(JSON.stringify({ error: 'extension offline' }));
          return;
        }
        cmd.from = DEVICE_ID;
        cmd.commandId = cmd.commandId || `http_${Date.now()}`;
        mqttClient.publish(`rbc/${extId}/cmd`, JSON.stringify(cmd), { qos: 1 });
        res.writeHead(202);
        res.end(JSON.stringify({ sent: true, commandId: cmd.commandId }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Send command + wait for result
  if (req.url === '/execute' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const cmd = JSON.parse(body);
        if (!extOnline) {
          res.writeHead(503);
          res.end(JSON.stringify({ error: 'extension offline' }));
          return;
        }

        const commandId = `http_${Date.now()}`;
        cmd.commandId = commandId;
        cmd.from = DEVICE_ID;

        // Listen for result
        const timeout = setTimeout(() => {
          mqttClient.off('message', handler);
          res.writeHead(504);
          res.end(JSON.stringify({ error: 'timeout' }));
        }, cmd.timeout || 30000);

        const handler = (topic, raw) => {
          try {
            const r = JSON.parse(raw.toString());
            if (r.commandId === commandId) {
              clearTimeout(timeout);
              mqttClient.off('message', handler);
              res.writeHead(200);
              res.end(JSON.stringify(r));
            }
          } catch {}
        };
        mqttClient.on('message', handler);

        mqttClient.publish(`rbc/${extId}/cmd`, JSON.stringify(cmd), { qos: 1 });

      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // List available actions
  if (req.url === '/actions') {
    res.writeHead(200);
    res.end(JSON.stringify({
      actions: [
        'navigate', 'back', 'forward', 'reload',
        'click', 'type', 'clear', 'select', 'check',
        'scroll',
        'getText', 'getHTML', 'getLinks', 'getInputs', 'getAttr', 'getValue',
        'wait', 'waitFor',
        'eval',
        'screenshot',
        'getTabs', 'newTab', 'closeTab', 'switchTab',
        'ping', 'status',
      ],
    }));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'not found' }));
});

// ── Start ───────────────────────────────────
function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

console.log(`
╔═══════════════════════════════════════════════╗
║  🔗 Remote Browser Control — MQTT Bridge      ║
╠═══════════════════════════════════════════════╣
║  Device ID:  ${DEVICE_ID.padEnd(32)}  ║
║  Broker:     ${(BROKER.length > 32 ? BROKER.slice(0,29) + '...' : BROKER).padEnd(32)}  ║
║  API:        http://localhost:${String(API_PORT).padEnd(16)}  ║
╚═══════════════════════════════════════════════╝
`);

connectMQTT();

server.listen(API_PORT, '127.0.0.1', () => {
  log(`🌐 API ready: http://127.0.0.1:${API_PORT}`);
});

process.on('SIGINT', () => {
  pub(TOPICS.status, { status: 'bridge_offline', deviceId: DEVICE_ID });
  mqttClient?.end();
  server.close();
  process.exit(0);
});
