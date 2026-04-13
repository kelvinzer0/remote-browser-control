# Remote Browser Control

🔗 Remote browser control via **Cloudflare Workers** — tanpa MQTT, tanpa host, mandiri.

## Arsitektur

```
[CLI / AI] → [Cloudflare Workers + Durable Object] ← [Chrome Extension]
              ↑ WebSocket bidirectional                ↑ WebSocket
```

- **Cloudflare Workers** — relay server (replace MQTT broker)
- **Durable Objects** — stateful room per device, real-time WebSocket
- **Chrome Extension** — connect langsung ke Workers via WebSocket
- **CLI** — connect via WebSocket atau HTTP API

## Setup

### 1. Deploy Cloudflare Worker

```bash
cd cf-workers
npm install
npx wrangler login
npx wrangler deploy
```

Output:
```
Published rbc-relay (x.x sec)
  https://rbc-relay.yourname.workers.dev
```

### 2. Install Chrome Extension

1. Buka `chrome://extensions`
2. Developer mode → ON
3. Load unpacked → pilih folder `extension/`
4. Klik icon extension → set **Relay URL** ke URL Worker kamu
5. Copy Extension ID dari popup

### 3. Install CLI

```bash
npm install
```

### 4. Gunakan

```bash
# Set environment
export RELAY_URL=https://rbc-relay.yourname.workers.dev
export DEVICE_ID=ext_abc123   # dari popup extension

# Navigate
node rbc-cf.js navigate "https://google.com"

# Click
node rbc-cf.js click "Sign In"

# Type
node rbc-cf.js type "#email" "me@mail.com"

# Get text
node rbc-cf.js text

# Screenshot
node rbc-cf.js screenshot

# Status
node rbc-cf.js status
```

## HTTP API

Worker juga expose HTTP API untuk integrasi mudah:

```bash
# Status
curl https://rbc-relay.yourname.workers.dev/device/ext_abc123/api/status

# Fire & forget command
curl -X POST https://rbc-relay.yourname.workers.dev/device/ext_abc123/api/cmd \
  -H 'Content-Type: application/json' \
  -d '{"action":"navigate","params":{"url":"https://google.com"}}'

# Execute + wait for result
curl -X POST https://rbc-relay.yourname.workers.dev/device/ext_abc123/api/execute \
  -H 'Content-Type: application/json' \
  -d '{"action":"getText","params":{},"timeout":15000}'
```

## Perbedaan dari Versi MQTT

| | MQTT (v1) | CF Workers (v2) |
|---|---|---|
| Broker | Public MQTT (HiveMQ/EMQX) | Cloudflare Workers + DO |
| Koneksi | MQTT pub/sub | WebSocket |
| Auth | None (public broker) | Device ID based |
| Latency | Variable | Low (CF edge) |
| Reliability | Public broker = shared | Dedicated per device |
| Cost | Free (public) | Free tier (100K req/day) |

## Commands

Semua commands sama seperti versi MQTT:

```
Navigation:  navigate, back, forward, reload
Click:       click, click-selector, click-id, click-index
Type:        type, type-text, type-placeholder, type-name, clear
Select:      select, select-selector, check, check-label, uncheck
Scroll:      scroll, scroll top, scroll bottom, scroll into
Read:        text, html, links, inputs, getAttr, getValue
Tabs:        tabs, newTab, closeTab, switchTab
Storage:     clear-localstorage, clear-sessionstorage
Cookies:     cookiejar, cookiefile
Utils:       status, ping, screenshot, wait, waitFor, eval
LinkedIn:    jobs-search, jobs-apply
```

## File Structure

```
remote-browser-control/
├── cf-workers/              ← Cloudflare Worker
│   ├── src/
│   │   ├── index.js         ← Worker entry point
│   │   └── device-room.js   ← Durable Object
│   ├── wrangler.toml
│   └── package.json
├── extension/               ← Chrome Extension (v2)
│   ├── manifest.json
│   ├── background.js        ← WebSocket ke Workers
│   ├── content.js
│   ├── popup.html
│   └── popup.js
├── rbc-cf.js                ← CLI (CF Workers relay)
├── mqtt-bridge.js           ← Legacy MQTT bridge
├── rbc.js                   ← Legacy MQTT CLI
├── package.json
└── README.md
```
