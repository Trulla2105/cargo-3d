/**
 * viewer.js — Three.js scene manager
 * Handles: scene init, camera, lights, container mesh, box meshes, views
 */

'use strict';

let scene, camera, renderer, controls;
let containerGroup = null;
let gridHelper = null;
let wireframeVisible = true;
let gridVisible = true;
let placedMeshes = [];
let placedItems = [];
let ghostMesh = null;
let selectedItem = null;
let manualDragBox = null;
let manualDragOri = 0;
let manualPointerActive = false;
let manualPending = null;
let manualLastPointer = { x: 0, y: 0 };
let sceneDrag = null;
let raycaster, pointer2;
let layoutHistory = [];
let layoutHistoryIndex = -1;
let restoringLayout = false;
let lastPlacementReason = 'Ubicación inválida';
let viewerTheme = 'dark';
let containerMaterials = null;

const VIEWER_THEMES = {
  dark: {
    background: 0x101722,
    fog: 0x101722,
    grid: 0x2b3442,
    edge: 0xf0883e,
    wall: 0x1c2330,
    wallOpacity: 0.12,
    floor: 0x303a49,
    floorOpacity: 0.55,
    boxEdge: 0x000000
  },
  light: {
    background: 0xeef2f7,
    fog: 0xeef2f7,
    grid: 0xc3ccd8,
    edge: 0x334155,
    wall: 0xe2e8f0,
    wallOpacity: 0.24,
    floor: 0xe4eaf2,
    floorOpacity: 0.9,
    boxEdge: 0x111827
  },
  print: {
    background: 0xf2f4f7,
    fog: 0xf2f4f7,
    grid: 0xc9d1dc,
    edge: 0x111827,
    wall: 0xf1f5f9,
    wallOpacity: 0.38,
    floor: 0xe9edf3,
    floorOpacity: 1,
    boxEdge: 0x111827
  }
};

const ORIENTS = [
  ['W','H','D'],
  ['D','H','W'],
  ['H','W','D'],
  ['H','D','W'],
  ['W','D','H'],
  ['D','W','H']
];
const EPS = 0.001;
const SNAP = 2;
const DRAG_THRESHOLD = 4;

// ── INIT ─────────────────────────────────────────────────────

function initThree() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(VIEWER_THEMES.dark.background);
  scene.fog = new THREE.FogExp2(VIEWER_THEMES.dark.fog, 0.00035);

  const host = document.getElementById('canvas3d');
  const w = host.clientWidth || window.innerWidth - 320;
  const h = host.clientHeight || window.innerHeight - 48;

  camera = new THREE.PerspectiveCamera(50, w / h, 1, 50000);
  camera.position.set(900, 700, 900);

  renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  host.appendChild(renderer.domElement);

  // Controls
  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 120, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.minDistance = 50;
  controls.maxDistance = 8000;
  controls.maxPolarAngle = Math.PI * 0.9;

  raycaster = new THREE.Raycaster();
  pointer2 = new THREE.Vector2();

  // Lights
  const ambient = new THREE.AmbientLight(0xffffff, 0.45);
  scene.add(ambient);

  const keyLight = new THREE.DirectionalLight(0xffeedd, 0.8);
  keyLight.position.set(600, 1200, 600);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0xadd8ff, 0.3);
  fillLight.position.set(-400, 300, -400);
  scene.add(fillLight);

  // Grid
  rebuildGridForContainer(null);

  window.addEventListener('resize', onResize);
  setupManualPlacement(renderer.domElement);
  animate();
}

