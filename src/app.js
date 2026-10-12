import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";

const ASSET_ROOT = "./public/anatomy";
const RELEVANT_SYSTEMS = ["skeletal", "muscular", "joints"];
const TENDON_PATTERN = /tendon|aponeurosis|retinaculum|sheath/i;

const layers = {
  bones: {
    label: "Bones",
    system: "skeletal",
    color: "#d9dde3",
    description: "Skeleton and cartilage",
    active: true,
    matches: (item) => item.system === "skeletal",
  },
  muscles: {
    label: "Muscles",
    system: "muscular",
    color: "#ef6a63",
    description: "Contractile muscle structures",
    active: true,
    matches: (item) => item.system === "muscular" && !item.isTendon,
  },
  tendons: {
    label: "Tendons",
    system: "muscular",
    color: "#f2b84b",
    description: "Tendons, sheaths, aponeuroses",
    active: true,
    matches: (item) => item.system === "muscular" && item.isTendon,
  },
  joints: {
    label: "Joints",
    system: "joints",
    color: "#79a8ff",
    description: "Ligaments, capsules, discs",
    active: false,
    matches: (item) => item.system === "joints",
  },
};

const state = {
  systems: null,
  lexicon: null,
  definitions: null,
  structures: new Map(),
  loadedSystems: new Map(),
  meshesById: new Map(),
  selectedId: null,
  isolatedId: null,
  ghostMode: false,
  bodyBox: new THREE.Box3(),
};

const els = {
  canvas: document.querySelector("#viewerCanvas"),
  layerList: document.querySelector("#layerList"),
  structureList: document.querySelector("#structureList"),
  structureCount: document.querySelector("#structureCount"),
  assetStatus: document.querySelector("#assetStatus"),
  detailsPanel: document.querySelector("#detailsPanel"),
  searchInput: document.querySelector("#searchInput"),
  searchResults: document.querySelector("#searchResults"),
  loadingOverlay: document.querySelector("#loadingOverlay"),
  loadingText: document.querySelector("#loadingText"),
  isolateButton: document.querySelector("#isolateButton"),
  ghostButton: document.querySelector("#ghostButton"),
  showAllButton: document.querySelector("#showAllButton"),
  fitButton: document.querySelector("#fitButton"),
};

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0f15);

const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 500);
camera.position.set(0, 1.4, 5);

