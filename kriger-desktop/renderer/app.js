// app.js — toda la logica de Kriger.
// Es el mismo boceto que ya funcionaba, pero ahora guarda en la base de datos
// SQLite del disco (a traves de window.api) en vez de en el navegador.

const $ = s => document.querySelector(s), $$ = s => Array.from(document.querySelectorAll(s));

// Estado en memoria. Arranca vacio y se llena desde la base de datos en boot().
let store = { config: { cajeros: [], saldoFrente: 0, saldoFondo: 0, fondoPin: '' }, cajeroActual: null, movs: [], clientes: {}, arqueos: {} };
let fondoVisible = false; // si ya escribio la clave para ver la caja fondo en esta sesion

// ---- Guardado en la base de datos -----------------------------------------
let _st, _saveT;
function showSaved() { const el = $('#saved'); el.classList.add('on'); clearTimeout(_st); _st = setTimeout(() => el.classList.remove('on'), 900); }
function persist() {
  showSaved();
  clearTimeout(_saveT);
  _saveT = setTimeout(() => { window.api.save(store); }, 150);
}

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function pm(s) { if (typeof s === 'number') return s; s = String(s || '').trim().replace(/\s/g, '').replace(/\$/g, ''); if (!s) return 0; const c = s.includes(','), d = s.includes('.'); if (c && d) s = s.replace(/\./g, '').replace(',', '.'); else if (c) s = s.replace(',', '.'); else if (d) s = s.replace(/\./g, ''); const n = parseFloat(s); return isNaN(n) ? 0 : n; }
function fmt(n) { return '$ ' + (n || 0).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }); }
function fmtP(n) { return (n || 0).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }); }
function today() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function fDate(s) { if (!s) return ''; const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; }
function norm(s) { return String(s || '').trim().toLowerCase(); }
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('on'), 1600); }
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const MEDIOS = [['efectivo', 'Efectivo'], ['transferencia', 'Transferencia'], ['cheque', 'Cheque'], ['deposito', 'Depósito'], ['cta corriente', 'Cta corriente'], ['otro', 'Otro']];

function efecto(m) {
  if (m.t === 'venta') return { frente: m.medio === 'efectivo' ? pm(m.monto) : 0, fondo: 0 };
  if (m.t === 'pago') return { frente: m.medio === 'efectivo' ? pm(m.monto) : 0, fondo: 0 };
  if (m.t === 'gasto') return { frente: -pm(m.frente), fondo: -pm(m.fondo) };
  if (m.t === 'mover') return m.dir === 'aFondo' ? { frente: -pm(m.monto), fondo: pm(m.monto) } : { frente: pm(m.monto), fondo: -pm(m.monto) };
  return { frente: 0, fondo: 0 };
}
function saldoHasta(caja, beforeDate) { let s = store.config['saldo' + (caja === 'frente' ? 'Frente' : 'Fondo')] || 0; store.movs.forEach(m => { if (!beforeDate || m.fecha < beforeDate) s += efecto(m)[caja]; }); return s; }
function saldoActual(caja) { let s = store.config['saldo' + (caja === 'frente' ? 'Frente' : 'Fondo')] || 0; store.movs.forEach(m => s += efecto(m)[caja]); return s; }
function ventaDe(date) { return store.movs.filter(m => m.t === 'venta' && m.fecha === date).reduce((a, m) => a + pm(m.monto), 0); }

const TITLES = { cargar: 'Cargar', movs: 'Movimientos', cierre: 'Cierre del día', ventas: 'Ventas', clientes: 'Clientes', estad: 'Estadísticas' };
function show(view) {
  ['login', 'home', 'cargar', 'movs', 'cierre', 'ventas', 'clientes', 'estad'].forEach(v => $('#v-' + v).classList.toggle('hide', v !== view));
  const sub = !['login', 'home'].includes(view);
  $('#backBtn').classList.toggle('hide', !sub);
  $('#brandLabel').classList.toggle('hide', sub);
  $('#barTitle').classList.toggle('hide', !sub);
  $('#barTitle').textContent = TITLES[view] || '';
  const logged = !!store.cajeroActual;
  $('#cajchip').classList.toggle('hide', !logged || view === 'login');
  $('#gearBtn').classList.toggle('hide', !logged || view === 'login');
  if (view === 'home') renderHome();
  if (view === 'cargar') renderCargar();
  if (view === 'movs') renderMovs();
  if (view === 'cierre') renderCierre();
  if (view === 'ventas') renderVentas();
  if (view === 'clientes') renderClientes();
  if (view === 'estad') renderEstad();
  window.scrollTo(0, 0);
}
$('#backBtn').addEventListener('click', () => show('home'));
$$('[data-go]').forEach(b => b.addEventListener('click', () => show(b.dataset.go)));

