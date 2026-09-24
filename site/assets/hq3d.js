/* THE AGENCY IN 3D.
   The headquarters (a textured low-poly model) stands on a pixel floor under a night sky,
   and the seven pixel kittens (the Director and the six agents) stand on that floor in front
   of it as 2D sprites: always facing the camera, upright, nearest-neighbour sharp, each
   with a flat pixel shadow. They bob, wander short paths on the plaza, and never walk
   through the building. Hover or tap one for its name tag; click to open its file.

   The building is the way in. Pointing at it shows the ENTER marker over its door; a click
   (or a second tap, or Enter with no kitten picked) pushes the camera to the door and opens
   the work floor, ./floor/. A kitten in front of the building always wins the click, so
   opening a file never also walks you inside. With reduced motion there is no push.

   Loaded by the home page after first paint. If anything here throws (no WebGL, no
   module support, no model), the page keeps the pixel roster picture it already shows. */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const hero = document.getElementById("hero");
const canvas = document.getElementById("hq");
const sceneBox = hero.querySelector(".hero-scene");
const stage = hero.querySelector(".stage");
const tag = document.getElementById("nametag");
const tagCode = tag.querySelector(".nt-code");
const tagBeat = tag.querySelector(".nt-beat");
const tagOpen = tag.querySelector(".nt-open");
const enterTag = document.getElementById("entertag");
const FLOOR_URL = "./floor/";
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const fail = (why) => { hero.dataset.scene = "fallback"; console.warn("3D agency unavailable:", why); };

/* ── world scale ─────────────────────────────────────────────────────────
   The model is unit-sized and centred (y from -0.5 to 0.5). Scaled to HQ units tall,
   its footprint is about 0.93 × 0.91 of that. The kittens stand a third of its height. */
const HQ = 6.4;
const FOOT = { x: 0.455 * HQ, z: 0.466 * HQ };           // half-extents of the plaza slab (turned to face +z)
const KEEP_OUT = { x: FOOT.x + 0.55, z: FOOT.z + 0.55 }; // nobody walks inside this
const KITTEN_H = HQ * 0.33;                               // the Director, tallest sprite (211 px)
const PX = KITTEN_H / 211;                                // world units per sprite pixel
const ART_PX = PX * 4;                                    // the sprites' art grid is 4 px
const TILE = 3.6;                                         // one floor tile (4 × 4 slabs) in world units

/* The seven, left to right as the roster picture stands them, with the Director in the
   middle. Home spots form a loose arc in front of the door, a step and a half apart; each
   wanders inside its own small circle, so paths never cross the building. */
const ROSTER = [
  { cat: "popcat",        t: -4.5 },
  { cat: "crying-cat",    t: -3 },
  { cat: "grumpy-cat",    t: -1.5 },
  { cat: "director",      t: 0 },
  { cat: "cashcat",       t: 1.5 },
  { cat: "snipurr",       t: 3 },
  { cat: "coinmarketcat", t: 4.5 },
];
/* They line up across the three-quarter view, in front of the door, with a slight bow. */
{
  const along = [Math.cos(THREE.MathUtils.degToRad(26)), -Math.sin(THREE.MathUtils.degToRad(26))];
  const toward = [along[1] * -1, along[0]];   // towards the camera, flat on the floor
  const centre = [2.05, 5.3];
  for (const k of ROSTER) {
    const bow = 0.5 * (1 - (k.t / 4.8) ** 2);
    k.home = [centre[0] + along[0] * k.t + toward[0] * bow, centre[1] + along[1] * k.t + toward[1] * bow];
    k.along = along; k.toward = toward;
  }
}

for (const k of ROSTER) {
  const card = document.querySelector(`.agent[data-cat="${k.cat}"]`);
  k.codename = card?.dataset.codename || k.cat;
  k.beat = card?.dataset.beat || "";
  k.accent = card ? getComputedStyle(card).getPropertyValue("--accent").trim() || "#14f195" : "#14f195";
}

/* ── renderer, scene, camera ───────────────────────────────────────────── */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
if (!renderer.getContext()) throw new Error("no WebGL context");
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
const INK = new THREE.Color("#0b0716");
renderer.setClearColor(INK, 1);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(INK, 38, 76);

