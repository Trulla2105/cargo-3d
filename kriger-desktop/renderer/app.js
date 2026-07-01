// app.js — toda la logica de Kriger.
// Es el mismo boceto que ya funcionaba, pero ahora guarda en la base de datos
// SQLite del disco (a traves de window.api) en vez de en el navegador.

const $ = s => document.querySelector(s), $$ = s => Array.from(document.querySelectorAll(s));

// Estado en memoria. Arranca vacio y se llena desde la base de datos en boot().
let store = { config: { cajeros: [], saldoFrente: 0, saldoFondo: 0, fondoPin: '' }, cajeroActual: null, movs: [], clientes: {}, arqueos: {}, cheques: [] };
let fondoUnlocked = false; // si ya escribio la clave (cuando hay) para ver la caja fondo en esta sesion

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
const MEDIOS = [['efectivo', 'Efectivo'], ['transferencia', 'Transferencia'], ['cheque', 'Cheque'], ['cta corriente', 'Cta corriente']];

function efecto(m) {
  if (m.t === 'venta') return { frente: m.medio === 'efectivo' ? pm(m.monto) : 0, fondo: 0 };
  if (m.t === 'pago') return { frente: m.medio === 'efectivo' ? pm(m.monto) : 0, fondo: 0 };
  if (m.t === 'gasto') return { frente: -pm(m.frente), fondo: -pm(m.fondo) };
  if (m.t === 'mover') return m.dir === 'aFondo' ? { frente: -pm(m.monto), fondo: pm(m.monto) } : { frente: pm(m.monto), fondo: -pm(m.monto) };
  return { frente: 0, fondo: 0 };
}
// El saldo cuenta desde config.saldoFecha (el día que cargaste tu efectivo
// actual). Los movimientos anteriores a esa fecha NO cuentan (ej: ventas viejas
// importadas del Excel), así el saldo refleja la plata que tenés hoy.
function saldoHasta(caja, beforeDate) {
  const desde = store.config.saldoFecha || '';
  let s = store.config['saldo' + (caja === 'frente' ? 'Frente' : 'Fondo')] || 0;
  store.movs.forEach(m => { if (desde && m.fecha < desde) return; if (!beforeDate || m.fecha < beforeDate) s += efecto(m)[caja]; });
  return s;
}
function saldoActual(caja) {
  const desde = store.config.saldoFecha || '';
  let s = store.config['saldo' + (caja === 'frente' ? 'Frente' : 'Fondo')] || 0;
  store.movs.forEach(m => { if (desde && m.fecha < desde) return; s += efecto(m)[caja]; });
  return s;
}
// "Venta del día" = plata que REALMENTE entró ese día.
// Las ventas en cuenta corriente NO cuentan hasta que el cliente paga; cada
// pago (aunque sea parcial) suma a la venta del día en que se hizo.
function ventaRealizada(m) { return m.t === 'venta' && m.medio !== 'cta corriente'; }
function ventaDe(date) {
  return store.movs.reduce((a, m) => {
    if (m.fecha !== date) return a;
    if (ventaRealizada(m) || m.t === 'pago') return a + pm(m.monto);
    return a;
  }, 0);
}

const TITLES = { cargar: 'Cargar', movs: 'Movimientos', cierre: 'Cierre del día', ventas: 'Ventas', clientes: 'Clientes', estad: 'Estadísticas', fondo: 'Caja fondo', cheques: 'Cheques' };
function show(view) {
  ['login', 'home', 'cargar', 'movs', 'cierre', 'ventas', 'clientes', 'estad', 'fondo', 'cheques'].forEach(v => $('#v-' + v).classList.toggle('hide', v !== view));
  const sub = !['login', 'home'].includes(view);
  $('#backBtn').classList.toggle('hide', !sub);
  $('#brandLabel').classList.toggle('hide', sub);
  $('#barTitle').classList.toggle('hide', !sub);
  $('#barTitle').textContent = TITLES[view] || '';
  const logged = !!store.cajeroActual;
  $('#cajchip').classList.toggle('hide', !logged || view === 'login');
  $('#gearBtn').classList.toggle('hide', !logged || view === 'login');
  if (view === 'home') renderHome();
  if (view === 'fondo') renderFondo();
  if (view === 'cargar') renderCargar();
  if (view === 'movs') renderMovs();
  if (view === 'cierre') renderCierre();
  if (view === 'ventas') renderVentas();
  if (view === 'clientes') renderClientes();
  if (view === 'estad') renderEstad();
  if (view === 'cheques') renderCheques();
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
  const frente = saldoActual('frente');
  $('#h_frente').textContent = fmt(frente);
  $('#h_fondo').textContent = fmt(saldoActual('fondo'));
  // Aviso si hay mucho efectivo en el mostrador.
  const max = pm(store.config.alertaMax);
  const over = max > 0 && frente > max;
  $('#alertaBanner').classList.toggle('hide', !over);
  if (over) $('#alertaMonto').textContent = fmt(frente);
  // La caja fondo queda SIEMPRE reservada (tapada) en el inicio. Se mira tocando "Ver".
  $('#h_fondo').classList.add('locked');
  $('#h_fondolock').classList.remove('hide');
}
// Abrir la caja fondo: si hay clave la pide una vez; si no, entra directo.
function openFondo() {
  const pin = store.config.fondoPin || '';
  if (pin && !fondoUnlocked) {
    const t = prompt('Clave de la caja fondo:');
    if (t == null) return;
    if (t !== pin) { toast('Clave incorrecta'); return; }
    fondoUnlocked = true;
  }
  show('fondo');
}
$('#h_fondolock').addEventListener('click', openFondo);
$('#h_fondobox').addEventListener('click', e => { if (!e.target.closest('#h_fondolock')) openFondo(); });

// Ir a "Mover" con Mostrador → Fondo listo.
function irAMoverFondo() {
  show('cargar'); selTipo('mover'); curDir = 'aFondo';
  $$('#form-mover [data-dir]').forEach(x => x.classList.toggle('on', x.dataset.dir === 'aFondo'));
  updateMoverInfo(); $('#mo_monto').focus();
}
$('#alertaMover').addEventListener('click', irAMoverFondo);