function renderLogin() {
  $('#cajeroBtns').innerHTML = store.config.cajeros.map(c => `<button class="chip" data-caj="${esc(c)}">${esc(c)}</button>`).join('')
    || '<p class="muted" style="grid-column:1/3;font-size:13px">Agregá el primer cajero abajo.</p>';
}
$('#cajeroBtns').addEventListener('click', e => { const b = e.target.closest('[data-caj]'); if (!b) return; setCajero(b.dataset.caj); });
$('#addCajero').addEventListener('click', () => {
  const n = $('#nuevoCajero').value.trim(); if (!n) return;
  if (!store.config.cajeros.includes(n)) store.config.cajeros.push(n);
  $('#nuevoCajero').value = ''; persist(); renderLogin(); setCajero(n);
});
function setCajero(n) { store.cajeroActual = n; persist(); $('#cajName').textContent = n; show('home'); }
$('#cajchip').addEventListener('click', () => { renderLogin(); show('login'); });

function renderHome() {
  $('#h_venta').textContent = fmt(ventaDe(today()));
  $('#h_frente').textContent = fmt(saldoActual('frente'));
  $('#h_fondo').textContent = fmt(saldoActual('fondo'));
  // Caja fondo reservada: si hay clave y todavia no la escribio, queda tapada.
  const pin = store.config.fondoPin || '';
  const locked = !!pin && !fondoVisible;
  $('#h_fondo').classList.toggle('locked', locked);
  $('#h_fondolock').classList.toggle('hide', !locked);
}
$('#h_fondolock').addEventListener('click', () => {
  const pin = store.config.fondoPin || '';
  const t = prompt('Clave de la caja fondo:');
  if (t == null) return;
  if (t === pin) { fondoVisible = true; renderHome(); }
  else toast('Clave incorrecta');
});

let curTipo = 'venta', curMedio = 'efectivo', curCaja = 'frente', curDir = 'aFondo';
function renderCargar() {
  $('#ve_fecha').value = $('#ga_fecha').value = $('#mo_fecha').value = today();
  $('#ve_medios').innerHTML = MEDIOS.map(([v, l]) => `<button class="chip med${v === curMedio ? ' on' : ''}" data-med="${v}">${l}</button>`).join('');
  refreshClientesDL(); renderUltimos();
}
function selTipo(t) {
  curTipo = t; $$('[data-tipo]').forEach(c => c.classList.toggle('on', c.dataset.tipo === t));
  $('#form-venta').classList.toggle('hide', t !== 'venta'); $('#form-gasto').classList.toggle('hide', t !== 'gasto'); $('#form-mover').classList.toggle('hide', t !== 'mover');
}
$$('[data-tipo]').forEach(c => c.addEventListener('click', () => selTipo(c.dataset.tipo)));
$('#ve_medios').addEventListener('click', e => { const b = e.target.closest('[data-med]'); if (!b) return; curMedio = b.dataset.med; $$('#ve_medios .chip').forEach(c => c.classList.toggle('on', c.dataset.med === curMedio)); });
$$('#form-gasto [data-caja]').forEach(c => c.addEventListener('click', () => { curCaja = c.dataset.caja; $$('#form-gasto [data-caja]').forEach(x => x.classList.toggle('on', x.dataset.caja === curCaja)); $('#ga_single').classList.toggle('hide', curCaja === 'div'); $('#ga_split').classList.toggle('hide', curCaja !== 'div'); }));
$$('#form-mover [data-dir]').forEach(c => c.addEventListener('click', () => { curDir = c.dataset.dir; $$('#form-mover [data-dir]').forEach(x => x.classList.toggle('on', x.dataset.dir === curDir)); }));
document.addEventListener('input', e => { if (e.target.id === 'ga_frente' || e.target.id === 'ga_fondo') $('#ga_total').textContent = fmt(pm($('#ga_frente').value) + pm($('#ga_fondo').value)); });

function refreshClientesDL() { $('#dl_clientes').innerHTML = Object.values(store.clientes).map(c => `<option value="${esc(c.nombre)}">`).join(''); }
function ensureCliente(nombre) { const k = norm(nombre); if (!k) return null; if (!store.clientes[k]) store.clientes[k] = { nombre: nombre.trim(), tel: '', mail: '', cuit: '', dir: '', notas: '' }; return k; }

