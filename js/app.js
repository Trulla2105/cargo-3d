/**
 * app.js — Main application logic
 * State, UI wiring, export/import, stats
 */

'use strict';

// ── STATE ─────────────────────────────────────────────────────

const state = {
  container: null,
  boxes: [],        // box types
  lastResult: null, // last packing result
  manual: []        // manually drag & drop placed boxes
};

let toastTimer = null;
let selectedBoxId = null; // box type selected in the list (for rotating with R/T before placing)
let _listDrag = null;     // active drag from the box list
let _suppressClick = false; // skip the click-select right after a drag

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

  state.boxes.push({
    id: Math.random().toString(36).slice(2),
    name, sku, client, w, d, h, kg, qty,
    priority, fragile, color,
    placed: 0
  });

  renderBoxList();
  updateStats();
  updateBadge();

  // Reset form
  document.getElementById('bName').value = '';
  document.getElementById('bSKU').value = '';
  document.getElementById('bQty').value = 1;

  toast(`"${name}" agregada (${qty} u).`, 'success');
}

function removeBoxType(id) {
  state.boxes = state.boxes.filter(b => b.id !== id);
  if (selectedBoxId === id) selectedBoxId = null;
  renderBoxList();
  updateStats();
  updateBadge();
}

// ── SELECT + ROTATE A BOX BEFORE PLACING ──────────────────────
// Click a box in the list to select it, then R/T rotate its orientation.
// The optimizer will place it (in bounds, stacked) in that fixed orientation.

function selectBoxType(id) {
  selectedBoxId = (selectedBoxId === id) ? null : id; // toggle
  renderBoxList();
  const b = state.boxes.find(x => x.id === selectedBoxId);
  if (b) setStatus(`"${b.name}" seleccionada — R gira · T voltea`, '#f0883e');
  else setStatus('Listo');
}

// axis: 'r' = girar sobre el eje vertical (W↔D) · 't' = voltear (D↔H)
function rotateSelectedBoxType(axis) {
  const b = state.boxes.find(x => x.id === selectedBoxId);
  if (!b) return;
  if (axis === 'r') { const t = b.w; b.w = b.d; b.d = t; }      // W ↔ D
  else              { const t = b.d; b.d = b.h; b.h = t; }      // D ↔ H
  b.lockOrientation = true; // honor this exact orientation when optimizing
  renderBoxList();
  updateStats();
  setStatus(`"${b.name}" → ${b.w}×${b.d}×${b.h} cm`, '#f0883e');
}

// ── DRAG & DROP PLACEMENT FROM THE LIST ───────────────────────
// Drag a box from the list into the container, rotate with R/T while
// holding the button, drop to place it (only where it fits, in bounds).

function initListDrag() {
  const host = document.getElementById('boxList');

  host.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const item = e.target.closest('.box-item');
    if (!item || e.target.closest('button')) return;
    const b = state.boxes.find(x => x.id === item.dataset.id);
    if (!b) return;
    _listDrag = { id: b.id, startX: e.clientX, startY: e.clientY, started: false };
  });

  window.addEventListener('pointermove', e => {
    if (!_listDrag) return;
    if (!_listDrag.started) {
      if (Math.abs(e.clientX - _listDrag.startX) + Math.abs(e.clientY - _listDrag.startY) < 6) return;
      const b = state.boxes.find(x => x.id === _listDrag.id);
      if (!state.container) { toast('Definí el contenedor primero.', 'error'); _listDrag = null; return; }
      if ((b.qty - (b.placed || 0)) <= 0) { toast('No quedan unidades de esa caja.', 'warning'); _listDrag = null; return; }
      if (!startDragPlacement(b, state.container)) { _listDrag = null; return; }
      _listDrag.started = true;
      toast(`Colocando "${b.name}" — R gira · T voltea (o rueda) · soltá para colocar · Esc cancela`, 'info');
    }
    updateDragPointer(e.clientX, e.clientY);
  });

  window.addEventListener('pointerup', () => {
    if (!_listDrag) return;
    const dragged = _listDrag.started;
    _listDrag = null;
    if (!dragged) return;
    _suppressClick = true;
    const rec = commitDragPlacement();
    if (!rec) { toast('No se colocó ahí (no entra).', 'warning'); return; }
    const b = state.boxes.find(x => x.id === rec.id);
    if (b) b.placed = (b.placed || 0) + 1;
    state.manual.push(rec);
    renderBoxList();
    updateStats();
    updateHUD();
    toast('Caja colocada.', 'success');
  });

  // Mouse wheel also rotates (vertical axis) while dragging
  window.addEventListener('wheel', e => {
    if (!isDraggingPlacement()) return;
    e.preventDefault();
    rotateDragBox('r');
  }, { passive: false });
}

