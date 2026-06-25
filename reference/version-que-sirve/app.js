/**
 * app.js — Main application logic
 * State, UI wiring, export/import, stats
 */

'use strict';

// ── STATE ─────────────────────────────────────────────────────

const state = {
  container: null,
  boxes: [],       // box types
  lastResult: null // last packing result
};
window.appState = state;

let toastTimer = null;

function boxSignature(box) {
  return [
    String(box.name || '').trim().toLowerCase(),
    String(box.sku || '').trim().toLowerCase(),
    String(box.client || '').trim().toLowerCase(),
    box.w,
    box.d,
    box.h,
    box.kg,
    box.priority,
    box.fragile,
    String(box.color || '').toLowerCase()
  ].join('|');
}

function totalQty() {
  return state.boxes.reduce((sum, b) => sum + b.qty, 0);
}

function placedQty() {
  return state.boxes.reduce((sum, b) => sum + (b.placed || 0), 0);
}

function pendingQty(box) {
  return Math.max(0, box.qty - (box.placed || 0));
}

// ── PRESETS ───────────────────────────────────────────────────

const PRESETS = {
  pallet_eu:  { w: 120,  d: 80,   h: 180, maxKg: 1000,  label: 'Pallet Europeo' },
  pallet_std: { w: 120,  d: 100,  h: 180, maxKg: 1500,  label: 'Pallet Standard' },
  '20ft':     { w: 590,  d: 234,  h: 239, maxKg: 25000, label: 'Contenedor 20\'' },
  '40ft':     { w: 1203, d: 234,  h: 239, maxKg: 27600, label: 'Contenedor 40\'' },
  '40hc':     { w: 1203, d: 234,  h: 270, maxKg: 26580, label: 'Contenedor 40HC' },
  truck:      { w: 1360, d: 248,  h: 270, maxKg: 24000, label: 'Camión semirremolque' },
};

// ── TOAST ─────────────────────────────────────────────────────

function toast(msg, type = 'info') {
  const el = document.getElementById('toast');
  el.className = `toast ${type}`;
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.display = 'none'; }, 3500);
}

// ── STATUS PILL ───────────────────────────────────────────────

function setStatus(msg, color = null) {
  const pill = document.getElementById('statusPill');
  if (!pill) return;
  pill.textContent = msg;
  pill.style.color = color || '';
}

// ── CONTAINER ─────────────────────────────────────────────────

function applyPreset() {
  const val = document.getElementById('presetSelect').value;
  const p = PRESETS[val];
  if (!p) return;
  document.getElementById('cW').value = p.w;
  document.getElementById('cD').value = p.d;
  document.getElementById('cH').value = p.h;
  document.getElementById('cMaxKg').value = p.maxKg;
  updateContainer(true);
}

function updateContainer(showToast = true) {
  const w = +document.getElementById('cW').value;
  const d = +document.getElementById('cD').value;
  const h = +document.getElementById('cH').value;
  const maxKg = +document.getElementById('cMaxKg').value;

  if (!w || !d || !h) return toast('Medidas de contenedor inválidas.', 'error');

  state.container = { w, d, h, maxKg };
  rebuildContainerMesh(state.container);
  updateStats();
  if (showToast) toast('Contenedor actualizado.', 'success');
  updateHUD();
  setStatus('Listo');
}

// ── ADD BOX ───────────────────────────────────────────────────

function addBox() {
  const name     = document.getElementById('bName').value.trim() || `Caja ${state.boxes.length + 1}`;
  const sku      = document.getElementById('bSKU').value.trim();
  const client   = document.getElementById('bClient').value.trim();
  const w        = +document.getElementById('bW').value;
  const d        = +document.getElementById('bD').value;
  const h        = +document.getElementById('bH').value;
  const kg       = +document.getElementById('bKg').value;
  const qty      = Math.max(1, Math.floor(+document.getElementById('bQty').value));
  const priority = document.getElementById('bPriority').value;
  const fragile  = document.getElementById('bFragile').value;
  const color    = document.getElementById('bColor').value;

  if (!w || !d || !h) return toast('Dimensiones de caja inválidas.', 'error');

  const newBox = {
    id: Math.random().toString(36).slice(2),
    name, sku, client, w, d, h, kg, qty,
    priority, fragile, color,
    placed: 0
  };

  const existing = addOrMergeBox(newBox);

  renderBoxList();
  renderPlacedList();
  updateStats();
  updateBadge();

  // Reset form
  document.getElementById('bName').value = '';
  document.getElementById('bSKU').value = '';
  document.getElementById('bQty').value = 1;

  toast(existing ? `"${name}" sumada (${qty} u más).` : `"${name}" agregada (${qty} u).`, 'success');
}