$('#ve_save').addEventListener('click', () => {
  const monto = pm($('#ve_monto').value); if (!monto) return $('#ve_monto').focus();
  const cli = $('#ve_cliente').value.trim(); if (cli) ensureCliente(cli);
  store.movs.push({ id: uid(), t: 'venta', fecha: $('#ve_fecha').value || today(), cajero: store.cajeroActual, monto, medio: curMedio, cliente: cli, contacto: $('#ve_contacto').value, nota: $('#ve_nota').value.trim() });
  $('#ve_monto').value = ''; $('#ve_cliente').value = ''; $('#ve_nota').value = '';
  persist(); refreshClientesDL(); renderUltimos(); toast('Venta guardada');
});
$('#ga_save').addEventListener('click', () => {
  let frente = 0, fondo = 0;
  if (curCaja === 'frente') frente = pm($('#ga_monto').value);
  else if (curCaja === 'fondo') fondo = pm($('#ga_monto').value);
  else { frente = pm($('#ga_frente').value); fondo = pm($('#ga_fondo').value); }
  if (frente + fondo <= 0) return toast('Falta el monto');
  store.movs.push({ id: uid(), t: 'gasto', fecha: $('#ga_fecha').value || today(), cajero: store.cajeroActual, concepto: $('#ga_concepto').value.trim() || 'Gasto', frente, fondo });
  $('#ga_concepto').value = ''; $('#ga_monto').value = ''; $('#ga_frente').value = ''; $('#ga_fondo').value = ''; $('#ga_total').textContent = '$ 0';
  persist(); renderUltimos(); toast('Gasto guardado');
});
$('#mo_save').addEventListener('click', () => {
  const monto = pm($('#mo_monto').value); if (!monto) return $('#mo_monto').focus();
  store.movs.push({ id: uid(), t: 'mover', fecha: $('#mo_fecha').value || today(), cajero: store.cajeroActual, monto, dir: curDir });
  $('#mo_monto').value = ''; persist(); renderUltimos(); toast('Movimiento guardado');
});

function pillC(m) { return m === 'efectivo' ? 'ef' : m === 'transferencia' ? 'tr' : m === 'cheque' ? 'ch' : m === 'cta corriente' ? 'cc' : ''; }
function movLabel(m) {
  if (m.t === 'venta') return { pill: pillC(m.medio), txt: m.medio, desc: (m.cliente || '') + (m.nota ? ' · ' + m.nota : ''), amt: pm(m.monto), sign: '' };
  if (m.t === 'pago') return { pill: 'ef', txt: 'pago', desc: m.cliente || '', amt: pm(m.monto), sign: '' };
  if (m.t === 'gasto') return { pill: 'ga', txt: 'gasto', desc: m.concepto + (pm(m.frente) && pm(m.fondo) ? ` (mostr ${fmtP(pm(m.frente))} / fondo ${fmtP(pm(m.fondo))})` : ''), amt: pm(m.frente) + pm(m.fondo), sign: '-' };
  if (m.t === 'mover') return { pill: 'mo', txt: 'mover', desc: m.dir === 'aFondo' ? 'mostrador → fondo' : 'fondo → mostrador', amt: pm(m.monto), sign: '' };
  return { pill: '', txt: m.t, desc: '', amt: 0, sign: '' };
}
function renderUltimos() {
  const hoy = store.movs.filter(m => m.fecha === today()).slice().reverse().slice(0, 8);
  $('#ultimos').innerHTML = hoy.length ? `<table><tbody>${hoy.map(m => { const L = movLabel(m); return `<tr>
    <td><span class="pill ${L.pill}">${esc(L.txt)}</span></td>
    <td>${esc(L.desc) || '<span class="muted">—</span>'}</td>
    <td class="num">${L.sign}${fmt(L.amt)}</td>
    <td><button class="tdel" data-delm="${m.id}">×</button></td></tr>`; }).join('')}</tbody></table>`
    : '<div class="empty">Sin movimientos hoy.</div>';
}
document.addEventListener('click', e => {
  const d = e.target.closest('[data-delm]'); if (!d) return;
  if (!confirm('¿Borrar este movimiento?')) return;
  store.movs = store.movs.filter(m => m.id !== d.dataset.delm); persist();
  renderUltimos(); if (!$('#v-clientes').classList.contains('hide')) renderCliMovs(curCli); if (!$('#v-ventas').classList.contains('hide')) renderVentas(); if (!$('#v-movs').classList.contains('hide')) renderMovs();
});