// ── BOX LIST RENDER ───────────────────────────────────────────

function renderBoxList() {
  const host = document.getElementById('boxList');
  if (!state.boxes.length) {
    host.innerHTML = '<div class="empty-state">Sin cajas. Agregá una arriba.</div>';
    return;
  }
  host.innerHTML = '';
  state.boxes.forEach(b => {
    const item = document.createElement('div');
    item.className = 'box-item' + (b.id === selectedBoxId ? ' selected' : '');
    item.dataset.id = b.id;
    item.title = 'Click para seleccionar · R/T para rotar antes de colocar';

    const tags = [];
    if (b.fragile === 'yes') tags.push('<span class="tag fragile">frágil</span>');
    if (b.priority === 'high') tags.push('<span class="tag high">alta prioridad</span>');
    if (b.priority === 'low')  tags.push('<span class="tag low">baja prioridad</span>');
    if (b.lockOrientation) tags.push('<span class="tag rot">↻ orientación fija</span>');

    const placedStr = b.placed > 0 ? `<span class="box-placed-badge">${b.placed}/${b.qty}</span>` : '';

    item.innerHTML = `
      <div class="box-dot" style="background:${b.color}"></div>
      <div class="box-meta">
        <div class="box-name">${b.name}</div>
        ${b.sku ? `<div class="box-sku">${b.sku}${b.client ? ' · ' + b.client : ''}</div>` : ''}
        <div class="box-sub">
          <span>${b.qty - b.placed}/${b.qty} u</span>
          <span>${b.w}×${b.d}×${b.h} cm</span>
          <span>${b.kg} kg/u</span>
        </div>
        <div class="box-tags">${tags.join('')}</div>
      </div>
      ${placedStr}
      <button class="box-del" onclick="removeBoxType('${b.id}')" title="Eliminar">×</button>
    `;
    item.addEventListener('click', e => {
      if (_suppressClick) { _suppressClick = false; return; } // a drag just happened
      if (e.target.closest('.box-del')) return; // don't select when deleting
      selectBoxType(b.id);
    });
    host.appendChild(item);
  });
}

