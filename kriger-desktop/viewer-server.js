// viewer-server.js — servidor chico de SOLO LECTURA para ver la info desde el
// celular en la misma red WiFi. No permite modificar nada.

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const report = require('./report');

let server = null;
let port = 0;

function lanIP() {
  const ifs = os.networkInterfaces();
  // Preferimos direcciones de red local típicas.
  const all = [];
  for (const name of Object.keys(ifs)) {
    for (const i of (ifs[name] || [])) {
      if (i.family === 'IPv4' && !i.internal) all.push(i.address);
    }
  }
  const pref = all.find(a => a.startsWith('192.168.') || a.startsWith('10.') || a.startsWith('172.'));
  return pref || all[0] || '127.0.0.1';
}

function today() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function start(getStore, startPort) {
  return new Promise((resolve) => {
    let html = '';
    try { html = fs.readFileSync(path.join(__dirname, 'viewer', 'index.html'), 'utf8'); }
    catch (e) { html = '<h1>Visor Kriger</h1>'; }

    server = http.createServer((req, res) => {
      let url;
      try { url = new URL(req.url, 'http://local'); } catch (e) { res.writeHead(400); res.end(); return; }

      if (url.pathname === '/' || url.pathname === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }
      if (url.pathname === '/report') {
        let store;
        try { store = getStore(); } catch (e) { res.writeHead(500); res.end('{}'); return; }
        const pin = (store.config && store.config.viewerPin) || '';
        const given = url.searchParams.get('pin') || '';
        if (pin && given !== pin) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ needPin: true }));
          return;
        }
        const rep = report.buildReport(store, url.searchParams.get('fecha') || today());
        rep.pinRequerido = !!pin;
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(rep));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('No encontrado');
    });

    let p = startPort || 7777;
    const onErr = (e) => {
      if (e && e.code === 'EADDRINUSE' && p < 7799) { p++; server.listen(p, '0.0.0.0'); }
      else { resolve({ ok: false, error: String(e && e.message || e) }); }
    };
    server.on('error', onErr);
    server.listen(p, '0.0.0.0', () => {
      port = p;
      resolve({ ok: true, port: p, ip: lanIP() });
    });
  });
}

function info() {
  return { port, ip: lanIP(), url: port ? `http://${lanIP()}:${port}` : '' };
}

module.exports = { start, info };
