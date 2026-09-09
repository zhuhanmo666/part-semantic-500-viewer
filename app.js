import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const $ = (id) => document.getElementById(id);
const ui = {
  canvas: $('canvas'), viewport: $('viewport'), loading: $('loading'), loadingDetail: $('loading-detail'),
  modelList: $('model-list'), modelSearch: $('model-search'), resultCount: $('result-count'),
  assetId: $('asset-id'), annotationSource: $('annotation-source'), partCount: $('part-count'),
  mergeStatus: $('merge-status'), partSearch: $('part-search'), partList: $('part-list'),
  visibleParts: $('visible-parts'), partDetail: $('part-detail'), partName: $('part-name'),
  partId: $('part-id'), objectCategory: $('object-category'), nodeName: $('node-name'),
  semanticSource: $('semantic-source'), previous: $('previous'), next: $('next'), download: $('download'),
  fit: $('fit'), showAll: $('show-all'), solo: $('solo'), semanticColors: $('semantic-colors'),
  wireframe: $('wireframe'), autoRotate: $('auto-rotate'), toast: $('toast'),
  statModels: $('stat-models'), statParts: $('stat-parts'), statManual: $('stat-manual'),
};

const state = {
  catalog: [], filtered: [], source: 'all', query: '', current: null, annotation: null,
  selectedPartId: null, root: null, meshes: [], solo: false, loadToken: 0, downloadUrl: null,
};

const renderer = new THREE.WebGLRenderer({ canvas: ui.canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, .001, 1000);
camera.position.set(2.5, -3.2, 2.1);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = .08;
scene.add(new THREE.HemisphereLight(0xffffff, 0x26344a, 2.8));
const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
keyLight.position.set(4, -5, 7);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0x89aaff, 1.35);
fillLight.position.set(-5, 2, 1);
scene.add(fillLight);
const loader = new GLTFLoader();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function resize() {
  const { width, height } = ui.viewport.getBoundingClientRect();
  renderer.setSize(width, height, false);
  camera.aspect = width / Math.max(1, height);
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(ui.viewport);
function animate() {
  requestAnimationFrame(animate);
  controls.autoRotate = ui.autoRotate.checked;
  controls.autoRotateSpeed = 1.3;
  controls.update();
  renderer.render(scene, camera);
}
animate();

function toast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ui.toast.classList.remove('show'), 2200);
}

function colorFor(label) {
  let hash = 0;
  for (const char of String(label)) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return new THREE.Color().setHSL(((hash >>> 0) % 360) / 360, .58, .55);
}

function disposeModel() {
  if (state.downloadUrl) {
    URL.revokeObjectURL(state.downloadUrl);
    state.downloadUrl = null;
  }
  if (!state.root) return;
  scene.remove(state.root);
  state.root.traverse((object) => {
    if (!object.isMesh) return;
    object.geometry?.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach(material => material?.dispose());
  });
  state.root = null;
  state.meshes = [];
}

async function fetchModelBlob(row, token) {
  const urls = row.model_chunks?.length ? row.model_chunks : [row.model_url];
  const pieces = [];
  let loaded = 0;
  for (const url of urls) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`model HTTP ${response.status}`);
    const piece = await response.arrayBuffer();
    if (token !== state.loadToken) return null;
    pieces.push(piece);
    loaded += piece.byteLength;
    const percent = row.model_bytes ? Math.round(loaded / row.model_bytes * 100) : null;
    ui.loadingDetail.textContent = `${percent === null ? "" : `${Math.min(percent, 100)}% · `}${(loaded / 1048576).toFixed(1)} MB`;
  }
  return new Blob(pieces, { type: "model/gltf-binary" });
}

function fitModel() {
  if (!state.root) return;
  const sphere = new THREE.Box3().setFromObject(state.root).getBoundingSphere(new THREE.Sphere());
  if (!Number.isFinite(sphere.radius) || sphere.radius <= 0) return;
  const direction = new THREE.Vector3(1.2, -1.5, .9).normalize();
  camera.near = Math.max(sphere.radius / 1000, .0001);
  camera.far = sphere.radius * 100;
  camera.position.copy(sphere.center).addScaledVector(direction, sphere.radius * 3.15);
  camera.updateProjectionMatrix();
  controls.target.copy(sphere.center);
  controls.update();
}