function onResize() {
  const host = document.getElementById('canvas3d');
  if (!host) return;
  camera.aspect = host.clientWidth / host.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(host.clientWidth, host.clientHeight);
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

function applyViewerTheme(themeName = viewerTheme) {
  const theme = VIEWER_THEMES[themeName] || VIEWER_THEMES.dark;
  viewerTheme = themeName;
  if (scene) {
    scene.background = new THREE.Color(theme.background);
    if (scene.fog) scene.fog.color.setHex(theme.fog);
  }
  if (gridHelper) {
    gridHelper.material.color.setHex(theme.grid);
    gridHelper.material.opacity = themeName === 'dark' ? 1 : 0.65;
    gridHelper.material.transparent = themeName !== 'dark';
  }
  if (containerMaterials) {
    containerMaterials.edges.forEach(mat => {
      mat.color.setHex(theme.edge);
      mat.opacity = themeName === 'dark' ? 0.6 : 0.85;
    });
    containerMaterials.walls.forEach(mat => {
      mat.color.setHex(theme.wall);
      mat.opacity = theme.wallOpacity;
    });
    if (containerMaterials.floor) {
      containerMaterials.floor.color.setHex(theme.floor);
      containerMaterials.floor.opacity = theme.floorOpacity;
    }
  }
  placedMeshes.forEach(mesh => {
    if (mesh.userData.edgeMat) {
      mesh.userData.edgeMat.color.setHex(theme.boxEdge);
      mesh.userData.edgeMat.opacity = wireframeVisible ? (themeName === 'dark' ? 0.35 : 0.55) : 0;
    }
  });
  return viewerTheme;
}

function toggleViewerTheme() {
  return applyViewerTheme(viewerTheme === 'dark' ? 'light' : 'dark');
}

function rebuildGridForContainer(container) {
  if (gridHelper) {
    scene.remove(gridHelper);
    if (gridHelper.geometry) gridHelper.geometry.dispose();
    if (gridHelper.material) gridHelper.material.dispose();
  }
  const base = container ? Math.max(container.w, container.d) : 800;
  const size = Math.max(240, Math.min(1800, base * 1.15));
  const divisions = Math.max(12, Math.min(48, Math.round(size / 25)));
  const theme = VIEWER_THEMES[viewerTheme] || VIEWER_THEMES.dark;
  gridHelper = new THREE.GridHelper(size, divisions, theme.grid, theme.grid);
  gridHelper.position.y = 0;
  gridHelper.visible = gridVisible;
  scene.add(gridHelper);
  applyViewerTheme(viewerTheme);
}

// ── CONTAINER ────────────────────────────────────────────────

function rebuildContainerMesh(container) {
  if (containerGroup) {
    scene.remove(containerGroup);
    containerGroup.traverse(c => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
    });
  }
  if (!container) return;

  containerGroup = new THREE.Group();
  containerMaterials = { edges: [], walls: [], floor: null };

  const { w, d, h } = container;
  const cx = 0, cy = h / 2, cz = 0;

  // Wireframe edges
  const boxGeom = new THREE.BoxGeometry(w, h, d);
  const edgesGeom = new THREE.EdgesGeometry(boxGeom);
  const edgesMat = new THREE.LineBasicMaterial({
    color: 0xf0883e,
    transparent: true,
    opacity: 0.6
  });
  const edges = new THREE.LineSegments(edgesGeom, edgesMat);
  edges.position.set(cx, cy, cz);
  containerGroup.add(edges);
  containerMaterials.edges.push(edgesMat);

  // Transparent walls
  const wallMat = new THREE.MeshPhongMaterial({
    color: 0x1c2330,
    transparent: true,
    opacity: 0.08,
    side: THREE.DoubleSide,
    depthWrite: false
  });

  // Floor
  const floorGeom = new THREE.PlaneGeometry(w, d);
  const floorMat = new THREE.MeshPhongMaterial({
    color: 0x2a3444,
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide
  });
  const floor = new THREE.Mesh(floorGeom, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.5;
  containerGroup.add(floor);
  containerMaterials.floor = floorMat;

  // Side walls (subtle)
  const sides = [
    { pos: [0, cy, -d/2], rot: [0,0,0], size: [w, h] },
    { pos: [0, cy,  d/2], rot: [0,0,0], size: [w, h] },
    { pos: [-w/2, cy, 0], rot: [0, Math.PI/2, 0], size: [d, h] },
    { pos: [ w/2, cy, 0], rot: [0, Math.PI/2, 0], size: [d, h] },
  ];
  sides.forEach(s => {
    const g = new THREE.PlaneGeometry(s.size[0], s.size[1]);
    const m = new THREE.Mesh(g, wallMat.clone());
    m.position.set(...s.pos);
    m.rotation.set(...s.rot);
    containerGroup.add(m);
    containerMaterials.walls.push(m.material);
  });

  // Corner markers
  const corners = [
    [-w/2, 0, -d/2], [w/2, 0, -d/2],
    [-w/2, 0,  d/2], [w/2, 0,  d/2],
    [-w/2, h, -d/2], [w/2, h, -d/2],
    [-w/2, h,  d/2], [w/2, h,  d/2],
  ];
  const sphereGeom = new THREE.SphereGeometry(4, 6, 6);
  const sphereMat = new THREE.MeshBasicMaterial({ color: 0xf0883e });
  corners.forEach(c => {
    const s = new THREE.Mesh(sphereGeom, sphereMat);
    s.position.set(...c);
    containerGroup.add(s);
  });

  scene.add(containerGroup);
  rebuildGridForContainer(container);
  applyViewerTheme(viewerTheme);

  // Aim camera
  controls.target.set(cx, cy * 0.6, cz);
  controls.update();
}

// ── BOXES ────────────────────────────────────────────────────

function placeBoxMesh(boxData, x, y, z) {
  const { w, d, h, color, fragile, priority } = boxData;

  const geom = new THREE.BoxGeometry(w, h, d);
  const col = new THREE.Color(color || '#3b82f6');

  const mat = new THREE.MeshPhongMaterial({
    color: col,
    transparent: true,
    opacity: fragile === 'yes' ? 0.72 : 0.88,
    shininess: 60,
  });

  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  // Edge outline
  const eGeom = new THREE.EdgesGeometry(geom);
  const eMat = new THREE.LineBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: wireframeVisible ? 0.35 : 0
  });
  const edgeMesh = new THREE.LineSegments(eGeom, eMat);
  edgeMesh.userData.kind = 'staticEdges';
  mesh.add(edgeMesh);

  // Fragile indicator — small red dot on top
  if (fragile === 'yes') {
    const dotG = new THREE.SphereGeometry(Math.min(w,d) * 0.06, 8, 8);
    const dotM = new THREE.MeshBasicMaterial({ color: 0xff7b72 });
    const dot = new THREE.Mesh(dotG, dotM);
    dot.position.set(0, h/2 + 2, 0);
    mesh.add(dot);
  }

  mesh.userData = {
    type: 'box',
    id: boxData.id,
    name: boxData.name,
    edgeMat: eMat,
    base: boxData.base || { w: boxData.baseW || w, d: boxData.baseD || d, h: boxData.baseH || h },
    ori: boxData.ori || 0
  };

  scene.add(mesh);
  placedMeshes.push(mesh);

  const item = {
    uid: Math.random().toString(36).slice(2),
    id: boxData.id,
    box: {
      id: boxData.id,
      name: boxData.name,
      w, d, h,
      color,
      fragile,
      priority,
      base: mesh.userData.base,
      ori: mesh.userData.ori
    },
    pos: { x, y: y - h / 2, z },
    mesh
  };
  mesh.userData.item = item;
  placedItems.push(item);
  return mesh;
}

function removeBoxMeshes() {
  placedMeshes.forEach(m => {
    scene.remove(m);
    m.traverse(c => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
    });
  });
  placedMeshes = [];
  placedItems = [];
  clearSelection();
  clearGhost();
}

// ── WIREFRAME TOGGLE ─────────────────────────────────────────

function setWireframe(visible) {
  wireframeVisible = visible;
  const theme = VIEWER_THEMES[viewerTheme] || VIEWER_THEMES.dark;
  placedMeshes.forEach(m => {
    if (m.userData.edgeMat) {
      m.userData.edgeMat.color.setHex(theme.boxEdge);
      m.userData.edgeMat.opacity = visible ? (viewerTheme === 'dark' ? 0.35 : 0.55) : 0;
    }
  });
}

function toggleWireframe() {
  setWireframe(!wireframeVisible);
  return wireframeVisible;
}

// ── GRID TOGGLE ──────────────────────────────────────────────