const renderer = new THREE.WebGLRenderer({
  canvas: els.canvas,
  antialias: true,
  alpha: false,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.04;

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 0.4;
controls.maxDistance = 18;

const anatomyRoot = new THREE.Group();
scene.add(anatomyRoot);

scene.add(new THREE.HemisphereLight(0xd9f7ff, 0x1a1f28, 2.3));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
keyLight.position.set(2.5, 3.6, 4);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0x86a7ff, 1.4);
fillLight.position.set(-3, 1.2, -2);
scene.add(fillLight);

const floorGrid = new THREE.GridHelper(2.8, 22, 0x30404d, 0x202933);
floorGrid.position.y = -1.05;
floorGrid.material.transparent = true;
floorGrid.material.opacity = 0.36;
scene.add(floorGrid);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const gltfLoader = new GLTFLoader();
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath("https://unpkg.com/three@0.180.0/examples/jsm/libs/draco/");
gltfLoader.setDRACOLoader(dracoLoader);

init().catch((error) => {
  console.error(error);
  setLoading(`Could not start the anatomy viewer: ${error.message}`);
});

async function init() {
  resize();
  window.addEventListener("resize", resize);
  renderer.setAnimationLoop(render);

  setLoading("Loading anatomy metadata...");
  const [systems, lexicon, definitions] = await Promise.all([
    fetchJson(`${ASSET_ROOT}/data/systems.json`),
    fetchJson(`${ASSET_ROOT}/data/lexicon.json`),
    fetchJson(`${ASSET_ROOT}/data/definitions.json`),
  ]);

  state.systems = systems;
  state.lexicon = lexicon;
  state.definitions = definitions;
  buildStructureIndex();
  renderLayers();
  renderStructureList();
  wireUi();

  setLoading("Loading bones and muscles...");
  await Promise.all([loadSystem("skeletal"), loadSystem("muscular")]);
  applyVisibility();
  frameBody();
  hideLoading();
  els.assetStatus.textContent = `${state.structures.size.toLocaleString()} structures indexed`;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return response.json();
}

function buildStructureIndex() {
  for (const system of RELEVANT_SYSTEMS) {
    for (const id of state.systems[system] || []) {
      const cleanName = baseName(id);
      const lex = state.lexicon[id] || state.lexicon[cleanName] || {};
      const item = {
        id,
        system,
        category: categoryFor(system, id),
        displayName: displayName(id),
        baseName: cleanName,
        side: sideFor(id),
        latin: lex.la || "",
        official: lex.official !== false,
        definition: state.definitions[id] || state.definitions[cleanName] || "",
        isTendon: TENDON_PATTERN.test(id),
      };
      state.structures.set(id, item);
    }
  }
}

function categoryFor(system, id) {
  if (system === "skeletal") return "bones";
  if (system === "joints") return "joints";
  return TENDON_PATTERN.test(id) ? "tendons" : "muscles";
}

function displayName(id) {
  const side = sideFor(id);
  const name = baseName(id);
  if (side === "left") return `${name} (left)`;
  if (side === "right") return `${name} (right)`;
  return name;
}

function baseName(id) {
  return id.replace(/\.(l|r)$/i, "");
}

function sideFor(id) {
  if (/\.l$/i.test(id)) return "left";
  if (/\.r$/i.test(id)) return "right";
  return "";
}

function renderLayers() {
  els.layerList.innerHTML = Object.entries(layers)
    .map(([key, layer]) => {
      const count = [...state.structures.values()].filter(layer.matches).length;
      return `
        <button class="layer-toggle ${layer.active ? "is-active" : ""}" type="button" data-layer="${key}">
          <span class="layer-swatch" style="background:${layer.color}"></span>
          <span>
            <span class="layer-title">${layer.label}</span>
            <span class="layer-meta">${layer.description} - ${count.toLocaleString()}</span>
          </span>
          <span class="layer-state">${layer.active ? "On" : "Off"}</span>
        </button>
      `;
    })
    .join("");
}

function renderStructureList() {
  const activeItems = [...state.structures.values()]
    .filter((item) => layers[item.category].active)
    .slice(0, 120);

  els.structureCount.textContent = activeItems.length.toLocaleString();
  els.structureList.innerHTML = activeItems
    .map(
      (item) => `
        <button class="structure-item ${state.selectedId === item.id ? "selected" : ""}" type="button" data-id="${escapeAttr(item.id)}">
          <span>${escapeHtml(item.displayName)}<br><small>${layers[item.category].label}</small></span>
          <span class="badge">${item.side ? item.side[0].toUpperCase() : "M"}</span>
        </button>
      `,
    )
    .join("");
}

async function loadSystem(system) {
  if (state.loadedSystems.has(system)) return state.loadedSystems.get(system);

  const promise = new Promise((resolve, reject) => {
    gltfLoader.load(
      `${ASSET_ROOT}/models/${system}.glb`,
      (gltf) => {
        const group = gltf.scene;
        group.name = system;
        group.userData.system = system;
        anatomyRoot.add(group);
        registerMeshes(group, system);
        state.loadedSystems.set(system, group);
        updateBodyBox();
        resolve(group);
      },
      (event) => {
        if (event.total) {
          const percent = Math.round((event.loaded / event.total) * 100);
          setLoading(`Loading ${system} model... ${percent}%`);
        } else {
          setLoading(`Loading ${system} model...`);
        }
      },
      reject,
    );
  });

  state.loadedSystems.set(system, promise);
  return promise;
}

function registerMeshes(root, system) {
  root.traverse((object) => {
    if (!object.isMesh) return;
    const id = resolveStructureId(object);
    if (!id) return;

    const item = state.structures.get(id);
    object.userData.anatomyId = id;
    object.userData.category = item?.category || categoryFor(system, id);
    object.userData.baseMaterials = cloneMaterialSet(object.material);
    object.material = cloneMaterialSet(object.material);
    object.castShadow = false;
    object.receiveShadow = false;

    forEachMaterial(object.material, (material) => {
      material.side = THREE.DoubleSide;
      material.transparent = true;
      material.userData.baseOpacity = material.opacity ?? 1;
      material.userData.baseColor = material.color?.clone();
      material.userData.baseEmissive = material.emissive?.clone();
    });

    if (!state.meshesById.has(id)) {
      state.meshesById.set(id, []);
    }
    state.meshesById.get(id).push(object);
  });
}

function resolveStructureId(mesh) {
  let node = mesh;
  while (node) {
    const raw = node.userData?.za_name || node.userData?.name || node.name;
    const id = matchStructureId(raw);
    if (id) return id;
    node = node.parent;
  }
  return null;
}

function matchStructureId(raw) {
  if (!raw) return "";
  const candidates = [
    raw,
    raw.replaceAll("_", " "),
    raw.replace(/\.\d+$/, ""),
    raw.replaceAll("_", " ").replace(/\.\d+$/, ""),
  ];
  return candidates.find((candidate) => state.structures.has(candidate)) || "";
}

function cloneMaterialSet(material) {
  if (Array.isArray(material)) return material.map((entry) => entry.clone());
  return material.clone();
}

function forEachMaterial(material, callback) {
  const materials = Array.isArray(material) ? material : [material];
  materials.forEach(callback);
}

function applyVisibility() {
  anatomyRoot.traverse((object) => {
    if (!object.isMesh) return;
    const id = object.userData.anatomyId;
    const item = state.structures.get(id);
    if (!item) return;
    const layer = layers[item.category];
    object.visible = layer.active && (!state.isolatedId || id === state.isolatedId);

    const shouldGhost = state.ghostMode && state.selectedId && id !== state.selectedId;
    setMeshGhosted(object, shouldGhost);
  });
  highlightSelected();
  renderLayers();
  renderStructureList();
}

function setMeshGhosted(mesh, ghosted) {
  forEachMaterial(mesh.material, (material) => {
    const baseOpacity = material.userData.baseOpacity ?? 1;
    material.opacity = ghosted ? Math.min(0.16, baseOpacity) : baseOpacity;
    material.depthWrite = !ghosted;
  });
}

function highlightSelected() {
  anatomyRoot.traverse((object) => {
    if (!object.isMesh) return;
    const highlighted = object.userData.anatomyId === state.selectedId;
    forEachMaterial(object.material, (material) => {
      if (material.color && material.userData.baseColor) {
        material.color.copy(highlighted ? new THREE.Color(0xffd05a) : material.userData.baseColor);
      }
      if (material.emissive) {
        material.emissive.copy(highlighted ? new THREE.Color(0x5a3a00) : material.userData.baseEmissive || new THREE.Color(0x000000));
      }
      material.opacity = highlighted ? 1 : material.opacity;
      material.depthWrite = highlighted ? true : material.depthWrite;
    });
  });
}

function wireUi() {
  els.layerList.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-layer]");
    if (!button) return;
    const layerKey = button.dataset.layer;
    const layer = layers[layerKey];
    layer.active = !layer.active;
    if (layer.active) {
      setLoading(`Loading ${layer.label.toLowerCase()}...`);
      els.loadingOverlay.classList.remove("hidden");
      await loadSystem(layer.system);
      hideLoading();
    }
    if (state.selectedId && !layers[state.structures.get(state.selectedId)?.category]?.active) {
      state.selectedId = null;
      renderEmptyDetails();
    }
    applyVisibility();
  });

  els.structureList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-id]");
    if (button) selectStructure(button.dataset.id, { frame: true });
  });

  els.searchInput.addEventListener("input", () => renderSearchResults(els.searchInput.value));
  els.searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSearch();
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".search-wrap")) closeSearch();
  });

  renderer.domElement.addEventListener("click", onCanvasClick);
  renderer.domElement.addEventListener("dblclick", () => {
    if (state.selectedId) frameStructure(state.selectedId);
  });

  document.querySelector(".view-toolbar").addEventListener("click", (event) => {
    const button = event.target.closest("[data-view]");
    if (button) setPresetView(button.dataset.view);
  });

  els.isolateButton.addEventListener("click", () => {
    state.isolatedId = state.isolatedId ? null : state.selectedId;
    els.isolateButton.textContent = state.isolatedId ? "Release isolate" : "Isolate";
    applyVisibility();
  });

  els.ghostButton.addEventListener("click", () => {
    state.ghostMode = !state.ghostMode;
    els.ghostButton.textContent = state.ghostMode ? "Solid view" : "Ghost others";
    applyVisibility();
  });

  els.showAllButton.addEventListener("click", () => {
    Object.values(layers).forEach((layer) => {
      layer.active = true;
    });
    state.isolatedId = null;
    state.ghostMode = false;
    els.isolateButton.textContent = "Isolate";
    els.ghostButton.textContent = "Ghost others";
    Promise.all([...new Set(Object.values(layers).map((layer) => layer.system))].map(loadSystem)).then(() => {
      applyVisibility();
      frameBody();
    });
  });

  els.fitButton.addEventListener("click", frameBody);
}