function materials(mesh) { return Array.isArray(mesh.material) ? mesh.material : [mesh.material]; }
function updateAppearance() {
  if (!state.annotation) return;
  const byId = new Map(state.annotation.parts.map(part => [part.part_id, part]));
  for (const mesh of state.meshes) {
    const id = mesh.userData.partId;
    const part = byId.get(id);
    mesh.visible = !state.solo || id === state.selectedPartId;
    for (const material of materials(mesh)) {
      material.wireframe = ui.wireframe.checked;
      material.transparent = false;
      material.opacity = 1;
      if (material.color) {
        material.color.copy(ui.semanticColors.checked && part ? colorFor(part.part_name) : material.userData.baseColor);
        if (state.selectedPartId && id !== state.selectedPartId) material.color.multiplyScalar(.52);
      }
      if (material.emissive) {
        material.emissive.set(id === state.selectedPartId ? 0xffbd59 : 0x000000);
        material.emissiveIntensity = id === state.selectedPartId ? .65 : 0;
      }
      material.needsUpdate = true;
    }
  }
  ui.solo.textContent = state.solo ? '退出单独显示' : '只看当前part';
}

function nodeIndexFor(object, associations) {
  let current = object;
  while (current) {
    const value = associations.get(current);
    if (value && Number.isInteger(value.nodes)) return value.nodes;
    current = current.parent;
  }
  return null;
}

function renderModels() {
  ui.resultCount.textContent = `${state.filtered.length} / ${state.catalog.length}`;
  ui.modelList.replaceChildren(...state.filtered.map((row) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `model-row${row.asset_id === state.current?.asset_id ? ' active' : ''}`;
    button.innerHTML = `<strong>${row.asset_id}</strong><small><span>${row.part_count} parts</span><span class="${row.annotation_source === 'manual' ? 'manual-badge' : ''}">${row.annotation_source === 'manual' ? '人工补全' : 'VLM'}</span></small>`;
    button.addEventListener('click', () => selectModel(row));
    return button;
  }));
}

function filterModels() {
  const query = state.query.toLowerCase().trim();
  state.filtered = state.catalog.filter((row) => {
    if (state.source !== 'all' && row.annotation_source !== state.source) return false;
    if (!query) return true;
    return [row.asset_id, ...(row.labels || []), ...(row.object_categories || [])]
      .some(value => String(value).toLowerCase().includes(query));
  });
  renderModels();
}

function renderParts() {
  if (!state.annotation) return;
  const query = ui.partSearch.value.toLowerCase().trim();
  const visible = state.annotation.parts.filter(part => !query || [part.part_id, part.part_name, part.object_category, part.node_name]
    .some(value => String(value || '').toLowerCase().includes(query)));
  ui.visibleParts.textContent = `${visible.length} / ${state.annotation.part_count}`;
  ui.partList.replaceChildren(...visible.map((part) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `part-row${part.part_id === state.selectedPartId ? ' active' : ''}`;
    button.style.setProperty('--part-color', `#${colorFor(part.part_name).getHexString()}`);
    button.innerHTML = `<span class="part-dot"></span><code>${part.part_id}</code><strong>${part.part_name}</strong>`;
    button.title = `${part.object_category || '未指定类别'} · ${part.node_name || ''}`;
    button.addEventListener('click', () => selectPart(part.part_id));
    return button;
  }));
}

function renderPartDetail() {
  const part = state.annotation?.parts.find(row => row.part_id === state.selectedPartId);
  ui.partDetail.classList.toggle('empty', !part);
  ui.partName.textContent = part?.part_name || '点击模型部件或右侧列表';
  ui.partId.textContent = part?.part_id || '—';
  ui.objectCategory.textContent = part?.object_category || '—';
  ui.nodeName.textContent = part?.node_name || '—';
  ui.semanticSource.textContent = part ? (part.semantic_source === 'manual' ? '人工' : 'VLM') : '—';
}

function updateUrl() {
  const url = new URL(location.href);
  if (state.current) url.searchParams.set('model', state.current.asset_id);
  if (state.selectedPartId) url.searchParams.set('part', state.selectedPartId);
  else url.searchParams.delete('part');
  history.replaceState(null, '', url);
}

function selectPart(partId) {
  state.selectedPartId = partId;
  renderParts();
  renderPartDetail();
  updateAppearance();
  updateUrl();
  ui.partList.querySelector('.part-row.active')?.scrollIntoView({ block: 'nearest' });
}