function toggleGrid() {
  gridVisible = !gridVisible;
  if (gridHelper) gridHelper.visible = gridVisible;
  return gridVisible;
}

// ── MANUAL PLACEMENT / ORIGINAL MOTOR ─────────────────────────

function oriDims(base, idx) {
  const map = ORIENTS[idx % ORIENTS.length];
  const get = c => c === 'W' ? base.w : (c === 'H' ? base.h : base.d);
  return { w: get(map[0]), h: get(map[1]), d: get(map[2]) };
}

function rotIdx(idx, axis) {
  const tup = ORIENTS[idx % ORIENTS.length];
  let nx, ny, nz;
  if (axis === 'x') { nx = tup[0]; ny = tup[2]; nz = tup[1]; }
  else if (axis === 'y') { nx = tup[2]; ny = tup[1]; nz = tup[0]; }
  else { nx = tup[1]; ny = tup[0]; nz = tup[2]; }
  const key = `${nx},${ny},${nz}`;
  const next = ORIENTS.findIndex(o => `${o[0]},${o[1]},${o[2]}` === key);
  return next >= 0 ? next : idx;
}

function getContainerDims() {
  return window.appState?.container || null;
}

function serializeCargoLayout() {
  return placedItems.map(it => ({
    id: it.id,
    name: it.box.name,
    color: it.box.color,
    fragile: it.box.fragile,
    priority: it.box.priority,
    w: it.box.w,
    d: it.box.d,
    h: it.box.h,
    base: it.box.base || { w: it.box.w, d: it.box.d, h: it.box.h },
    ori: it.box.ori || 0,
    pos: { x: it.pos.x, y: it.pos.y, z: it.pos.z }
  }));
}

function syncLayoutCounts() {
  if (typeof window.onManualLayoutChanged !== 'function') return;
  const counts = {};
  placedItems.forEach(it => {
    counts[it.id] = (counts[it.id] || 0) + 1;
  });
  window.onManualLayoutChanged(counts);
}

function notifySelectionChanged() {
  if (typeof window.onCargoSelectionChanged !== 'function') return;
  if (!selectedItem) {
    window.onCargoSelectionChanged(null);
    return;
  }
  window.onCargoSelectionChanged({
    uid: selectedItem.uid,
    id: selectedItem.id,
    name: selectedItem.box.name,
    w: selectedItem.box.w,
    d: selectedItem.box.d,
    h: selectedItem.box.h,
    x: selectedItem.pos.x,
    y: selectedItem.pos.y,
    z: selectedItem.pos.z,
    ori: selectedItem.box.ori || 0,
    color: selectedItem.box.color
  });
}

function recordLayoutHistory() {
  if (restoringLayout) return;
  const snap = JSON.stringify(serializeCargoLayout());
  if (layoutHistory[layoutHistoryIndex] === snap) return;
  layoutHistory = layoutHistory.slice(0, layoutHistoryIndex + 1);
  layoutHistory.push(snap);
  layoutHistoryIndex = layoutHistory.length - 1;
}

function restoreCargoLayout(layout, options = {}) {
  restoringLayout = true;
  removeBoxMeshes();
  (layout || []).forEach(entry => {
    const source = window.appState?.boxes?.find(b => b.id === entry.id) || entry;
    const base = entry.base || { w: source.w, d: source.d, h: source.h };
    const meshBox = {
      ...source,
      id: entry.id,
      name: entry.name || source.name,
      color: entry.color || source.color,
      fragile: entry.fragile ?? source.fragile,
      priority: entry.priority ?? source.priority,
      w: entry.w,
      d: entry.d,
      h: entry.h,
      base,
      ori: entry.ori || 0
    };
    const mesh = placeBoxMesh(meshBox, entry.pos.x, entry.pos.y + entry.h / 2, entry.pos.z);
    const item = mesh.userData.item;
    item.pos = { ...entry.pos };
    item.box.base = base;
    item.box.ori = entry.ori || 0;
  });
  restoringLayout = false;
  clearSelection();
  syncLayoutCounts();
  if (!options.skipHistory) recordLayoutHistory();
}

function undoCargoLayout() {
  if (layoutHistoryIndex <= 0) return;
  layoutHistoryIndex -= 1;
  restoreCargoLayout(JSON.parse(layoutHistory[layoutHistoryIndex]), { skipHistory: true });
}

function redoCargoLayout() {
  if (layoutHistoryIndex >= layoutHistory.length - 1) return;
  layoutHistoryIndex += 1;
  restoreCargoLayout(JSON.parse(layoutHistory[layoutHistoryIndex]), { skipHistory: true });
}

function resetCargoLayoutHistory() {
  layoutHistory = [];
  layoutHistoryIndex = -1;
  recordLayoutHistory();
}

function setPointer(clientX, clientY) {
  const r = renderer.domElement.getBoundingClientRect();
  pointer2.x = ((clientX - r.left) / r.width) * 2 - 1;
  pointer2.y = -((clientY - r.top) / r.height) * 2 + 1;
  raycaster.setFromCamera(pointer2, camera);
}

function pickOnFloor(clientX, clientY) {
  setPointer(clientX, clientY);
  const pt = new THREE.Vector3();
  const ok = raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), pt);
  return ok ? { x: pt.x, z: pt.z } : { x: 0, z: 0 };
}

function intersectBox(clientX, clientY) {
  setPointer(clientX, clientY);
  const hits = raycaster.intersectObjects(placedMeshes, false);
  return hits.length ? hits[0].object.userData.item : null;
}

function snapToBounds(pos, dims) {
  const c = getContainerDims();
  if (!c) return pos;
  const minX = -c.w / 2 + dims.w / 2;
  const maxX = c.w / 2 - dims.w / 2;
  const minZ = -c.d / 2 + dims.d / 2;
  const maxZ = c.d / 2 - dims.d / 2;
  return {
    x: Math.max(minX, Math.min(maxX, pos.x)),
    y: pos.y,
    z: Math.max(minZ, Math.min(maxZ, pos.z))
  };
}