let curCi = null;
function renderCierre() {
  if (!curCi) curCi = today();
  $('#ci_fecha').value = curCi;
  const date = curCi;
  const movs = store.movs.filter(m => m.fecha === date);
  const ventas = movs.filter(m => m.t === 'venta');
  const efTot = ventas.filter(v => v.medio === 'efectivo').reduce((a, v) => a + pm(v.monto), 0);
  const transf = ventas.filter(v => v.medio === 'transferencia');
  const cheques = ventas.filter(v => v.medio === 'cheque');
  const otras = ventas.filter(v => !['efectivo', 'transferencia', 'cheque'].includes(v.medio));
  const ventaTotal = ventas.reduce((a, v) => a + pm(v.monto), 0);
  const gastos = movs.filter(m => m.t === 'gasto');
  const movers = movs.filter(m => m.t === 'mover');
  const arq = store.arqueos[date] || {};

  function arqueoCaja(caja) {
    const ini = saldoHasta(caja, date); const ent = [], sal = [];
    if (caja === 'frente') {
      if (efTot) ent.push(['Ventas en efectivo', efTot]);
      movs.filter(m => m.t === 'pago' && m.medio === 'efectivo').forEach(p => ent.push(['Pago cta cte ' + (p.cliente || ''), pm(p.monto)]));
      movers.filter(m => m.dir === 'aFrente').forEach(m => ent.push(['Vino del fondo', pm(m.monto)]));
      movers.filter(m => m.dir === 'aFondo').forEach(m => sal.push(['Pasó al fondo', pm(m.monto)]));
      gastos.filter(g => pm(g.frente)).forEach(g => sal.push(['Gasto: ' + g.concepto, pm(g.frente)]));
    } else {
      movers.filter(m => m.dir === 'aFondo').forEach(m => ent.push(['Vino del mostrador', pm(m.monto)]));
      movers.filter(m => m.dir === 'aFrente').forEach(m => sal.push(['Pasó al mostrador', pm(m.monto)]));
      gastos.filter(g => pm(g.fondo)).forEach(g => sal.push(['Gasto: ' + g.concepto, pm(g.fondo)]));
    }
    const esperado = ini + ent.reduce((a, x) => a + x[1], 0) - sal.reduce((a, x) => a + x[1], 0);
    return { ini, ent, sal, esperado };
  }
  const aF = arqueoCaja('frente'), aD = arqueoCaja('fondo');
  function arqHTML(titulo, color, a, key) {
    const cont = arq[key];
    const dif = cont != null && cont !== '' ? pm(cont) - a.esperado : null;
    return `<div class="arqueo"><h3><span class="dot" style="background:${color}"></span>${titulo}</h3>
      <div class="ln"><span>Saldo al iniciar el día</span><span class="v">${fmt(a.ini)}</span></div>
      ${a.ent.map(x => `<div class="ln sub"><span>+ ${esc(x[0])}</span><span class="v">${fmt(x[1])}</span></div>`).join('')}
      ${a.sal.map(x => `<div class="ln sub"><span>− ${esc(x[0])}</span><span class="v">−${fmtP(x[1])}</span></div>`).join('')}
      <div class="esper"><span>Tiene que haber</span><span class="v">${fmt(a.esperado)}</span></div>
      <div class="ln" style="margin-top:6px"><span>Conté en la caja</span><input class="money" inputmode="decimal" data-arq="${key}" value="${cont != null && cont !== '' ? fmtP(pm(cont)) : ''}" style="width:140px;text-align:right;padding:8px 10px"></div>
      ${dif != null ? `<div class="dif ${Math.abs(dif) < 0.5 ? 'ok' : 'bad'}">${Math.abs(dif) < 0.5 ? '✓ Cuadra' : (dif > 0 ? 'Sobra ' + fmt(dif) : 'Falta ' + fmt(-dif))}</div>` : ''}
    </div>`;
  }

  $('#cierreBody').innerHTML = `
    <div class="hilite"><span class="swipe"></span><div class="top"><span class="l">Venta del día</span><span class="v">${fmt(ventaTotal)}</span></div></div>
    <div class="card">
      <div class="lbl" style="margin-bottom:8px">Ventas</div>
      <div class="ln"><span>Efectivo <span class="muted">(total)</span></span><span class="v">${fmt(efTot)}</span></div>
      <div class="rule"></div>
      <div class="ln"><span>Transferencias</span><span class="v">${fmt(transf.reduce((a, v) => a + pm(v.monto), 0))}</span></div>
      ${transf.map(v => `<div class="ln sub"><span>${esc(v.cliente || 'sin nombre')}</span><span class="v">${fmt(pm(v.monto))}</span></div>`).join('')}
      <div class="rule"></div>
      <div class="ln"><span>Cheques</span><span class="v">${fmt(cheques.reduce((a, v) => a + pm(v.monto), 0))}</span></div>
      ${cheques.map(v => `<div class="ln sub"><span>${esc(v.cliente || 'sin nombre')}</span><span class="v">${fmt(pm(v.monto))}</span></div>`).join('')}
      ${otras.length ? '<div class="rule"></div>' + otras.map(v => `<div class="ln sub"><span>${esc(v.medio)} · ${esc(v.cliente || '')}</span><span class="v">${fmt(pm(v.monto))}</span></div>`).join('') : ''}
    </div>
    ${gastos.length ? `<div class="card"><div class="lbl" style="margin-bottom:8px">Gastos del día</div>
      ${gastos.map(g => `<div class="ln"><span>${esc(g.concepto)}</span><span class="v">${fmt(pm(g.frente) + pm(g.fondo))}</span></div>`).join('')}</div>` : ''}
    <div class="card">
      <div class="lbl">Arqueo de caja</div>
      ${arqHTML('Caja mostrador', '#9CC112', aF, 'frente')}
      ${arqHTML('Caja fondo', '#27347A', aD, 'fondo')}
    </div>`;
}
$('#ci_fecha').addEventListener('change', e => { curCi = e.target.value; renderCierre(); });
document.addEventListener('input', e => { const t = e.target; if (t.dataset && t.dataset.arq) { store.arqueos[curCi] = store.arqueos[curCi] || {}; store.arqueos[curCi][t.dataset.arq] = t.value; persist(); } });
document.addEventListener('focusout', e => { if (e.target.dataset && e.target.dataset.arq) renderCierre(); });

