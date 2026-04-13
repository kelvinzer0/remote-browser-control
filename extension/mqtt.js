/**
 * Minimal MQTT 3.1.1 over WebSocket client
 * Designed for Chrome Extension MV3 Service Workers
 * No dependencies, no polyfills needed
 */
(function(root) {
  'use strict';

  // ── MQTT Packet Types ────────────────────
  const CONNECT = 1, CONNACK = 2, PUBLISH = 3, SUBSCRIBE = 8,
        SUBACK = 9, PINGREQ = 12, PINGRESP = 13, DISCONNECT = 14;

  // ── Encode remaining length (MQTT spec) ──
  function encLen(n) {
    const bytes = [];
    do {
      let b = n % 128;
      n = (n / 128) | 0;
      if (n > 0) b |= 0x80;
      bytes.push(b);
    } while (n > 0);
    return bytes;
  }

  function decLen(buf, pos) {
    let mul = 1, val = 0, b;
    do {
      b = buf[pos++];
      val += (b & 0x7f) * mul;
      mul *= 128;
    } while (b & 0x80);
    return { val, pos };
  }

  // ── Encode/Decode UTF-8 string with 2-byte length prefix ──
  function encStr(s) {
    const utf8 = unescape(encodeURIComponent(s));
    const a = new Uint8Array(2 + utf8.length);
    a[0] = (utf8.length >> 8) & 0xff;
    a[1] = utf8.length & 0xff;
    for (let i = 0; i < utf8.length; i++) a[2 + i] = utf8.charCodeAt(i);
    return a;
  }

  function decStr(buf, pos) {
    const len = (buf[pos] << 8) | buf[pos + 1];
    let s = '';
    for (let i = 0; i < len; i++) s += String.fromCharCode(buf[pos + 2 + i]);
    return { str: decodeURIComponent(escape(s)), pos: pos + 2 + len };
  }

  // ── Build a packet ──────────────────────
  function buildPacket(type, ...parts) {
    let bodyLen = 0;
    parts.forEach(p => bodyLen += p.length);
    const lenBytes = encLen(bodyLen);
    const pkt = new Uint8Array(1 + lenBytes.length + bodyLen);
    pkt[0] = type << 4;
    let off = 1;
    lenBytes.forEach(b => pkt[off++] = b);
    parts.forEach(p => { pkt.set(p, off); off += p.length; });
    return pkt;
  }

  // ── Client Class ────────────────────────
  function MqttClient(url, opts) {
    this.url = url;
    this.clientId = opts.clientId || ('c' + Math.random().toString(36).slice(2, 10));
    this.reconnectPeriod = opts.reconnectPeriod || 0;
    this.keepaliveMs = (opts.keepalive || 30) * 1000;
    this.ws = null;
    this.connected = false;
    this._handlers = {};
    this._pingTimer = null;
    this._reconnectTimer = null;
    this._closed = false;
    this._pktId = 0;
  }

  MqttClient.prototype.on = function(evt, fn) {
    (this._handlers[evt] = this._handlers[evt] || []).push(fn);
    return this;
  };

  MqttClient.prototype._emit = function(evt) {
    const fns = this._handlers[evt] || [];
    const args = Array.prototype.slice.call(arguments, 1);
    for (let i = 0; i < fns.length; i++) {
      try { fns[i].apply(null, args); } catch(e) { console.error('[mqtt]', e); }
    }
  };

  MqttClient.prototype.connect = function() {
    if (this._closed) return;
    const self = this;
    try {
      this.ws = new WebSocket(this.url);
    } catch(e) {
      this._emit('error', e);
      return;
    }
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = function() {
      console.log('[mqtt] WS open, sending CONNECT');
      // CONNECT packet
      const proto = encStr('MQTT');
      const level = new Uint8Array([4]);      // MQTT 3.1.1
      const flags = new Uint8Array([0x02]);   // Clean Session
      const keep = new Uint8Array([0, 30]);   // 30s keepalive
      const cid = encStr(self.clientId);
      const pkt = buildPacket(CONNECT, proto, level, flags, keep, cid);
      console.log('[mqtt] CONNECT pkt len=' + pkt.length);
      self.ws.send(pkt);
    };

    this.ws.onmessage = function(ev) {
      const raw = ev.data;
      const data = raw instanceof ArrayBuffer ? new Uint8Array(raw) : new Uint8Array(raw.buffer || raw);
      if (data.length < 2) return;
      const type = data[0] >> 4;
      const rl = decLen(data, 1);
      const body = rl.pos;
      console.log('[mqtt] RECV type=' + type + ' len=' + data.length + ' body=' + body);

      switch (type) {
        case CONNACK:
          console.log('[mqtt] CONNACK, rc=' + data[body + 1] + ' flags=' + data[body]);
          if (data[body + 1] === 0) { // return code 0 = accepted
            self.connected = true;
            self._emit('connect');
            console.log('[mqtt] Connected! Starting keepalive');
            // Start keepalive pings
            clearInterval(self._pingTimer);
            self._pingTimer = setInterval(function() {
              if (self.ws && self.ws.readyState === 1) {
                self.ws.send(new Uint8Array([PINGREQ << 4, 0]));
              }
            }, self.keepaliveMs - 2000);
          } else {
            self._emit('error', new Error('CONNACK rc=' + data[body + 1]));
          }
          break;

        case PUBLISH: {
          const t = decStr(data, body);
          const qos = (data[0] >> 1) & 3;
          let payOff = t.pos;
          if (qos > 0) payOff += 2; // skip packet ID
          const msg = data.slice(payOff);
          self._emit('message', t.str, msg);
          break;
        }

        case SUBACK:
          break;

        case PINGRESP:
          break;
      }
    };

    this.ws.onclose = function() {
      self.connected = false;
      clearInterval(self._pingTimer);
      self._emit('close');
      if (!self._closed && self.reconnectPeriod > 0) {
        self._reconnectTimer = setTimeout(function() { self.connect(); }, self.reconnectPeriod);
      }
    };

    this.ws.onerror = function(e) {
      self._emit('error', e);
    };
  };

  MqttClient.prototype.subscribe = function(topics, opts) {
    if (!this.ws || this.ws.readyState !== 1) return;
    const list = Array.isArray(topics) ? topics : [topics];
    const qos = (opts && opts.qos) || 0;
    this._pktId = (this._pktId + 1) || 1;
    for (let i = 0; i < list.length; i++) {
      const t = encStr(list[i]);
      const q = new Uint8Array([qos]);
      const pid = new Uint8Array([this._pktId >> 8, this._pktId & 0xff]);
      this.ws.send(buildPacket(SUBSCRIBE, pid, t, q));
    }
  };

  MqttClient.prototype.publish = function(topic, payload, opts) {
    if (!this.ws || this.ws.readyState !== 1) return;
    const t = encStr(topic);
    const p = typeof payload === 'string'
      ? (function() {
          const utf8 = unescape(encodeURIComponent(payload));
          const a = new Uint8Array(utf8.length);
          for (let i = 0; i < utf8.length; i++) a[i] = utf8.charCodeAt(i);
          return a;
        })()
      : new Uint8Array(payload);
    this.ws.send(buildPacket(PUBLISH, t, p));
  };

  MqttClient.prototype.end = function() {
    this._closed = true;
    clearInterval(this._pingTimer);
    clearTimeout(this._reconnectTimer);
    if (this.ws) {
      try {
        this.ws.send(new Uint8Array([DISCONNECT << 4, 0]));
        this.ws.close();
      } catch(e) {}
    }
    this.connected = false;
  };

  // ── Export ───────────────────────────────
  root.mqtt = {
    connect: function(url, opts) {
      const c = new MqttClient(url, opts || {});
      c.connect();
      return c;
    }
  };

})(typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : this);