function rectsAtTop(y, ignoreUid = null) {
  const ignored = ignoreUid instanceof Set ? ignoreUid : new Set(ignoreUid ? [ignoreUid] : []);
  return placedItems
    .filter(it => !ignored.has(it.uid) && Math.abs(it.pos.y + it.box.h - y) < EPS)
    .map(it => ({
      x1: it.pos.x - it.box.w / 2,
      x2: it.pos.x + it.box.w / 2,
      z1: it.pos.z - it.box.d / 2,
      z2: it.pos.z + it.box.d / 2
    }));
}

function inRect(x, z, r) {
  return x >= r.x1 - EPS && x <= r.x2 + EPS && z >= r.z1 - EPS && z <= r.z2 + EPS;
}

function rectOfItem(it) {
  return {
    x1: it.pos.x - it.box.w / 2,
    x2: it.pos.x + it.box.w / 2,
    z1: it.pos.z - it.box.d / 2,
    z2: it.pos.z + it.box.d / 2
  };
}

function rectsOverlap(a, b) {
  return a.x1 < b.x2 - EPS && a.x2 > b.x1 + EPS && a.z1 < b.z2 - EPS && a.z2 > b.z1 + EPS;
}

function buildStackFrom(baseItem) {
  const group = [baseItem];
  const seen = new Set([baseItem.uid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of placedItems) {
      if (seen.has(candidate.uid)) continue;
      const supportedByGroup = group.some(support => {
        const sitsOnSupport = Math.abs(candidate.pos.y - (support.pos.y + support.box.h)) < 0.5;
        return sitsOnSupport && rectsOverlap(rectOfItem(candidate), rectOfItem(support));
      });
      if (supportedByGroup) {
        seen.add(candidate.uid);
        group.push(candidate);
        changed = true;
      }
    }
  }
  return group.map(it => ({
    it,
    dx: it.pos.x - baseItem.pos.x,
    dy: it.pos.y - baseItem.pos.y,
    dz: it.pos.z - baseItem.pos.z
  }));
}

function stackBounds(group, baseDims) {
  let x1 = -baseDims.w / 2, x2 = baseDims.w / 2;
  let z1 = -baseDims.d / 2, z2 = baseDims.d / 2;
  let top = baseDims.h;
  group.forEach(g => {
    const b = g.it.box;
    x1 = Math.min(x1, g.dx - b.w / 2);
    x2 = Math.max(x2, g.dx + b.w / 2);
    z1 = Math.min(z1, g.dz - b.d / 2);
    z2 = Math.max(z2, g.dz + b.d / 2);
    top = Math.max(top, g.dy + b.h);
  });
  return { w: x2 - x1, d: z2 - z1, h: top };
}

function stackYAt(x, z, dims, ignoreUid = null) {
  let y = 0;
  placedItems.forEach(it => {
    if (it.uid === ignoreUid) return;
    const ovX = Math.abs(x - it.pos.x) < (dims.w + it.box.w) / 2 - EPS;
    const ovZ = Math.abs(z - it.pos.z) < (dims.d + it.box.d) / 2 - EPS;
    if (ovX && ovZ) y = Math.max(y, it.pos.y + it.box.h);
  });
  return y;
}

function validatePlaceAt(dims, pos, ignoreUid = null) {
  const ignored = ignoreUid instanceof Set ? ignoreUid : new Set(ignoreUid ? [ignoreUid] : []);
  const c = getContainerDims();
  if (!c) return { ok: false, reason: 'No hay contenedor definido' };
  if (Math.abs(pos.x) + dims.w / 2 > c.w / 2 + 0.75) return { ok: false, reason: 'Fuera del ancho del contenedor' };
  if (Math.abs(pos.z) + dims.d / 2 > c.d / 2 + 0.75) return { ok: false, reason: 'Fuera de la profundidad del contenedor' };
  if (pos.y < -EPS || pos.y + dims.h > c.h + 0.75) return { ok: false, reason: 'Excede la altura del contenedor' };

  for (const it of placedItems) {
    if (ignored.has(it.uid)) continue;
    const ox = Math.abs(pos.x - it.pos.x) < (dims.w + it.box.w) / 2 - EPS;
    const oy = Math.abs((pos.y + dims.h / 2) - (it.pos.y + it.box.h / 2)) < (dims.h + it.box.h) / 2 - EPS;
    const oz = Math.abs(pos.z - it.pos.z) < (dims.d + it.box.d) / 2 - EPS;
    if (ox && oy && oz) return { ok: false, reason: `Colisiona con ${it.box.name}` };
  }

  if (pos.y <= EPS) return { ok: true, reason: 'Posición válida' };
  const supports = rectsAtTop(pos.y, ignoreUid);
  if (!supports.length) return { ok: false, reason: 'No tiene apoyo debajo' };
  const x1 = pos.x - dims.w / 2, x2 = pos.x + dims.w / 2;
  const z1 = pos.z - dims.d / 2, z2 = pos.z + dims.d / 2;
  const corners = [{ x: x1, z: z1 }, { x: x1, z: z2 }, { x: x2, z: z1 }, { x: x2, z: z2 }];
  const supported = corners.every(corner => supports.some(r => inRect(corner.x, corner.z, r)));
  return supported ? { ok: true, reason: 'Posición válida' } : { ok: false, reason: 'Apoyo insuficiente' };
}

function canPlaceAt(dims, pos, ignoreUid = null) {
  const result = validatePlaceAt(dims, pos, ignoreUid);
  lastPlacementReason = result.reason;
  return result.ok;
}

function boxWeightById(id) {
  const source = window.appState?.boxes?.find(b => b.id === id);
  return +(source?.kg || 0);
}

function placedWeight(ignoreUid = null) {
  return placedItems.reduce((sum, it) => {
    if (it.uid === ignoreUid) return sum;
    return sum + boxWeightById(it.id);
  }, 0);
}

function canPlaceBoxAt(box, dims, pos, ignoreUid = null) {
  if (!canPlaceAt(dims, pos, ignoreUid)) return false;
  const c = getContainerDims();
  const maxKg = +(c?.maxKg || 0);
  if (maxKg && placedWeight(ignoreUid) + +(box.kg || 0) > maxKg + EPS) {
    lastPlacementReason = 'Excede el peso máximo del contenedor';
    return false;
  }
  lastPlacementReason = 'Posición válida';
  return true;
}

