/**
 * Minimal MQTT 3.1.1 client for Chrome Extension MV3 Service Worker
 * Supports WebSocket transport only (wss://)
 * ~200 lines, no dependencies
 */
(function(global) {
  'use strict';

  const PACKET = {
    CONNECT: 1, CONNACK: 2, PUBLISH: 3, PUBACK: 4,
    SUBSCRIBE: 8, SUBACK: 9, PINGREQ: 12, PINGRESP: 13,
    DISCONNECT: 14,
  };

  function encodeLength(length) {
    const enc = [];
    do {
      let byte = length % 128;
      length = Math.floor(length / 128);
      if (length > 0) byte |= 0x80;
      enc.push(byte);
    } while (length > 0);
    return enc;
  }

  function decodeLength(data, offset) {
    let multiplier = 1, value = 0, byte;
    do {
      byte = data[offset++];
      value += (byte & 0x7f) * multiplier;
      multiplier *= 128;
    } while ((byte & 0x80) !== 0);
    return { length: value, offset };
  }

  function encodeString(str) {
    const encoded = new TextEncoder().encode(str);
    const buf = new Uint8Array(2 + encoded.length);
    buf[0] = encoded.length >> 8;
    buf[1] = encoded.length & 0xff;
    buf.set(encoded, 2);
    return buf;
  }

  function decodeString(data, offset) {
    const len = (data[offset] << 8) | data[offset + 1];
    const str = new TextDecoder().decode(data.slice(offset + 2, offset + 2 + len));
    return { str, offset: offset + 2 + len };
  }

  function buildPacket(type, variableHeader, payload) {
    const body = new Uint8Array([...variableHeader, ...(payload || [])]);
    const lengthEnc = encodeLength(body.length);
    return new Uint8Array([type << 4, ...lengthEnc, ...body]);
  }

  class MqttClient {
    constructor(url, options = {}) {
      this.url = url;
      this.options = options;
      this.clientId = options.clientId || ('c_' + Math.random().toString(36).substr(2, 8));
      this.ws = null;
      this.connected = false;
      this.subscriptions = {};
      this.pingInterval = null;
      this.reconnectTimer = null;
      this._handlers = {};
      this._closed = false;
    }

    on(event, handler) {
      if (!this._handlers[event]) this._handlers[event] = [];
      this._handlers[event].push(handler);
    }

    off(event, handler) {
      if (!this._handlers[event]) return;
      this._handlers[event] = this._handlers[event].filter(h => h !== handler);
    }

    _emit(event, ...args) {
      (this._handlers[event] || []).forEach(h => {
        try { h(...args); } catch (e) { console.error('[MQTT]', e); }
      });
    }

    connect() {
      if (this._closed) return;
      try {
        this.ws = new WebSocket(this.url);
        this.ws.binaryType = 'arraybuffer';
      } catch (e) {
        this._emit('error', e);
        return;
      }

      this.ws.onopen = () => {
        // Send CONNECT packet
        const proto = encodeString('MQTT');
        const level = new Uint8Array([4]); // MQTT 3.1.1
        const flags = new Uint8Array([0x02]); // Clean session
        const keepalive = new Uint8Array([0, 30]); // 30s
        const clientId = encodeString(this.clientId);
        const packet = buildPacket(PACKET.CONNECT, [...proto, ...level, ...flags, ...keepalive], [...clientId]);
        this.ws.send(packet);
      };

      this.ws.onmessage = (event) => {
        const data = new Uint8Array(event.data);
        if (data.length < 2) return;
        const type = data[0] >> 4;
        const { offset } = decodeLength(data, 1);

        switch (type) {
          case PACKET.CONNACK:
            this.connected = true;
            this._emit('connect');
            // Start keepalive ping
            this.pingInterval = setInterval(() => {
              if (this.ws?.readyState === WebSocket.OPEN) {
                const ping = new Uint8Array([PACKET.PINGREQ << 4, 0]);
                this.ws.send(ping);
              }
            }, 25000);
            break;

          case PACKET.PUBLISH: {
            const topicLen = (data[offset] << 8) | data[offset + 1];
            const topic = new TextDecoder().decode(data.slice(offset + 2, offset + 2 + topicLen));
            const qos = (data[0] >> 1) & 0x03;
            let msgOffset = offset + 2 + topicLen;
            if (qos > 0) msgOffset += 2; // skip packet ID
            const message = data.slice(msgOffset);
            this._emit('message', topic, message);
            break;
          }

          case PACKET.SUBACK:
            break;

          case PACKET.PINGRESP:
            break;
        }
      };

      this.ws.onclose = () => {
        this.connected = false;
        clearInterval(this.pingInterval);
        this._emit('close');
        if (!this._closed && (this.options.reconnectPeriod || 0) > 0) {
          this.reconnectTimer = setTimeout(() => this.connect(), this.options.reconnectPeriod);
        }
      };

      this.ws.onerror = (err) => {
        this._emit('error', err);
      };
    }

    subscribe(topics, options = {}) {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const topicList = Array.isArray(topics) ? topics : [topics];
      const qos = options.qos || 0;

      for (const topic of topicList) {
        const topicBuf = encodeString(topic);
        const qosBuf = new Uint8Array([qos]);
        const packetId = new Uint8Array([0, 1]); // fixed packet ID for simplicity
        const packet = buildPacket(PACKET.SUBSCRIBE, [...packetId], [...topicBuf, ...qosBuf]);
        this.ws.send(packet);
      }
    }

    publish(topic, message, options = {}) {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const topicBuf = encodeString(topic);
      const msgBuf = typeof message === 'string'
        ? new TextEncoder().encode(message)
        : new Uint8Array(message);
      const packet = buildPacket(PACKET.PUBLISH, [...topicBuf], [...msgBuf]);
      this.ws.send(packet);
    }

    end() {
      this._closed = true;
      clearInterval(this.pingInterval);
      clearTimeout(this.reconnectTimer);
      if (this.ws) {
        try {
          const disconnect = new Uint8Array([PACKET.DISCONNECT << 4, 0]);
          this.ws.send(disconnect);
          this.ws.close();
        } catch {}
      }
      this.connected = false;
    }
  }

  // Export as global `mqtt` matching the same API as mqtt.js
  global.mqtt = {
    connect(url, options) {
      const client = new MqttClient(url, options);
      client.connect();
      return client;
    }
  };

})(typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : this);
