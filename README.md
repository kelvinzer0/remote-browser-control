# Remote Browser Control

Remote browser control via **MCP** (Model Context Protocol) — Rust native host + Chrome extension.

## Arsitektur

```
Chrome Extension
  | chrome.runtime.connectNative('com.kelvin.rbc')
  | Chrome spawns rbc-host binary
  v
rbc-host (Native Messaging on stdin/stdout)
  | TCP localhost:3000 (JSON-RPC 2.0 per line)
  v
MCP Client (Claude Desktop / OpenClaude)
```

Chrome yang spawn binary secara otomatis — tidak perlu jalankan app manual.

## Setup

### 1. Build & Install

```bash
cd host

# Windows
install.bat

# Linux/Mac
chmod +x install.sh && ./install.sh
```

Script akan:
- Build `rbc-host.exe`
- Copy ke `%LOCALAPPDATA%\rbc\`
- Generate manifest Native Messaging
- Register di Windows Registry

### 2. Load Chrome Extension

1. Buka `chrome://extensions`
2. Developer mode → ON
3. Load unpacked → pilih folder `extension/`
4. Catat Extension ID yang muncul

### 3. Register Extension ID

Jalankan `install.bat` lagi, masukkan Extension ID saat diminta.

### 4. Konfigurasi MCP Client

```json
{
  "mcpServers": {
    "browser": {
      "command": "node",
      "args": ["C:\\Users\\kelvin\\remote-browser-control\\host\\mcp-bridge.js"]
    }
  }
}
```

Atau gunakan transport TCP langsung jika MCP client mendukungnya.

## Cara Kerja

1. Buka Chrome (extension auto-connect ke native host)
2. Chrome spawn `rbc-host.exe` via Native Messaging
3. Binary buka TCP server di `localhost:3000`
4. MCP client connect ke TCP server
5. Kirim perintah → binary relay ke extension → extension eksekusi di browser

## MCP Tools

| Tool | Deskripsi |
|------|-----------|
| `navigate` | Buka URL |
| `go_back` / `go_forward` / `reload` | Navigasi history |
| `click` | Klik elemen |
| `type_text` | Ketik ke input |
| `get_text` / `get_html` | Ambil konten |
| `screenshot` | Screenshot tab |
| `get_tabs` / `new_tab` / `close_tab` | Manajemen tab |
| `eval_js` | Eksekusi JavaScript |
| ...dan 20+ lainnya | |