async function selectModel(row) {
  const token = ++state.loadToken;
  state.current = row;
  state.annotation = null;
  state.selectedPartId = null;
  state.solo = false;
  renderModels();
  disposeModel();
  ui.assetId.textContent = row.asset_id;
  ui.loading.hidden = false;
  ui.loading.querySelector('strong').textContent = '加载模型…';
  ui.loadingDetail.textContent = '';
  ui.download.removeAttribute("href");
  ui.download.download = `${row.asset_id}.glb`;
  try {
    const annotationResponse = await fetch(row.annotation_url);
    if (!annotationResponse.ok) throw new Error(`annotations HTTP ${annotationResponse.status}`);
    const annotation = await annotationResponse.json();
    if (token !== state.loadToken) return;
    state.annotation = annotation;
    ui.annotationSource.textContent = annotation.annotation_source === 'manual' ? '人工补全' : 'VLM';
    ui.partCount.textContent = annotation.part_count;
    ui.mergeStatus.textContent = annotation.semantic_merge_applied ? '已合并' : (annotation.semantic_merge_result || '未合并');
    ui.partSearch.value = '';
    renderParts();
    renderPartDetail();
    updateUrl();

    const modelBlob = await fetchModelBlob(row, token);
    if (!modelBlob || token !== state.loadToken) return;
    state.downloadUrl = URL.createObjectURL(modelBlob);
    ui.download.href = state.downloadUrl;
    const modelBuffer = await modelBlob.arrayBuffer();
    const gltf = await new Promise((resolve, reject) => loader.parse(modelBuffer, "./", resolve, reject));
    if (token !== state.loadToken) return;
    state.root = gltf.scene;
    const byNode = new Map(annotation.parts.map(part => [part.node_index, part.part_id]));
    state.root.traverse((object) => {
      if (!object.isMesh) return;
      object.material = (Array.isArray(object.material) ? object.material : [object.material]).map((material) => {
        const clone = material.clone();
        clone.userData.baseColor = clone.color?.clone() || new THREE.Color(.7, .7, .7);
        return clone;
      });
      if (object.material.length === 1) object.material = object.material[0];
      object.userData.partId = byNode.get(nodeIndexFor(object, gltf.parser.associations)) || null;
      if (object.userData.partId) state.meshes.push(object);
    });
    scene.add(state.root);
    fitModel();
    updateAppearance();
    const requestedPart = new URL(location.href).searchParams.get('part');
    if (requestedPart && annotation.parts.some(part => part.part_id === requestedPart)) selectPart(requestedPart);
    ui.loading.hidden = true;
    ui.modelList.querySelector('.model-row.active')?.scrollIntoView({ block: 'nearest' });
  } catch (error) {
    if (token !== state.loadToken) return;
    ui.loading.querySelector('strong').textContent = '模型加载失败';
    ui.loadingDetail.textContent = error.message;
    toast(`加载失败：${error.message}`);
  }
}

function navigate(delta) {
  if (!state.filtered.length) return;
  const current = state.filtered.findIndex(row => row.asset_id === state.current?.asset_id);
  selectModel(state.filtered[(Math.max(current, 0) + delta + state.filtered.length) % state.filtered.length]);
}

renderer.domElement.addEventListener('pointerdown', (event) => {
  if (!state.root) return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(state.meshes.filter(mesh => mesh.visible), false)[0];
  if (hit?.object.userData.partId) selectPart(hit.object.userData.partId);
});

ui.modelSearch.addEventListener('input', () => { state.query = ui.modelSearch.value; filterModels(); });
document.querySelectorAll('[data-source]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('[data-source]').forEach(item => item.classList.toggle('active', item === button));
  state.source = button.dataset.source;
  filterModels();
  if (!state.filtered.some(row => row.asset_id === state.current?.asset_id) && state.filtered.length) selectModel(state.filtered[0]);
}));
ui.partSearch.addEventListener('input', renderParts);
ui.previous.addEventListener('click', () => navigate(-1));
ui.next.addEventListener('click', () => navigate(1));
ui.fit.addEventListener('click', fitModel);
ui.showAll.addEventListener('click', () => { state.solo = false; updateAppearance(); });
ui.solo.addEventListener('click', () => {
  if (!state.selectedPartId) return toast('请先选择一个part');
  state.solo = !state.solo;
  updateAppearance();
});
ui.semanticColors.addEventListener('change', updateAppearance);
ui.wireframe.addEventListener('change', updateAppearance);
window.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement) return;
  if (event.key === 'ArrowLeft') navigate(-1);
  if (event.key === 'ArrowRight') navigate(1);
  if (event.key.toLowerCase() === 'f') fitModel();
});

async function init() {
  try {
    const response = await fetch('./catalog.json');
    if (!response.ok) throw new Error(`catalog HTTP ${response.status}`);
    const data = await response.json();
    state.catalog = data.models;
    state.filtered = [...state.catalog];
    ui.statModels.textContent = data.summary.asset_count.toLocaleString();
    ui.statParts.textContent = data.summary.part_count.toLocaleString();
    ui.statManual.textContent = data.summary.manual_completed_asset_count.toLocaleString();
    renderModels();
    const requested = new URL(location.href).searchParams.get('model');
    await selectModel(state.catalog.find(row => row.asset_id === requested) || state.catalog[0]);
  } catch (error) {
    ui.loading.querySelector('strong').textContent = '数据集加载失败';
    ui.loadingDetail.textContent = `${error.message}。请通过HTTP服务器打开本页面。`;
  }
}
init();