function mesKey(f) { return f ? f.slice(0, 7) : ''; }
function fillMes(sel) {
  const meses = [...new Set(store.movs.filter(m => m.t === 'venta').map(m => mesKey(m.fecha)).filter(Boolean))].sort().reverse();
  const v = $(sel).value;
  $(sel).innerHTML = '<option value="">Todos los meses</option>' + meses.map(m => { const [y, mm] = m.split('-'); return `<option value="${m}">${MESES[+mm - 1]} ${y}</option>`; }).join('');
  if (v) $(sel).value = v;
}
function renderVentas() {
  fillMes('#fl_mes');
  const q = norm($('#fl_q').value), mes = $('#fl_mes').value;
  let rows = store.movs.filter(m => m.t === 'venta').filter(m => {
    if (mes && mesKey(m.fecha) !== mes) return false;
    if (q && !(norm(m.cliente).includes(q) || norm(m.nota).includes(q) || norm(m.cajero).includes(q))) return false; return true;
  }).sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '') || b.id.localeCompare(a.id));
  const tot = rows.reduce((a, v) => a + pm(v.monto), 0);
  $('#ventasTable').innerHTML = rows.length ? `<div class="ln" style="margin-bottom:4px"><span class="muted" style="font-size:12px">${rows.length} ventas</span><span style="font-weight:700" class="tabnum">${fmt(tot)}</span></div>
    <table><thead><tr><th>Fecha</th><th>Cliente</th><th>Medio</th><th class="num">Total</th><th></th></tr></thead><tbody>
    ${rows.map(v => `<tr><td>${fDate(v.fecha)}<div class="muted" style="font-size:11px">${esc(v.cajero || '')}</div></td>
      <td>${esc(v.cliente) || '<span class="muted">—</span>'}${v.nota ? `<div class="muted" style="font-size:11px">${esc(v.nota)}</div>` : ''}</td>
      <td><span class="pill ${pillC(v.medio)}">${esc(v.medio)}</span></td>
      <td class="num">${fmt(pm(v.monto))}</td>
      <td><button class="tdel" data-delm="${v.id}">×</button></td></tr>`).join('')}</tbody></table>`
    : '<div class="empty">No hay ventas con esos filtros.</div>';
}
$('#fl_q').addEventListener('input', renderVentas); $('#fl_mes').addEventListener('change', renderVentas);

let curMvf = 'todo';
function fillMesMovs() {
  const meses = [...new Set(store.movs.map(m => mesKey(m.fecha)).filter(Boolean))].sort().reverse();
  const v = $('#mv_mes').value;
  $('#mv_mes').innerHTML = '<option value="">Todos los meses</option>' + meses.map(m => { const [y, mm] = m.split('-'); return `<option value="${m}">${MESES[+mm - 1]} ${y}</option>`; }).join('');
  if (v) $('#mv_mes').value = v;
}
function movSearch(m) { const L = movLabel(m); return norm((m.cliente || '') + ' ' + (m.concepto || '') + ' ' + (m.nota || '') + ' ' + (m.cajero || '') + ' ' + L.txt + ' ' + L.desc); }
function renderMovs() {
  fillMesMovs();
  const q = norm($('#mv_q').value), mes = $('#mv_mes').value;
  let rows = store.movs.filter(m => {
    if (mes && mesKey(m.fecha) !== mes) return false;
    if (curMvf === 'venta' && m.t !== 'venta') return false;
    if (curMvf === 'gasto' && m.t !== 'gasto') return false;
    if (q && !movSearch(m).includes(q)) return false;
    return true;
  }).sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '') || (b.id || '').localeCompare(a.id || ''));
  if (!rows.length) { $('#movsTable').innerHTML = '<div class="card"><div class="empty">No hay movimientos.</div></div>'; return; }
  const dias = [], map = {};
  rows.forEach(m => { if (!map[m.fecha]) { map[m.fecha] = []; dias.push(m.fecha); } map[m.fecha].push(m); });
  $('#movsTable').innerHTML = dias.map(f => {
    const ms = map[f];
    const venta = ms.filter(m => m.t === 'venta').reduce((a, m) => a + pm(m.monto), 0);
    return `<div class="card" style="margin-bottom:12px">
      <div class="ln" style="border-bottom:1px solid var(--line);padding-bottom:8px;margin-bottom:2px">
        <span style="font-weight:700">${fDate(f)}</span>
        <span class="muted" style="font-size:12px">Venta del día ${fmt(venta)}</span></div>
      <table><tbody>${ms.map(m => { const L = movLabel(m); return `<tr>
        <td style="width:1%"><span class="pill ${L.pill}">${esc(L.txt)}</span></td>
        <td>${esc(L.desc) || '<span class="muted">—</span>'}${m.cajero ? `<div class="muted" style="font-size:11px">${esc(m.cajero)}</div>` : ''}</td>
        <td class="num">${L.sign}${fmt(L.amt)}</td>
        <td style="width:1%"><button class="tdel" data-delm="${m.id}">×</button></td></tr>`; }).join('')}</tbody></table>
    </div>`;
  }).join('');
}
$('#mv_q').addEventListener('input', renderMovs);
$('#mv_mes').addEventListener('change', renderMovs);
$$('[data-mvf]').forEach(b => b.addEventListener('click', () => { curMvf = b.dataset.mvf; $$('[data-mvf]').forEach(x => x.classList.toggle('on', x.dataset.mvf === curMvf)); renderMovs(); }));

