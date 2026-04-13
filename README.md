# 🔗 Remote Browser Control

Control browser jarak jauh via **MQTT** — tanpa LLM, tanpa host, mandiri.

## Arsitektur

```
[Kamu/AI] → [MQTT Broker gratis] → [Bridge di laptop] → [Chrome Extension] → [Browser]
```

**Zero dependency pada AI/LLM.** Semua command adalah direct DOM manipulation.

## Setup (3 langkah)

### 1. Install Extension

Download & install extension ke Chrome:

```
1. Buka chrome://extensions
2. Developer mode → ON
3. Load unpacked → pilih folder extension/
4. Klik icon extension → catat Extension ID dari popup
```

### 2. Jalankan Bridge

```bash
cd remote-browser
npm install
node mqtt-bridge.js
```

Output:
```
╔═══════════════════════════════════════════════╗
║  🔗 Remote Browser Control — MQTT Bridge      ║
║  Device ID:  dev_abc123                        ║
║  Broker:     wss://broker.hivemq.com:8884/mqtt ║
║  API:        http://127.0.0.1:38402            ║
╚═══════════════════════════════════════════════╝
```

Copy **Device ID**, kirim ke saya.

### 3. Kontrol dari Mana Saja

```bash
# Via CLI
DEVICE_ID=dev_abc123 node rbc.js status
DEVICE_ID=dev_abc123 node rbc.js navigate "https://linkedin.com/jobs"
DEVICE_ID=dev_abc123 node rbc.js click "Easy Apply"
DEVICE_ID=dev_abc123 node rbc.js type "#email" "me@mail.com"

# Via API
curl -X POST http://127.0.0.1:38402/execute \
  -d '{"action":"navigate","params":{"url":"https://linkedin.com"}}'

# Via MQTT dari mana saja
mosquitto_pub -h broker.hivemq.com -t "rbc/ext_abc/cmd" \
  -m '{"action":"click","params":{"text":"Sign In"},"commandId":"1"}'
```

## Commands (Direct, No LLM)

### Navigation
| Command | Example |
|---------|---------|
| `navigate` | `navigate "https://linkedin.com"` |
| `back` | `back` |
| `forward` | `forward` |
| `reload` | `reload` |

### Click
| Command | Example |
|---------|---------|
| `click` | `click "Sign In"` (by text) |
| `click-selector` | `click-selector "button.primary"` |
| `click-id` | `click-id "loginBtn"` |
| `click-index` | `click-index 3` (n-th link) |

### Type / Fill
| Command | Example |
|---------|---------|
| `type` | `type "#email" "me@mail.com"` |
| `type-text` | `type-text "Email" "me@mail.com"` (by label) |
| `type-placeholder` | `type-placeholder "Enter email" "me@mail.com"` |
| `type-name` | `type-name "email" "me@mail.com"` |
| `clear` | `clear "#email"` |

### Select / Checkbox
| Command | Example |
|---------|---------|
| `select` | `select "country" "Indonesia"` |
| `select-selector` | `select-selector "#dropdown" "option1"` |
| `check` | `check "agree"` |
| `check-label` | `check-label "I agree to terms"` |
| `uncheck` | `uncheck "newsletter"` |

### Scroll
| Command | Example |
|---------|---------|
| `scroll` | scroll down 500px |
| `scroll 1000` | scroll 1000px |
| `scroll top` | scroll to top |
| `scroll bottom` | scroll to bottom |
| `scroll into "Submit"` | scroll element to center |

### Read
| Command | Example |
|---------|---------|
| `text` | get all page text |
| `text "h1"` | get text of h1 |
| `html` | get page HTML |
| `links` | get all links |
| `links linkedin.com` | filter links |
| `inputs` | get all form inputs |
| `getAttr "a.link" "href"` | get attribute |
| `getValue "#email"` | get input value |

### Storage
| Command | Example |
|---------|---------|
| `clear-localstorage` | `clear-localstorage` |
| `clear-sessionstorage` | `clear-sessionstorage` |

### Cookies
| Command | Example |
|---------|---------|
| `cookiejar` | `cookiejar` (get cookies, Netscape format) |
| `cookiejar example.com` | `cookiejar example.com` (filter by domain) |
| `cookiefile` | `cookiefile` (save cookies to file) |
| `cookiefile example.com cookies.txt` | `cookiefile example.com cookies.txt` |

### Tabs
| Command | Example |
|---------|---------|
| `tabs` | list all tabs |
| `newTab "https://..."` | open new tab |
| `closeTab` | close current tab |
| `switchTab 42` | switch to tab ID |

### LinkedIn
| Command | Example |
|---------|---------|
| `jobs-search "Python"` | open LinkedIn job search |
| `jobs-apply "https://linkedin.com/jobs/view/123"` | go to job listing |

### Utils
| Command | Example |
|---------|---------|
| `status` | device status |
| `ping` | ping |
| `screenshot` | take screenshot |
| `wait 2000` | wait 2 seconds |
| `waitFor "button" 10000` | wait for element |
| `eval "document.title"` | run JS |

## MQTT Topics

```
rbc/{extId}/cmd        ← send commands here
rbc/{extId}/result     ← results come here
rbc/{extId}/status     ← heartbeat
rbc/cmd                ← broadcast to all
```

## Free MQTT Brokers

| Broker | WebSocket |
|--------|-----------|
| HiveMQ | `wss://broker.hivemq.com:8884/mqtt` |
| EMQX | `wss://broker.emqx.io:8084/mqtt` |
| Mosquitto | `wss://test.mosquitto.org:8081` |

## File Structure

```
remote-browser/
├── mqtt-bridge.js     ← Bridge: MQTT ↔ Extension WebSocket
├── rbc.js             ← CLI controller
├── package.json
├── extension/
│   ├── manifest.json  ← Chrome extension manifest
│   ├── background.js  ← MQTT + command executor
│   ├── content.js     ← Page event relay
│   ├── popup.html/js  ← Extension popup UI
│   └── mqtt.min.js    ← MQTT.js library
└── README.md
```

## LinkedIn Job Apply Flow

```bash
# 1. Search jobs
node rbc.js jobs-search "Python Developer Jakarta"

# 2. Browser opens LinkedIn jobs, wait for page
node rbc.js waitFor ".jobs-search-results" 10000

# 3. Get links
node rbc.js links "linkedin.com/jobs/view"

# 4. Navigate to job
node rbc.js navigate "https://linkedin.com/jobs/view/123456"

# 5. Click Easy Apply
node rbc.js click "Easy Apply"

# 6. Fill form
node rbc.js type "#email" "me@mail.com"
node rbc.js type-name "phone" "081234567890"
node rbc.js select "country" "Indonesia"

# 7. Scroll & submit
node rbc.js scroll into "Submit"
node rbc.js click "Submit application"
```
