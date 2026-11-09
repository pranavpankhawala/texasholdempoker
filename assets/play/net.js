/**
 * Player networking: connects this phone to the host's browser over PeerJS (WebRTC).
 * Reconnects automatically with backoff. Optional `?peer=host:port[:secure]` selects
 * a self-hosted PeerJS server (must match the host page).
 */

const PEER_PREFIX = 'thp-holdem-';

function peerOptions() {
  const raw = new URLSearchParams(location.search).get('peer');
  const base = { debug: 0 };
  if (!raw) return base;
  const [host, port, secure] = raw.split(':');
  if (!/^[a-z0-9.-]+$/i.test(host || '')) return base;
  return { ...base, host, port: Number(port) || (secure === 'secure' ? 443 : 80), path: '/', secure: secure === 'secure' };
}

/**
 * @param {{room:string, clientId:string, onMessage:(m:object)=>void, onStatus:(s:{state:string, detail?:string})=>void}} opts
 */
export function connect({ room, clientId, onMessage, onStatus }) {
  if (typeof window.Peer !== 'function') {
    onStatus({ state: 'error', detail: 'Networking library failed to load. Check your connection and reload.' });
    return { send() { return false; }, close() {} };
  }
  let peer = null;
  let conn = null;
  let closed = false;
  let attempt = 0;
  let timer = null;
  let everConnected = false;

  function start() {
    if (closed) return;
    onStatus({ state: everConnected ? 'reconnecting' : 'connecting' });
    if (!peer || peer.destroyed) {
      peer = new window.Peer(undefined, peerOptions());
      peer.on('open', dial);
      peer.on('disconnected', () => { if (!closed && !peer.destroyed) setTimeout(() => peer.reconnect(), 1000); });
      peer.on('error', (err) => {
        if (closed) return;
        if (err?.type === 'peer-unavailable') {
          onStatus({ state: everConnected ? 'reconnecting' : 'not-found', detail: everConnected ? 'The host screen went away. Waiting for it to come back…' : 'Room not found. Check the code and make sure the host screen is open.' });
          if (everConnected) schedule(); else closed = true;
        } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err?.type)) {
          onStatus({ state: 'reconnecting', detail: 'Network problem. Retrying…' });
          try { peer.destroy(); } catch { /* ignore */ }
          schedule();
        } else {
          console.warn('peer error', err?.type, err);
        }
      });
    } else if (peer.open) {
      dial();
    }
  }

  function dial() {
    if (closed) return;
    conn = peer.connect(PEER_PREFIX + room, { metadata: { clientId }, reliable: true, serialization: 'json' });
    const c = conn;
    const openTimer = setTimeout(() => { if (!c.open && !closed) { try { c.close(); } catch { /* ignore */ } schedule(); } }, 12000);
    c.on('open', () => {
      clearTimeout(openTimer);
      attempt = 0;
      everConnected = true;
      onStatus({ state: 'online' });
      c.send({ t: 'hello' });
    });
    c.on('data', (d) => { if (d && typeof d === 'object' && typeof d.t === 'string') onMessage(d); });
    c.on('close', () => { if (!closed && conn === c) { onStatus({ state: 'reconnecting', detail: 'Connection lost. Reconnecting…' }); schedule(); } });
    c.on('error', () => { if (!closed && conn === c) schedule(); });
  }

  function schedule() {
    clearTimeout(timer);
    const delay = Math.min(10000, 1000 * 2 ** attempt);
    attempt += 1;
    timer = setTimeout(start, delay);
  }

  // Phones often drop connections when the screen locks; reconnect on return.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !closed && (!conn || !conn.open)) { attempt = 0; clearTimeout(timer); start(); }
  });

  start();

  return {
    send(msg) {
      if (conn && conn.open) { conn.send(msg); return true; }
      return false;
    },
    close() {
      closed = true;
      clearTimeout(timer);
      try { conn?.close(); } catch { /* ignore */ }
      try { peer?.destroy(); } catch { /* ignore */ }
    },
  };
}