function clienteStats(key) {
  const ms = store.movs.filter(m => norm(m.cliente) === key);
  const ventas = ms.filter(m => m.t === 'venta');
  const total = ventas.reduce((a, v) => a + pm(v.monto), 0);
  const fechas = ventas.map(v => v.fecha).filter(Boolean).sort();
  const cc = ventas.filter(v => v.medio === 'cta corriente').reduce((a, v) => a + pm(v.monto), 0);
  const pagos = ms.filter(m => m.t === 'pago').reduce((a, v) => a + pm(v.monto), 0);
  return { total, count: ventas.length, ultima: fechas[fechas.length - 1], saldoCC: cc - pagos };
}
let curCli = null;
function renderClientes() {
  refreshClientesDL();
  const q = norm($('#cl_q').value);
  let keys = Object.keys(store.clientes).filter(k => !q || norm(store.clientes[k].nombre).includes(q));
  keys.sort((a, b) => clienteStats(b).total - clienteStats(a).total);
  $('#clientesTable').innerHTML = keys.length ? `<table><thead><tr><th>Cliente</th><th class="num">Total</th><th>Última</th><th class="num">Cta cte</th></tr></thead><tbody>
    ${keys.map(k => { const s = clienteStats(k), c = store.clientes[k]; return `<tr class="clk" data-cli="${esc(k)}"><td><b>${esc(c.nombre)}</b></td>
      <td class="num">${fmt(s.total)}</td><td>${fDate(s.ultima) || '—'}</td>
      <td class="num">${s.saldoCC > 0.5 ? `<span style="color:var(--bad);font-weight:600">${fmt(s.saldoCC)}</span>` : '—'}</td></tr>`; }).join('')}</tbody></table>`
    : '<div class="empty">Sin clientes. Se crean al cargar una venta con nombre, o con “+ Cliente”.</div>';
}
$('#cl_q').addEventListener('input', renderClientes);
$('#cl_new').addEventListener('click', () => openCli(null));
document.addEventListener('click', e => { const r = e.target.closest('[data-cli]'); if (r) openCli(r.dataset.cli); });
function openCli(key) {
  curCli = key; const c = key ? store.clientes[key] : { nombre: '', tel: '', mail: '', cuit: '', dir: '', notas: '' };
  $('#cli_title').textContent = key ? c.nombre : 'Nuevo cliente';
  ['nombre', 'tel', 'mail', 'cuit', 'dir', 'notas'].forEach(f => $('#cli_' + f).value = c[f] || '');
  $('#cli_pago').value = ''; renderCliMovs(key);
  $('#cli_del').style.display = key ? 'block' : 'none';
  $('#ovCli').classList.add('on');
}
function renderCliMovs(key) {
  if (!key) { $('#cli_ccbal').className = 'ccbal'; $('#cli_ccamt').textContent = fmt(0); $('#cli_movs').innerHTML = ''; return; }
  const s = clienteStats(key), bal = $('#cli_ccbal');
  bal.className = 'ccbal ' + (s.saldoCC > 0.5 ? 'deuda' : 'ok');
  $('#cli_ccamt').textContent = s.saldoCC > 0.5 ? fmt(s.saldoCC) + ' debe' : (s.saldoCC < -0.5 ? fmt(-s.saldoCC) + ' a favor' : '$ 0');
  const ms = store.movs.filter(m => norm(m.cliente) === key && (m.t === 'venta' || m.t === 'pago')).sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
  $('#cli_movs').innerHTML = ms.length ? `<table><tbody>${ms.map(m => `<tr><td>${fDate(m.fecha)}</td>
    <td>${m.t === 'pago' ? '<span class="pill ef">pago</span>' : '<span class="pill ' + pillC(m.medio) + '">' + esc(m.medio) + '</span>'}${m.nota ? ' ' + esc(m.nota) : ''}</td>
    <td class="num">${m.t === 'pago' ? '−' : ''}${fmt(pm(m.monto))}</td>
    <td><button class="tdel" data-delm="${m.id}">×</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty">Sin movimientos.</div>';
}
$('#cli_save').addEventListener('click', () => {
  const nombre = $('#cli_nombre').value.trim(); if (!nombre) return $('#cli_nombre').focus();
  const newKey = norm(nombre);
  const data = { nombre, tel: $('#cli_tel').value.trim(), mail: $('#cli_mail').value.trim(), cuit: $('#cli_cuit').value.trim(), dir: $('#cli_dir').value.trim(), notas: $('#cli_notas').value.trim() };
  if (curCli && curCli !== newKey) { delete store.clientes[curCli]; store.movs.forEach(m => { if (norm(m.cliente) === curCli) m.cliente = nombre; }); }
  store.clientes[newKey] = data; persist(); $('#ovCli').classList.remove('on'); renderClientes();
});
$('#cli_del').addEventListener('click', () => { if (!curCli || !confirm('¿Eliminar la ficha? Las ventas quedan.')) return; delete store.clientes[curCli]; persist(); $('#ovCli').classList.remove('on'); renderClientes(); });
$('#cli_pagoBtn').addEventListener('click', () => {
  const monto = pm($('#cli_pago').value); if (!monto) return $('#cli_pago').focus();
  const nombre = $('#cli_nombre').value.trim(); const key = ensureCliente(nombre) || curCli;
  store.movs.push({ id: uid(), t: 'pago', fecha: today(), cajero: store.cajeroActual, cliente: nombre, monto, medio: 'efectivo', nota: 'pago cta cte' });
  $('#cli_pago').value = ''; persist(); renderCliMovs(key); toast('Pago registrado');
});

