(() => {
  'use strict';
  const ORIGIN = 'https://ikea.timeplan-software.net';
  const root = document.createElement('div');
  root.id = 'tp-alpha-connection';
  root.style.cssText = 'position:fixed;right:16px;top:12px;z-index:2147483647;background:#fff;border:1px solid #ccd7e2;border-radius:9px;padding:9px 12px;font:13px Arial;box-shadow:0 2px 12px #0002;display:flex;gap:10px;align-items:center';
  root.innerHTML = '<span id="tp-alpha-status">● Waiting for TimePlan</span><button id="tp-alpha-refresh" disabled style="padding:7px 10px;cursor:pointer">↻ Refresh roster</button>';
  document.body.appendChild(root);
  const status = root.querySelector('#tp-alpha-status');
  const button = root.querySelector('#tp-alpha-refresh');
  let connected = false, busy = false, lastSeen = 0;
  const source = window.opener;
  function setStatus(label, color) { status.textContent = '● ' + label; status.style.color = color; button.disabled = !connected || busy; }
  function send(type) {
    if (!source || source.closed) return false;
    source.postMessage({type}, ORIGIN);
    return true;
  }
  window.addEventListener('message', event => {
    if (event.origin !== ORIGIN || event.source !== source || !event.data || typeof event.data !== 'object') return;
    const data = event.data;
    if (data.type === 'TIMEPLAN_TOOLS_DATA' || data.type === 'TIMEPLAN_TOOLS_REFRESHED') {
      connected = true; busy = false; lastSeen = Date.now();
      setStatus(data.type === 'TIMEPLAN_TOOLS_REFRESHED' ? 'Roster refreshed' : 'Connected to TimePlan', '#167246');
    } else if (data.type === 'TIMEPLAN_TOOLS_REFRESH_ERROR') {
      busy = false;
      setStatus('Refresh failed: ' + String(data.message || 'Unknown error').slice(0,100), '#b42318');
    } else if (data.type === 'TIMEPLAN_TOOLS_PONG') {
      connected = true; lastSeen = Date.now();
      if (!busy) setStatus('Connected to TimePlan', '#167246');
    }
  });
  button.addEventListener('click', () => {
    if (busy || !connected) return;
    busy = true;
    setStatus('Refreshing roster…', '#52647c');
    if (!send('TIMEPLAN_TOOLS_REQUEST_REFRESH')) { connected = false; busy = false; setStatus('Disconnected', '#b42318'); }
  });
  setInterval(() => {
    if (!source || source.closed) { connected = false; busy = false; setStatus('Disconnected — reopen from TimePlan', '#b42318'); return; }
    if (lastSeen && Date.now() - lastSeen > 20000) { connected = false; busy = false; setStatus('Connection lost — reopen from TimePlan', '#b42318'); }
    send('TIMEPLAN_TOOLS_PING');
  }, 6000);
  // The launcher may send data before this extra script is loaded. Ask for an initial handshake.
  send('TIMEPLAN_TOOLS_READY');
})();