function canPlaceStackAt(group, baseDims, basePos) {
  const ignore = new Set(group.map(g => g.it.uid));
  const targets = group.map(g => {
    const dims = g.it === group[0].it ? baseDims : { w: g.it.box.w, d: g.it.box.d, h: g.it.box.h };
    return {
      uid: g.it.uid,
      name: g.it.box.name,
      dims,
      pos: {
        x: basePos.x + g.dx,
        y: basePos.y + g.dy,
        z: basePos.z + g.dz
      }
    };
  });

  const baseCheck = validatePlaceAt(baseDims, basePos, ignore);
  if (!baseCheck.ok) {
    lastPlacementReason = baseCheck.reason;
    return false;
  }

  const c = getContainerDims();
  for (const target of targets) {
    if (Math.abs(target.pos.x) + target.dims.w / 2 > c.w / 2 + 0.75) {
      lastPlacementReason = `${target.name}: fuera del ancho del contenedor`;
      return false;
    }
    if (Math.abs(target.pos.z) + target.dims.d / 2 > c.d / 2 + 0.75) {
      lastPlacementReason = `${target.name}: fuera de la profundidad del contenedor`;
      return false;
    }
    if (target.pos.y < -EPS || target.pos.y + target.dims.h > c.h + 0.75) {
      lastPlacementReason = `${target.name}: excede la altura del contenedor`;
      return false;
    }
  }

  for (const other of placedItems) {
    if (ignore.has(other.uid)) continue;
    for (const target of targets) {
      const ox = Math.abs(target.pos.x - other.pos.x) < (target.dims.w + other.box.w) / 2 - EPS;
      const oy = Math.abs((target.pos.y + target.dims.h / 2) - (other.pos.y + other.box.h / 2)) < (target.dims.h + other.box.h) / 2 - EPS;
      const oz = Math.abs(target.pos.z - other.pos.z) < (target.dims.d + other.box.d) / 2 - EPS;
      if (ox && oy && oz) {
        lastPlacementReason = `La pila colisiona con ${other.box.name}`;
        return false;
      }
    }
  }

  lastPlacementReason = 'Posición válida';
  return true;
}

function proposeSnapWithinSupports(pos, dims, ignoreUid = null) {
  const supports = rectsAtTop(pos.y, ignoreUid);
  if (!supports.length) return pos;
  const candidates = [];
  supports.forEach(r => {
    const tx1 = r.x1 + dims.w / 2, tx2 = r.x2 - dims.w / 2;
    const tz1 = r.z1 + dims.d / 2, tz2 = r.z2 - dims.d / 2;
    candidates.push({ x: tx1, y: pos.y, z: pos.z }, { x: tx2, y: pos.y, z: pos.z });
    candidates.push({ x: pos.x, y: pos.y, z: tz1 }, { x: pos.x, y: pos.y, z: tz2 });
    candidates.push({ x: tx1, y: pos.y, z: tz1 }, { x: tx1, y: pos.y, z: tz2 });
    candidates.push({ x: tx2, y: pos.y, z: tz1 }, { x: tx2, y: pos.y, z: tz2 });
  });
  let best = pos;
  let bestD = Infinity;
  candidates.forEach(c => {
    if (Math.abs(c.x - pos.x) > SNAP && Math.abs(c.z - pos.z) > SNAP) return;
    if (!canPlaceAt(dims, c, ignoreUid)) return;
    const d2 = (c.x - pos.x) ** 2 + (c.z - pos.z) ** 2;
    if (d2 < bestD) { bestD = d2; best = c; }
  });
  return best;
}

function fitInsideSupport(pos, dims, ignoreUid = null) {
  if (pos.y <= EPS) return pos;
  const supports = rectsAtTop(pos.y, ignoreUid);
  if (!supports.length) return pos;
  const current = {
    x1: pos.x - dims.w / 2,
    x2: pos.x + dims.w / 2,
    z1: pos.z - dims.d / 2,
    z2: pos.z + dims.d / 2
  };
  let best = null;
  let bestArea = 0;
  supports.forEach(s => {
    const ix = Math.max(0, Math.min(current.x2, s.x2) - Math.max(current.x1, s.x1));
    const iz = Math.max(0, Math.min(current.z2, s.z2) - Math.max(current.z1, s.z1));
    const area = ix * iz;
    if (area > bestArea) { bestArea = area; best = s; }
  });
  if (!best || best.x2 - best.x1 < dims.w || best.z2 - best.z1 < dims.d) return pos;
  return {
    x: Math.max(best.x1 + dims.w / 2, Math.min(best.x2 - dims.w / 2, pos.x)),
    y: pos.y,
    z: Math.max(best.z1 + dims.d / 2, Math.min(best.z2 - dims.d / 2, pos.z))
  };
}

function positionFromPointer(clientX, clientY, dims, ignoreUid = null) {
  const p2 = pickOnFloor(clientX, clientY);
  const y = stackYAt(p2.x, p2.z, dims, ignoreUid);
  let pos = snapToBounds({ x: p2.x, y, z: p2.z }, dims);
  pos = proposeSnapWithinSupports(pos, dims, ignoreUid);
  pos = fitInsideSupport(pos, dims, ignoreUid);
  return pos;
}

function findBestManualPosition(dims) {
  const c = getContainerDims();
  if (!c) return null;
  let best = null;
  let bestScore = Infinity;
  const step = Math.max(5, Math.min(dims.w, dims.d, 20));
  for (let x = -c.w / 2 + dims.w / 2; x <= c.w / 2 - dims.w / 2; x += step) {
    for (let z = -c.d / 2 + dims.d / 2; z <= c.d / 2 - dims.d / 2; z += step) {
      const y = stackYAt(x, z, dims);
      const pos = { x, y, z };
      if (!canPlaceAt(dims, pos)) continue;
      const score = y * 1000000 + z * 1000 + x;
      if (score < bestScore) { bestScore = score; best = pos; }
    }
  }
  return best;
}