// Recordatorio por hora (ej. 16:55) si hay mucho efectivo en el mostrador.
let _timeAlertDay = '';
function checkTimeAlert() {
  const cfg = store.config || {};
  const max = pm(cfg.alertaMax), hora = cfg.alertaHora || '';
  if (!max || !hora) return;
  const day = today();
  if (_timeAlertDay === day) return;
  const now = new Date();
  const hhmm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  if (hhmm < hora) return;
  const frente = saldoActual('frente');
  if (frente <= max) return;
  _timeAlertDay = day;
  const msg = `Son las ${hora}. Hay ${fmt(frente)} en el mostrador. ¿Pasás algo a la caja fondo antes de cerrar?`;
  try { new Notification('Kriger — cierre', { body: msg }); } catch (e) {}
  toast('⚠️ Pasá efectivo al fondo');
  setTimeout(() => { if (confirm(msg + '\n\n¿Ir a pasar efectivo al fondo?')) irAMoverFondo(); }, 300);
}
setInterval(checkTimeAlert, 30000);

function renderFondo() {
  $('#fo_saldo').textContent = fmt(saldoActual('fondo'));
  const movs = store.movs.filter(m => efecto(m).fondo !== 0)
    .slice().sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '') || (b.id || '').localeCompare(a.id || ''));
  const fila = m => {
    const ef = efecto(m).fondo;
    let desc = '';
    if (m.t === 'gasto') desc = 'Gasto: ' + (m.concepto || '');
    else if (m.t === 'mover') desc = m.dir === 'aFondo' ? 'Vino del mostrador' : 'Pasó al mostrador';
    const pill = m.t === 'gasto' ? 'ga' : 'mo';
    return `<tr>
      <td style="width:1%"><span class="pill ${pill}">${m.t === 'gasto' ? 'gasto' : 'mover'}</span></td>
      <td>${esc(desc)}<div class="muted" style="font-size:11px">${fDate(m.fecha)}${m.cajero ? ' · ' + esc(m.cajero) : ''}</div></td>
      <td class="num" style="color:${ef < 0 ? 'var(--bad)' : 'var(--ok)'}">${ef < 0 ? '−' : '+'}${fmtP(Math.abs(ef))}</td></tr>`;
  };
  const inicial = store.config.saldoFondo || 0;
  $('#fondoBody').innerHTML = (movs.length ? `<table><tbody>${movs.map(fila).join('')}</tbody></table>` : '<div class="empty">Sin movimientos en la caja fondo.</div>')
    + `<div class="ln" style="border-top:1px solid var(--line);margin-top:6px;padding-top:10px"><span class="muted">Saldo inicial cargado</span><span class="v">${fmt(inicial)}</span></div>`;
}

let curTipo = 'venta', curMedio = 'efectivo', curCaja = 'frente', curDir = 'aFondo';
function renderCargar() {
  $('#ve_fecha').value = $('#ga_fecha').value = $('#mo_fecha').value = today();
  $('#ve_medios').innerHTML = MEDIOS.map(([v, l]) => `<button class="chip med${v === curMedio ? ' on' : ''}" data-med="${v}">${l}</button>`).join('');
  $('#ve_remito_wrap').classList.toggle('hide', curMedio !== 'cta corriente');
  $('#ve_cheques_wrap').classList.toggle('hide', curMedio !== 'cheque');
  updateChequesBtn(); updateMoverInfo();
  refreshClientesDL(); renderUltimos();
}
function selTipo(t) {
  curTipo = t; $$('[data-tipo]').forEach(c => c.classList.toggle('on', c.dataset.tipo === t));
  $('#form-venta').classList.toggle('hide', t !== 'venta'); $('#form-gasto').classList.toggle('hide', t !== 'gasto'); $('#form-mover').classList.toggle('hide', t !== 'mover');
}
$$('[data-tipo]').forEach(c => c.addEventListener('click', () => selTipo(c.dataset.tipo)));
$('#ve_medios').addEventListener('click', e => {
  const b = e.target.closest('[data-med]'); if (!b) return;
  curMedio = b.dataset.med;
  $$('#ve_medios .chip').forEach(c => c.classList.toggle('on', c.dataset.med === curMedio));
  $('#ve_remito_wrap').classList.toggle('hide', curMedio !== 'cta corriente');
  $('#ve_cheques_wrap').classList.toggle('hide', curMedio !== 'cheque');
  if (curMedio !== 'cheque') chequesPend = [];
  updateChequesBtn();
});

// ---- Cheques de una venta -------------------------------------------------
let chequesPend = []; // cheques que se están cargando en la venta actual
function updateChequesBtn() {
  const n = chequesPend.length;
  const tot = chequesPend.reduce((a, c) => a + pm(c.monto), 0);
  $('#ve_cheques_btn').textContent = n ? `${n} cheque${n > 1 ? 's' : ''} · ${fmt(tot)}` : '+ Cargar cheques';
}
function openChequesModal() {
  if (!chequesPend.length) chequesPend = [{ numero: '', vencimiento: '', monto: '' }];
  renderChqRows();
  $('#ovCheques').classList.add('on');
}
function renderChqRows() {
  $('#chq_rows').innerHTML = chequesPend.map((c, i) => `
    <div class="card" style="padding:10px;margin-bottom:8px">
      <div class="fr2">
        <div><label class="fl">N° cheque</label><input data-chq="numero" data-i="${i}" value="${esc(c.numero)}" placeholder="N°"></div>
        <div><label class="fl">Vencimiento</label><input type="date" data-chq="vencimiento" data-i="${i}" value="${esc(c.vencimiento)}"></div>
      </div>
      <div style="margin-top:8px"><label class="fl">Monto</label><input data-chq="monto" data-i="${i}" inputmode="decimal" value="${c.monto !== '' && c.monto != null ? fmtP(pm(c.monto)) : ''}" placeholder="$ 0"></div>
      ${chequesPend.length > 1 ? `<button class="btn gh sm" data-chqdel="${i}" style="margin-top:8px;color:var(--bad)">Quitar este cheque</button>` : ''}
    </div>`).join('');
  $('#chq_total').textContent = fmt(chequesPend.reduce((a, c) => a + pm(c.monto), 0));
}
$('#ve_cheques_btn').addEventListener('click', openChequesModal);
$('#chq_add').addEventListener('click', () => { chequesPend.push({ numero: '', vencimiento: '', monto: '' }); renderChqRows(); });
$('#chq_rows').addEventListener('input', e => {
  const t = e.target; if (!t.dataset || !t.dataset.chq) return;
  chequesPend[+t.dataset.i][t.dataset.chq] = t.value;
  if (t.dataset.chq === 'monto') $('#chq_total').textContent = fmt(chequesPend.reduce((a, c) => a + pm(c.monto), 0));
});
$('#chq_rows').addEventListener('click', e => {
  const d = e.target.closest('[data-chqdel]'); if (!d) return;
  chequesPend.splice(+d.dataset.chqdel, 1); renderChqRows();
});
$('#chq_done').addEventListener('click', () => {
  chequesPend = chequesPend.filter(c => pm(c.monto) > 0);
  const tot = chequesPend.reduce((a, c) => a + pm(c.monto), 0);
  if (tot) $('#ve_monto').value = fmtP(tot);
  updateChequesBtn();
  $('#ovCheques').classList.remove('on');
});
$$('#form-gasto [data-caja]').forEach(c => c.addEventListener('click', () => { curCaja = c.dataset.caja; $$('#form-gasto [data-caja]').forEach(x => x.classList.toggle('on', x.dataset.caja === curCaja)); $('#ga_single').classList.toggle('hide', curCaja === 'div'); $('#ga_split').classList.toggle('hide', curCaja !== 'div'); }));
$$('#form-mover [data-dir]').forEach(c => c.addEventListener('click', () => { curDir = c.dataset.dir; $$('#form-mover [data-dir]').forEach(x => x.classList.toggle('on', x.dataset.dir === curDir)); updateMoverInfo(); }));
function updateMoverInfo() {
  const el = $('#mo_info'); if (!el) return;
  const f = saldoActual('frente'), fo = saldoActual('fondo');
  el.innerHTML = `Efectivo disponible — Mostrador: ${curDir === 'aFondo' ? '<b>' + fmt(f) + '</b>' : fmt(f)} · Fondo: ${curDir === 'aFrente' ? '<b>' + fmt(fo) + '</b>' : fmt(fo)}`;
}
document.addEventListener('input', e => { if (e.target.id === 'ga_frente' || e.target.id === 'ga_fondo') $('#ga_total').textContent = fmt(pm($('#ga_frente').value) + pm($('#ga_fondo').value)); });