function addOrMergeBox(newBox) {
  const existing = state.boxes.find(b => boxSignature(b) === boxSignature(newBox));
  if (existing) {
    existing.qty += newBox.qty;
    return existing;
  }
  state.boxes.push(newBox);
  return null;
}

function removeBoxType(id) {
  state.boxes = state.boxes.filter(b => b.id !== id);
  renderBoxList();
  renderPlacedList();
  updateStats();
  updateBadge();
}

// ── BOX LIST RENDER ───────────────────────────────────────────

function renderBoxList() {
  const host = document.getElementById('boxList');
  const pendingBoxes = state.boxes.filter(b => pendingQty(b) > 0);
  if (!pendingBoxes.length) {
    host.innerHTML = state.boxes.length
      ? '<div class="empty-state">Sin cajas pendientes.</div>'
      : '<div class="empty-state">Sin cajas. Agregá una arriba.</div>';
    return;
  }
  host.innerHTML = '';
  pendingBoxes.forEach(b => {
    const item = document.createElement('div');
    item.className = 'box-item';
    item.draggable = true;

    const tags = [];
    if (b.fragile === 'yes') tags.push('<span class="tag fragile">frágil</span>');
    if (b.priority === 'high') tags.push('<span class="tag high">alta prioridad</span>');
    if (b.priority === 'low')  tags.push('<span class="tag low">baja prioridad</span>');

    item.innerHTML = `
      <div class="box-dot" style="background:${b.color}"></div>
      <div class="box-meta">
        <div class="box-name">${b.name}</div>
        ${b.sku ? `<div class="box-sku">${b.sku}${b.client ? ' · ' + b.client : ''}</div>` : ''}
        <div class="box-sub">
          <span>${pendingQty(b)} pendientes</span>
          <span>${b.w}×${b.d}×${b.h} cm</span>
          <span>${b.kg} kg/u</span>
        </div>
        <div class="box-tags">${tags.join('')}</div>
      </div>
      <button class="box-del" onclick="removeBoxType('${b.id}')" title="Eliminar">×</button>
    `;
    item.addEventListener('dragstart', e => {
      if (typeof startManualBoxDrag === 'function') startManualBoxDrag(b);
      try {
        e.dataTransfer.setData('text/plain', b.id);
        e.dataTransfer.effectAllowed = 'copy';
      } catch {}
    });
    item.addEventListener('dragend', () => {
      if (typeof clearManualBoxDrag === 'function') clearManualBoxDrag();
    });
    item.addEventListener('dblclick', () => {
      if (typeof autoPlaceSingleBox === 'function') autoPlaceSingleBox(b);
    });
    host.appendChild(item);
  });
}

function renderPlacedList() {
  const host = document.getElementById('placedList');
  const badge = document.getElementById('placedCount');
  if (!host) return;

  const placedBoxes = state.boxes.filter(b => (b.placed || 0) > 0);
  if (badge) badge.textContent = placedQty();

  if (!placedBoxes.length) {
    host.innerHTML = '<div class="empty-state compact">Todavía no hay cajas colocadas.</div>';
    return;
  }

  host.innerHTML = '';
  placedBoxes.forEach(b => {
    const item = document.createElement('div');
    item.className = 'box-item placed';
    item.innerHTML = `
      <div class="box-dot" style="background:${b.color}"></div>
      <div class="box-meta">
        <div class="box-name">${b.name}</div>
        <div class="box-sub">
          <span>${b.placed} colocadas</span>
          <span>${pendingQty(b)} pendientes</span>
        </div>
      </div>
      <span class="box-placed-badge">${b.placed}/${b.qty}</span>
    `;
    host.appendChild(item);
  });
}

function updateBadge() {
  const badge = document.getElementById('boxCount');
  if (badge) badge.textContent = totalQty() - placedQty();
}

