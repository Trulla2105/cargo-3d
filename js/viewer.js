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

// ── INIT ─────────────────────────────────────────────────────

function initThree() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x070b10);
  scene.fog = new THREE.FogExp2(0x070b10, 0.00035);

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
  gridHelper = new THREE.GridHelper(4000, 60, 0x1c2330, 0x1c2330);
  scene.add(gridHelper);

  window.addEventListener('resize', onResize);
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
  gridHelper.position.y = 0;

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
    edgeMat: eMat
  };

  scene.add(mesh);
  placedMeshes.push(mesh);
  return mesh;
}

function removeBoxMeshes() {
  cancelDragPlacement();
  placedMeshes.forEach(m => {
    scene.remove(m);
    m.traverse(c => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
    });
  });
  placedMeshes = [];
}

// ── WIREFRAME TOGGLE ─────────────────────────────────────────

function setWireframe(visible) {
  wireframeVisible = visible;
  placedMeshes.forEach(m => {
    if (m.userData.edgeMat) {
      m.userData.edgeMat.opacity = visible ? 0.35 : 0;
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

// ── DRAG & DROP PLACEMENT ────────────────────────────────────
// Drag a box from the list into the container: a ghost follows the
// cursor on the floor (always clamped inside the container and resting
// on whatever is below). Rotate it with R / T (or the wheel) while the
// button is held. Drop to place it only if it fits.

let dragMesh = null, dragBoxData = null, dragContainer = null, dragValid = false;
const _dragRay = new THREE.Raycaster();
const _dragNDC = new THREE.Vector2();
const _floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _hitPoint = new THREE.Vector3();
const _box3a = new THREE.Box3();
const _box3b = new THREE.Box3();

function isDraggingPlacement() { return !!dragMesh; }

function startDragPlacement(boxData, container) {
  cancelDragPlacement();
  if (!container) return false;
  dragBoxData = boxData;
  dragContainer = container;

  const { w, d, h, color } = boxData;
  const geom = new THREE.BoxGeometry(w, h, d);
  const mat = new THREE.MeshPhongMaterial({
    color: new THREE.Color(color || '#3b82f6'),
    transparent: true, opacity: 0.6, shininess: 60,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.castShadow = true;
  const eMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 });
  mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geom), eMat));
  mesh.userData = { mat, edgeMat: eMat };
  mesh.visible = false; // until the cursor is over the floor
  scene.add(mesh);

  dragMesh = mesh;
  controls.enabled = false; // freeze the camera while placing
  return true;
}

function cancelDragPlacement() {
  if (!dragMesh) return;
  scene.remove(dragMesh);
  dragMesh.traverse(c => { if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); });
  dragMesh = null; dragBoxData = null; dragContainer = null; dragValid = false;
  controls.enabled = true;
  if (typeof setStatus === 'function') setStatus('Listo');
}

function updateDragPointer(clientX, clientY) {
  if (!dragMesh) return;
  const rect = renderer.domElement.getBoundingClientRect();
  const inside = clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
  if (!inside) {
    dragMesh.visible = false; dragValid = false;
    if (typeof setStatus === 'function') setStatus('Soltá dentro del visor', '#d29922');
    return;
  }
  _dragNDC.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  _dragNDC.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  _dragRay.setFromCamera(_dragNDC, camera);
  if (!_dragRay.ray.intersectPlane(_floorPlane, _hitPoint)) {
    dragMesh.visible = false; dragValid = false; return;
  }
  dragMesh.visible = true;
  _positionDragAt(_hitPoint.x, _hitPoint.z);
}

// Center the footprint at (x,z), clamp inside the container, rest on support.
function _positionDragAt(x, z) {
  const c = dragContainer;
  dragMesh.position.set(x, dragMesh.position.y, z);
  _box3a.setFromObject(dragMesh);
  const halfW = (_box3a.max.x - _box3a.min.x) / 2;
  const halfD = (_box3a.max.z - _box3a.min.z) / 2;
  dragMesh.position.x = Math.min(c.w / 2 - halfW, Math.max(-c.w / 2 + halfW, x));
  dragMesh.position.z = Math.min(c.d / 2 - halfD, Math.max(-c.d / 2 + halfD, z));

  _box3a.setFromObject(dragMesh);
  let support = 0;
  for (const m of placedMeshes) {
    _box3b.setFromObject(m);
    const ov = _box3a.min.x < _box3b.max.x - 0.5 && _box3a.max.x > _box3b.min.x + 0.5 &&
               _box3a.min.z < _box3b.max.z - 0.5 && _box3a.max.z > _box3b.min.z + 0.5;
    if (ov) support = Math.max(support, _box3b.max.y);
  }
  dragMesh.position.y += support - _box3a.min.y; // rest the bottom on the support
  updateDragFit();
}