function renderSearchResults(query) {
  const normalized = query.trim().toLowerCase();
  if (normalized.length < 2) {
    closeSearch();
    return;
  }

  const matches = [...state.structures.values()]
    .filter((item) => {
      const haystack = `${item.displayName} ${item.latin} ${layers[item.category].label}`.toLowerCase();
      return haystack.includes(normalized);
    })
    .slice(0, 18);

  els.searchResults.innerHTML = matches.length
    ? matches
        .map(
          (item) => `
          <button class="search-result" type="button" data-id="${escapeAttr(item.id)}" role="option">
            ${escapeHtml(item.displayName)}
            <small>${layers[item.category].label}${item.latin ? ` - ${escapeHtml(item.latin)}` : ""}</small>
          </button>
        `,
        )
        .join("")
    : `<div class="search-result" role="option" aria-disabled="true">No structures found</div>`;
  els.searchResults.classList.add("show");

  els.searchResults.querySelectorAll("[data-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      closeSearch();
      els.searchInput.value = "";
      await revealStructure(button.dataset.id);
      selectStructure(button.dataset.id, { frame: true });
    });
  });
}

function closeSearch() {
  els.searchResults.classList.remove("show");
  els.searchResults.innerHTML = "";
}

async function revealStructure(id) {
  const item = state.structures.get(id);
  if (!item) return;
  layers[item.category].active = true;
  setLoading(`Loading ${layers[item.category].label.toLowerCase()}...`);
  els.loadingOverlay.classList.remove("hidden");
  await loadSystem(layers[item.category].system);
  hideLoading();
  state.isolatedId = null;
  applyVisibility();
}

