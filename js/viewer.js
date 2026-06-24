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
  initBoxInteraction();
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
  deselectBox();
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

// ── BOX SELECTION & MANUAL ROTATION ──────────────────────────
// Click a placed box to select it, then rotate it "in the air":
//   · drag with the mouse for free rotation
//   · X / Y / Z keys for 90° snaps around each axis
//   · 0 resets the orientation · Esc / click empty space deselects

let selectedMesh = null;
const _raycaster = new THREE.Raycaster();
const _pointerNDC = new THREE.Vector2();
let _isRotatingBox = false;
let _activeRotMesh = null; // mesh currently being rotated by the mouse (placed box or preview ghost)
let _lastPointer = { x: 0, y: 0 };
let _pointerDown = null;

function initBoxInteraction() {
  const dom = renderer.domElement;
  // Capture phase so we can disable OrbitControls before it reacts to the drag.
  dom.addEventListener('pointerdown', onBoxPointerDown, true);
  window.addEventListener('pointermove', onBoxPointerMove);
  window.addEventListener('pointerup', onBoxPointerUp);
}

function _pickInteractive(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  _pointerNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  _pointerNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  _raycaster.setFromCamera(_pointerNDC, camera);
  const targets = previewMesh ? placedMeshes.concat(previewMesh) : placedMeshes;
  const hits = _raycaster.intersectObjects(targets, false);
  return hits.length ? hits[0].object : null;
}

function onBoxPointerDown(e) {
  if (e.button !== 0) return; // left button only
  const hit = _pickInteractive(e);
  if (hit) {
    if (hit !== previewMesh) selectBox(hit); // preview ghost is already "active", don't treat as placed box
    _activeRotMesh = hit;
    _isRotatingBox = true;
    controls.enabled = false; // stop the camera from orbiting while we rotate the box
    _lastPointer.x = e.clientX;
    _lastPointer.y = e.clientY;
    _pointerDown = { x: e.clientX, y: e.clientY, empty: false };
  } else {
    _pointerDown = { x: e.clientX, y: e.clientY, empty: true };
  }
}

function onBoxPointerMove(e) {
  if (!_isRotatingBox || !_activeRotMesh) return;
  const dx = e.clientX - _lastPointer.x;
  const dy = e.clientY - _lastPointer.y;
  _lastPointer.x = e.clientX;
  _lastPointer.y = e.clientY;
  const f = 0.01; // radians per pixel
  // Rotate around world axes so the drag feels intuitive from any camera angle.
  _activeRotMesh.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), dx * f);
  _activeRotMesh.rotateOnWorldAxis(new THREE.Vector3(1, 0, 0), dy * f);
  if (_activeRotMesh === previewMesh) updatePreviewFit();
}

function onBoxPointerUp(e) {
  if (_isRotatingBox) {
    _isRotatingBox = false;
    _activeRotMesh = null;
    controls.enabled = true;
  } else if (_pointerDown && _pointerDown.empty) {
    const moved = Math.abs(e.clientX - _pointerDown.x) + Math.abs(e.clientY - _pointerDown.y);
    if (moved < 4) deselectBox(); // a click (not a camera drag) on empty space deselects
  }
  _pointerDown = null;
}

function selectBox(mesh) {
  if (selectedMesh === mesh) return;
  deselectBox();
  selectedMesh = mesh;

  const mat = mesh.material;
  mesh.userData._origEmissive = mat.emissive.getHex();
  mesh.userData._origEmissiveIntensity = mat.emissiveIntensity;
  mat.emissive.setHex(0xf0883e);
  mat.emissiveIntensity = 0.5;

  if (mesh.userData.edgeMat) {
    mesh.userData._origEdgeOpacity = mesh.userData.edgeMat.opacity;
    mesh.userData._origEdgeColor = mesh.userData.edgeMat.color.getHex();
    mesh.userData.edgeMat.opacity = 0.95;
    mesh.userData.edgeMat.color.setHex(0xf0883e);
  }

  if (typeof toast === 'function') {
    toast(`"${mesh.userData.name}" — arrastrá para rotar · X/Y/Z giran 90° · 0 reset · Esc salir`, 'info');
  }
}

function deselectBox() {
  if (!selectedMesh) return;
  const mesh = selectedMesh;
  const mat = mesh.material;
  if (mesh.userData._origEmissive != null) {
    mat.emissive.setHex(mesh.userData._origEmissive);
    mat.emissiveIntensity = mesh.userData._origEmissiveIntensity ?? 1;
  }
  if (mesh.userData.edgeMat && mesh.userData._origEdgeColor != null) {
    mesh.userData.edgeMat.opacity = mesh.userData._origEdgeOpacity;
    mesh.userData.edgeMat.color.setHex(mesh.userData._origEdgeColor);
  }
  selectedMesh = null;
}