const camera = new THREE.PerspectiveCamera(34, 1, 0.5, 400);
const TARGET = new THREE.Vector3(0, 2.2, 2.2);
const AZ_CENTER = THREE.MathUtils.degToRad(26);   // three-quarter view, from the front right
const AZ_SWING = THREE.MathUtils.degToRad(26);    // the slow orbit swings this far each way
const AZ_LIMIT = THREE.MathUtils.degToRad(52);    // dragging stops here
const POLAR = THREE.MathUtils.degToRad(72);       // 18° above the horizon
let distance = 30;

const controls = new OrbitControls(camera, canvas);
controls.target.copy(TARGET);
controls.enableZoom = false;
controls.enablePan = false;
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.rotateSpeed = 0.55;
controls.minAzimuthAngle = AZ_CENTER - AZ_LIMIT;
controls.maxAzimuthAngle = AZ_CENTER + AZ_LIMIT;
controls.minPolarAngle = THREE.MathUtils.degToRad(60);
controls.maxPolarAngle = THREE.MathUtils.degToRad(79);
canvas.style.touchAction = "pan-y";   // a vertical swipe still scrolls the page on a phone

const placeCamera = (az, polar = POLAR) => {
  const s = new THREE.Spherical(distance, polar, az);
  camera.position.copy(TARGET).add(new THREE.Vector3().setFromSpherical(s));
  camera.lookAt(TARGET);
};
placeCamera(AZ_CENTER);

/* ── textures ──────────────────────────────────────────────────────────── */
const texLoader = new THREE.TextureLoader();
const pixelTexture = (url) => new Promise((resolve, reject) => {
  texLoader.load(url, (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    resolve(t);
  }, undefined, reject);
});
const canvasTexture = (w, h, draw, nearest = true) => {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (nearest) { t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; }
  return t;
};