function onCanvasClick(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(anatomyRoot.children, true);
  const hit = hits.find((entry) => entry.object.visible && entry.object.userData.anatomyId);
  if (hit) selectStructure(hit.object.userData.anatomyId);
}

function selectStructure(id, { frame = false } = {}) {
  if (!state.structures.has(id)) return;
  state.selectedId = id;
  state.isolatedId = null;
  els.isolateButton.textContent = "Isolate";
  highlightSelected();
  renderDetails(id);
  renderStructureList();
  if (frame) frameStructure(id);
}

function renderDetails(id) {
  const item = state.structures.get(id);
  const location = estimateLocation(id);
  const definition = item.definition || "No source definition is available for this specific structure yet.";
  els.isolateButton.disabled = false;
  els.ghostButton.disabled = false;
  els.detailsPanel.innerHTML = `
    <p class="eyebrow">${layers[item.category].label}</p>
    <h2>${escapeHtml(item.displayName)}</h2>
    <div class="detail-grid">
      <dl class="detail-row">
        <dt>Location</dt>
        <dd>${escapeHtml(location)}</dd>
      </dl>
      <dl class="detail-row">
        <dt>Function</dt>
        <dd>${escapeHtml(functionFor(item))}</dd>
      </dl>
      <dl class="detail-row">
        <dt>Details</dt>
        <dd>${escapeHtml(detailsFor(item))}</dd>
      </dl>
      ${
        item.latin
          ? `<dl class="detail-row"><dt>Latin</dt><dd>${escapeHtml(item.latin)}</dd></dl>`
          : ""
      }
    </div>
    <p class="definition">${escapeHtml(definition)}</p>
  `;
}