function hasSelectedBox() {
  return !!selectedMesh;
}

function rotateSelectedBox(axis, deg) {
  if (!selectedMesh) return false;
  const rad = (deg * Math.PI) / 180;
  const v = axis === 'x' ? new THREE.Vector3(1, 0, 0)
          : axis === 'y' ? new THREE.Vector3(0, 1, 0)
          :                 new THREE.Vector3(0, 0, 1);
  selectedMesh.rotateOnWorldAxis(v, rad);
  return true;
}

function resetSelectedBoxRotation() {
  if (!selectedMesh) return false;
  selectedMesh.rotation.set(0, 0, 0);
  return true;
}

// ── DRAG & DROP PLACEMENT ────────────────────────────────────
// Drag a box from the list into the container: a ghost follows the
// cursor along the floor, rotate it with the wheel or X/Y/Z while
// holding the button, and drop it to place it where it fits.

let dragMesh = null;
let dragBoxData = null;
let dragContainer = null;
let dragValid = false;
const _floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _dragNDC = new THREE.Vector2();
const _hitPoint = new THREE.Vector3();
const _tmpBox3 = new THREE.Box3();
const _tmpBox3b = new THREE.Box3();

function isDraggingPlacement() {
  return !!dragMesh;
}

function startDragPlacement(boxData, container) {
  cancelDragPlacement();
  if (!container) return false;
  deselectBox();
  dragBoxData = boxData;
  dragContainer = container;

  const { w, d, h, color } = boxData;
  const geom = new THREE.BoxGeometry(w, h, d);
  const mat = new THREE.MeshPhongMaterial({
    color: new THREE.Color(color || '#3b82f6'),
    transparent: true,
    opacity: 0.6,
    shininess: 60,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.castShadow = true;

  const eMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 });
  mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geom), eMat));

  mesh.userData = { type: 'drag', mat, edgeMat: eMat };
  mesh.visible = false; // hidden until the cursor is over the container floor
  scene.add(mesh);

  dragMesh = mesh;
  controls.enabled = false; // freeze the camera while placing
  return true;
}

function cancelDragPlacement() {
  if (!dragMesh) return;
  scene.remove(dragMesh);
  dragMesh.traverse(c => {
    if (c.geometry) c.geometry.dispose();
    if (c.material) c.material.dispose();
  });
  dragMesh = null;
  dragBoxData = null;
  dragContainer = null;
  dragValid = false;
  controls.enabled = true;
  if (typeof setStatus === 'function') setStatus('Listo');
}

// Project the screen cursor onto the container floor and move the ghost there.
function updateDragPointer(clientX, clientY) {
  if (!dragMesh) return;
  const rect = renderer.domElement.getBoundingClientRect();
  const inside = clientX >= rect.left && clientX <= rect.right &&
                 clientY >= rect.top && clientY <= rect.bottom;
  if (!inside) {
    dragMesh.visible = false;
    dragValid = false;
    if (typeof setStatus === 'function') setStatus('Soltá dentro del visor para colocar', '#d29922');
    return;
  }
  _dragNDC.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  _dragNDC.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  _raycaster.setFromCamera(_dragNDC, camera);
  if (!_raycaster.ray.intersectPlane(_floorPlane, _hitPoint)) {
    dragMesh.visible = false;
    dragValid = false;
    return;
  }
  dragMesh.visible = true;
  _positionDragAt(_hitPoint.x, _hitPoint.z);
}

// Center the ghost footprint at (x,z), clamp it inside the container and
// rest it on top of whatever box is underneath (or the floor).
function _positionDragAt(x, z) {
  const c = dragContainer;
  dragMesh.position.x = x;
  dragMesh.position.z = z;

  _tmpBox3.setFromObject(dragMesh);
  const halfW = (_tmpBox3.max.x - _tmpBox3.min.x) / 2;
  const halfD = (_tmpBox3.max.z - _tmpBox3.min.z) / 2;
  dragMesh.position.x = Math.min(c.w / 2 - halfW, Math.max(-c.w / 2 + halfW, x));
  dragMesh.position.z = Math.min(c.d / 2 - halfD, Math.max(-c.d / 2 + halfD, z));

  // Find support height from boxes overlapping the footprint
  _tmpBox3.setFromObject(dragMesh);
  let support = 0;
  for (const m of placedMeshes) {
    _tmpBox3b.setFromObject(m);
    const overlapXZ =
      _tmpBox3.min.x < _tmpBox3b.max.x - 0.5 && _tmpBox3.max.x > _tmpBox3b.min.x + 0.5 &&
      _tmpBox3.min.z < _tmpBox3b.max.z - 0.5 && _tmpBox3.max.z > _tmpBox3b.min.z + 0.5;
    if (overlapXZ) support = Math.max(support, _tmpBox3b.max.y);
  }
  dragMesh.position.y += support - _tmpBox3.min.y; // rest the bottom on the support
  updateDragFit();
}