function markBoxPlaced(id) {
  const box = state.boxes.find(b => b.id === id);
  if (!box || pendingQty(box) <= 0) return;
  box.placed = (box.placed || 0) + 1;
  renderBoxList();
  renderPlacedList();
  updateStats();
  updateBadge();
}

function markBoxUnplaced(id) {
  const box = state.boxes.find(b => b.id === id);
  if (!box || !box.placed) return;
  box.placed = Math.max(0, box.placed - 1);
  renderBoxList();
  renderPlacedList();
  updateStats();
  updateBadge();
}

window.onManualBoxPlaced = markBoxPlaced;
window.onManualBoxUnplaced = markBoxUnplaced;

function syncPlacedCounts(counts) {
  state.boxes.forEach(b => {
    b.placed = counts[b.id] || 0;
  });
  renderBoxList();
  renderPlacedList();
  updateStats();
  updateBadge();
}

function showSelectionPanel(item) {
  const empty = document.getElementById('selectionEmpty');
  const body = document.getElementById('selectionBody');
  if (!empty || !body) return;
  if (!item) {
    empty.style.display = '';
    body.style.display = 'none';
    return;
  }
  empty.style.display = 'none';
  body.style.display = '';
  document.getElementById('selName').textContent = item.name || 'Caja';
  document.getElementById('selMeta').textContent = `${item.w} × ${item.d} × ${item.h} cm · ori ${item.ori}`;
  document.getElementById('selX').value = item.x.toFixed(1);
  document.getElementById('selY').value = item.y.toFixed(1);
  document.getElementById('selZ').value = item.z.toFixed(1);
}

window.onManualLayoutChanged = syncPlacedCounts;
window.onCargoSelectionChanged = showSelectionPanel;

// ── OPTIMIZE ──────────────────────────────────────────────────

function optimizeAndPlace() {
  if (!state.container) return toast('Definí el contenedor primero.', 'error');
  if (!state.boxes.length) return toast('Agregá al menos una caja.', 'error');

  setStatus('Calculando…', '#f0883e');
  toast('Optimizando carga…', 'info');

  // Small delay for UI feedback
  setTimeout(() => {
    removeBoxMeshes();
    state.boxes.forEach(b => b.placed = 0);

    const result = packBoxes(state.boxes, state.container);
    state.lastResult = result;

    // Place meshes
    result.placed.forEach(p => {
      const meshBox = Object.assign({}, p.boxData, {
        w: p.rw, d: p.rd, h: p.rh
      });
      placeBoxMesh(meshBox, p.x, p.y, p.z);
    });

    // Update placed counts
    state.boxes.forEach(b => {
      b.placed = result.placedCount[b.id] || 0;
    });

    renderBoxList();
    renderPlacedList();
    updateStats();
    updateHUD();
    if (typeof recordLayoutHistory === 'function') recordLayoutHistory();

    const total = state.boxes.reduce((s, b) => s + b.qty, 0);
    const placed = result.placed.length;
    const pct = total > 0 ? Math.round(placed/total*100) : 0;

    setStatus(`${placed} cajas colocadas`, '#3fb950');
    toast(`✓ ${placed}/${total} cajas colocadas (${pct}%).`, placed === total ? 'success' : 'warning');
  }, 50);
}

// ── STATS ─────────────────────────────────────────────────────

function updateStats() {
  const c = state.container;
  const vMax = c ? c.w * c.d * c.h : 1;
  let vUsed = 0, wTotal = 0, allCount = 0;

  state.boxes.forEach(b => {
    vUsed  += b.qty * (b.w * b.d * b.h);
    wTotal += b.qty * b.kg;
    allCount += b.qty;
  });

  const pct    = (vUsed / vMax * 100);
  const pctStr = pct.toFixed(1) + '%';
  const freeStr = Math.max(0, 100 - pct).toFixed(1) + '%';
  const wPct   = c && c.maxKg ? Math.min(100, wTotal / c.maxKg * 100) : 0;
  const placed = placedQty();

  document.getElementById('statPlaced').textContent = `${placed}/${allCount}`;
  document.getElementById('statVol').textContent    = pctStr;
  document.getElementById('statWeight').textContent = wTotal.toLocaleString('es-AR') + ' kg';
  document.getElementById('statFree').textContent   = freeStr;

  document.getElementById('ovPlaced').textContent = `${placed}/${allCount}`;
  document.getElementById('ovVol').textContent    = pctStr;
  document.getElementById('ovWeight').textContent = wTotal.toLocaleString('es-AR') + ' kg';

  document.getElementById('progPct').textContent  = pctStr;
  document.getElementById('progFill').style.width = Math.min(100, pct) + '%';

  document.getElementById('progWeightPct').textContent  = wPct.toFixed(0) + '%';
  document.getElementById('progWeightFill').style.width = wPct + '%';

  // Color warning on weight
  const wFill = document.getElementById('progWeightFill');
  wFill.style.background = wPct > 90 ? '#ff7b72' : wPct > 70 ? '#d29922' : '';
}