function refreshClientesDL() { $('#dl_clientes').innerHTML = Object.values(store.clientes).map(c => `<option value="${esc(c.nombre)}">`).join(''); }
function ensureCliente(nombre) { const k = norm(nombre); if (!k) return null; if (!store.clientes[k]) store.clientes[k] = { nombre: nombre.trim(), tel: '', mail: '', cuit: '', dir: '', notas: '' }; return k; }

$('#ve_save').addEventListener('click', () => {
  let monto, chq = [];
  if (curMedio === 'cheque') {
    chq = chequesPend.filter(c => pm(c.monto) > 0);
    if (!chq.length) { toast('Cargá al menos un cheque'); return openChequesModal(); }
    monto = chq.reduce((a, c) => a + pm(c.monto), 0);
  } else {
    monto = pm($('#ve_monto').value); if (!monto) return $('#ve_monto').focus();
  }
  const cli = $('#ve_cliente').value.trim(); if (cli) ensureCliente(cli);
  const remito = curMedio === 'cta corriente' ? $('#ve_remito').value.trim() : '';
  const fecha = $('#ve_fecha').value || today();
  const vid = uid();
  store.movs.push({ id: vid, t: 'venta', fecha, cajero: store.cajeroActual, monto, medio: curMedio, cliente: cli, contacto: $('#ve_contacto').value, nota: $('#ve_nota').value.trim(), remito });
  // Los cheques van a la cartera, ligados a esta venta.
  chq.forEach(c => store.cheques.push({ id: uid(), ventaId: vid, numero: String(c.numero || '').trim(), monto: pm(c.monto), vencimiento: c.vencimiento || '', fecha, cliente: cli, estado: 'cartera', salidaDetalle: '', salidaFecha: '' }));
  $('#ve_monto').value = ''; $('#ve_cliente').value = ''; $('#ve_nota').value = ''; $('#ve_remito').value = '';
  chequesPend = []; updateChequesBtn();
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
function contactoLabel(c) {
  const M = { presencial: 'Presencial', whatsapp: 'WhatsApp', cc: 'CC', comisionista: 'Comisionista', 'seña': 'Seña' };
  return M[c] || (c || '—');
}
function gastoCaja(g) {
  const f = pm(g.frente), fo = pm(g.fondo);
  if (f && fo) return 'dividido: mostr ' + fmtP(f) + ' · fondo ' + fmtP(fo);
  if (f) return 'mostrador';
  if (fo) return 'fondo';
  return '';
}
function movLabel(m) {
  if (m.t === 'venta') return { pill: pillC(m.medio), txt: m.medio, desc: (m.cliente || '') + (m.remito ? ' · remito ' + m.remito : '') + (m.nota ? ' · ' + m.nota : ''), amt: pm(m.monto), sign: '' };
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
    <td><button class="tdel" data-editm="${m.id}" title="Editar">✎</button><button class="tdel" data-delm="${m.id}">×</button></td></tr>`; }).join('')}</tbody></table>`
    : '<div class="empty">Sin movimientos hoy.</div>';
}
document.addEventListener('click', e => {
  const d = e.target.closest('[data-delm]'); if (!d) return;
  if (!confirm('¿Borrar este movimiento?')) return;
  store.movs = store.movs.filter(m => m.id !== d.dataset.delm); persist();
  renderUltimos(); if (!$('#v-clientes').classList.contains('hide')) renderCliMovs(curCli); if (!$('#v-ventas').classList.contains('hide')) renderVentas(); if (!$('#v-movs').classList.contains('hide')) renderMovs();
});

function refreshMovViews() {
  renderUltimos();
  if (!$('#v-clientes').classList.contains('hide')) renderCliMovs(curCli);
  if (!$('#v-ventas').classList.contains('hide')) renderVentas();
  if (!$('#v-movs').classList.contains('hide')) renderMovs();
  if (!$('#v-cheques').classList.contains('hide')) renderCheques();
  if (!$('#v-home').classList.contains('hide')) renderHome();
}

// ---- Editar un movimiento (lapicito) --------------------------------------
let edCurId = null, edMedio = 'efectivo', edCaja = 'frente', edDir = 'aFondo';
document.addEventListener('click', e => { const b = e.target.closest('[data-editm]'); if (b) openEdit(b.dataset.editm); });
function openEdit(id) {
  const m = store.movs.find(x => x.id === id); if (!m) return;
  edCurId = id;
  $('#ed_fecha').value = m.fecha || today();
  ['venta', 'gasto', 'mover', 'pago'].forEach(t => $('#ed_' + t).classList.toggle('hide', t !== m.t));
  $('#ed_title').textContent = { venta: 'Editar venta', gasto: 'Editar gasto', mover: 'Editar pase', pago: 'Editar pago' }[m.t] || 'Editar';
  if (m.t === 'venta') {
    $('#ed_ve_monto').value = fmtP(pm(m.monto));
    edMedio = m.medio || 'efectivo';
    $('#ed_medios').innerHTML = MEDIOS.map(([v, l]) => `<button type="button" class="chip med${v === edMedio ? ' on' : ''}" data-edmed="${v}">${l}</button>`).join('');
    $('#ed_ve_cliente').value = m.cliente || '';
    $('#ed_ve_contacto').value = m.contacto || 'presencial';
    $('#ed_ve_nota').value = m.nota || '';
    $('#ed_ve_chqnote').classList.toggle('hide', m.medio !== 'cheque');
  } else if (m.t === 'gasto') {
    $('#ed_ga_concepto').value = m.concepto || '';
    const f = pm(m.frente), fo = pm(m.fondo);
    edCaja = (f && fo) ? 'div' : (fo ? 'fondo' : 'frente');
    $$('#ed_gasto [data-edcaja]').forEach(x => x.classList.toggle('on', x.dataset.edcaja === edCaja));
    $('#ed_ga_single').classList.toggle('hide', edCaja === 'div');
    $('#ed_ga_split').classList.toggle('hide', edCaja !== 'div');
    $('#ed_ga_monto').value = fmtP(edCaja === 'fondo' ? fo : f);
    $('#ed_ga_frente').value = f ? fmtP(f) : '';
    $('#ed_ga_fondo').value = fo ? fmtP(fo) : '';
  } else if (m.t === 'mover') {
    edDir = m.dir || 'aFondo';
    $$('#ed_mover [data-eddir]').forEach(x => x.classList.toggle('on', x.dataset.eddir === edDir));
    $('#ed_mo_monto').value = fmtP(pm(m.monto));
  } else if (m.t === 'pago') {
    $('#ed_pa_cliente').value = m.cliente || '';
    $('#ed_pa_monto').value = fmtP(pm(m.monto));
  }
  $('#ovEdit').classList.add('on');
}
$('#ed_medios').addEventListener('click', e => { const b = e.target.closest('[data-edmed]'); if (!b) return; edMedio = b.dataset.edmed; $$('#ed_medios .chip').forEach(c => c.classList.toggle('on', c.dataset.edmed === edMedio)); $('#ed_ve_chqnote').classList.toggle('hide', edMedio !== 'cheque'); });
$$('#ed_gasto [data-edcaja]').forEach(c => c.addEventListener('click', () => { edCaja = c.dataset.edcaja; $$('#ed_gasto [data-edcaja]').forEach(x => x.classList.toggle('on', x.dataset.edcaja === edCaja)); $('#ed_ga_single').classList.toggle('hide', edCaja === 'div'); $('#ed_ga_split').classList.toggle('hide', edCaja !== 'div'); }));
$$('#ed_mover [data-eddir]').forEach(c => c.addEventListener('click', () => { edDir = c.dataset.eddir; $$('#ed_mover [data-eddir]').forEach(x => x.classList.toggle('on', x.dataset.eddir === edDir)); }));
$('#ed_save').addEventListener('click', () => {
  const m = store.movs.find(x => x.id === edCurId); if (!m) return;
  m.fecha = $('#ed_fecha').value || m.fecha;
  if (m.t === 'venta') {
    const monto = pm($('#ed_ve_monto').value); if (!monto) return toast('Falta el monto');
    m.monto = monto; m.medio = edMedio;
    const cli = $('#ed_ve_cliente').value.trim(); if (cli) ensureCliente(cli); m.cliente = cli;
    m.contacto = $('#ed_ve_contacto').value; m.nota = $('#ed_ve_nota').value.trim();
  } else if (m.t === 'gasto') {
    m.concepto = $('#ed_ga_concepto').value.trim() || 'Gasto';
    let frente = 0, fondo = 0;
    if (edCaja === 'frente') frente = pm($('#ed_ga_monto').value);
    else if (edCaja === 'fondo') fondo = pm($('#ed_ga_monto').value);
    else { frente = pm($('#ed_ga_frente').value); fondo = pm($('#ed_ga_fondo').value); }
    if (frente + fondo <= 0) return toast('Falta el monto');
    m.frente = frente; m.fondo = fondo;
  } else if (m.t === 'mover') {
    const monto = pm($('#ed_mo_monto').value); if (!monto) return toast('Falta el monto');
    m.monto = monto; m.dir = edDir;
  } else if (m.t === 'pago') {
    const monto = pm($('#ed_pa_monto').value); if (!monto) return toast('Falta el monto');
    m.monto = monto; const cli = $('#ed_pa_cliente').value.trim(); if (cli) ensureCliente(cli); m.cliente = cli;
  }
  persist(); $('#ovEdit').classList.remove('on'); refreshMovViews(); refreshClientesDL(); toast('Cambios guardados ✓');
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
  const otras = ventas.filter(v => !['efectivo', 'transferencia', 'cheque', 'cta corriente'].includes(v.medio));
  const ctaCte = ventas.filter(v => v.medio === 'cta corriente');
  const pagos = movs.filter(m => m.t === 'pago');
  const pagosTot = pagos.reduce((a, p) => a + pm(p.monto), 0);
  // Venta del día = lo realmente cobrado: ventas que no son cuenta corriente + pagos recibidos.
  const ventaTotal = ventas.filter(v => v.medio !== 'cta corriente').reduce((a, v) => a + pm(v.monto), 0) + pagosTot;
  const gastos = movs.filter(m => m.t === 'gasto');
  const gastosTot = gastos.reduce((a, g) => a + pm(g.frente) + pm(g.fondo), 0);
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
      ${pagosTot ? `<div class="rule"></div><div class="ln"><span>Cobrado de cuenta corriente</span><span class="v">${fmt(pagosTot)}</span></div>` + pagos.map(p => `<div class="ln sub"><span>${esc(p.cliente || 'sin nombre')}</span><span class="v">${fmt(pm(p.monto))}</span></div>`).join('') : ''}
      ${ctaCte.length ? `<div class="rule"></div><div class="ln"><span class="muted">Entregado a cta cte <span style="font-weight:400">(a cobrar · no suma)</span></span><span class="v muted">${fmt(ctaCte.reduce((a, v) => a + pm(v.monto), 0))}</span></div>` + ctaCte.map(v => `<div class="ln sub"><span>${esc(v.cliente || 'sin nombre')}${v.remito ? ' · remito ' + esc(v.remito) : ''}</span><span class="v">${fmt(pm(v.monto))}</span></div>`).join('') : ''}
    </div>
    <div class="card"><div class="lbl" style="margin-bottom:8px">Gastos del día</div>
      ${gastos.length ? gastos.map(g => `<div class="ln"><span>${esc(g.concepto)} <span class="muted" style="font-size:12px">(${gastoCaja(g)})</span></span><span class="v">−${fmtP(pm(g.frente) + pm(g.fondo))}</span></div>`).join('') + `<div class="esper"><span>Total gastos</span><span class="v">${fmt(gastosTot)}</span></div>` : '<div class="muted" style="font-size:13.5px;padding:6px 0">Sin gastos del día.</div>'}
    </div>
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
  const cobrado = rows.filter(v => v.medio !== 'cta corriente').reduce((a, v) => a + pm(v.monto), 0);
  const aCobrar = rows.filter(v => v.medio === 'cta corriente').reduce((a, v) => a + pm(v.monto), 0);
  const MAX = 400, shown = rows.slice(0, MAX);
  $('#ventasTable').innerHTML = rows.length ? `<div class="ln" style="margin-bottom:4px"><span class="muted" style="font-size:12px">${rows.length} ventas · cobrado</span><span style="font-weight:700" class="tabnum">${fmt(cobrado)}</span></div>
    ${aCobrar ? `<div class="ln" style="margin-bottom:8px"><span class="muted" style="font-size:12px">A cobrar (cta cte)</span><span class="tabnum" style="color:var(--bad);font-weight:600">${fmt(aCobrar)}</span></div>` : ''}
    <table><thead><tr><th>Fecha</th><th>Cliente</th><th>Tipo</th><th>Medio</th><th class="num">Total</th><th></th></tr></thead><tbody>
    ${shown.map(v => `<tr><td>${fDate(v.fecha)}<div class="muted" style="font-size:11px">${esc(v.cajero || '')}</div></td>
      <td>${esc(v.cliente) || '<span class="muted">—</span>'}${v.nota ? `<div class="muted" style="font-size:11px">${esc(v.nota)}</div>` : ''}</td>
      <td><span class="muted" style="font-size:12.5px">${esc(contactoLabel(v.contacto))}</span></td>
      <td><span class="pill ${pillC(v.medio)}">${esc(v.medio)}</span></td>
      <td class="num">${fmt(pm(v.monto))}</td>
      <td><button class="tdel" data-editm="${v.id}" title="Editar">✎</button><button class="tdel" data-delm="${v.id}">×</button></td></tr>`).join('')}</tbody></table>
    ${rows.length > MAX ? `<div class="muted" style="font-size:12px;text-align:center;padding:10px 8px">Mostrando ${MAX} de ${rows.length}. Filtrá por mes o buscá para ver menos.</div>` : ''}`
    : '<div class="empty">No hay ventas con esos filtros.</div>';
}
$('#fl_q').addEventListener('input', renderVentas); $('#fl_mes').addEventListener('change', renderVentas);

let curMvf = 'todo', curMvp = 'dia';
function movSearch(m) { const L = movLabel(m); return norm((m.cliente || '') + ' ' + (m.concepto || '') + ' ' + (m.nota || '') + ' ' + (m.cajero || '') + ' ' + L.txt + ' ' + L.desc); }
function renderMovs() {
  if (!$('#mv_fecha').value) $('#mv_fecha').value = today();
  const base = $('#mv_fecha').value || today();
  const q = norm($('#mv_q').value);
  let rows = store.movs.filter(m => {
    if (curMvp === 'dia' && m.fecha !== base) return false;
    if (curMvp === 'mes' && mesKey(m.fecha) !== mesKey(base)) return false;
    if (curMvp === 'anio' && (m.fecha || '').slice(0, 4) !== base.slice(0, 4)) return false;
    if (curMvf === 'venta' && m.t !== 'venta') return false;
    if (curMvf === 'gasto' && m.t !== 'gasto') return false;
    if (q && !movSearch(m).includes(q)) return false;
    return true;
  }).sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '') || (b.id || '').localeCompare(a.id || ''));
  if (!rows.length) { $('#movsTable').innerHTML = '<div class="card"><div class="empty">No hay movimientos en este período.</div></div>'; return; }
  const dias = [], map = {};
  rows.forEach(m => { if (!map[m.fecha]) { map[m.fecha] = []; dias.push(m.fecha); } map[m.fecha].push(m); });
  $('#movsTable').innerHTML = dias.map(f => {
    const ms = map[f];
    const venta = ventaDe(f);
    return `<div class="card" style="margin-bottom:12px">
      <div class="ln" style="border-bottom:1px solid var(--line);padding-bottom:8px;margin-bottom:2px">
        <span style="font-weight:700">${fDate(f)}</span>
        <span class="muted" style="font-size:12px">Venta del día ${fmt(venta)}</span></div>
      <table><tbody>${ms.map(m => { const L = movLabel(m); return `<tr>
        <td style="width:1%"><span class="pill ${L.pill}">${esc(L.txt)}</span></td>
        <td>${esc(L.desc) || '<span class="muted">—</span>'}${m.cajero ? `<div class="muted" style="font-size:11px">${esc(m.cajero)}</div>` : ''}</td>
        <td class="num">${L.sign}${fmt(L.amt)}</td>
        <td style="width:1%"><button class="tdel" data-editm="${m.id}" title="Editar">✎</button><button class="tdel" data-delm="${m.id}">×</button></td></tr>`; }).join('')}</tbody></table>
    </div>`;
  }).join('');
}
$('#mv_q').addEventListener('input', renderMovs);
$('#mv_fecha').addEventListener('change', renderMovs);
$$('[data-mvf]').forEach(b => b.addEventListener('click', () => { curMvf = b.dataset.mvf; $$('[data-mvf]').forEach(x => x.classList.toggle('on', x.dataset.mvf === curMvf)); renderMovs(); }));
$$('[data-mvp]').forEach(b => b.addEventListener('click', () => { curMvp = b.dataset.mvp; $$('[data-mvp]').forEach(x => x.classList.toggle('on', x.dataset.mvp === curMvp)); renderMovs(); }));

function clienteStats(key) {
  const ms = store.movs.filter(m => norm(m.cliente) === key);
  const ventas = ms.filter(m => m.t === 'venta');
  const total = ventas.reduce((a, v) => a + pm(v.monto), 0);
  const fechas = ventas.map(v => v.fecha).filter(Boolean).sort();
  const cc = ventas.filter(v => v.medio === 'cta corriente').reduce((a, v) => a + pm(v.monto), 0);
  const pagos = ms.filter(m => m.t === 'pago').reduce((a, v) => a + pm(v.monto), 0);
  return { total, count: ventas.length, ultima: fechas[fechas.length - 1], saldoCC: cc - pagos };
}
// Calcula las estadísticas de TODOS los clientes en una sola pasada (rápido,
// aunque haya miles de ventas importadas).
function allClienteStats() {
  const map = {};
  store.movs.forEach(m => {
    const key = norm(m.cliente); if (!key) return;
    const s = map[key] || (map[key] = { total: 0, count: 0, ultima: '', cc: 0, pagos: 0 });
    if (m.t === 'venta') { const v = pm(m.monto); s.total += v; s.count++; if (m.fecha && m.fecha > s.ultima) s.ultima = m.fecha; if (m.medio === 'cta corriente') s.cc += v; }
    else if (m.t === 'pago') { s.pagos += pm(m.monto); }
  });
  for (const k in map) map[k].saldoCC = map[k].cc - map[k].pagos;
  return map;
}
let curCli = null;
function renderClientes() {
  refreshClientesDL();
  const q = norm($('#cl_q').value);
  const stats = allClienteStats();
  const blank = { total: 0, count: 0, ultima: '', saldoCC: 0 };
  let keys = Object.keys(store.clientes).filter(k => !q || norm(store.clientes[k].nombre).includes(q));
  keys.sort((a, b) => (stats[b] || blank).total - (stats[a] || blank).total);
  $('#clientesTable').innerHTML = keys.length ? `<table><thead><tr><th>Cliente</th><th class="num">Total</th><th>Última</th><th class="num">Cta cte</th></tr></thead><tbody>
    ${keys.map(k => { const s = stats[k] || blank, c = store.clientes[k]; return `<tr class="clk" data-cli="${esc(k)}"><td><b>${esc(c.nombre)}</b></td>
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
    <td>${m.t === 'pago' ? '<span class="pill ef">pago</span>' : '<span class="pill ' + pillC(m.medio) + '">' + esc(m.medio) + '</span>'}${m.remito ? ' <span class="muted">remito ' + esc(m.remito) + '</span>' : ''}${m.nota ? ' ' + esc(m.nota) : ''}</td>
    <td class="num">${m.t === 'pago' ? '−' : ''}${fmt(pm(m.monto))}</td>
    <td><button class="tdel" data-editm="${m.id}" title="Editar">✎</button><button class="tdel" data-delm="${m.id}">×</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty">Sin movimientos.</div>';
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
  // Ingreso = plata cobrada: ventas que no son cuenta corriente + pagos recibidos (los pagos entran como efectivo).
  const esIngreso = m => (m.t === 'venta' && m.medio !== 'cta corriente') || m.t === 'pago';
  const medioDe = m => m.t === 'pago' ? 'efectivo' : m.medio;
  const mesV = store.movs.filter(m => esIngreso(m) && mesKey(m.fecha) === now);
  const t = mesV.reduce((a, v) => a + pm(v.monto), 0);
  const ef = mesV.filter(v => medioDe(v) === 'efectivo').reduce((a, v) => a + pm(v.monto), 0);
  const nVentas = mesV.filter(m => m.t === 'venta').length;
  $('#es_stats').innerHTML = `
    <div><div class="lbl">Total mes</div><div style="font-size:24px;font-weight:700" class="tabnum">${fmt(t)}</div></div>
    <div><div class="lbl">Ventas</div><div style="font-size:24px;font-weight:700" class="tabnum">${nVentas}</div></div>
    <div><div class="lbl">Efectivo</div><div style="font-size:20px;font-weight:700" class="tabnum">${fmt(ef)}</div></div>
    <div><div class="lbl">Otros medios</div><div style="font-size:20px;font-weight:700" class="tabnum">${fmt(t - ef)}</div></div>`;
  fillMes('#es_mes'); if (!$('#es_mes').value) $('#es_mes').value = now;
  const selMes = $('#es_mes').value || now;
  const dias = {}; store.movs.filter(m => esIngreso(m) && mesKey(m.fecha) === selMes).forEach(v => { (dias[v.fecha] = dias[v.fecha] || { ef: 0, tr: 0, ch: 0, t: 0, n: 0 }); const d = dias[v.fecha]; const me = medioDe(v); d.t += pm(v.monto); if (v.t === 'venta') d.n++; if (me === 'efectivo') d.ef += pm(v.monto); else if (me === 'transferencia') d.tr += pm(v.monto); else if (me === 'cheque') d.ch += pm(v.monto); });
  const orden = Object.keys(dias).sort().reverse();
  $('#es_diario').innerHTML = orden.length ? `<table><thead><tr><th>Día</th><th class="num">Efvo</th><th class="num">Transf</th><th class="num">Total</th></tr></thead><tbody>
    ${orden.map(f => `<tr><td>${fDate(f)}<div class="muted" style="font-size:11px">${dias[f].n} vta${dias[f].n > 1 ? 's' : ''}</div></td>
      <td class="num">${fmt(dias[f].ef)}</td><td class="num">${fmt(dias[f].tr)}</td><td class="num"><b>${fmt(dias[f].t)}</b></td></tr>`).join('')}</tbody></table>`
    : '<div class="empty">Sin ventas ese mes.</div>';
  const years = [...new Set(store.movs.filter(esIngreso).map(m => m.fecha && m.fecha.slice(0, 4)).filter(Boolean))].sort();
  if (!years.length) { $('#es_mensual').innerHTML = '<div class="empty">Sin datos.</div>'; return; }
  const M = {}; years.forEach(y => M[y] = Array(12).fill(0));
  store.movs.filter(esIngreso).forEach(v => { if (!v.fecha) return; const y = v.fecha.slice(0, 4), mi = +v.fecha.slice(5, 7) - 1; if (M[y]) M[y][mi] += pm(v.monto); });
  $('#es_mensual').innerHTML = `<table><thead><tr><th>Mes</th>${years.map(y => `<th class="num">${y}</th>`).join('')}</tr></thead><tbody>
    ${MESES.map((mn, i) => `<tr><td>${mn.slice(0, 3)}</td>${years.map(y => `<td class="num">${M[y][i] ? fmt(M[y][i]) : '<span style="color:var(--line)">—</span>'}</td>`).join('')}</tr>`).join('')}
    <tr style="font-weight:700"><td>Total</td>${years.map(y => `<td class="num">${fmt(M[y].reduce((a, x) => a + x, 0))}</td>`).join('')}</tr></tbody></table>`;
}
$('#es_mes').addEventListener('change', renderEstad);

// ---- Apartado de cheques (cartera) ----------------------------------------
let curChf = 'cartera', curChq = null, curChqEstado = 'cartera';
function renderCheques() {
  const all = store.cheques || [];
  const sum = est => all.filter(c => c.estado === est).reduce((a, c) => a + pm(c.monto), 0);
  $('#chq_cartera').textContent = fmt(sum('cartera'));
  $('#chq_cobrados').textContent = fmt(sum('cobrado'));
  $('#chq_entregados').textContent = fmt(sum('entregado'));
  let rows = curChf === 'todos' ? all.slice() : all.filter(c => c.estado === curChf);
  rows.sort((a, b) => (a.vencimiento || '').localeCompare(b.vencimiento || ''));
  const hoy = today();
  $('#chequesTable').innerHTML = rows.length ? `<table><thead><tr><th>N°</th><th>Cliente</th><th>Vence</th><th class="num">Monto</th><th>Estado</th></tr></thead><tbody>
    ${rows.map(c => {
    const venc = c.vencimiento || '';
    const vencido = c.estado === 'cartera' && venc && venc < hoy;
    const est = c.estado === 'cobrado' ? '<span class="pill ef">cobrado</span>' : c.estado === 'entregado' ? '<span class="pill ga">entregado</span>' : '<span class="pill tr">en cartera</span>';
    return `<tr class="clk" data-cheque="${c.id}">
        <td><b>${esc(c.numero) || '—'}</b></td>
        <td>${esc(c.cliente) || '<span class="muted">—</span>'}${c.estado === 'entregado' && c.salidaDetalle ? `<div class="muted" style="font-size:11px">a ${esc(c.salidaDetalle)}</div>` : ''}</td>
        <td>${venc ? fDate(venc) : '—'}${vencido ? '<div style="color:var(--bad);font-size:11px">vencido</div>' : ''}</td>
        <td class="num">${fmt(pm(c.monto))}</td>
        <td>${est}</td></tr>`;
  }).join('')}</tbody></table>`
    : '<div class="empty">No hay cheques en este estado. Se cargan al guardar una venta con medio Cheque.</div>';
}
$$('[data-chf]').forEach(b => b.addEventListener('click', () => { curChf = b.dataset.chf; $$('[data-chf]').forEach(x => x.classList.toggle('on', x.dataset.chf === curChf)); renderCheques(); }));
document.addEventListener('click', e => { const r = e.target.closest('[data-cheque]'); if (r) openChqSalida(r.dataset.cheque); });
function setChqEstadoUI(est) {
  curChqEstado = est;
  $$('#ovChqSalida [data-cs]').forEach(b => b.classList.toggle('on', b.dataset.cs === est));
  $('#cs_entregado_wrap').classList.toggle('hide', est !== 'entregado');
  $('#cs_fecha_wrap').classList.toggle('hide', est === 'cartera');
}
function openChqSalida(id) {
  const c = (store.cheques || []).find(x => x.id === id); if (!c) return;
  curChq = id;
  $('#cs_num').textContent = c.numero ? 'N° ' + c.numero : '';
  $('#cs_info').textContent = `${c.cliente || 'sin cliente'} · ${fmt(pm(c.monto))}${c.vencimiento ? ' · vence ' + fDate(c.vencimiento) : ''}`;
  $('#cs_aquien').value = c.salidaDetalle || '';
  $('#cs_fecha').value = c.salidaFecha || today();
  setChqEstadoUI(c.estado || 'cartera');
  $('#ovChqSalida').classList.add('on');
}
$$('#ovChqSalida [data-cs]').forEach(b => b.addEventListener('click', () => setChqEstadoUI(b.dataset.cs)));
$('#cs_save').addEventListener('click', () => {
  const c = (store.cheques || []).find(x => x.id === curChq); if (!c) return;
  c.estado = curChqEstado;
  if (curChqEstado === 'cartera') { c.salidaDetalle = ''; c.salidaFecha = ''; }
  else { c.salidaFecha = $('#cs_fecha').value || today(); c.salidaDetalle = curChqEstado === 'entregado' ? $('#cs_aquien').value.trim() : ''; }
  persist(); $('#ovChqSalida').classList.remove('on'); renderCheques();
});
$('#cs_del').addEventListener('click', () => {
  if (!curChq || !confirm('¿Eliminar este cheque de la cartera?')) return;
  store.cheques = store.cheques.filter(x => x.id !== curChq);
  persist(); $('#ovChqSalida').classList.remove('on'); renderCheques();
});

$('#gearBtn').addEventListener('click', () => {
  $('#cfg_frente').value = fmtP(store.config.saldoFrente); $('#cfg_fondo').value = fmtP(store.config.saldoFondo);
  $('#cfg_pin').value = store.config.fondoPin || '';
  $('#cfg_alertaMax').value = store.config.alertaMax ? fmtP(store.config.alertaMax) : '';
  $('#cfg_alertaHora').value = store.config.alertaHora || '16:55';
  renderCfgCajeros(); renderViewer(); $('#ovCfg').classList.add('on');
});

// ---- Ver desde el celular (enlace privado) --------------------------------
function genKey() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let s = ''; for (let i = 0; i < 24; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}
function renderViewer() {
  const box = $('#viewerBox'), cfg = store.config;
  if (cfg.viewerUrl && cfg.viewerReadKey) {
    box.innerHTML = `<div id="viewerLinkBox" style="text-align:center"><p class="muted" style="font-size:12px">Cargando enlace…</p></div>
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
        <button class="btn gh sm" data-vw="test">Probar ahora</button>
        <button class="btn gh sm" data-vw="steps">Ver pasos otra vez</button>
        <button class="btn gh sm" data-vw="remove" style="color:var(--bad)">Quitar</button>
      </div>
      <p class="muted" style="font-size:12px;margin-top:8px">Abrí ese enlace en el celular (podés "Agregar a pantalla de inicio" para que quede como app). Muestra venta del día, cierre, cheques y caja fondo. Solo lectura. La PC lo actualiza cada vez que cargás un movimiento.</p>`;
    loadPhoneLink();
  } else if (cfg.viewerWriteKey) {
    renderViewerSteps();
  } else {
    box.innerHTML = `<p class="muted" style="font-size:12px;margin-bottom:8px">Para ver la info desde el celular (desde cualquier lado), preparamos un enlace privado tuyo. Es un paso de una sola vez; te guío.</p>
      <button class="btn pri" data-vw="prepare">Preparar enlace</button>`;
  }
}
async function renderViewerSteps() {
  const box = $('#viewerBox');
  let code = '';
  try { const wc = await window.api.viewerWorkerCode(); code = (wc && wc.code) || ''; } catch (e) {}
  box.innerHTML = `
    <ol style="font-size:13px;padding-left:18px;line-height:1.55">
      <li>Entrá a <b>dash.cloudflare.com</b> y creá una cuenta gratis (no pide tarjeta).</li>
      <li>Menú <b>Workers &amp; Pages</b> → <b>Create</b> → <b>Create Worker</b> → ponele un nombre → <b>Deploy</b>.</li>
      <li>Tocá <b>Edit code</b>, borrá todo lo que haya y pegá este código:</li>
    </ol>
    <textarea data-vw-code readonly style="height:110px;font-family:monospace;font-size:11px;margin-top:6px">${esc(code)}</textarea>
    <button class="btn gh sm" data-vw="copy" style="margin-top:6px">Copiar código</button>
    <ol start="4" style="font-size:13px;padding-left:18px;line-height:1.55;margin-top:8px">
      <li>Arriba a la derecha tocá <b>Deploy</b>.</li>
      <li>Creá el guardado: menú <b>Storage &amp; Databases → KV</b> → <b>Create</b> → nombre <b>KRIGER</b>.</li>
      <li>Volvé a tu Worker → <b>Settings → Bindings</b> → agregá <b>KV namespace</b>: nombre de variable <b>KRIGER</b> y elegí el que creaste. Guardá.</li>
      <li>Copiá la dirección de tu Worker (termina en <b>.workers.dev</b>) y pegala acá:</li>
    </ol>
    <input data-vw-url placeholder="https://tu-worker.workers.dev" style="margin-top:6px">
    <button class="btn pri" data-vw="saveUrl" style="margin-top:8px">Guardar dirección</button>`;
}
async function loadPhoneLink() {
  try {
    const r = await window.api.viewerPhoneLink();
    const el = $('#viewerLinkBox');
    if (el && r && r.ok) {
      el.innerHTML = (r.qr ? `<img src="${r.qr}" style="width:150px;height:150px">` : '') +
        `<div style="font-size:12px;margin-top:4px;word-break:break-all"><b>${esc(r.link)}</b></div>`;
    } else if (el) { el.innerHTML = '<p class="muted" style="font-size:12px">—</p>'; }
  } catch (e) {}
}
$('#viewerBox').addEventListener('click', async e => {
  const b = e.target.closest('[data-vw]'); if (!b) return;
  const a = b.dataset.vw;
  if (a === 'prepare') { store.config.viewerWriteKey = genKey(); store.config.viewerReadKey = genKey(); persist(); renderViewer(); }
  else if (a === 'copy') { const t = $('[data-vw-code]'); t.select(); try { document.execCommand('copy'); } catch (e) {} toast('Código copiado'); }
  else if (a === 'saveUrl') { const u = ($('[data-vw-url]').value || '').trim(); if (!u) return toast('Pegá la dirección'); store.config.viewerUrl = u.replace(/\/+$/, ''); persist(); renderViewer(); const r = await window.api.viewerTest(); toast(r && r.ok ? 'Enlace listo ✓' : 'Guardado (probá con "Probar ahora")'); }
  else if (a === 'steps') { renderViewerSteps(); }
  else if (a === 'test') { toast('Enviando…'); const r = await window.api.viewerTest(); toast(r && r.ok ? 'Enviado al celular ✓' : 'No se pudo. Revisá la dirección y el KV.'); }
  else if (a === 'remove') { if (confirm('¿Quitar el enlace del celular? (podés volver a prepararlo)')) { store.config.viewerUrl = ''; persist(); renderViewer(); } }
});
function renderCfgCajeros() { $('#cfg_cajeros').innerHTML = store.config.cajeros.map(c => `<span class="pill" style="font-size:13px;padding:5px 10px">${esc(c)} <b data-rmcaj="${esc(c)}" style="cursor:pointer;color:var(--bad);margin-left:4px">×</b></span>`).join('') || '<span class="muted" style="font-size:13px">Ninguno</span>'; }
$('#cfg_cajeros').addEventListener('click', e => { const b = e.target.closest('[data-rmcaj]'); if (!b) return; store.config.cajeros = store.config.cajeros.filter(c => c !== b.dataset.rmcaj); renderCfgCajeros(); });
$('#cfg_addCaj').addEventListener('click', () => { const n = $('#cfg_nuevoCaj').value.trim(); if (n && !store.config.cajeros.includes(n)) store.config.cajeros.push(n); $('#cfg_nuevoCaj').value = ''; renderCfgCajeros(); });
$('#cfg_save').addEventListener('click', () => {
  store.config.saldoFrente = pm($('#cfg_frente').value); store.config.saldoFondo = pm($('#cfg_fondo').value);
  store.config.saldoFecha = today(); // el saldo cuenta desde hoy
  store.config.alertaMax = pm($('#cfg_alertaMax').value);
  store.config.alertaHora = $('#cfg_alertaHora').value || '16:55';
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
$('#cfg_import').addEventListener('click', async () => {
  const r = await window.api.pickExcel();
  if (!r || r.canceled) return;
  if (!r.ok) { alert('No se pudo leer el Excel.\n\n' + (r.error || '')); return; }
  const s = r.resumen;
  let msg = `Voy a importar de la hoja "${s.hoja}":\n\n`;
  msg += `• ${s.ventas} ventas (del ${fDate(s.fechaMin)} al ${fDate(s.fechaMax)})\n`;
  msg += `• ${s.clientes} clientes (se crean solos)\n`;
  msg += `• Cajeros: ${s.cajeros.join(', ')}\n`;
  msg += `• Total histórico: ${fmt(s.sumaTotal)}\n`;
  if (s.saltadasFecha) msg += `\n(${s.saltadasFecha} venta/s con la fecha mal cargada quedan afuera)\n`;
  msg += `\nSe hace una copia de seguridad antes de tocar nada.\n¿Importar ahora?`;
  if (!confirm(msg)) return;
  const imp = await window.api.importExcel(r.filePath);
  if (imp && imp.ok) {
    const ld = await window.api.load();
    if (ld && ld.ok && ld.store) store = ld.store;
    $('#ovCfg').classList.remove('on');
    toast('Importado: ' + imp.resumen.ventas + ' ventas ✓');
    show('home');
  } else {
    alert('No se pudo importar.\n\n' + (imp && imp.error || ''));
  }
});

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
  store.cheques = store.cheques || [];
  // Si nunca se fijó la fecha del saldo, la ponemos hoy (así las ventas viejas
  // importadas no inflan el saldo de la caja).
  if (!store.config.saldoFecha) { store.config.saldoFecha = today(); persist(); }
  if (store.cajeroActual) { $('#cajName').textContent = store.cajeroActual; show('home'); }
  else { renderLogin(); show('login'); }
}
boot();