function rotateDragBox(axis, deg) {
  if (!dragMesh) return false;
  const rad = (deg * Math.PI) / 180;
  const v = axis === 'x' ? new THREE.Vector3(1, 0, 0)
          : axis === 'y' ? new THREE.Vector3(0, 1, 0)
          :                 new THREE.Vector3(0, 0, 1);
  dragMesh.rotateOnWorldAxis(v, rad);
  _positionDragAt(dragMesh.position.x, dragMesh.position.z); // re-rest after rotating
  return true;
}

// Recompute fit (container bounds + collision with placed boxes), recolor the ghost.
function updateDragFit() {
  if (!dragMesh || !dragContainer) return false;
  const c = dragContainer;
  const eps = 0.5;

  _tmpBox3.setFromObject(dragMesh); // world AABB, accounts for any rotation
  const inside =
    _tmpBox3.min.x >= -c.w / 2 - eps && _tmpBox3.max.x <= c.w / 2 + eps &&
    _tmpBox3.min.y >= -eps           && _tmpBox3.max.y <= c.h + eps &&
    _tmpBox3.min.z >= -c.d / 2 - eps && _tmpBox3.max.z <= c.d / 2 + eps;

  const probe = _tmpBox3.clone().expandByScalar(-eps); // ignore flush contact
  let collides = false;
  for (const m of placedMeshes) {
    _tmpBox3b.setFromObject(m);
    if (probe.intersectsBox(_tmpBox3b)) { collides = true; break; }
  }

  dragValid = inside && !collides;
  dragMesh.userData.mat.emissive.setHex(dragValid ? 0x1e7e34 : 0x8a1f1f);
  dragMesh.userData.mat.emissiveIntensity = 0.9;
  dragMesh.userData.mat.color.setHex(dragValid ? 0x3fb950 : 0xff7b72);
  dragMesh.userData.edgeMat.color.setHex(dragValid ? 0xeafff0 : 0xffe1de);

  if (typeof setStatus === 'function') {
    const reason = !inside ? 'se sale del contenedor' : 'choca con otra caja';
    setStatus(dragValid ? '✓ Soltá para colocar' : `✗ No entra — ${reason}`,
              dragValid ? '#3fb950' : '#ff7b72');
  }
  return dragValid;
}

// Finalize: if valid, turn the ghost into a permanent placed box and return
// its placement record. Otherwise cancel and return null.
function commitDragPlacement() {
  if (!dragMesh || !dragValid) { cancelDragPlacement(); return null; }
  const mesh = dragMesh;
  const b = dragBoxData;

  // Restyle the ghost to look like a normal placed box
  const mat = mesh.userData.mat;
  mat.emissive.setHex(0x000000);
  mat.emissiveIntensity = 1;
  mat.color.set(new THREE.Color(b.color || '#3b82f6'));
  mat.opacity = b.fragile === 'yes' ? 0.72 : 0.88;
  mesh.receiveShadow = true;

  const eMat = mesh.userData.edgeMat;
  eMat.color.setHex(0x000000);
  eMat.opacity = wireframeVisible ? 0.35 : 0;

  mesh.userData = { type: 'box', id: b.id, name: b.name, edgeMat: eMat, manual: true };
  placedMeshes.push(mesh);

  const rec = {
    id: b.id,
    px: mesh.position.x, py: mesh.position.y, pz: mesh.position.z,
    qx: mesh.quaternion.x, qy: mesh.quaternion.y, qz: mesh.quaternion.z, qw: mesh.quaternion.w,
    w: b.w, d: b.d, h: b.h
  };

  dragMesh = null;
  dragBoxData = null;
  dragContainer = null;
  dragValid = false;
  controls.enabled = true;
  if (typeof setStatus === 'function') setStatus('Listo');
  return rec;
}

// Recreate a manually-placed box from a saved record (position + rotation).
function placeManualBox(boxData, rec) {
  const meshBox = Object.assign({}, boxData, { w: rec.w, d: rec.d, h: rec.h });
  const mesh = placeBoxMesh(meshBox, rec.px, rec.py, rec.pz);
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
