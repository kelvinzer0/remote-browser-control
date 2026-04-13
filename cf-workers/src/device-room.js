/**
 * DeviceRoom — Cloudflare Durable Object
 *
 * Relay for Remote Browser Control. Replaces MQTT broker.
 *
 * Connections:
 *   - Extension → ws://host/device/{deviceId}?role=ext
 *   - CLI       → ws://host/device/{deviceId}?role=cli
 *
 * Message flow:
 *   CLI sends:      { type: "command", action, params, commandId }
 *   Extension recv: { type: "command", action, params, commandId }
 *   Extension sends:{ type: "result", commandId, ok, data?, error? }
 *   CLI recv:       { type: "result", commandId, ok, data?, error? }
 */

export class DeviceRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.extSockets = new Set();
    this.cliSockets = new Set();
    this.extInfo = null;
    this.lastSeen = 0;
    // For HTTP /execute — pending result resolvers
    this.pendingResults = new Map();
  }

  async fetch(request) {
    const url = new URL(request.url);

    // ── WebSocket upgrade ────────────────────
    if (request.headers.get('Upgrade') === 'websocket') {
      const role = url.searchParams.get('role') || 'cli';
      return this.handleUpgrade(request, role);
    }

    // ── HTTP API ─────────────────────────────

    // GET /api/status — device status
    if (url.pathname === '/api/status') {
      return Response.json({
        extOnline: this.extSockets.size > 0,
        extInfo: this.extInfo,
        cliConnected: this.cliSockets.size,
        lastSeen: this.lastSeen,
      });
    }

    // POST /api/cmd — fire-and-forget command
    if (url.pathname === '/api/cmd' && request.method === 'POST') {
      const cmd = await request.json();
      const commandId = cmd.commandId || `http_${Date.now()}`;

      if (this.extSockets.size === 0) {
        return Response.json({ error: 'extension offline' }, { status: 503 });
      }

      this.sendToExt({
        type: 'command',
        action: cmd.action,
        params: cmd.params || {},
        commandId,
      });

      return Response.json({ sent: true, commandId }, { status: 202 });
    }

    // POST /api/execute — send command and wait for result
    if (url.pathname === '/api/execute' && request.method === 'POST') {
      const cmd = await request.json();
      const commandId = cmd.commandId || `exec_${Date.now()}`;
      const timeout = cmd.timeout || 30000;

      if (this.extSockets.size === 0) {
        return Response.json({ error: 'extension offline' }, { status: 503 });
      }

      // Set up promise for result
      const result = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pendingResults.delete(commandId);
          reject(new Error('timeout'));
        }, timeout);

        this.pendingResults.set(commandId, { resolve, reject, timer });

        this.sendToExt({
          type: 'command',
          action: cmd.action,
          params: cmd.params || {},
          commandId,
        });
      });

      return Response.json(result);
    }

    // GET /api/health
    if (url.pathname === '/api/health') {
      return Response.json({ ok: true });
    }

    return Response.json({ error: 'not found' }, { status: 404 });
  }

  // ── WebSocket handling ─────────────────────
  handleUpgrade(request, role) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    if (role === 'ext') {
      this.extSockets.add(server);
      this.lastSeen = Date.now();
    } else {
      this.cliSockets.add(server);
      // Send current status to new CLI
      server.send(JSON.stringify({
        type: 'status',
        extOnline: this.extSockets.size > 0,
        extInfo: this.extInfo,
      }));
    }

    server.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (role === 'ext') this.onExtMessage(msg);
        else this.onCliMessage(server, msg);
      } catch {}
    });

    server.addEventListener('close', () => {
      if (role === 'ext') {
        this.extSockets.delete(server);
        this.broadcastToCli({ type: 'status', extOnline: false, extInfo: this.extInfo });
      } else {
        this.cliSockets.delete(server);
      }
    });

    server.addEventListener('error', () => server.close());

    return new Response(null, { status: 101, webSocket: client });
  }

  // ── Extension messages ─────────────────────
  onExtMessage(msg) {
    switch (msg.type) {
      case 'status':
        this.extInfo = { extId: msg.extId, url: msg.url, title: msg.title, tabs: msg.tabs };
        this.lastSeen = Date.now();
        this.broadcastToCli({ type: 'status', extOnline: true, extInfo: this.extInfo, ts: Date.now() });
        break;

      case 'result': {
        // Check if there's a pending HTTP result
        const pending = this.pendingResults.get(msg.commandId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingResults.delete(msg.commandId);
          pending.resolve(msg);
        }
        // Also broadcast to CLI WebSocket clients
        this.broadcastToCli(msg);
        break;
      }

      case 'heartbeat':
        this.lastSeen = Date.now();
        break;

      default:
        this.broadcastToCli(msg);
    }
  }

  // ── CLI messages ───────────────────────────
  onCliMessage(ws, msg) {
    switch (msg.type) {
      case 'command':
        if (this.extSockets.size === 0) {
          ws.send(JSON.stringify({
            type: 'result',
            commandId: msg.commandId,
            ok: false,
            error: 'extension offline',
          }));
          return;
        }
        this.sendToExt(msg);
        break;

      case 'status':
        ws.send(JSON.stringify({
          type: 'status',
          extOnline: this.extSockets.size > 0,
          extInfo: this.extInfo,
        }));
        break;

      case 'ping':
        ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
        break;
    }
  }

  // ── Helpers ────────────────────────────────
  sendToExt(msg) {
    const payload = JSON.stringify(msg);
    for (const ws of this.extSockets) {
      try { ws.send(payload); } catch { this.extSockets.delete(ws); }
    }
  }

  broadcastToCli(msg) {
    const payload = typeof msg === 'string' ? msg : JSON.stringify(msg);
    for (const ws of this.cliSockets) {
      try { ws.send(payload); } catch { this.cliSockets.delete(ws); }
    }
  }
}