function updateBadge() {
  const badge = document.getElementById('boxCount');
  if (badge) badge.textContent = state.boxes.length;
}

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
    state.manual = []; // auto-optimize replaces any manual placement

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
    updateStats();
    updateHUD();

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
  let vUsed = 0, wTotal = 0, pCount = 0;

  state.boxes.forEach(b => {
    vUsed  += b.placed * (b.w * b.d * b.h);
    wTotal += b.placed * b.kg;
    pCount += b.placed;
  });

  const pct    = (vUsed / vMax * 100);
  const pctStr = pct.toFixed(1) + '%';
  const freeStr = (100 - pct).toFixed(1) + '%';
  const wPct   = c ? Math.min(100, wTotal / c.maxKg * 100) : 0;

  document.getElementById('statPlaced').textContent = pCount;
  document.getElementById('statVol').textContent    = pctStr;
  document.getElementById('statWeight').textContent = wTotal.toLocaleString('es-AR') + ' kg';
  document.getElementById('statFree').textContent   = freeStr;

  document.getElementById('ovPlaced').textContent = pCount;
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
    placement: state.lastResult?.placed?.map(p => ({
      id: p.boxData.id,
      x: p.x, y: p.y, z: p.z,
      rw: p.rw, rd: p.rd, rh: p.rh
    })) || [],
    manual: state.manual || []
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
        renderBoxList();
        updateBadge();
      }

      // Restore placement (auto-optimized + manual drag & drop)
      removeBoxMeshes();
      state.boxes.forEach(b => b.placed = 0);
      state.manual = [];

      (data.placement || []).forEach(p => {
        const b = state.boxes.find(b => b.id === p.id);
        if (!b) return;
        const meshBox = Object.assign({}, b, { w: p.rw, d: p.rd, h: p.rh });
        placeBoxMesh(meshBox, p.x, p.y, p.z);
        b.placed = (b.placed || 0) + 1;
      });

      (data.manual || []).forEach(rec => {
        const b = state.boxes.find(b => b.id === rec.id);
        if (!b) return;
        placeManualBox(b, rec);
        b.placed = (b.placed || 0) + 1;
        state.manual.push(rec);
      });

      updateStats();
      updateHUD();
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
  const data = { container: state.container, boxes: state.boxes };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `cargo-boxes-${Date.now()}.json`;
  a.click();
  toast('JSON exportado.', 'success');
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
      if (data.boxes) {
        state.boxes = data.boxes;
        renderBoxList();
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
  document.getElementById('btnExportPNG').addEventListener('click', exportPNG);

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

  // Container
  document.getElementById('btnApplyPreset').addEventListener('click', applyPreset);
  document.getElementById('btnUpdateContainer').addEventListener('click', () => updateContainer(true));

  // Boxes
  document.getElementById('btnAddBox').addEventListener('click', addBox);
  document.getElementById('btnClearScene').addEventListener('click', () => {
    removeBoxMeshes();
    state.boxes.forEach(b => b.placed = 0);
    state.manual = [];
    renderBoxList();
    updateStats();
    toast('Escena limpiada.', 'info');
  });
  document.getElementById('btnOptimize').addEventListener('click', optimizeAndPlace);

  // File inputs
  document.getElementById('fileInput').addEventListener('change', handleFileImport);
  document.getElementById('projectInput').addEventListener('change', loadProjectFile);

  // Keyboard shortcuts
  window.addEventListener('keydown', e => {
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName || '');

    // While dragging a box into the container: R/T rotate the ghost, Esc cancels.
    if (typeof isDraggingPlacement === 'function' && isDraggingPlacement()) {
      const k = e.key.toLowerCase();
      if (e.key === 'Escape') { cancelDragPlacement(); _listDrag = null; return; }
      if (k === 'r') { e.preventDefault(); rotateDragBox('r'); return; }
      if (k === 't') { e.preventDefault(); rotateDragBox('t'); return; }
    }

    // Rotate the selected box before placing it (R = girar, T = voltear).
    if (selectedBoxId && !typing) {
      const k = e.key.toLowerCase();
      if (e.key === 'Escape') { selectedBoxId = null; renderBoxList(); setStatus('Listo'); return; }
      if (k === 'r') { e.preventDefault(); rotateSelectedBoxType('r'); return; }
      if (k === 't') { e.preventDefault(); rotateSelectedBoxType('t'); return; }
    }

    if (e.key === 'F5' || (e.ctrlKey && e.key === 'Enter')) {
      e.preventDefault();
      optimizeAndPlace();
    }
    if (e.ctrlKey && e.key === 's') {
      e.preventDefault();
      saveProject();
    }
    if (e.key === 'g' && !typing) toggleGrid();
    if (e.key === 'w' && !typing) toggleWireframe();
  });
}

// ── INIT ──────────────────────────────────────────────────────

window.addEventListener('load', () => {
  initThree();
  initMenus();
  initPanelToggle();
  initListDrag();
  wireButtons();

  // Apply default preset
  applyPreset();
});