/* ── the night: a dark dome with a violet haze and pixel stars. The floor is a
   disc that fades into the dark before its edge, so beyond it the stars show. ── */
{
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(300, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { haze: { value: new THREE.Color("#241246") }, ink: { value: INK } },
      vertexShader: "varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader: `uniform vec3 haze; uniform vec3 ink; varying vec3 vDir;
        void main(){
          float y = vDir.y;
          float band = exp(-pow((y + 0.02) / 0.2, 2.0));
          float behind = smoothstep(0.2, -0.9, vDir.z);   // strongest behind the building
          gl_FragColor = vec4(mix(ink, haze, band * (0.35 + 0.65 * behind)), 1.0);
          #include <colorspace_fragment>
        }`,
    }),
  );
  sky.renderOrder = -10;
  scene.add(sky);
}
const starGroups = [];
const glass = [];
let beacon = null;
const sparkleTex = canvasTexture(7, 7, (g) => {
  g.fillStyle = "#fff";
  g.fillRect(3, 0, 1, 7); g.fillRect(0, 3, 7, 1); g.fillRect(2, 2, 3, 3);
});
{
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const sparkle = sparkleTex;
  const dot = canvasTexture(1, 1, (g) => { g.fillStyle = "#fff"; g.fillRect(0, 0, 1, 1); });
  const sets = [
    { n: 260, size: 2, color: "#cfc6ea", map: dot },
    { n: 70, size: 3, color: "#ffffff", map: dot },
    { n: 34, size: 3, color: "#5ef0b4", map: dot },
    { n: 26, size: 3, color: "#b994ff", map: dot },
    { n: 16, size: 11, color: "#ffffff", map: sparkle },
    { n: 10, size: 11, color: "#5ef0b4", map: sparkle },
    { n: 6, size: 11, color: "#ff8ae6", map: sparkle },
  ];
  for (const set of sets) {
    const pos = new Float32Array(set.n * 3);
    for (let i = 0; i < set.n; i++) {
      // Mostly behind the building, where the camera looks; low in the sky, where the view reaches.
      const az = Math.PI + (rand() - 0.5) * 2 * THREE.MathUtils.degToRad(100);
      const el = THREE.MathUtils.degToRad(-20 + Math.pow(rand(), 1.3) * 62);
      const r = 240;
      pos.set([r * Math.cos(el) * Math.sin(az), r * Math.sin(el), r * Math.cos(el) * Math.cos(az)], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ color: set.color, size: set.size, map: set.map, sizeAttenuation: false, fog: false, transparent: true, alphaTest: 0.5, depthWrite: false });
    const pts = new THREE.Points(g, m);
    pts.renderOrder = -9;
    scene.add(pts);
    starGroups.push({ m, phase: rand() * 10, sparkle: set.map === sparkle });
  }
}

/* ── lights: soft moonlight, a violet and a mint glow at the door ───────── */
scene.add(new THREE.HemisphereLight("#8b78ff", "#140c28", 1.25));
const moon = new THREE.DirectionalLight("#d9ccff", 1.5);
moon.position.set(-8, 14, 10);
scene.add(moon);
const violetGlow = new THREE.PointLight("#9945ff", 42, 16, 1.6);
violetGlow.position.set(-4.2, 3.2, 4.4);
scene.add(violetGlow);
const mintGlow = new THREE.PointLight("#14f195", 34, 14, 1.6);
mintGlow.position.set(3.8, 2.2, 5.2);
scene.add(mintGlow);
const doorGlow = new THREE.PointLight("#5ef0b4", 16, 8, 1.8);
doorGlow.position.set(0, 1.2, FOOT.z + 1.2);
scene.add(doorGlow);

/* ── the floor: the pixel tile, repeated, nearest-neighbour up close ───── */
const floorReady = pixelTexture("assets/floor-tile-256.png").then((t) => {
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  const radius = 84;
  t.repeat.set((radius * 2) / TILE, (radius * 2) / TILE);
  t.minFilter = THREE.LinearMipmapLinearFilter;   // far away: smooth, no shimmer
  t.generateMipmaps = true;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  // The disc fades out well before its rim, so the floor melts into the night sky.
  const fade = canvasTexture(256, 256, (g, w, h) => {
    const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grad.addColorStop(0, "#fff");
    grad.addColorStop(0.42, "#fff");
    grad.addColorStop(0.8, "#000");
    grad.addColorStop(1, "#000");
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  }, false);
  fade.colorSpace = THREE.NoColorSpace;
  const floor = new THREE.Mesh(new THREE.CircleGeometry(radius, 72),
    new THREE.MeshLambertMaterial({ map: t, color: "#6f6690", alphaMap: fade, transparent: true }));
  floor.rotation.x = -Math.PI / 2;
  floor.renderOrder = -5;
  scene.add(floor);
});

/* A soft contact shadow that sets the building down on the floor. */
{
  const t = canvasTexture(128, 128, (g, w, h) => {
    const grad = g.createRadialGradient(w / 2, h / 2, 8, w / 2, h / 2, w / 2);
    grad.addColorStop(0, "rgba(0,0,0,0.75)");
    grad.addColorStop(0.55, "rgba(0,0,0,0.45)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  }, false);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(FOOT.x * 3, FOOT.z * 3),
    new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.01;
  scene.add(m);
}

/* ── the kittens ───────────────────────────────────────────────────────── */
const shadowTex = canvasTexture(20, 6, (g) => {
  g.fillStyle = "rgba(0,0,0,1)";
  g.fillRect(4, 0, 12, 6);
  g.fillRect(2, 1, 16, 4);
  g.fillRect(0, 2, 20, 2);
});
const kittens = [];
const kittenReady = Promise.all(ROSTER.map(async (k, i) => {
  const tex = await pixelTexture(`assets/sprites/${k.cat}.png`);
  const img = tex.image;
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  // Keep the alpha so a click lands on the kitten, not on the empty corners of its quad.
  const probe = document.createElement("canvas");
  probe.width = w; probe.height = h;
  const pg = probe.getContext("2d", { willReadFrequently: true });
  pg.drawImage(img, 0, 0);
  const alpha = pg.getImageData(0, 0, w, h).data;

  const group = new THREE.Group();
  const geo = new THREE.PlaneGeometry(w * PX, h * PX);
  geo.translate(0, (h * PX) / 2, 0);
  const sprite = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, toneMapped: false, fog: false }));
  sprite.position.y = 0.006;
  sprite.userData.kitten = i;
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(w * PX * 0.78, w * PX * 0.26),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(0, 0.02, 0.05);
  group.add(shadow, sprite);
  group.position.set(k.home[0], 0, k.home[1]);
  scene.add(group);
  kittens[i] = {
    ...k, group, sprite, shadow, w, h, alpha,
    x: k.home[0], z: k.home[1], tx: k.home[0], tz: k.home[1],
    mode: "idle", wait: 0.8 + i * 0.7, phase: i * 0.37,
  };
}));

const inKeepOut = (x, z) => Math.abs(x) < KEEP_OUT.x && Math.abs(z) < KEEP_OUT.z;
function pickTarget(k) {
  // A short stroll: a little sideways, a little towards or away from the camera.
  for (let tries = 0; tries < 12; tries++) {
    const side = (Math.random() * 2 - 1) * 0.3, depth = (Math.random() * 2 - 1) * 0.75;
    const x = k.home[0] + k.along[0] * side + k.toward[0] * depth;
    const z = k.home[1] + k.along[1] * side + k.toward[1] * depth;
    if (inKeepOut(x, z)) continue;
    if (Math.hypot(x - k.x, z - k.z) < 0.25) continue;
    if (kittens.some((o) => o && o !== k && Math.hypot(o.x - x, o.z - z) < 1.2)) continue;
    k.tx = x; k.tz = z;
    return true;
  }
  return false;
}

/* ── the building ──────────────────────────────────────────────────────── */
const hqMeshes = [];
const door = new THREE.Vector3(0, 0, FOOT.z);
const hqReady = new Promise((resolve, reject) => {
  new GLTFLoader().load("assets/agency-hq.glb", (gltf) => {
    const model = gltf.scene;
    model.scale.setScalar(HQ);
    model.position.y = HQ * 0.5 + 0.004;
    model.rotation.y = -Math.PI / 2;   // the door faces the plaza (+z)
    model.traverse((o) => {
      if (!o.isMesh) return;
      const m = o.material;
      if (m.map) { m.map.anisotropy = renderer.capabilities.getMaxAnisotropy(); }
      if (m.emissiveMap) { m.emissive = new THREE.Color("#ffffff"); m.emissiveIntensity = 1.35; glass.push(m); }
    });
    scene.add(model);
    // The building answers the pointer: every mesh of it is a way in. Its door is on the
    // face towards the plaza (+z), at the foot of the model, in the middle.
    model.updateMatrixWorld(true);
    model.traverse((o) => { if (o.isMesh) hqMeshes.push(o); });
    const box = new THREE.Box3().setFromObject(model);
    door.set((box.min.x + box.max.x) / 2, 0, box.max.z);
    // A mint beacon blinks on the tip of the antenna (the model's highest point).
    model.updateMatrixWorld(true);
    const tip = new THREE.Vector3(0, -Infinity, 0), v = new THREE.Vector3();
    model.traverse((o) => {
      if (!o.isMesh) return;
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        if (v.y > tip.y) tip.copy(v);
      }
    });
    const bg = new THREE.BufferGeometry();
    bg.setAttribute("position", new THREE.Float32BufferAttribute([tip.x, tip.y + 0.12, tip.z], 3));
    beacon = new THREE.Points(bg, new THREE.PointsMaterial({ color: "#5ef0b4", size: 13, map: sparkleTex, sizeAttenuation: false, transparent: true, alphaTest: 0.5, depthWrite: false, fog: false }));
    scene.add(beacon);
    resolve(model);
  }, undefined, reject);
});

/* ── framing: fit the building and the kittens into the stage box ─────── */
const subject = [];
{
  const ext = [[-FOOT.x, 0, -FOOT.z], [FOOT.x, 0, -FOOT.z], [-FOOT.x, 0, FOOT.z], [FOOT.x, 0, FOOT.z],
    [-FOOT.x, HQ * 0.82, -FOOT.z], [FOOT.x, HQ * 0.82, -FOOT.z], [-FOOT.x, HQ * 0.82, FOOT.z], [FOOT.x, HQ * 0.82, FOOT.z], [0, HQ, 0]];
  for (const p of ext) subject.push(new THREE.Vector3(...p));
  for (const k of ROSTER) {
    for (const [side, depth] of [[-1, 0], [1, 0], [0, 1], [0, -1]]) {
      const a = side * 1.0, d = depth * 0.75;   // half a sprite's width plus the stroll
      const x = k.home[0] + k.along[0] * a + k.toward[0] * d, z = k.home[1] + k.along[1] * a + k.toward[1] * d;
      subject.push(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, KITTEN_H + 0.1, z));
    }
  }
}
const ndc = new THREE.Vector3();
function frame() {
  const cw = sceneBox.clientWidth, ch = sceneBox.clientHeight;
  if (!cw || !ch) return;
  renderer.setSize(cw, ch, false);
  camera.aspect = cw / ch;
  camera.clearViewOffset();
  camera.updateProjectionMatrix();
  // The stage box is where the words are not. On a wide screen it runs on to the right edge.
  const box = stage.getBoundingClientRect(), outer = sceneBox.getBoundingClientRect();
  const left = box.left - outer.left, top = box.top - outer.top;
  const right = Math.max(box.right - outer.left, cw - Math.min(40, cw * 0.03));
  const sw = Math.max(right - left, 200), sh = Math.max(box.height, 200);
  const sx = left + sw / 2, sy = top + sh / 2;
  const az = AZ_CENTER;
  // Fit over the whole slow swing, so no kitten walks off the edge at either end of it.
  const measure = (d) => {
    distance = d;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const a of [az - AZ_SWING, az - AZ_SWING * 0.5, az, az + AZ_SWING * 0.5, az + AZ_SWING]) {
      placeCamera(a);
      camera.updateMatrixWorld();
      for (const p of subject) {
        ndc.copy(p).project(camera);
        x0 = Math.min(x0, ndc.x); x1 = Math.max(x1, ndc.x); y0 = Math.min(y0, ndc.y); y1 = Math.max(y1, ndc.y);
      }
    }
    return { w: ((x1 - x0) / 2) * cw, h: ((y1 - y0) / 2) * ch, cx: ((x0 + x1) / 2 + 1) / 2 * cw, cy: (1 - (y0 + y1) / 2) / 2 * ch };
  };
  let lo = 8, hi = 200, m;
  for (let i = 0; i < 26; i++) {
    const mid = (lo + hi) / 2;
    m = measure(mid);
    if (m.w > sw * 0.98 || m.h > sh * 0.98) lo = mid; else hi = mid;
  }
  m = measure(hi);
  camera.setViewOffset(cw, ch, m.cx - sx, m.cy - sy, cw, ch);
  camera.updateProjectionMatrix();
  controls.minDistance = controls.maxDistance = distance;
  placeCamera(currentAz ?? AZ_CENTER, currentPolar ?? POLAR);
  controls.update();
  dirty = true;
}
let currentAz = null, currentPolar = null;
/* With reduced motion nothing moves on its own, so a frame is drawn only when something
   changed: a drag, a resize, or the preference itself. */
let dirty = true;
controls.addEventListener("change", () => { dirty = true; });
reduceMotion.addEventListener?.("change", () => { dirty = true; });

/* ── interaction: hover, tap, click, keys ─────────────────────────────── */
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let hovered = -1, pinned = -1, cycling = -1, pinnedByKey = false;
let lastUserAt = -1e9;

function aim(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  pointer.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
}
function hitTest(clientX, clientY) {
  aim(clientX, clientY);
  const hits = raycaster.intersectObjects(kittens.filter(Boolean).map((k) => k.sprite), false);
  for (const h of hits) {
    const k = kittens[h.object.userData.kitten];
    const u = h.uv.x, v = h.uv.y;
    const px = Math.min(k.w - 1, Math.floor(u * k.w)), py = Math.min(k.h - 1, Math.floor((1 - v) * k.h));
    // Accept a hit on a visible pixel, or near one (a forgiving margin for fingers).
    const pad = 3;
    for (let dy = -pad; dy <= pad; dy += pad) for (let dx = -pad; dx <= pad; dx += pad) {
      const qx = px + dx, qy = py + dy;
      if (qx >= 0 && qy >= 0 && qx < k.w && qy < k.h && k.alpha[(qy * k.w + qx) * 4 + 3] > 100) return h.object.userData.kitten;
    }
  }
  return -1;
}
/* The building, asked only after the kittens: a kitten standing in front of it wins. */
function hitBuilding(clientX, clientY) {
  if (!hqMeshes.length) return false;
  aim(clientX, clientY);
  return raycaster.intersectObjects(hqMeshes, false).length > 0;
}

function showTag(i, withButton) {
  if (i < 0 || !kittens[i]) { tag.hidden = true; tag.dataset.cat = ""; return; }
  const k = kittens[i];
  tagCode.textContent = k.codename;
  tagBeat.textContent = k.beat;
  tag.style.setProperty("--accent", k.accent);
  tag.classList.toggle("hover", !withButton);
  tag.dataset.cat = k.cat;
  tag.hidden = false;
  placeTag();
}
const head = new THREE.Vector3();
function placeTag() {
  const i = pinned >= 0 ? pinned : hovered >= 0 ? hovered : cycling;
  if (i < 0 || tag.hidden || !kittens[i]) return;
  const k = kittens[i];
  head.set(k.group.position.x, k.sprite.position.y + k.h * PX + 0.22, k.group.position.z).project(camera);
  const cw = sceneBox.clientWidth;
  const x = (head.x + 1) / 2 * cw, y = (1 - head.y) / 2 * sceneBox.clientHeight;
  // Keep the whole tag on screen; its pointer still sits over the kitten.
  const w = tag.offsetWidth, left = Math.max(8, Math.min(cw - w - 8, x - w / 2));
  tag.style.setProperty("--arrow", `${Math.round(Math.max(12, Math.min(w - 12, x - left)))}px`);
  tag.style.transform = `translate(${Math.round(left)}px, ${Math.round(y)}px) translate(0, -100%)`;
}
const openFile = (i) => {
  if (i < 0 || !kittens[i]) return;
  document.dispatchEvent(new CustomEvent("cia:dossier", { detail: { cat: kittens[i].cat } }));
};

/* ── the way in ───────────────────────────────────────────────────────── */
let overHQ = false, pinnedHQ = false, entering = null;
const doorAt = new THREE.Vector3();
function showEnter(show, withButton = false) {
  if (!enterTag) return;
  enterTag.hidden = !show;
  enterTag.classList.toggle("pinned", show && withButton);
  if (show) placeEnter();
}
/* The marker floats on the facade over the door, just above the kittens' heads, so it never
   covers the kitten standing in front of the door. */
function placeEnter() {
  if (!enterTag || enterTag.hidden) return;
  doorAt.copy(door).setY(KITTEN_H * 1.12).project(camera);
  const cw = sceneBox.clientWidth, ch = sceneBox.clientHeight;
  const x = (doorAt.x + 1) / 2 * cw, y = (1 - doorAt.y) / 2 * ch;
  const w = enterTag.offsetWidth, h = enterTag.offsetHeight;
  const pin = enterTag.classList.contains("pinned") ? enterTag.querySelector(".et-go").offsetHeight + 6 : 0;
  const left = Math.max(8, Math.min(cw - w - 8, x - w / 2));
  enterTag.style.transform = `translate(${Math.round(left)}px, ${Math.round(y - h + pin)}px)`;
}
function setOverHQ(on) {
  if (on === overHQ) return;
  overHQ = on;
  if (pinnedHQ) return;
  if (on) { cycling = -1; if (pinned < 0) showTag(-1); }
  showEnter(on, false);
}
function enterAgency() {
  if (entering) return;
  pinned = -1; hovered = -1; cycling = -1; pinnedHQ = false;
  showTag(-1);
  showEnter(false);
  if (reduceMotion.matches) { location.assign(FLOOR_URL); return; }
  // Push in: from where the camera is to a spot just outside the door, turning to face it.
  const from = camera.position.clone();
  const lookFrom = controls.target.clone();
  const toDoor = door.clone().add(new THREE.Vector3(0, HQ * 0.12, 0));
  const to = toDoor.clone().add(from.clone().sub(toDoor).normalize().multiplyScalar(HQ * 0.42));
  entering = { t0: performance.now(), from, to, lookFrom, toDoor, gone: false };
  hero.classList.add("entering");
  controls.enabled = false;
}
const look = new THREE.Vector3();
function pushIn() {
  const p = Math.min(1, (performance.now() - entering.t0) / 900);
  const e = p * p * p;   // slow at first, then through the door
  camera.position.lerpVectors(entering.from, entering.to, e);
  look.lerpVectors(entering.lookFrom, entering.toDoor, Math.min(1, p * 1.6));
  camera.lookAt(look);
  renderer.render(scene, camera);
  if (p >= 1 && !entering.gone) { entering.gone = true; location.assign(FLOOR_URL); }
}
// Back from the floor (the page restored from the back/forward cache): the scene as it was.
addEventListener("pageshow", (e) => {
  if (!e.persisted || !entering) return;
  entering = null;
  hero.classList.remove("entering");
  controls.enabled = true;
  placeCamera(currentAz ?? AZ_CENTER, currentPolar ?? POLAR);
  controls.update();
  dirty = true;
});

let down = null;
canvas.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now(), type: e.pointerType }; lastUserAt = performance.now(); hero.classList.add("touched"); });
canvas.addEventListener("pointermove", (e) => {
  if (e.pointerType !== "mouse" || entering) return;
  const i = down ? -1 : hitTest(e.clientX, e.clientY);
  if (i !== hovered) {
    hovered = i;
    cycling = -1;
    if (pinned < 0) showTag(hovered, false);
  }
  const onHQ = !down && i < 0 && hitBuilding(e.clientX, e.clientY);
  setOverHQ(onHQ);
  canvas.classList.toggle("point", i >= 0 || onHQ);
  if (i >= 0 || onHQ) lastUserAt = performance.now();
});
canvas.addEventListener("pointerleave", () => { hovered = -1; canvas.classList.remove("point"); setOverHQ(false); if (pinned < 0) showTag(-1); });
canvas.addEventListener("pointerup", (e) => {
  if (!down || entering) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  const type = down.type;
  down = null;
  lastUserAt = performance.now();
  if (moved > 8) return;
  const i = hitTest(e.clientX, e.clientY);
  const onHQ = i < 0 && hitBuilding(e.clientX, e.clientY);
  if (type === "mouse") {
    if (i >= 0) openFile(i);
    else if (onHQ) enterAgency();
    else { pinned = -1; showTag(-1); }
  } else if (i >= 0) {
    // Touch and pen: the first tap shows the tag with its button, a second tap opens the file.
    if (pinned === i) openFile(i);
    else { pinned = i; pinnedByKey = false; cycling = -1; pinnedHQ = false; showEnter(false); showTag(i, true); }
  } else if (onHQ) {
    // The building works the same way: the first tap shows the way in, the second goes in.
    if (pinnedHQ) enterAgency();
    else { pinned = -1; cycling = -1; showTag(-1); pinnedHQ = true; showEnter(true, true); }
  } else {
    pinned = -1; pinnedHQ = false; showTag(-1); showEnter(false);
  }
});
canvas.addEventListener("pointercancel", () => { down = null; });
tagOpen.addEventListener("click", () => openFile(pinned >= 0 ? pinned : hovered >= 0 ? hovered : cycling));
canvas.addEventListener("keydown", (e) => {
  const n = kittens.length;
  if (entering) return;
  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
    e.preventDefault();
    const cur = pinned >= 0 ? pinned : -1;
    pinned = e.key === "ArrowRight" ? (cur + 1) % n : (cur - 1 + n) % n;
    pinnedByKey = true;
    cycling = -1;
    pinnedHQ = false; showEnter(false);
    showTag(pinned, true);
    lastUserAt = performance.now();
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (pinned >= 0) openFile(pinned);
    else enterAgency();
  } else if (e.key === "Escape") {
    pinned = -1; pinnedHQ = false; showTag(-1); showEnter(false);
  }
});
// A tag picked with the keyboard goes when focus leaves the scene (unless it moves onto the tag).
canvas.addEventListener("blur", (e) => { if (pinned >= 0 && pinnedByKey && !tag.contains(e.relatedTarget)) { pinned = -1; showTag(-1); } });
controls.addEventListener("start", () => { lastUserAt = performance.now(); if (pinned >= 0 && down?.type === "mouse") { pinned = -1; showTag(-1); } });

/* ── the loop: runs only while the hero is on screen and the tab is visible ── */
const clock = new THREE.Clock(false);
let running = false, onScreen = true, t = 0;
let orbitDir = 1;
let cycleClock = 0, cycleIndex = 0;

const dossier = document.getElementById("dossier");
function tick() {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (dossier && dossier.open) return;   // an agent's file covers the scene: nothing to draw
  if (entering) { pushIn(); return; }    // going in: the camera belongs to the push
  const still = reduceMotion.matches;
  t += dt;
  const now = performance.now();
  const idle = now - lastUserAt > 3500;

  // The slow orbit: swings between two limits, easing at each end.
  if (!still && idle && !down) {
    const az = controls.getAzimuthalAngle();
    const off = (az - AZ_CENTER) / AZ_SWING;
    if (off > 0.98) orbitDir = -1; else if (off < -0.98) orbitDir = 1;
    const ease = 0.18 + 0.82 * Math.max(0, 1 - off * off);
    const step = orbitDir * ease * 0.075 * dt;
    const s = new THREE.Spherical().setFromVector3(camera.position.clone().sub(TARGET));
    s.theta = az + step;
    s.phi += (POLAR - s.phi) * Math.min(1, dt * 0.6);
    camera.position.copy(TARGET).add(new THREE.Vector3().setFromSpherical(s));
  }
  controls.update();
  const cs = new THREE.Spherical().setFromVector3(camera.position.clone().sub(TARGET));
  currentAz = cs.theta; currentPolar = cs.phi;

  // Kittens: face the camera (on Y only), wander, and hop two pixel steps.
  const yaw = Math.atan2(camera.position.x - TARGET.x, camera.position.z - TARGET.z);
  for (const k of kittens) {
    if (!k) continue;
    if (!still) {
      if (k.mode === "idle") {
        k.wait -= dt;
        if (k.wait <= 0 && pickTarget(k)) k.mode = "walk";
        else if (k.wait <= 0) k.wait = 0.6;
      } else {
        const dx = k.tx - k.x, dz = k.tz - k.z, d = Math.hypot(dx, dz);
        const v = 0.42 * dt;
        if (d <= v) { k.x = k.tx; k.z = k.tz; k.mode = "idle"; k.wait = 1.6 + Math.random() * 3.2; }
        else {
          const nx = k.x + (dx / d) * v, nz = k.z + (dz / d) * v;
          if (inKeepOut(nx, nz)) { k.mode = "idle"; k.wait = 0.5; }
          else { k.x = nx; k.z = nz; }
        }
      }
    }
    const walking = !still && k.mode === "walk";
    const beat = walking ? Math.floor(t * 5.2 + k.phase * 4) % 2 : still ? 0 : Math.floor(t * 1.7 + k.phase * 4) % 2;
    const lift = walking ? beat * ART_PX * 2 : beat * ART_PX;
    k.group.position.set(k.x, 0, k.z);
    k.group.rotation.y = yaw;
    k.sprite.position.y = 0.006 + lift;
    k.shadow.scale.setScalar(lift > 0 ? 0.88 : 1);
  }

  // Stars twinkle in two steps.
  for (const s of starGroups) {
    const on = still || Math.floor(t * (s.sparkle ? 1.3 : 0.8) + s.phase) % 3 !== 0;
    s.m.opacity = on ? 1 : 0.5;
    if (s.sparkle) s.m.size = on ? 11 : 7;
  }

  // The windows breathe; the beacon blinks.
  for (const m of glass) m.emissiveIntensity = still ? 1.35 : 1.3 + 0.12 * Math.sin(t * 1.4);
  if (beacon) beacon.visible = still || Math.floor(t * 1.6) % 2 === 0;

  // When nobody is pointing at anything, the name tags take turns.
  if (!still && hovered < 0 && pinned < 0 && !overHQ && !pinnedHQ && idle && kittens.length) {
    cycleClock += dt;
    const on = cycleClock % 4.2 < 2.9;
    const i = Math.floor(cycleClock / 4.2) % kittens.length;
    const want = on ? (cycleIndex + i) % kittens.length : -1;
    if (want !== cycling) { cycling = want; showTag(cycling, false); }
  } else if (cycling >= 0 && (hovered >= 0 || pinned >= 0)) {
    cycling = -1;
  }

  if (still && !dirty) return;
  dirty = false;
  renderer.render(scene, camera);
  placeTag();
  placeEnter();
}

function setRunning() {
  const want = onScreen && !document.hidden;
  if (want === running) return;
  running = want;
  if (running) { clock.start(); renderer.setAnimationLoop(tick); }
  else { clock.stop(); renderer.setAnimationLoop(null); }
}
new IntersectionObserver((entries) => { onScreen = entries[0].isIntersecting; setRunning(); }, { threshold: 0 }).observe(canvas);
document.addEventListener("visibilitychange", setRunning);
new ResizeObserver(() => { frame(); if (!running) renderer.render(scene, camera); }).observe(sceneBox);
canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); fail("context lost"); });

frame();
Promise.all([hqReady, kittenReady, floorReady]).then(() => {
  frame();
  renderer.render(scene, camera);
  hero.dataset.scene = "ready";
  canvas.tabIndex = 0;
  setRunning();
  if (new URLSearchParams(location.search).has("debug")) window.__hq = { camera, kittens, controls, door, hqMeshes };
}).catch((e) => fail(e && e.message ? e.message : e));