function renderEmptyDetails() {
  els.isolateButton.disabled = true;
  els.ghostButton.disabled = true;
  els.detailsPanel.innerHTML = `
    <p class="eyebrow">Selection</p>
    <h2>Select a structure</h2>
    <p class="muted">Click the 3D model or search by name to highlight a bone, muscle, tendon, or joint structure.</p>
  `;
}

function estimateLocation(id) {
  const item = state.structures.get(id);
  const meshes = state.meshesById.get(id) || [];
  if (!meshes.length || state.bodyBox.isEmpty()) {
    return [item.side, "body"].filter(Boolean).join(" ");
  }
  const box = new THREE.Box3();
  meshes.forEach((mesh) => box.expandByObject(mesh));
  const center = box.getCenter(new THREE.Vector3());
  const minY = state.bodyBox.min.y;
  const maxY = state.bodyBox.max.y;
  const normalizedY = (center.y - minY) / Math.max(0.001, maxY - minY);
  let region = "lower limb";
  if (normalizedY > 0.84) region = "head";
  else if (normalizedY > 0.72) region = "neck and shoulder";
  else if (normalizedY > 0.5) region = "thorax or upper limb";
  else if (normalizedY > 0.34) region = "abdomen and pelvis";

  return [item.side, region].filter(Boolean).join(" ");
}

function functionFor(item) {
  if (item.category === "bones") {
    return "Provides support, protection, and leverage for movement with nearby muscles and joints.";
  }
  if (item.category === "muscles") {
    return "Contracts to produce movement, stabilize posture, or control local body mechanics.";
  }
  if (item.category === "tendons") {
    return "Transmits muscle force to bone or supports smooth movement through connective tissue.";
  }
  if (/ligament/i.test(item.id)) {
    return "Stabilizes a joint by connecting bones and limiting excessive motion.";
  }
  return "Supports articulation, alignment, or load transfer between neighboring skeletal structures.";
}

function detailsFor(item) {
  const side = item.side ? `${capitalize(item.side)} side. ` : "";
  const official = item.official ? "" : "Marked non-official in the source lexicon. ";
  return `${side}${official}Source system: ${layers[item.category].label}.`;
}

function frameStructure(id) {
  const meshes = state.meshesById.get(id) || [];
  if (!meshes.length) return;
  const box = new THREE.Box3();
  meshes.forEach((mesh) => box.expandByObject(mesh));
  frameBox(box, 1.7);
}

function frameBody() {
  updateBodyBox();
  if (!state.bodyBox.isEmpty()) {
    frameBox(state.bodyBox, 1.38);
  }
}

function frameBox(box, distanceMultiplier) {
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const distance = maxDim * distanceMultiplier / Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
  const direction = new THREE.Vector3(0, 0.08, 1).normalize();
  camera.position.copy(center).add(direction.multiplyScalar(distance));
  camera.near = Math.max(0.001, distance / 100);
  camera.far = Math.max(100, distance * 100);
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.update();
}

function setPresetView(view) {
  updateBodyBox();
  if (state.bodyBox.isEmpty()) return;
  const center = state.bodyBox.getCenter(new THREE.Vector3());
  const size = state.bodyBox.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const distance = maxDim * 2.15;
  const directions = {
    front: new THREE.Vector3(0, 0, 1),
    left: new THREE.Vector3(-1, 0, 0),
    back: new THREE.Vector3(0, 0, -1),
    top: new THREE.Vector3(0, 1, 0.001).normalize(),
  };
  camera.position.copy(center).add(directions[view].multiplyScalar(distance));
  controls.target.copy(center);
  controls.update();
}

function updateBodyBox() {
  state.bodyBox.makeEmpty();
  for (const value of state.loadedSystems.values()) {
    if (value instanceof Promise) continue;
    state.bodyBox.expandByObject(value);
  }
}

function resize() {
  const rect = els.canvas.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

function render() {
  controls.update();
  renderer.render(scene, camera);
}

function setLoading(message) {
  els.loadingText.textContent = message;
}

function hideLoading() {
  els.loadingOverlay.classList.add("hidden");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