function renderEstad() {
  const now = today().slice(0, 7);
  const mesV = store.movs.filter(m => m.t === 'venta' && mesKey(m.fecha) === now);
  const t = mesV.reduce((a, v) => a + pm(v.monto), 0);
  const ef = mesV.filter(v => v.medio === 'efectivo').reduce((a, v) => a + pm(v.monto), 0);
  $('#es_stats').innerHTML = `
    <div><div class="lbl">Total mes</div><div style="font-size:24px;font-weight:700" class="tabnum">${fmt(t)}</div></div>
    <div><div class="lbl">Ventas</div><div style="font-size:24px;font-weight:700" class="tabnum">${mesV.length}</div></div>
    <div><div class="lbl">Efectivo</div><div style="font-size:20px;font-weight:700" class="tabnum">${fmt(ef)}</div></div>
    <div><div class="lbl">Otros medios</div><div style="font-size:20px;font-weight:700" class="tabnum">${fmt(t - ef)}</div></div>`;
  fillMes('#es_mes'); if (!$('#es_mes').value) $('#es_mes').value = now;
  const selMes = $('#es_mes').value || now;
  const dias = {}; store.movs.filter(m => m.t === 'venta' && mesKey(m.fecha) === selMes).forEach(v => { (dias[v.fecha] = dias[v.fecha] || { ef: 0, tr: 0, ch: 0, t: 0, n: 0 }); const d = dias[v.fecha]; d.t += pm(v.monto); d.n++; if (v.medio === 'efectivo') d.ef += pm(v.monto); else if (v.medio === 'transferencia') d.tr += pm(v.monto); else if (v.medio === 'cheque') d.ch += pm(v.monto); });
  const orden = Object.keys(dias).sort().reverse();
  $('#es_diario').innerHTML = orden.length ? `<table><thead><tr><th>Día</th><th class="num">Efvo</th><th class="num">Transf</th><th class="num">Total</th></tr></thead><tbody>
    ${orden.map(f => `<tr><td>${fDate(f)}<div class="muted" style="font-size:11px">${dias[f].n} vta${dias[f].n > 1 ? 's' : ''}</div></td>
      <td class="num">${fmt(dias[f].ef)}</td><td class="num">${fmt(dias[f].tr)}</td><td class="num"><b>${fmt(dias[f].t)}</b></td></tr>`).join('')}</tbody></table>`
    : '<div class="empty">Sin ventas ese mes.</div>';
  const years = [...new Set(store.movs.filter(m => m.t === 'venta').map(m => m.fecha && m.fecha.slice(0, 4)).filter(Boolean))].sort();
  if (!years.length) { $('#es_mensual').innerHTML = '<div class="empty">Sin datos.</div>'; return; }
  const M = {}; years.forEach(y => M[y] = Array(12).fill(0));
  store.movs.filter(m => m.t === 'venta').forEach(v => { if (!v.fecha) return; const y = v.fecha.slice(0, 4), mi = +v.fecha.slice(5, 7) - 1; if (M[y]) M[y][mi] += pm(v.monto); });
  $('#es_mensual').innerHTML = `<table><thead><tr><th>Mes</th>${years.map(y => `<th class="num">${y}</th>`).join('')}</tr></thead><tbody>
    ${MESES.map((mn, i) => `<tr><td>${mn.slice(0, 3)}</td>${years.map(y => `<td class="num">${M[y][i] ? fmt(M[y][i]) : '<span style="color:var(--line)">—</span>'}</td>`).join('')}</tr>`).join('')}
    <tr style="font-weight:700"><td>Total</td>${years.map(y => `<td class="num">${fmt(M[y].reduce((a, x) => a + x, 0))}</td>`).join('')}</tr></tbody></table>`;
}
$('#es_mes').addEventListener('change', renderEstad);