function updateHUD() {
  const el = document.getElementById('hudContainer');
  if (!el) return;
  const c = state.container;
  if (!c) { el.textContent = '— sin contenedor —'; return; }
  const sel = document.getElementById('presetSelect');
  const label = PRESETS[sel.value]?.label || 'Personalizado';
  el.textContent = `${label}\n${c.w} × ${c.d} × ${c.h} cm  |  máx ${c.maxKg.toLocaleString('es-AR')} kg`;
}

// ── SAVE / OPEN PROJECT ───────────────────────────────────────

function saveProject() {
  if (!state.container && !state.boxes.length) {
    return toast('No hay nada que guardar.', 'warning');
  }
  const data = {
    version: '1.0',
    date: new Date().toISOString(),
    container: state.container,
    boxes: state.boxes,
    layout: typeof serializeCargoLayout === 'function' ? serializeCargoLayout() : [],
    placement: typeof serializeCargoLayout === 'function' ? serializeCargoLayout().map(p => ({
      id: p.id,
      x: p.pos.x,
      y: p.pos.y + p.h / 2,
      z: p.pos.z,
      rw: p.w,
      rd: p.d,
      rh: p.h,
      ori: p.ori
    })) : []
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `cargo-project-${Date.now()}.json`;
  a.click();
  toast('Proyecto guardado.', 'success');
}

function openProject() {
  document.getElementById('projectInput').click();
}

function loadProjectFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      if (data.container) {
        state.container = data.container;
        document.getElementById('cW').value = data.container.w;
        document.getElementById('cD').value = data.container.d;
        document.getElementById('cH').value = data.container.h;
        document.getElementById('cMaxKg').value = data.container.maxKg;
        rebuildContainerMesh(data.container);
      }
      if (data.boxes) {
        state.boxes = data.boxes;
        state.boxes.forEach(b => b.placed = 0);
        renderBoxList();
        renderPlacedList();
        updateBadge();
      }
      const layout = data.layout || data.placement?.map(p => ({
        id: p.id,
        w: p.rw,
        d: p.rd,
        h: p.rh,
        ori: p.ori || 0,
        pos: { x: p.x, y: p.y - p.rh / 2, z: p.z }
      })) || [];

      if (layout.length && typeof restoreCargoLayout === 'function') {
        restoreCargoLayout(layout, { skipHistory: true });
      } else if (typeof removeBoxMeshes === 'function') {
        removeBoxMeshes();
        syncPlacedCounts({});
      }

      renderBoxList();
      renderPlacedList();
      updateBadge();
      updateStats();
      updateHUD();
      if (typeof resetCargoLayoutHistory === 'function') resetCargoLayoutHistory();
      toast('Proyecto cargado correctamente.', 'success');
    } catch {
      toast('Error al leer el archivo JSON.', 'error');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

// ── IMPORT / EXPORT JSON (legacy) ────────────────────────────

function exportJSON() {
  const data = {
    container: state.container,
    boxes: state.boxes,
    layout: typeof serializeCargoLayout === 'function' ? serializeCargoLayout() : []
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `cargo-boxes-${Date.now()}.json`;
  a.click();
  toast('JSON exportado.', 'success');
}

function exportCSV() {
  const layout = typeof getPlacedCargoItems === 'function' ? getPlacedCargoItems() : [];
  const rows = [
    ['#','Nombre','SKU','Cliente','Ancho','Profundo','Alto','X','Y','Z','Peso kg','Fragilidad','Prioridad']
  ];
  layout.forEach((it, idx) => {
    const source = state.boxes.find(b => b.id === it.id) || {};
    rows.push([
      idx + 1,
      it.name,
      source.sku || '',
      source.client || '',
      it.w,
      it.d,
      it.h,
      it.x.toFixed(1),
      it.y.toFixed(1),
      it.z.toFixed(1),
      source.kg || 0,
      source.fragile === 'yes' ? 'Frágil' : 'Estándar',
      source.priority || 'normal'
    ]);
  });
  const csv = rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `cargo-cajas-${Date.now()}.csv`;
  a.click();
  toast('CSV exportado.', 'success');
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}

function reportMetrics() {
  const c = state.container;
  const placedBoxes = state.boxes.filter(b => (b.placed || 0) > 0);
  const placed = placedQty();
  const total = totalQty();
  const placedVolume = placedBoxes.reduce((sum, b) => sum + (b.placed || 0) * b.w * b.d * b.h, 0);
  const placedWeight = placedBoxes.reduce((sum, b) => sum + (b.placed || 0) * b.kg, 0);
  const containerVolume = c ? c.w * c.d * c.h : 0;
  return {
    placed,
    total,
    pending: total - placed,
    placedVolume,
    placedWeight,
    containerVolume,
    volumePct: containerVolume ? placedVolume / containerVolume * 100 : 0,
    weightPct: c && c.maxKg ? placedWeight / c.maxKg * 100 : 0
  };
}

function buildPrintReportHTML(shots, placedItems) {
  const c = state.container;
  const sel = document.getElementById('presetSelect');
  const label = PRESETS[sel.value]?.label || 'Personalizado';
  const metrics = reportMetrics();
  const positioned = placedItems.map(it => {
    const source = state.boxes.find(b => b.id === it.id) || {};
    return { ...it, kg: +(source.kg || 0) };
  });
  const totalPositionedWeight = positioned.reduce((sum, it) => sum + it.kg, 0);
  const center = totalPositionedWeight ? positioned.reduce((acc, it) => {
    acc.x += it.x * it.kg;
    acc.y += (it.y + it.h / 2) * it.kg;
    acc.z += it.z * it.kg;
    return acc;
  }, { x: 0, y: 0, z: 0 }) : { x: 0, y: 0, z: 0 };
  if (totalPositionedWeight) {
    center.x /= totalPositionedWeight;
    center.y /= totalPositionedWeight;
    center.z /= totalPositionedWeight;
  }
  const zones = positioned.reduce((acc, it) => {
    acc[it.x < 0 ? 'left' : 'right'] += it.kg;
    acc[it.z < 0 ? 'front' : 'back'] += it.kg;
    return acc;
  }, { left: 0, right: 0, front: 0, back: 0 });
  const placedRows = state.boxes
    .filter(b => (b.placed || 0) > 0)
    .map(b => {
      const volume = (b.placed || 0) * b.w * b.d * b.h;
      const weight = (b.placed || 0) * b.kg;
      return `
        <tr>
          <td><span class="swatch" style="background:${esc(b.color)}"></span>${esc(b.name)}</td>
          <td>${esc(b.sku || '-')}</td>
          <td>${esc(b.client || '-')}</td>
          <td>${b.placed}/${b.qty}</td>
          <td>${b.w} × ${b.d} × ${b.h}</td>
          <td>${weight.toLocaleString('es-AR')} kg</td>
          <td>${(volume / 1000000).toLocaleString('es-AR', { maximumFractionDigits: 2 })} m³</td>
          <td>${b.fragile === 'yes' ? 'Frágil' : 'Estándar'}</td>
        </tr>
      `;
    }).join('');
  const pendingRows = state.boxes
    .filter(b => pendingQty(b) > 0)
    .map(b => `
      <tr>
        <td><span class="swatch" style="background:${esc(b.color)}"></span>${esc(b.name)}</td>
        <td>${esc(b.sku || '-')}</td>
        <td>${esc(b.client || '-')}</td>
        <td>${pendingQty(b)}</td>
        <td>${b.w} × ${b.d} × ${b.h}</td>
        <td>${((pendingQty(b) * b.kg) || 0).toLocaleString('es-AR')} kg</td>
      </tr>
    `).join('');
  const positionsRows = placedItems.map((it, idx) => `
    <tr>
      <td>${idx + 1}</td>
      <td>${esc(it.name)}</td>
      <td>${it.w} × ${it.d} × ${it.h}</td>
      <td>${it.x.toFixed(1)}, ${it.y.toFixed(1)}, ${it.z.toFixed(1)}</td>
    </tr>
  `).join('');

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Informe de carga - Cargo3D</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #111827; font-family: Arial, sans-serif; font-size: 11px; }
  h1 { margin: 0; font-size: 22px; }
  h2 { margin: 18px 0 8px; font-size: 14px; border-bottom: 1px solid #d1d5db; padding-bottom: 4px; }
  .top { display: flex; justify-content: space-between; gap: 18px; align-items: flex-start; }
  .muted { color: #6b7280; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 14px; }
  .card { border: 1px solid #d1d5db; border-radius: 6px; padding: 8px; }
  .card b { display: block; font-size: 15px; margin-top: 3px; }
  .views { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .view { border: 1px solid #d1d5db; border-radius: 6px; overflow: hidden; page-break-inside: avoid; }
  .view h3 { margin: 0; padding: 6px 8px; background: #f3f4f6; font-size: 11px; }
  .view img { display: block; width: 100%; height: 205px; object-fit: contain; background: #070b10; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #d1d5db; padding: 5px 6px; text-align: left; vertical-align: top; }
  th { background: #f3f4f6; font-size: 10px; text-transform: uppercase; color: #374151; }
  .swatch { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; vertical-align: -1px; }
  .footer { margin-top: 14px; color: #6b7280; font-size: 10px; }
  .page-break { page-break-before: always; }
  @media print {
    .no-print { display: none; }
    .view img { height: 190px; }
  }
</style>
</head>
<body>
  <button class="no-print" onclick="window.print()" style="position:fixed;right:12px;top:12px;padding:8px 12px">Imprimir</button>
  <section class="top">
    <div>
      <h1>Informe de carga Cargo3D</h1>
      <div class="muted">Generado: ${new Date().toLocaleString('es-AR')}</div>
    </div>
    <div>
      <b>${esc(label)}</b><br>
      ${c ? `${c.w} × ${c.d} × ${c.h} cm · Máx ${c.maxKg.toLocaleString('es-AR')} kg` : 'Sin contenedor'}
    </div>
  </section>

  <section class="grid">
    <div class="card">Cajas colocadas<b>${metrics.placed}/${metrics.total}</b></div>
    <div class="card">Pendientes<b>${metrics.pending}</b></div>
    <div class="card">Peso cargado<b>${metrics.placedWeight.toLocaleString('es-AR')} kg</b><span class="muted">${metrics.weightPct.toFixed(1)}% del máximo</span></div>
    <div class="card">Volumen usado<b>${metrics.volumePct.toFixed(1)}%</b><span class="muted">${(metrics.placedVolume / 1000000).toLocaleString('es-AR', { maximumFractionDigits: 2 })} m³</span></div>
  </section>

  <section class="grid">
    <div class="card">Centro X<b>${center.x.toFixed(1)} cm</b></div>
    <div class="card">Centro Y<b>${center.y.toFixed(1)} cm</b></div>
    <div class="card">Centro Z<b>${center.z.toFixed(1)} cm</b></div>
    <div class="card">Balance L/R<b>${zones.left.toLocaleString('es-AR')} / ${zones.right.toLocaleString('es-AR')} kg</b><span class="muted">Frente/fondo ${zones.front.toLocaleString('es-AR')} / ${zones.back.toLocaleString('es-AR')} kg</span></div>
  </section>

  <h2>Vistas del contenedor</h2>
  <section class="views">
    ${shots.map(s => `<div class="view"><h3>${esc(s.label)}</h3><img src="${s.image}" alt="${esc(s.label)}"></div>`).join('')}
  </section>

  <h2>Cajas cargadas</h2>
  <table>
    <thead><tr><th>Caja</th><th>SKU</th><th>Cliente</th><th>Cant.</th><th>Medidas cm</th><th>Peso</th><th>Volumen</th><th>Tipo</th></tr></thead>
    <tbody>${placedRows || '<tr><td colspan="8">No hay cajas colocadas.</td></tr>'}</tbody>
  </table>

  <h2>Posiciones colocadas</h2>
  <table>
    <thead><tr><th>#</th><th>Caja</th><th>Medidas cm</th><th>Posición X/Y/Z cm</th></tr></thead>
    <tbody>${positionsRows || '<tr><td colspan="4">No hay posiciones registradas.</td></tr>'}</tbody>
  </table>

  <h2>Cajas pendientes</h2>
  <table>
    <thead><tr><th>Caja</th><th>SKU</th><th>Cliente</th><th>Pend.</th><th>Medidas cm</th><th>Peso pendiente</th></tr></thead>
    <tbody>${pendingRows || '<tr><td colspan="6">No hay cajas pendientes.</td></tr>'}</tbody>
  </table>

  <div class="footer">Cargo3D · Informe generado desde el estado actual del visor 3D.</div>
</body>
</html>`;
}

function printCargoReport() {
  if (!state.container) return toast('Definí el contenedor primero.', 'error');
  if (!placedQty()) return toast('No hay cajas colocadas para imprimir.', 'warning');
  if (typeof captureCargoViews !== 'function') return toast('El visor no está listo para imprimir.', 'error');

  const shots = captureCargoViews(state.container);
  const placedItems = typeof getPlacedCargoItems === 'function' ? getPlacedCargoItems() : [];
  const html = buildPrintReportHTML(shots, placedItems);
  const report = window.open('', '_blank');
  if (!report) {
    const blob = new Blob([html], { type: 'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `informe-cargo-${Date.now()}.html`;
    a.click();
    return toast('Informe descargado. Abrilo para imprimir.', 'success');
  }
  report.document.open();
  report.document.write(html);
  report.document.close();
  report.focus();
  setTimeout(() => report.print(), 400);
}

function importJSON() {
  document.getElementById('fileInput').click();
}

function handleFileImport(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      if (data.container) {
        state.container = data.container;
        document.getElementById('cW').value = data.container.w;
        document.getElementById('cD').value = data.container.d;
        document.getElementById('cH').value = data.container.h;
        document.getElementById('cMaxKg').value = data.container.maxKg;
        rebuildContainerMesh(data.container);
        updateHUD();
      }
      if (data.boxes) {
        state.boxes = data.boxes;
        state.boxes.forEach(b => b.placed = 0);
        if (data.layout?.length && typeof restoreCargoLayout === 'function') {
          restoreCargoLayout(data.layout, { skipHistory: true });
          if (typeof resetCargoLayoutHistory === 'function') resetCargoLayoutHistory();
        }
        renderBoxList();
        renderPlacedList();
        updateBadge();
        updateStats();
        toast(`${data.boxes.length} cajas importadas.`, 'success');
      }
    } catch {
      toast('Error al importar JSON.', 'error');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

// ── PANEL TOGGLE ──────────────────────────────────────────────

function initPanelToggle() {
  document.getElementById('toggleBoxForm').addEventListener('click', () => {
    const body = document.getElementById('boxFormBody');
    const btn  = document.getElementById('toggleBoxForm');
    const collapsed = body.style.display === 'none';
    body.style.display = collapsed ? '' : 'none';
    btn.textContent = collapsed ? '▾' : '▸';
  });
}

// ── MENU DROPDOWNS ────────────────────────────────────────────

function initMenus() {
  document.querySelectorAll('.menuBtn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const dd = btn.nextElementSibling;
      const open = dd.style.display === 'block';
      document.querySelectorAll('.dropdown').forEach(d => d.style.display = 'none');
      dd.style.display = open ? 'none' : 'block';
    });
  });
  window.addEventListener('click', () => {
    document.querySelectorAll('.dropdown').forEach(d => d.style.display = 'none');
  });
}

// ── WIRE UP ALL BUTTONS ───────────────────────────────────────

function wireButtons() {
  // File menu
  document.getElementById('btnSaveProject').addEventListener('click', saveProject);
  document.getElementById('btnOpenProject').addEventListener('click', openProject);
  document.getElementById('btnExportJSON').addEventListener('click', exportJSON);
  document.getElementById('btnImportJSON').addEventListener('click', importJSON);
  document.getElementById('btnExportCSV').addEventListener('click', exportCSV);
  document.getElementById('btnExportPNG').addEventListener('click', exportPNG);
  document.getElementById('btnPrintReport').addEventListener('click', printCargoReport);

  // View menu
  document.getElementById('btnViewIso').addEventListener('click',   () => setCameraView('iso',   state.container));
  document.getElementById('btnViewFront').addEventListener('click', () => setCameraView('front', state.container));
  document.getElementById('btnViewSide').addEventListener('click',  () => setCameraView('side',  state.container));
  document.getElementById('btnViewTop').addEventListener('click',   () => setCameraView('top',   state.container));
  document.getElementById('btnResetCam').addEventListener('click',  () => setCameraView('reset', state.container));
  document.getElementById('btnToggleGrid').addEventListener('click', () => {
    const on = toggleGrid();
    toast(`Grid ${on ? 'activado' : 'desactivado'}.`, 'info');
  });
  document.getElementById('btnToggleWire').addEventListener('click', () => {
    const on = toggleWireframe();
    toast(`Wireframe ${on ? 'activado' : 'desactivado'}.`, 'info');
  });
  document.getElementById('btnToggleTheme').addEventListener('click', () => {
    const theme = typeof toggleViewerTheme === 'function' ? toggleViewerTheme() : 'dark';
    toast(`Tema ${theme === 'light' ? 'claro' : 'oscuro'} activado.`, 'info');
  });

  // Container
  document.getElementById('btnApplyPreset').addEventListener('click', applyPreset);
  document.getElementById('btnUpdateContainer').addEventListener('click', () => updateContainer(true));

  // Boxes
  document.getElementById('btnUndoLayout').addEventListener('click', () => {
    if (typeof undoCargoLayout === 'function') undoCargoLayout();
  });
  document.getElementById('btnRedoLayout').addEventListener('click', () => {
    if (typeof redoCargoLayout === 'function') redoCargoLayout();
  });
  document.getElementById('btnAddBox').addEventListener('click', addBox);
  document.getElementById('btnClearScene').addEventListener('click', () => {
    removeBoxMeshes();
    state.boxes.forEach(b => b.placed = 0);
    renderBoxList();
    renderPlacedList();
    updateStats();
    showSelectionPanel(null);
    if (typeof recordLayoutHistory === 'function') recordLayoutHistory();
    toast('Escena limpiada.', 'info');
  });
  document.getElementById('btnOptimize').addEventListener('click', optimizeAndPlace);

  document.getElementById('selRotY').addEventListener('click', () => typeof rotateSelected === 'function' && rotateSelected('y'));
  document.getElementById('selRotX').addEventListener('click', () => typeof rotateSelected === 'function' && rotateSelected('x'));
  document.getElementById('selRotZ').addEventListener('click', () => typeof rotateSelected === 'function' && rotateSelected('z'));
  document.getElementById('selDelete').addEventListener('click', () => typeof deleteSelectedCargoItem === 'function' && deleteSelectedCargoItem());
  document.getElementById('selDuplicate').addEventListener('click', () => typeof duplicateSelectedCargoItem === 'function' && duplicateSelectedCargoItem());
  ['selX','selY','selZ'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => {
      if (typeof moveSelectedCargoItem !== 'function') return;
      moveSelectedCargoItem({
        x: +document.getElementById('selX').value,
        y: +document.getElementById('selY').value,
        z: +document.getElementById('selZ').value
      });
    });
  });

  // File inputs
  document.getElementById('fileInput').addEventListener('change', handleFileImport);
  document.getElementById('projectInput').addEventListener('change', loadProjectFile);

  // Keyboard shortcuts
  window.addEventListener('keydown', e => {
    if (e.key === 'F5' || (e.ctrlKey && e.key === 'Enter')) {
      e.preventDefault();
      optimizeAndPlace();
    }
    if (e.ctrlKey && e.key === 's') {
      e.preventDefault();
      saveProject();
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (typeof undoCargoLayout === 'function') undoCargoLayout();
    }
    if ((e.ctrlKey && e.key.toLowerCase() === 'y') || (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'z')) {
      e.preventDefault();
      if (typeof redoCargoLayout === 'function') redoCargoLayout();
    }
    if (e.key === 'g') toggleGrid();
    if (e.key === 'w') toggleWireframe();
  });
}

// ── INIT ──────────────────────────────────────────────────────

window.addEventListener('load', () => {
  initThree();
  initMenus();
  initPanelToggle();
  wireButtons();
  renderPlacedList();

  // Apply default preset
  applyPreset();
  if (typeof resetCargoLayoutHistory === 'function') resetCargoLayoutHistory();
});