function updateGhost(dims, pos, ok) {
  if (!ghostMesh) {
    ghostMesh = new THREE.Mesh(
      new THREE.BoxGeometry(dims.w, dims.h, dims.d),
      new THREE.MeshBasicMaterial({ color: ok ? 0x43a047 : 0xe53935, transparent: true, opacity: 0.35 })
    );
    scene.add(ghostMesh);
  } else {
    const g = ghostMesh.geometry.parameters;
    if (Math.abs(g.width - dims.w) > EPS || Math.abs(g.height - dims.h) > EPS || Math.abs(g.depth - dims.d) > EPS) {
      ghostMesh.geometry.dispose();
      ghostMesh.geometry = new THREE.BoxGeometry(dims.w, dims.h, dims.d);
    }
    ghostMesh.material.color.setHex(ok ? 0x43a047 : 0xe53935);
  }
  ghostMesh.position.set(pos.x, pos.y + dims.h / 2, pos.z);
}

function clearGhost() {
  if (!ghostMesh) return;
  scene.remove(ghostMesh);
  ghostMesh.geometry.dispose();
  ghostMesh.material.dispose();
  ghostMesh = null;
}

function clearSelection() {
  hideRotUI();
  if (selectedItem?.mesh?.userData?.highlight) {
    const edge = selectedItem.mesh.userData.highlight;
    selectedItem.mesh.remove(edge);
    edge.geometry.dispose();
    edge.material.dispose();
    selectedItem.mesh.userData.highlight = null;
  }
  selectedItem = null;
  notifySelectionChanged();
}

function highlightItem(item) {
  clearSelection();
  selectedItem = item;
  const edge = new THREE.LineSegments(
    new THREE.EdgesGeometry(item.mesh.geometry),
    new THREE.LineBasicMaterial({ color: 0x3fb950 })
  );
  item.mesh.add(edge);
  item.mesh.userData.highlight = edge;
  notifySelectionChanged();
}

function showRotUIAt(clientX, clientY) {
  const ui = document.getElementById('rotUI');
  if (!ui) return;
  ui.style.display = 'flex';
  ui.style.left = `${clientX + 12}px`;
  ui.style.top = `${clientY + 12}px`;
}

function positionRotUI(item) {
  const ui = document.getElementById('rotUI');
  if (!ui || !item) return;
  const v = new THREE.Vector3(item.pos.x, item.pos.y + item.box.h, item.pos.z).project(camera);
  const r = renderer.domElement.getBoundingClientRect();
  ui.style.left = `${(v.x * 0.5 + 0.5) * r.width + r.left + 12}px`;
  ui.style.top = `${(-v.y * 0.5 + 0.5) * r.height + r.top + 12}px`;
}

function hideRotUI() {
  const ui = document.getElementById('rotUI');
  if (ui) ui.style.display = 'none';
}

function applyItemDims(item, dims, ori) {
  item.box.w = dims.w;
  item.box.d = dims.d;
  item.box.h = dims.h;
  item.box.ori = ori;
  item.mesh.geometry.dispose();
  item.mesh.geometry = new THREE.BoxGeometry(dims.w, dims.h, dims.d);
  item.mesh.position.set(item.pos.x, item.pos.y + dims.h / 2, item.pos.z);
  if (item.mesh.userData.edgeMat) {
    for (let i = item.mesh.children.length - 1; i >= 0; i--) {
      const child = item.mesh.children[i];
      if (child.userData?.kind !== 'staticEdges') continue;
      item.mesh.remove(child);
      child.geometry.dispose();
    }
    const eGeom = new THREE.EdgesGeometry(item.mesh.geometry);
    const edgeMesh = new THREE.LineSegments(eGeom, item.mesh.userData.edgeMat);
    edgeMesh.userData.kind = 'staticEdges';
    item.mesh.add(edgeMesh);
  }
}

function rotateSelected(axis) {
  const item = selectedItem;
  if (!item || sceneDrag?.active) return;
  const base = item.box.base || { w: item.box.w, d: item.box.d, h: item.box.h };
  const newOri = rotIdx(item.box.ori || 0, axis);
  const dims = oriDims(base, newOri);
  if (!canPlaceAt(dims, item.pos, item.uid)) {
    if (typeof toast === 'function') toast('Rotación inválida en esa posición.', 'error');
    return;
  }
  applyItemDims(item, dims, newOri);
  highlightItem(item);
  positionRotUI(item);
  recordLayoutHistory();
}

function removePlacedItem(item) {
  if (!item) return;
  scene.remove(item.mesh);
  item.mesh.traverse(c => {
    if (c.geometry) c.geometry.dispose();
    if (c.material) c.material.dispose();
  });
  placedItems = placedItems.filter(it => it !== item);
  placedMeshes = placedMeshes.filter(mesh => mesh !== item.mesh);
  if (selectedItem === item) clearSelection();
  if (typeof window.onManualBoxUnplaced === 'function') window.onManualBoxUnplaced(item.id);
  syncLayoutCounts();
  recordLayoutHistory();
}

function selectedCargoItem() {
  return selectedItem;
}

function moveSelectedCargoItem(pos) {
  const item = selectedItem;
  if (!item) return false;
  const dims = { w: item.box.w, d: item.box.d, h: item.box.h };
  const group = buildStackFrom(item);
  const next = {
    x: Number.isFinite(+pos.x) ? +pos.x : item.pos.x,
    y: Number.isFinite(+pos.y) ? +pos.y : item.pos.y,
    z: Number.isFinite(+pos.z) ? +pos.z : item.pos.z
  };
  if (!canPlaceStackAt(group, dims, next)) {
    if (typeof toast === 'function') toast(lastPlacementReason || 'Ubicación inválida.', 'error');
    return false;
  }
  group.forEach(g => {
    const target = { x: next.x + g.dx, y: next.y + g.dy, z: next.z + g.dz };
    g.it.pos = target;
    g.it.mesh.position.set(target.x, target.y + g.it.box.h / 2, target.z);
  });
  positionRotUI(item);
  notifySelectionChanged();
  recordLayoutHistory();
  return true;
}

function deleteSelectedCargoItem() {
  if (selectedItem) removePlacedItem(selectedItem);
}