// which: 'r' = girar (eje vertical) · 't' = voltear (eje horizontal)
function rotateDragBox(which) {
  if (!dragMesh) return false;
  const v = which === 't' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  dragMesh.rotateOnWorldAxis(v, Math.PI / 2);
  _positionDragAt(dragMesh.position.x, dragMesh.position.z); // re-clamp / re-rest
  return true;
}

function updateDragFit() {
  if (!dragMesh || !dragContainer) return false;
  const c = dragContainer, eps = 0.5;
  _box3a.setFromObject(dragMesh);
  const inb =
    _box3a.min.x >= -c.w / 2 - eps && _box3a.max.x <= c.w / 2 + eps &&
    _box3a.min.y >= -eps           && _box3a.max.y <= c.h + eps &&
    _box3a.min.z >= -c.d / 2 - eps && _box3a.max.z <= c.d / 2 + eps;
  const probe = _box3a.clone().expandByScalar(-eps);
  let coll = false;
  for (const m of placedMeshes) { _box3b.setFromObject(m); if (probe.intersectsBox(_box3b)) { coll = true; break; } }

  dragValid = inb && !coll;
  dragMesh.userData.mat.emissive.setHex(dragValid ? 0x1e7e34 : 0x8a1f1f);
  dragMesh.userData.mat.emissiveIntensity = 0.9;
  dragMesh.userData.mat.color.setHex(dragValid ? 0x3fb950 : 0xff7b72);
  dragMesh.userData.edgeMat.color.setHex(dragValid ? 0xeafff0 : 0xffe1de);
  if (typeof setStatus === 'function') {
    setStatus(dragValid ? '✓ Soltá para colocar' : (!inb ? '✗ Fuera de límites' : '✗ Choca con otra caja'),
              dragValid ? '#3fb950' : '#ff7b72');
  }
  return dragValid;
}

function commitDragPlacement() {
  if (!dragMesh || !dragValid) { cancelDragPlacement(); return null; }
  const mesh = dragMesh, b = dragBoxData;
  const mat = mesh.userData.mat;
  mat.emissive.setHex(0x000000); mat.emissiveIntensity = 1;
  mat.color.set(new THREE.Color(b.color || '#3b82f6'));
  mat.opacity = b.fragile === 'yes' ? 0.72 : 0.88;
  mesh.receiveShadow = true;
  const eMat = mesh.userData.edgeMat;
  eMat.color.setHex(0x000000); eMat.opacity = wireframeVisible ? 0.35 : 0;
  mesh.userData = { type: 'box', id: b.id, name: b.name, edgeMat: eMat, manual: true };
  placedMeshes.push(mesh);

  const rec = {
    id: b.id,
    px: mesh.position.x, py: mesh.position.y, pz: mesh.position.z,
    qx: mesh.quaternion.x, qy: mesh.quaternion.y, qz: mesh.quaternion.z, qw: mesh.quaternion.w,
    w: b.w, d: b.d, h: b.h
  };
  dragMesh = null; dragBoxData = null; dragContainer = null; dragValid = false;
  controls.enabled = true;
  if (typeof setStatus === 'function') setStatus('Listo');
  return rec;
}

// Recreate a manually-placed box from a saved record (position + rotation).
function placeManualBox(boxData, rec) {
  const mesh = placeBoxMesh(Object.assign({}, boxData, { w: rec.w, d: rec.d, h: rec.h }), rec.px, rec.py, rec.pz);
  mesh.quaternion.set(rec.qx, rec.qy, rec.qz, rec.qw);
  mesh.userData.manual = true;
  return mesh;
}

// ── PNG EXPORT ───────────────────────────────────────────────

function exportPNG() {
  renderer.render(scene, camera);
  const dataURL = renderer.domElement.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = dataURL;
  a.download = 'cargo-optimizer-3d.png';
  a.click();
}