$('#gearBtn').addEventListener('click', () => {
  $('#cfg_frente').value = fmtP(store.config.saldoFrente); $('#cfg_fondo').value = fmtP(store.config.saldoFondo);
  $('#cfg_pin').value = store.config.fondoPin || '';
  renderCfgCajeros(); $('#ovCfg').classList.add('on');
});
function renderCfgCajeros() { $('#cfg_cajeros').innerHTML = store.config.cajeros.map(c => `<span class="pill" style="font-size:13px;padding:5px 10px">${esc(c)} <b data-rmcaj="${esc(c)}" style="cursor:pointer;color:var(--bad);margin-left:4px">×</b></span>`).join('') || '<span class="muted" style="font-size:13px">Ninguno</span>'; }
$('#cfg_cajeros').addEventListener('click', e => { const b = e.target.closest('[data-rmcaj]'); if (!b) return; store.config.cajeros = store.config.cajeros.filter(c => c !== b.dataset.rmcaj); renderCfgCajeros(); });
$('#cfg_addCaj').addEventListener('click', () => { const n = $('#cfg_nuevoCaj').value.trim(); if (n && !store.config.cajeros.includes(n)) store.config.cajeros.push(n); $('#cfg_nuevoCaj').value = ''; renderCfgCajeros(); });
$('#cfg_save').addEventListener('click', () => {
  store.config.saldoFrente = pm($('#cfg_frente').value); store.config.saldoFondo = pm($('#cfg_fondo').value);
  store.config.fondoPin = $('#cfg_pin').value.trim();
  persist(); $('#ovCfg').classList.remove('on'); renderHome();
});
$('#cfg_backup').addEventListener('click', async () => {
  // aseguro que lo ultimo este guardado antes de copiar
  await window.api.save(store);
  const r = await window.api.exportBackup();
  if (r && r.ok) toast('Copia guardada ✓');
  else if (r && r.canceled) { /* el usuario cancelo */ }
  else toast('No se pudo guardar la copia');
});
$('#cfg_openFolder').addEventListener('click', () => { window.api.openDbFolder(); });

$$('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('.ov').classList.remove('on')));
$$('.ov').forEach(o => o.addEventListener('click', e => { if (e.target === o) o.classList.remove('on'); }));
document.addEventListener('focusout', e => { if (e.target.classList && e.target.classList.contains('money') && !(e.target.dataset && e.target.dataset.arq)) { const v = pm(e.target.value); if (e.target.id && e.target.id.startsWith('cfg_')) e.target.value = v ? fmtP(v) : ''; } });

// Guardado final por las dudas al cerrar la ventana.
window.addEventListener('beforeunload', () => { try { window.api.save(store); } catch (e) {} });

// ---- Arranque: leer la base de datos del disco ----------------------------
async function boot() {
  try {
    const res = await window.api.load();
    if (res && res.ok && res.store) store = res.store;
  } catch (e) { console.error('No se pudo leer la base de datos', e); }
  store.config = store.config || { cajeros: [], saldoFrente: 0, saldoFondo: 0 };
  store.config.cajeros = store.config.cajeros || [];
  store.cajeroActual = store.cajeroActual || null;
  store.movs = store.movs || [];
  store.clientes = store.clientes || {};
  store.arqueos = store.arqueos || {};
  if (store.cajeroActual) { $('#cajName').textContent = store.cajeroActual; show('home'); }
  else { renderLogin(); show('login'); }
}
boot();