function duplicateSelectedCargoItem() {
  const item = selectedItem;
  if (!item) return false;
  const source = window.appState?.boxes?.find(b => b.id === item.id);
  if (!source) {
    if (typeof toast === 'function') toast('No se encontró la caja original.', 'error');
    return false;
  }
  const dims = { w: item.box.w, d: item.box.d, h: item.box.h };
  const pos = findBestManualPosition(dims);
  if (!pos || !placeManualBox(source, dims, pos, item.box.ori || 0)) {
    if (typeof toast === 'function') toast(lastPlacementReason || 'No se pudo duplicar.', 'error');
    return false;
  }
  return true;
}

function placeManualBox(box, dims, pos, ori) {
  const source = window.appState?.boxes?.find(b => b.id === box.id);
  if (source && (source.qty - (source.placed || 0)) <= 0) {
    lastPlacementReason = 'No quedan unidades pendientes de esa caja';
    return false;
  }
  if (!canPlaceBoxAt(box, dims, pos)) return false;
  const meshBox = {
    ...box,
    w: dims.w,
    d: dims.d,
    h: dims.h,
    base: { w: box.w, d: box.d, h: box.h },
    ori
  };
  const mesh = placeBoxMesh(meshBox, pos.x, pos.y + dims.h / 2, pos.z);
  const item = mesh.userData.item;
  item.pos = { ...pos };
  item.box.base = meshBox.base;
  item.box.ori = ori;
  if (typeof window.onManualBoxPlaced === 'function') window.onManualBoxPlaced(box.id);
  syncLayoutCounts();
  recordLayoutHistory();
  return true;
}

function startManualBoxDrag(box) {
  manualDragBox = box;
  manualDragOri = 0;
}

function clearManualBoxDrag() {
  manualDragBox = null;
  manualDragOri = 0;
  clearGhost();
}

// ── POINTER-BASED MANUAL DRAG (para que R/T funcionen al arrastrar) ──
function isOverCanvas(x, y) {
  const r = renderer.domElement.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

function startManualPointerPending(box, x, y) {
  manualPending = { box, x, y };
}

function updateManualGhost(x, y) {
  if (!manualDragBox) return;
  manualLastPointer.x = x;
  manualLastPointer.y = y;
  if (!isOverCanvas(x, y)) { clearGhost(); return; }
  const dims = oriDims(manualDragBox, manualDragOri);
  const pos = positionFromPointer(x, y, dims);
  updateGhost(dims, pos, canPlaceBoxAt(manualDragBox, dims, pos));
}

function finishManualPointerDrag(x, y) {
  const box = manualDragBox;
  if (box && isOverCanvas(x, y)) {
    const dims = oriDims(box, manualDragOri);
    const pos = positionFromPointer(x, y, dims);
    if (!placeManualBox(box, dims, pos, manualDragOri) && typeof toast === 'function') {
      toast(lastPlacementReason || 'Ubicación inválida.', 'error');
    }
  }
  manualPointerActive = false;
  manualPending = null;
  clearManualBoxDrag();
  controls.enabled = true;
}

function autoPlaceSingleBox(box) {
  const dims = oriDims(box, 0);
  const pos = findBestManualPosition(dims);
  if (!pos || !placeManualBox(box, dims, pos, 0)) {
    if (typeof toast === 'function') toast('Ubicación inválida.', 'error');
  }
}

function setupManualPlacement(dom) {
  dom.addEventListener('dragover', e => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    if (!manualDragBox) return;
    const dims = oriDims(manualDragBox, manualDragOri);
    const pos = positionFromPointer(e.clientX, e.clientY, dims);
    updateGhost(dims, pos, canPlaceBoxAt(manualDragBox, dims, pos));
  });

  dom.addEventListener('drop', e => {
    e.preventDefault();
    if (!manualDragBox) return;
    const dims = oriDims(manualDragBox, manualDragOri);
    const pos = positionFromPointer(e.clientX, e.clientY, dims);
    if (!placeManualBox(manualDragBox, dims, pos, manualDragOri) && typeof toast === 'function') {
      toast(lastPlacementReason || 'Ubicación inválida.', 'error');
    }
    clearManualBoxDrag();
  });

  // Pointer-based manual drag from the list (so keydown R/T works while dragging)
  window.addEventListener('pointermove', e => {
    if (manualPending && !manualPointerActive) {
      if (Math.abs(e.clientX - manualPending.x) + Math.abs(e.clientY - manualPending.y) <= DRAG_THRESHOLD) return;
      manualDragBox = manualPending.box;
      manualDragOri = 0;
      manualPointerActive = true;
      manualPending = null;
      controls.enabled = false;
      clearSelection();
    }
    if (!manualPointerActive) return;
    updateManualGhost(e.clientX, e.clientY);
  });

  window.addEventListener('pointerup', e => {
    manualPending = null;
    if (!manualPointerActive) return;
    finishManualPointerDrag(e.clientX, e.clientY);
  });

  dom.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const item = intersectBox(e.clientX, e.clientY);
    if (!item) { clearSelection(); return; }
    highlightItem(item);
    showRotUIAt(e.clientX, e.clientY);
    sceneDrag = {
      item,
      pending: true,
      active: false,
      down: { x: e.clientX, y: e.clientY },
      start: { ...item.pos }
    };
    controls.enabled = false;
    e.preventDefault();
  });

  window.addEventListener('pointermove', e => {
    if (!sceneDrag?.item) return;
    const item = sceneDrag.item;
    if (sceneDrag.pending) {
      const dx = Math.abs(e.clientX - sceneDrag.down.x);
      const dy = Math.abs(e.clientY - sceneDrag.down.y);
      if (dx <= DRAG_THRESHOLD && dy <= DRAG_THRESHOLD) return;
      sceneDrag.pending = false;
      sceneDrag.active = true;
      sceneDrag.group = buildStackFrom(item);
      sceneDrag.bounds = stackBounds(sceneDrag.group, { w: item.box.w, d: item.box.d, h: item.box.h });
      sceneDrag.group.forEach(g => { g.it.mesh.visible = false; });
      hideRotUI();
    }
    if (!sceneDrag.active) return;
    const dims = { w: item.box.w, d: item.box.d, h: item.box.h };
    const ignore = new Set((sceneDrag.group || []).map(g => g.it.uid));
    const pos = positionFromPointer(e.clientX, e.clientY, dims, ignore);
    updateGhost(sceneDrag.bounds || dims, pos, canPlaceStackAt(sceneDrag.group || [{ it: item, dx: 0, dy: 0, dz: 0 }], dims, pos));
  });

  window.addEventListener('pointerup', e => {
    if (!sceneDrag?.item) return;
    const item = sceneDrag.item;
    if (sceneDrag.pending) {
      sceneDrag = null;
      controls.enabled = true;
      showRotUIAt(e.clientX, e.clientY);
      return;
    }
    const dims = { w: item.box.w, d: item.box.d, h: item.box.h };
    const group = sceneDrag.group || [{ it: item, dx: 0, dy: 0, dz: 0 }];
    const ignore = new Set(group.map(g => g.it.uid));
    const pos = positionFromPointer(e.clientX, e.clientY, dims, ignore);
    clearGhost();
    if (canPlaceStackAt(group, dims, pos)) {
      group.forEach(g => {
        const next = { x: pos.x + g.dx, y: pos.y + g.dy, z: pos.z + g.dz };
        g.it.pos = next;
        g.it.mesh.position.set(next.x, next.y + g.it.box.h / 2, next.z);
        g.it.mesh.visible = true;
      });
      notifySelectionChanged();
      recordLayoutHistory();
    } else {
      group.forEach(g => {
        const start = { x: sceneDrag.start.x + g.dx, y: sceneDrag.start.y + g.dy, z: sceneDrag.start.z + g.dz };
        g.it.mesh.position.set(start.x, start.y + g.it.box.h / 2, start.z);
        g.it.mesh.visible = true;
      });
      if (typeof toast === 'function') toast(lastPlacementReason || 'Ubicación inválida.', 'error');
    }
    sceneDrag = null;
    controls.enabled = true;
    positionRotUI(item);
  });

  window.addEventListener('keydown', e => {
    if (manualDragBox) {
      let rotated = false;
      if (e.key === 'r' || e.key === 'R') { manualDragOri = rotIdx(manualDragOri, 'y'); rotated = true; e.preventDefault(); }
      if (e.key === 't' || e.key === 'T') { manualDragOri = rotIdx(manualDragOri, 'z'); rotated = true; e.preventDefault(); }
      if (e.key === 'y' || e.key === 'Y') { manualDragOri = rotIdx(manualDragOri, 'x'); rotated = true; e.preventDefault(); }
      // refrescar el ghost al instante cuando se arrastra con pointer
      if (rotated && manualPointerActive) updateManualGhost(manualLastPointer.x, manualLastPointer.y);
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selectedItem) { e.preventDefault(); deleteSelectedCargoItem(); }
    }
    if (!selectedItem) return;
    if (e.key === 'r' || e.key === 'R') { e.preventDefault(); rotateSelected('y'); }
    if (e.key === 't' || e.key === 'T') { e.preventDefault(); rotateSelected('z'); }
    if (e.key === 'y' || e.key === 'Y') { e.preventDefault(); rotateSelected('x'); }
  });

  const rotUI = document.getElementById('rotUI');
  if (rotUI) {
    rotUI.addEventListener('click', e => {
      const btn = e.target.closest('button[data-axis]');
      if (!btn) return;
      rotateSelected(btn.dataset.axis);
    });
  }
}

