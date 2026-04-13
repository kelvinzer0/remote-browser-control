/**
 * RBC Cloudflare Worker — Entry Point
 *
 * Routes:
 *   GET  /api/health           — worker health check
 *   GET  /device/{id}/status   — device status (HTTP)
 *   POST /device/{id}/cmd      — send command (fire & forget)
 *   POST /device/{id}/execute  — send command + wait for result
 *   WS   /device/{id}?role=ext — extension WebSocket
 *   WS   /device/{id}?role=cli — CLI WebSocket
 */

import { DeviceRoom } from './device-room.js';

export { DeviceRoom };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === '/api/health') {
      return Response.json({ ok: true, service: 'rbc-relay', ts: Date.now() });
    }

    // Parse /device/{id}/... routes
    const match = url.pathname.match(/^\/device\/([a-zA-Z0-9_]+)(.*)$/);
    if (!match) {
      return Response.json({
        error: 'not found',
        hint: 'Use /device/{deviceId}/status or WebSocket /device/{deviceId}?role=ext|cli',
      }, { status: 404 });
    }

    const deviceId = match[1];
    const rest = match[2] || '/api/status';

    // Get Durable Object for this device
    const id = env.DEVICE_ROOM.idFromName(deviceId);
    const room = env.DEVICE_ROOM.get(id);

    // Build internal request to the Durable Object
    const internalUrl = new URL(request.url);
    internalUrl.pathname = rest.startsWith('/api') ? rest : `/api${rest}`;

    // For WebSocket, add role param
    if (request.headers.get('Upgrade') === 'websocket') {
      const role = url.searchParams.get('role') || 'cli';
      internalUrl.searchParams.set('role', role);
    }

    const internalRequest = new Request(internalUrl.toString(), {
      method: request.method,
      headers: request.headers,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
    });

    return room.fetch(internalRequest);
  },
};
