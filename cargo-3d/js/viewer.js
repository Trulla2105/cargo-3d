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

// ── PNG EXPORT ───────────────────────────────────────────────

function exportPNG() {
  renderer.render(scene, camera);
  const dataURL = renderer.domElement.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = dataURL;
  a.download = 'cargo-optimizer-3d.png';
  a.click();
}