// ── CAMERA VIEWS ─────────────────────────────────────────────

function setCameraView(view, container) {
  const cx = 0;
  const cy = container ? container.h / 2 : 120;
  const cz = 0;
  const size = container ? Math.max(container.w, container.d, container.h) : 600;
  const dist = size * 1.6;

  controls.target.set(cx, cy * 0.6, cz);

  switch (view) {
    case 'iso':
      camera.position.set(dist, dist * 0.8, dist);
      break;
    case 'front':
      camera.position.set(cx, cy, cz + dist);
      break;
    case 'side':
      camera.position.set(cx + dist, cy, cz);
      break;
    case 'top':
      camera.position.set(cx, cy + dist * 1.2, cz + 0.01);
      break;
    case 'reset':
    default:
      camera.position.set(dist * 0.9, dist * 0.7, dist * 0.9);
  }

  controls.update();
}

// ── PNG EXPORT ───────────────────────────────────────────────

function captureCargoViews(container) {
  const oldPos = camera.position.clone();
  const oldTarget = controls.target.clone();
  const oldGrid = gridHelper ? gridHelper.visible : null;
  const oldSelected = selectedItem;
  const oldTheme = viewerTheme;
  const views = [
    { key: 'iso', label: 'Vista isométrica' },
    { key: 'front', label: 'Vista frontal' },
    { key: 'side', label: 'Vista lateral' },
    { key: 'top', label: 'Vista superior' }
  ];

  hideRotUI();
  applyViewerTheme('print');
  if (gridHelper) gridHelper.visible = true;

  const shots = views.map(view => {
    setCameraView(view.key, container);
    renderer.render(scene, camera);
    return {
      ...view,
      image: renderer.domElement.toDataURL('image/png')
    };
  });

  camera.position.copy(oldPos);
  controls.target.copy(oldTarget);
  if (gridHelper && oldGrid !== null) gridHelper.visible = oldGrid;
  applyViewerTheme(oldTheme);
  controls.update();
  renderer.render(scene, camera);
  if (oldSelected) positionRotUI(oldSelected);

  return shots;
}

function getPlacedCargoItems() {
  return placedItems.map(it => ({
    id: it.id,
    name: it.box.name,
    w: it.box.w,
    d: it.box.d,
    h: it.box.h,
    x: it.pos.x,
    y: it.pos.y,
    z: it.pos.z,
    color: it.box.color,
    fragile: it.box.fragile,
    priority: it.box.priority
  }));
}

function exportPNG() {
  renderer.render(scene, camera);
  const dataURL = renderer.domElement.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = dataURL;
  a.download = 'cargo-optimizer-3d.png';
  a.click();
}
