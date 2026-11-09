/**
 * Host networking: the host browser is the "server". Players' phones connect
 * peer-to-peer via PeerJS (WebRTC). Only the public PeerJS broker is used to
 * introduce the devices; game data flows directly between them.
 *
 * Optional `?peer=host:port` (or `host:port:secure`) on the page URL points at a
 * self-hosted PeerJS server instead of the public one.
 */

export const PEER_PREFIX = 'thp-holdem-';

export function peerOptionsFromUrl() {
  const raw = new URLSearchParams(location.search).get('peer');
  const base = { debug: 0 };
  if (!raw) return base;
  const [host, port, secure] = raw.split(':');
  if (!/^[a-z0-9.-]+$/i.test(host || '')) return base;
  return { ...base, host, port: Number(port) || (secure === 'secure' ? 443 : 80), path: '/', secure: secure === 'secure' };
}

/**
 * @param {{room:string, onMessage:(clientId:string, msg:object)=>void, onStatus:(s:{state:string, detail?:string})=>void, onPeers:()=>void}} opts
 */
export function createHost({ room, onMessage, onStatus, onPeers }) {
  if (typeof window.Peer !== 'function') {
    onStatus({ state: 'error', detail: 'Networking library failed to load.' });
    return { send() {}, broadcast() {}, connectedIds: () => new Set(), destroy() {} };
  }
  const conns = new Map(); // clientId -> DataConnection
  let peer = null;
  let destroyed = false;
  let retry = 0;
  let retryTimer = null;

  function open() {
    if (destroyed) return;
    onStatus({ state: 'connecting' });
    peer = new window.Peer(PEER_PREFIX + room, peerOptionsFromUrl());

    peer.on('open', () => { retry = 0; onStatus({ state: 'online' }); });

    peer.on('connection', (conn) => {
      const clientId = String(conn.metadata?.clientId || '').slice(0, 64);
      if (!clientId) { conn.close(); return; }
      conn.on('open', () => {
        const old = conns.get(clientId);
        if (old && old !== conn) old.close();
        conns.set(clientId, conn);
        onPeers();
      });
      conn.on('data', (data) => {
        if (data && typeof data === 'object' && typeof data.t === 'string') onMessage(clientId, data);
      });
      const drop = () => {
        if (conns.get(clientId) === conn) { conns.delete(clientId); onPeers(); }
      };
      conn.on('close', drop);
      conn.on('error', drop);
    });

    peer.on('disconnected', () => {
      if (destroyed) return;
      onStatus({ state: 'reconnecting', detail: 'Lost the connection to the matchmaking server. Players already connected can keep playing.' });
      setTimeout(() => { if (!destroyed && peer && !peer.destroyed) peer.reconnect(); }, 1500);
    });

    peer.on('error', (err) => {
      if (destroyed) return;
      const type = err?.type || 'error';
      if (type === 'unavailable-id') {
        // A previous host tab is still registered (e.g. right after a refresh). Try again shortly.
        onStatus({ state: 'reconnecting', detail: 'Room is still held by a previous session. Retrying…' });
        scheduleReopen();
      } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(type)) {
        onStatus({ state: 'reconnecting', detail: 'Can’t reach the matchmaking server. Retrying…' });
        scheduleReopen();
      } else if (type === 'browser-incompatible') {
        onStatus({ state: 'error', detail: 'This browser doesn’t support peer-to-peer connections.' });
      } else {
        console.warn('Peer error', type, err);
      }
    });
  }

  function scheduleReopen() {
    clearTimeout(retryTimer);
    try { peer?.destroy(); } catch { /* ignore */ }
    const delay = Math.min(15000, 2000 * 2 ** retry);
    retry += 1;
    retryTimer = setTimeout(open, delay);
  }

  function send(clientId, msg) {
    const c = conns.get(clientId);
    if (c && c.open) { try { c.send(msg); } catch (e) { console.warn('send failed', e); } }
  }

  open();

  return {
    send,
    broadcast(build) { for (const id of conns.keys()) send(id, build(id)); },
    connectedIds: () => new Set([...conns.entries()].filter(([, c]) => c.open).map(([id]) => id)),
    destroy() { destroyed = true; clearTimeout(retryTimer); try { peer?.destroy(); } catch { /* ignore */ } },
  };
}
