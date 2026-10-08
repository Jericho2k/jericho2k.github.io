// The card table: a small low-res 3D room (PS1-era look) with a dealer across the table.
// World is rendered to a tiny target and dithered; the hand is rendered crisp on top.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.150.1/build/three.module.js';

const G = window.__portfolio;
const { P, isRed, reduced, touchOnly } = G;
const $ = id => document.getElementById(id);
const stage = $('stage'), sec = $('projects'), canvas = $('game'), label = $('hand-label');
const hintEl = $('hint'), hintText = $('hint-text');
const textbox = $('textbox'), tbText = $('tb-text'), tbFace = $('tb-face'), endbar = $('endbar'), srHand = $('sr-hand');

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeInOut = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/* ---------------- what the dealer says ---------------- */
const LINES = {
  intro: '* Садись.\n* У тебя шесть карт. Каждая — что-то, что ты построил. Покажи.',
  0: '* Туз червей.\n* Сотни страниц регламентов — и ответ со ссылкой на пункт. Неплохое начало.',
  1: '* Король.\n* Говорит голосом автора и не отвечает дважды на одно и то же. Аккуратно.',
  2: '* Дама.\n* Помнит, что было сто сообщений назад.\n* ...Я тоже кое-что помню.',
  3: '* Бубны. Деньги.\n* Ты записал, где проиграл. Редко кто так делает.',
  4: '* Валет. Лента, свайпы, монорепозиторий.\n* Сойдёт.',
  5: '* Девятка пик. Питчи, инвесторы, поиск.\n* Простая карта. Но играет.',
  all: '* Ты выложил всё.\n* ...\n* Банк твой.',
  again: '* Ещё партию?',
  poke: ['* Не трогай.', '* Твой ход, не мой.', '* ...', '* Я жду.'],
};
const HINT = touchOnly ? 'Коснись карты, чтобы рассмотреть, и ещё раз — чтобы сыграть' : 'Наведи на карту и нажми, чтобы сыграть';

/* ---------------- sound (off until asked) ---------------- */
const sound = {
  on: false, ctx: null,
  toggle(btn) {
    this.on = !this.on;
    if (this.on && !this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    btn.textContent = this.on ? '♪ Звук: вкл' : '♪ Звук: выкл';
    btn.setAttribute('aria-pressed', this.on);
  },
  tone(freq, dur, type = 'square', vol = .04) {
    if (!this.on) return;
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, c.currentTime); g.gain.exponentialRampToValueAtTime(.0001, c.currentTime + dur);
    o.connect(g).connect(c.destination); o.start(); o.stop(c.currentTime + dur + .02);
  },
  noise(dur, freq, vol, type = 'lowpass') {
    if (!this.on) return;
    const c = this.ctx, n = c.sampleRate * dur, b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2);
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = b; f.type = type; f.frequency.value = freq; g.gain.value = vol;
    s.connect(f).connect(g).connect(c.destination); s.start();
  },
  blip() { this.tone(150 + Math.random() * 25, .05, 'square', .035); },
  swish() { this.noise(.12, 2400, .12, 'highpass'); },
  thud() { this.noise(.22, 320, .5); this.tone(70, .12, 'sine', .12); },
};
$('sound').addEventListener('click', e => sound.toggle(e.currentTarget));

/* ---------------- pixel-art textures ---------------- */
const SUITS = {
  '♥': ['.11...11.', '1111.1111', '111111111', '111111111', '.1111111.', '..11111..', '...111...', '....1....', '.........'],
  '♦': ['....1....', '...111...', '..11111..', '.1111111.', '111111111', '.1111111.', '..11111..', '...111...', '....1....'],
  '♣': ['...111...', '..11111..', '..11111..', '1..111..1', '111111111', '111111111', '1..1.1..1', '....1....', '...111...'],
  '♠': ['....1....', '...111...', '..11111..', '.1111111.', '111111111', '111111111', '.11.1.11.', '....1....', '...111...'],
};
function mk(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function tex(c) {
  const t = new THREE.CanvasTexture(c);
  t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  return t;
}
function suit(g, s, x, y, k, color) {
  g.fillStyle = color;
  SUITS[s].forEach((row, j) => [...row].forEach((v, i) => { if (v === '1') g.fillRect(x + i * k, y + j * k, k, k); }));
}
// text drawn on its own layer and thresholded, so it stays hard-edged pixel type
function textLayer(w, h, draw) {
  const c = mk(w, h), q = c.getContext('2d'); draw(q);
  const im = q.getImageData(0, 0, w, h), d = im.data;
  for (let i = 3; i < d.length; i += 4) d[i] = d[i] > 110 ? 255 : 0;
  q.putImageData(im, 0, 0); return c;
}
function wrap(q, text, maxW) {
  const words = text.split(/(?<=-)|\s+/), lines = []; let line = '';
  for (const w of words) {
    const sep = line && !line.endsWith('-') ? ' ' : '';
    if (q.measureText(line + sep + w).width > maxW && line) { lines.push(line); line = w; } else line += sep + w;
  }
  lines.push(line); return lines;
}
const CW = 96, CH = 134;
function faceTexture(p) {
  const c = mk(CW, CH), g = c.getContext('2d');
  g.fillStyle = '#120e0c'; g.fillRect(1, 0, CW - 2, CH); g.fillRect(0, 1, CW, CH - 2);
  g.fillStyle = '#E9DFC6'; g.fillRect(2, 1, CW - 4, CH - 2); g.fillRect(1, 2, CW - 2, CH - 4);
  for (let i = 0; i < 380; i++) { g.fillStyle = Math.random() < .55 ? 'rgba(120,96,60,.13)' : 'rgba(255,255,255,.25)'; g.fillRect(2 + Math.random() * (CW - 4) | 0, 2 + Math.random() * (CH - 4) | 0, 1, 1); }
  g.fillStyle = '#D3C5A4'; g.fillRect(5, 5, CW - 10, 1); g.fillRect(5, CH - 6, CW - 10, 1); g.fillRect(5, 5, 1, CH - 10); g.fillRect(CW - 6, 5, 1, CH - 10);
  const col = isRed(p.s) ? '#A8242B' : '#1E1A17';
  const corner = q => { q.fillStyle = col; q.textBaseline = 'top'; q.font = '16px "Press Start 2P"'; q.fillText(p.r, 8, 8); };
  g.drawImage(textLayer(CW, CH, q => {
    corner(q);
    q.textAlign = 'center'; q.textBaseline = 'top';
    q.font = '8px "Press Start 2P"'; q.fillStyle = '#1E1A17';
    const lines = wrap(q, p.name, 84);
    lines.forEach((l, j) => q.fillText(l, CW / 2, 74 + j * 11 - (lines.length - 1) * 5));
    q.fillStyle = '#7A6E5C';
    q.fillText(p.yr.replace(' · диплом', '').replace(/\s*—\s*сейчас/, '–н.в.').replace(/\s*—\s*/, '–'), CW / 2, 112);
    if (p.site) { q.textAlign = 'right'; q.fillStyle = '#2F7A4F'; q.fillText('сайт', CW - 8, 9); }
  }), 0, 0);
  suit(g, p.s, 8, 27, 1, col);
  g.save(); g.translate(CW, CH); g.rotate(Math.PI);
  g.drawImage(textLayer(CW, CH, corner), 0, 0); suit(g, p.s, 8, 27, 1, col);
  g.restore();
  suit(g, p.s, (CW - 27) / 2, 36, 3, col);
  return tex(c);
}
function backTexture() {
  const c = mk(CW, CH), g = c.getContext('2d');
  g.fillStyle = '#120e0c'; g.fillRect(0, 0, CW, CH);
  g.fillStyle = '#E9DFC6'; g.fillRect(2, 2, CW - 4, CH - 4);
  g.fillStyle = '#5A171C'; g.fillRect(5, 5, CW - 10, CH - 10);
  g.fillStyle = '#9C7B3A';
  for (let y = 5; y < CH - 5; y++) for (let x = 5; x < CW - 5; x++) if (((x + y) % 8 === 0) || ((x - y + 400) % 8 === 0)) g.fillRect(x, y, 1, 1);
  suit(g, '♥', (CW - 18) / 2, (CH - 18) / 2, 2, '#E9DFC6');
  return tex(c);
}
function feltTexture() {
  const S = 128, c = mk(S, S), g = c.getContext('2d');
  g.fillStyle = '#2C6A4E'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 3000; i++) { const v = Math.random(); g.fillStyle = v < .5 ? 'rgba(0,0,0,.10)' : 'rgba(150,220,180,.06)'; g.fillRect(Math.random() * S | 0, Math.random() * S | 0, 1, 1); }
  g.strokeStyle = 'rgba(214,190,130,.45)'; g.lineWidth = 1;
  g.beginPath(); g.arc(S / 2, S / 2, S * .40, 0, Math.PI * 2); g.stroke();
  return tex(c);
}
function decalTexture(text) {
  const c = mk(256, 24);
  c.getContext('2d').drawImage(textLayer(256, 24, q => { q.fillStyle = 'rgba(214,190,130,1)'; q.font = '8px "Press Start 2P"'; q.textAlign = 'center'; q.textBaseline = 'middle'; q.fillText(text, 128, 12); }), 0, 0);
  return tex(c);
}
function slotTexture() {
  const c = mk(32, 45), g = c.getContext('2d');
  g.fillStyle = 'rgba(214,190,130,.55)';
  g.fillRect(2, 0, 28, 1); g.fillRect(2, 44, 28, 1); g.fillRect(0, 2, 1, 41); g.fillRect(31, 2, 1, 41);
  return tex(c);
}
function glowTexture(r = 255, gg = 200, b = 120) {
  const c = mk(64, 64), g = c.getContext('2d'), grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, `rgba(${r},${gg},${b},1)`); grd.addColorStop(1, `rgba(${r},${gg},${b},0)`);
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); return t;
}

/* ---------------- PS1-style vertex snapping ---------------- */
const snap = { value: new THREE.Vector2(160, 90) };
function psx(mat) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.uSnap = snap;
    sh.vertexShader = 'uniform vec2 uSnap;\n' + sh.vertexShader.replace('#include <project_vertex>',
      '#include <project_vertex>\n  gl_Position.xy = floor(gl_Position.xy / gl_Position.w * uSnap + .5) / uSnap * gl_Position.w;');
  };
  return mat;
}
const lam = (color, o = {}) => psx(new THREE.MeshLambertMaterial({ color, ...o }));

/* ---------------- post: dither, quantize, scanlines, power-on pixelation ---------------- */
const POST_FRAG = `
uniform sampler2D tWorld; uniform sampler2D tHand;
uniform vec2 uWorldRes; uniform vec2 uRes; uniform float uPix; uniform float uTime; uniform float uWS;
varying vec2 vUv;
float b2(vec2 a){ a=floor(a); return fract(a.x*.5 + a.y*a.y*.75); }
float b4(vec2 a){ return b2(.5*a)*.25 + b2(a); }
void main(){
  vec2 wr = uWorldRes / uPix;
  vec2 cell = floor(vUv*wr);
  vec2 uv = (cell+.5)/wr;
  vec3 c = texture2D(tWorld, uv).rgb;
  c.r = mix(c.r, texture2D(tWorld, uv + vec2(1./wr.x, 0.)).r, .25);
  c = mix(c, c*c*(3.-2.*c), .35);
  c = mix(vec3(.010,.022,.018), vec3(1.0,.95,.84), c);
  float L = 9.;
  c = floor(c*L + b4(cell)) / L;
  vec2 q = vUv-.5;
  float vig = smoothstep(.98, .28, length(q*vec2(1.05,1.3)));
  c *= vig;
  vec2 hr = uRes / uPix;
  vec2 huv = uPix > 1.01 ? (floor(vUv*hr)+.5)/hr : vUv;
  vec4 h = texture2D(tHand, huv);
  c = mix(c, h.rgb * mix(1., vig, .25), h.a);
  c *= 1. - mod(floor(gl_FragCoord.y / uWS), 2.) * .07;
  c *= .985 + .015*sin(uTime*53.);
  gl_FragColor = vec4(c, 1.);
}`;

/* =================================================================== */
async function main() {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  } catch (e) {
    $('nogl').hidden = false; stage.style.background = '#050706'; stage.style.setProperty('--head', 1);
    return;
  }
  renderer.setPixelRatio(1);
  await Promise.all(['16px "Press Start 2P"', '8px "Press Start 2P"'].map(f => document.fonts.load(f, 'АаZz1')));

  const TABLE_Y = .76, RX = 1.45, RZ = .9, CARD_W = .16;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050706);
  scene.fog = new THREE.Fog(0x050706, 2.6, 6.2);
  const camera = new THREE.PerspectiveCamera(50, 1, .05, 14);
  const handScene = new THREE.Scene();
  const handCam = new THREE.PerspectiveCamera(50, 1, .05, 10);
  handScene.add(handCam);

  /* lights */
  scene.add(new THREE.AmbientLight(0x30423a, .42));
  const back = new THREE.DirectionalLight(0x5f7f9a, .35); back.position.set(0, 3, -4); scene.add(back);

  /* room */
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), lam(0x0b0d0b)); floor.rotation.x = -Math.PI / 2; scene.add(floor);
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(14, 6), lam(0x141814)); wall.position.set(0, 2.5, -3.4); scene.add(wall);
  const spill = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 2.6), new THREE.MeshBasicMaterial({ map: glowTexture(90, 110, 90), transparent: true, opacity: .32, depthWrite: false, fog: false }));
  spill.position.set(0, 1.75, -3.35); scene.add(spill);

  /* table */
  const feltMat = lam(0xffffff, { map: feltTexture() });
  const woodMat = lam(0x3a2216);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, .06, 30), [woodMat, feltMat, woodMat]);
  top.scale.set(RX, 1, RZ); top.position.y = TABLE_Y - .03; scene.add(top);
  const rail = new THREE.Mesh(new THREE.TorusGeometry(1, .075, 6, 36), psx(new THREE.MeshPhongMaterial({ color: 0x24150f, shininess: 40, specular: 0x5a4030 })));
  rail.rotation.x = Math.PI / 2; rail.scale.set(RX + .02, RZ + .03, 1.1); rail.position.y = TABLE_Y + .015; scene.add(rail);
  const apron = new THREE.Mesh(new THREE.CylinderGeometry(1.02, .88, .2, 30, 1, true), woodMat);
  apron.scale.set(RX, 1, RZ); apron.position.y = TABLE_Y - .14; scene.add(apron);
  const decal = new THREE.Mesh(new THREE.PlaneGeometry(.95, .09), new THREE.MeshBasicMaterial({ map: decalTexture('JERICHO · BACKEND HOLD’EM'), transparent: true, opacity: .32, depthWrite: false }));
  decal.rotation.x = -Math.PI / 2; decal.position.set(0, TABLE_Y + .002, .42); scene.add(decal);

  /* board slots */
  const slotTex = slotTexture();
  const slots = P.map((_, k) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(CARD_W, CARD_W * 1.4), new THREE.MeshBasicMaterial({ map: slotTex, transparent: true, opacity: .55, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.set((k - 2.5) * .205, TABLE_Y + .002, -.16); scene.add(m); return m;
  });

  /* chips, deck, candle, glass */
  const chipCols = [0x9e2a2a, 0x2b4580, 0x1b1b1b, 0xd9ceb3];
  const chipGeo = new THREE.CylinderGeometry(.045, .045, .013, 10);
  function stack(x, z, n, ci) {
    for (let i = 0; i < n; i++) {
      const c = new THREE.Mesh(chipGeo, lam(chipCols[(ci + (i % 3 === 2 ? 1 : 0)) % 4]));
      c.position.set(x + (Math.random() - .5) * .006, TABLE_Y + .007 + i * .0135, z + (Math.random() - .5) * .006); scene.add(c);
    }
  }
  stack(.52, -.5, 9, 0); stack(.63, -.42, 6, 1); stack(.42, -.6, 4, 2);
  stack(-.86, .12, 7, 1); stack(-.76, .2, 5, 0); stack(.88, -.12, 8, 2);
  for (let i = 0; i < 5; i++) { const c = new THREE.Mesh(chipGeo, lam(chipCols[i % 4])); c.position.set(-.08 + i * .05 + Math.random() * .03, TABLE_Y + .007, -.46 + Math.random() * .06); c.rotation.z = (Math.random() - .5) * .3; scene.add(c); }
  const backTex = backTexture();
  const edge = lam(0xd8ccb0);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(.16, .045, .224), [edge, edge, lam(0xffffff, { map: backTex }), edge, edge, edge]);
  deck.position.set(-.42, TABLE_Y + .023, -.6); deck.rotation.y = .18; scene.add(deck);

  const candle = new THREE.Group(); candle.position.set(-1.0, TABLE_Y, -.42); scene.add(candle);
  const wax = new THREE.Mesh(new THREE.CylinderGeometry(.034, .04, .17, 6), lam(0xd8cdb3)); wax.position.y = .085; candle.add(wax);
  const flame = new THREE.Mesh(new THREE.ConeGeometry(.016, .06, 5), new THREE.MeshBasicMaterial({ color: 0xffc061 })); flame.position.y = .2; candle.add(flame);
  const flameGlow = new THREE.Mesh(new THREE.PlaneGeometry(.34, .34), new THREE.MeshBasicMaterial({ map: glowTexture(255, 170, 80), transparent: true, opacity: .55, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  flameGlow.position.y = .2; candle.add(flameGlow);
  const candleLight = new THREE.PointLight(0xff8a3a, 1.15, 2.6, 1.4); candleLight.position.set(0, .26, 0); candle.add(candleLight);
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(.042, .036, .095, 8), psx(new THREE.MeshPhongMaterial({ color: 0xb8782a, transparent: true, opacity: .55, shininess: 80 })));
  glass.position.set(.98, TABLE_Y + .048, .08); scene.add(glass);

  /* lamp */
  const lamp = new THREE.Group(); lamp.position.set(0, 2.16, -.22); scene.add(lamp);
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(.006, .006, 1.6, 4), lam(0x111111)); cord.position.y = .8; lamp.add(cord);
  const shade = new THREE.Mesh(new THREE.ConeGeometry(.36, .24, 8, 1, true), lam(0x1f4232, { side: THREE.DoubleSide })); lamp.add(shade);
  const under = new THREE.Mesh(new THREE.CircleGeometry(.3, 8), new THREE.MeshBasicMaterial({ color: 0xd9b98a, fog: false })); under.rotation.x = Math.PI / 2; under.position.y = -.1; lamp.add(under);
  const spot = new THREE.SpotLight(0xffd59a, 1.75, 5, .64, .55, 1.1); spot.position.y = -.1; lamp.add(spot);
  const spotTarget = new THREE.Object3D(); spotTarget.position.set(0, TABLE_Y, -.12); scene.add(spotTarget); spot.target = spotTarget;
  const shaft = new THREE.Mesh(new THREE.ConeGeometry(.8, 1.22, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: .028, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  shaft.position.y = -.72; lamp.add(shaft);

  /* dust in the light */
  const DUST = 60, dustPos = new Float32Array(DUST * 3);
  const resetMote = (i, anyY) => {
    const y = anyY ? lerp(TABLE_Y + .05, 1.95, Math.random()) : TABLE_Y + .05;
    const r = lerp(.85, .12, (y - TABLE_Y) / 1.2) * Math.sqrt(Math.random()), a = Math.random() * 6.283;
    dustPos[i * 3] = Math.cos(a) * r; dustPos[i * 3 + 1] = y; dustPos[i * 3 + 2] = -.22 + Math.sin(a) * r * .8;
  };
  for (let i = 0; i < DUST; i++) resetMote(i, true);
  const dustGeo = new THREE.BufferGeometry(); dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xffe2b0, size: 1, sizeAttenuation: false, transparent: true, opacity: .4, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  scene.add(dust);

  /* the dealer */
  const D = new THREE.Group(); D.position.set(0, 0, -1.18); D.rotation.x = .04; scene.add(D);
  const cloth = lam(0x17120f), dark = lam(0x0c0a09);
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(.24, .45, .96, 7), cloth); torso.position.y = 1.1; D.add(torso);
  const shoulders = new THREE.Mesh(new THREE.SphereGeometry(.45, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), cloth); shoulders.scale.set(1, .42, .62); shoulders.position.y = 1.52; D.add(shoulders);
  const headG = new THREE.Group(); headG.position.y = 1.76; D.add(headG);
  headG.add(new THREE.Mesh(new THREE.SphereGeometry(.16, 8, 6), dark));
  const hood = new THREE.Mesh(new THREE.ConeGeometry(.28, .6, 8, 1, true, Math.PI * .28, Math.PI * 1.44), lam(0x120e0c, { side: THREE.DoubleSide }));
  hood.position.y = .1; headG.add(hood);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, fog: false });
  const eyes = [-1, 1].map(s => { const e = new THREE.Mesh(new THREE.PlaneGeometry(.046, .017), eyeMat); e.position.set(s * .058, .02, .172); headG.add(e); return e; });
  const eyeGlow = new THREE.Mesh(new THREE.PlaneGeometry(.34, .14), new THREE.MeshBasicMaterial({ map: glowTexture(255, 190, 90), transparent: true, opacity: .35, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  eyeGlow.position.set(0, .02, .18); headG.add(eyeGlow);
  const skin = lam(0x7d6c5a);
  function limb(a, b, w, mat) {
    const len = a.distanceTo(b), m = new THREE.Mesh(new THREE.BoxGeometry(w, w, len), mat);
    m.position.copy(a).add(b).multiplyScalar(.5); m.lookAt(b); D.add(m); return m;
  }
  const hands = [-1, 1].map(s => {
    const h = new THREE.Group(); h.position.set(s * .3, TABLE_Y + .02, .44); D.add(h);
    h.add(new THREE.Mesh(new THREE.BoxGeometry(.11, .034, .12), skin));
    for (let f = 0; f < 4; f++) { const fg = new THREE.Mesh(new THREE.BoxGeometry(.018, .018, .075), skin); fg.position.set((f - 1.5) * .025, -.006, .085); fg.rotation.x = .25; h.add(fg); }
    limb(new THREE.Vector3(s * .36, 1.42, .02), new THREE.Vector3(s * .3, TABLE_Y + .05, .36), .11, cloth);
    h.userData.base = h.position.clone(); return h;
  });
  const dealerMeshes = []; D.traverse(o => { if (o.isMesh) dealerMeshes.push(o); });
  const dealer = { flare: 0, talk: 0, blink: 0, nextBlink: 2, tap: 0, open: 0 };

  /* the hand */
  const hand = new THREE.Group(); handCam.add(hand);
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: .45, depthWrite: false });
  const cards = P.map((p, i) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1.4), new THREE.MeshBasicMaterial({ map: faceTexture(p), transparent: true, color: 0xe6dccb }));
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(1.04, 1.44), shadowMat); sh.position.set(.05, -.06, -.02); m.add(sh);
    m.userData = { i, shadow: sh, p: new THREE.Vector3(0, -2, -1), r: new THREE.Euler(), s: .1, tilt: new THREE.Vector2(), deal: 0 };
    hand.add(m); return m;
  });
  let inHand = P.map((_, i) => i), onBoard = [], hover = -1, touchLift = -1, busy = false, introDone = false, saidAll = false;
  // hint state: has the visitor touched a card yet, played one yet, and how long the table has been quiet
  let touched = false, played = false, calm = 0, boardHintUntil = 0, boardHintShown = false, seated = false;

  /* post */
  const tWorld = new THREE.WebGLRenderTarget(4, 4, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  const tHand = new THREE.WebGLRenderTarget(4, 4, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  const post = new THREE.ShaderMaterial({
    uniforms: { tWorld: { value: tWorld.texture }, tHand: { value: tHand.texture }, uWorldRes: { value: new THREE.Vector2() }, uRes: { value: new THREE.Vector2() }, uPix: { value: 1 }, uTime: { value: 0 }, uWS: { value: 3 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }',
    fragmentShader: POST_FRAG, depthTest: false, depthWrite: false,
  });
  const postScene = new THREE.Scene(), postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), post));

  /* camera path: from above the table down into the seat */
  const camFrom = { p: new THREE.Vector3(0, 3.5, .9), l: new THREE.Vector3(0, TABLE_Y, -.05) };
  const camTo = { p: new THREE.Vector3(0, 1.66, 1.92), l: new THREE.Vector3(0, 1.02, -.62) };

  /* sizing */
  let W = 1, H = 1, M = {};
  function resize() {
    W = stage.clientWidth; H = stage.clientHeight;
    renderer.setSize(W, H, false);
    const ws = W < 600 ? 2.5 : 3;
    const ww = Math.ceil(W / ws), wh = Math.ceil(H / ws);
    tWorld.setSize(ww, wh); tHand.setSize(W, H);
    post.uniforms.uWorldRes.value.set(ww, wh); post.uniforms.uRes.value.set(W, H); post.uniforms.uWS.value = ws;
    snap.value.set(ww / 2.4, wh / 2.4);
    const aspect = W / H, fov = aspect < .7 ? 72 : aspect < 1.1 ? 60 : 50;
    for (const c of [camera, handCam]) { c.aspect = aspect; c.fov = fov; c.updateProjectionMatrix(); }
    const hh = .8 * Math.tan(THREE.MathUtils.degToRad(fov / 2)), hw = hh * aspect, ch = hh * (aspect < .8 ? .36 : aspect < 1.2 ? .38 : .42);
    M = { hh, hw, ch, cw: ch / 1.4, D: .8 };
    // upright phones: tilt the view up so the dealer clears the heading
    camTo.l.y = aspect < .8 ? 1.36 : 1.02; camTo.p.z = aspect < .8 ? 2.05 : 1.92;
  }
  new ResizeObserver(resize).observe(stage); resize();

  /* labels + keyboard access */
  function say(i) { label.innerHTML = i < 0 ? (inHand.length ? HINT : 'Все карты на столе.') : `<b>${P[i].r}${P[i].s} ${P[i].name}</b> · ${P[i].sub}`; }
  function syncSr() {
    srHand.innerHTML = inHand.map(i => `<button type="button" data-i="${i}">${P[i].r}${P[i].s} ${P[i].name}</button>`).join('');
    srHand.querySelectorAll('button').forEach(b => {
      const i = +b.dataset.i;
      b.addEventListener('focus', () => { hover = i; touched = true; say(i); });
      b.addEventListener('blur', () => { if (hover === i) { hover = -1; say(-1); } });
      b.addEventListener('click', () => play(i));
    });
  }
  say(-1); syncSr();

  /* speech */
  let speech = null;
  function speak(text) {
    if (speech) speech.close();
    return new Promise(res => {
      const s = { done: false, timers: [] }; speech = s;
      textbox.classList.add('on'); textbox.classList.remove('done'); tbText.textContent = '';
      const finish = () => { s.timers.forEach(clearTimeout); tbText.textContent = text; textbox.classList.add('done'); s.done = true; s.timers = []; };
      const close = () => { if (speech !== s) return; s.timers.forEach(clearTimeout); textbox.classList.remove('on'); speech = null; res(); };
      s.finish = finish; s.close = close;
      if (reduced) { finish(); return; }
      let k = 0;
      const step = () => {
        k++; tbText.textContent = text.slice(0, k);
        const ch = text[k - 1];
        if (k % 2 && ch !== ' ' && ch !== '\n') { sound.blip(); dealer.talk = 1; }
        if (k >= text.length) return finish();
        s.timers = [setTimeout(step, ch === '\n' ? 320 : ch === '.' ? 160 : ch === ',' || ch === '—' ? 110 : 30)];
      };
      step();
    });
  }
  const advance = () => { if (speech) speech.done ? speech.close() : speech.finish(); };
  textbox.addEventListener('click', advance);
  addEventListener('keydown', e => { if (speech && (e.key === 'Enter' || e.key === ' ') && !e.target.closest('button,a,input')) { e.preventDefault(); advance(); } });

  /* tween helper */
  const tweens = [];
  const tween = (dur, fn) => new Promise(res => { if (dur <= 0) { fn(1); return res(); } tweens.push({ t0: performance.now(), dur, fn, res }); });

  /* landing puff */
  const puffs = [];
  function puff(at) {
    const m = new THREE.Mesh(new THREE.RingGeometry(.06, .075, 14), new THREE.MeshBasicMaterial({ color: 0xffe9c0, transparent: true, opacity: .6, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.copy(at).setY(TABLE_Y + .004); scene.add(m); puffs.push({ m, t: 0 });
  }
  let shake = 0;

  /* playing a card */
  async function play(i) {
    if (busy || !inHand.includes(i)) return;
    busy = true; hover = -1; touchLift = -1; played = touched = true;
    const m = cards[i];
    inHand = inHand.filter(x => x !== i); syncSr(); say(-1);
    const slot = slots[onBoard.length]; onBoard.push(i);
    m.userData.flying = true; m.userData.shadow.visible = false;
    handCam.updateMatrixWorld(true); scene.attach(m); m.material.needsUpdate = true;
    sound.swish();
    const from = { p: m.position.clone(), q: m.quaternion.clone(), s: m.scale.x };
    const to = { p: slot.position.clone().setY(TABLE_Y + .005 + onBoard.length * .0004), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, (Math.random() - .5) * .16)), s: CARD_W };
    await tween(reduced ? 0 : 720, t => {
      const e = easeInOut(t);
      m.position.lerpVectors(from.p, to.p, e); m.position.y += Math.sin(Math.PI * e) * .3;
      m.quaternion.slerpQuaternions(from.q, to.q, easeOut(t));
      m.scale.setScalar(lerp(from.s, to.s, e));
    });
    m.userData.flying = false; m.userData.onTable = true;
    m.material.color.setHex(0xffffff);
    puff(m.position); sound.thud(); shake = reduced ? 0 : 1;
    dealer.flare = 1; dealer.tap = 1;
    await speak(LINES[i]);
    busy = false;
    G.openCase(i);
  }
  G.dialog.addEventListener('close', async () => {
    if (played && !boardHintShown && inHand.length) { boardHintShown = true; boardHintUntil = performance.now() / 1000 + 5; }
    if (!inHand.length && !saidAll && onBoard.length) {
      saidAll = true; dealer.flare = 1;
      await speak(LINES.all);
      endbar.hidden = false;
    }
  });

  function resetTable() {
    if (busy) return;
    onBoard.forEach(i => {
      const m = cards[i]; m.userData.onTable = false; m.userData.shadow.visible = true; m.material.color.setHex(0xe6dccb);
      handScene.updateMatrixWorld(true); hand.attach(m); m.material.needsUpdate = true;
      m.userData.p.copy(m.position); m.userData.r.copy(m.rotation); m.userData.s = m.scale.x;
    });
    onBoard = []; inHand = P.map((_, i) => i); saidAll = false; endbar.hidden = true;
    syncSr(); say(-1); speak(LINES.again);
  }
  $('end-reset').addEventListener('click', resetTable);
  $('end-cascade').addEventListener('click', () => G.cascade());

  /* pointer */
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), look = { x: 0, y: 0, tx: 0, ty: 0 };
  let ptrType = 'mouse', hoverUv = new THREE.Vector2(.5, .5);
  function pick(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    look.tx = ndc.x; look.ty = ndc.y;
    ray.setFromCamera(ndc, handCam);
    const hit = ray.intersectObjects(inHand.map(i => cards[i]), false)[0];
    if (hit) return { card: hit.object.userData.i, uv: hit.uv };
    ray.setFromCamera(ndc, camera);
    const b = ray.intersectObjects(onBoard.map(i => cards[i]), false)[0];
    if (b) return { board: b.object.userData.i };
    if (ray.intersectObjects(dealerMeshes, false)[0]) return { dealer: true };
    return {};
  }
  canvas.addEventListener('pointerdown', e => { ptrType = e.pointerType; });
  canvas.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch' || busy) return;
    const h = pick(e);
    const nh = h.card ?? -1;
    if (nh !== hover) { hover = nh; say(nh); if (nh >= 0) { touched = true; sound.tone(620, .03, 'square', .015); } }
    if (h.uv) hoverUv.copy(h.uv);
    canvas.style.cursor = h.card !== undefined || h.board !== undefined || h.dealer ? 'pointer' : 'default';
  });
  canvas.addEventListener('pointerleave', () => { if (ptrType !== 'touch') { hover = -1; say(-1); } look.tx = look.ty = 0; });
  let pokes = 0;
  canvas.addEventListener('click', e => {
    if (speech) { advance(); return; }
    if (busy) return;
    const h = pick(e);
    if (h.card !== undefined) {
      if (ptrType === 'touch' && touchLift !== h.card) { touchLift = h.card; hover = h.card; touched = true; say(h.card); return; }
      play(h.card);
    } else if (h.board !== undefined) G.openCase(h.board);
    else if (h.dealer) { dealer.flare = 1; speak(LINES.poke[pokes++ % LINES.poke.length]); }
    else if (ptrType === 'touch') { touchLift = -1; hover = -1; say(-1); }
  });

  /* scroll progress: the camera sits down at the table */
  const lookAt = new THREE.Vector3();
  function progress() {
    if (reduced) return 1;
    const V = innerHeight, t = sec.getBoundingClientRect().top;
    return clamp((V * .6 - t) / (V * 1.1));
  }

  /* frame */
  let last = performance.now(), running = false;
  function update(dt, t) {
    const p = progress(), e = easeOut(p);
    stage.style.setProperty('--fade', clamp(p / .22).toFixed(3));
    stage.style.setProperty('--head', clamp((p - .25) / .3).toFixed(3));
    stage.classList.toggle('seated', p > .45);
    seated = p >= .97;
    calm = seated && !speech && !busy && !G.dialog.open ? calm + dt : 0;
    post.uniforms.uPix.value = reduced ? 1 : lerp(22, 1, easeOut(clamp(p / .62)));
    post.uniforms.uTime.value = t;

    // camera + gentle look-around with the pointer
    look.x += (look.tx - look.x) * Math.min(1, dt * 3); look.y += (look.ty - look.y) * Math.min(1, dt * 3);
    camera.position.lerpVectors(camFrom.p, camTo.p, e);
    lookAt.lerpVectors(camFrom.l, camTo.l, e);
    if (!reduced && !touchOnly) { camera.position.x += look.x * .09 * e; camera.position.y += look.y * .04 * e; lookAt.x += look.x * .05 * e; }
    if (shake > 0) { camera.position.x += (Math.random() - .5) * .02 * shake; camera.position.y += (Math.random() - .5) * .014 * shake; shake = Math.max(0, shake - dt * 5); }
    camera.lookAt(lookAt);
    handCam.position.copy(camera.position); handCam.quaternion.copy(camera.quaternion);

    if (p >= .97 && !introDone && !busy) { introDone = true; dealer.flare = .6; speak(LINES.intro); }

    // lamp sway + flicker, candle
    const amb = reduced ? 0 : 1;
    lamp.rotation.z = Math.sin(t * .55) * .022 * amb; lamp.rotation.x = Math.sin(t * .37) * .012 * amb;
    const flick = 1 - amb * (Math.random() < .012 ? .35 : 0) - amb * .04 * Math.sin(t * 13) * Math.sin(t * 7.3);
    spot.intensity = 1.75 * flick; under.material.color.setRGB(.85 * flick, .72 * flick, .54 * flick);
    const cf = 1 + amb * (.18 * Math.sin(t * 17) * Math.sin(t * 5.1) + (Math.random() - .5) * .12);
    candleLight.intensity = 1.15 * cf; flame.scale.set(1, cf, 1); flameGlow.material.opacity = .5 * cf;
    flameGlow.lookAt(camera.position); eyeGlow.lookAt(camera.position);

    // dust
    if (amb) {
      for (let i = 0; i < DUST; i++) {
        dustPos[i * 3] += Math.sin(t * .3 + i) * .00025; dustPos[i * 3 + 1] += .0009 * (0.4 + (i % 5) * .15) * dt * 60 * .4;
        if (dustPos[i * 3 + 1] > 1.95) resetMote(i, false);
      }
      dustGeo.attributes.position.needsUpdate = true;
    }

    // dealer: breathing, blinking, eyes flare when you play, hands tap
    dealer.open = Math.max(dealer.open, clamp((p - .8) / .15));
    dealer.nextBlink -= dt;
    if (dealer.nextBlink <= 0) { dealer.blink = 1; dealer.nextBlink = 2.5 + Math.random() * 4; tbFace.classList.add('blink'); setTimeout(() => tbFace.classList.remove('blink'), 140); }
    dealer.blink = Math.max(0, dealer.blink - dt * 7);
    dealer.flare = Math.max(0, dealer.flare - dt * .9);
    dealer.talk = Math.max(0, dealer.talk - dt * 8);
    dealer.tap = Math.max(0, dealer.tap - dt * 1.6);
    const ey = dealer.open * (1 - Math.min(1, dealer.blink * 1.6)) * (1 + dealer.flare * .5);
    eyes.forEach(m => m.scale.set(1 + dealer.flare * .3, Math.max(.05, ey), 1));
    eyeGlow.material.opacity = (.22 + dealer.flare * .5) * dealer.open;
    torso.scale.y = 1 + Math.sin(t * 1.3) * .012 * amb; shoulders.position.y = 1.52 + Math.sin(t * 1.3) * .006 * amb;
    headG.rotation.z = Math.sin(t * .4) * .04 * amb + dealer.flare * .06;
    headG.rotation.x = -dealer.talk * .05 - dealer.flare * .04;
    headG.position.y = 1.76 + Math.sin(t * 1.3) * .006 * amb;
    hands.forEach((h, k) => {
      h.position.copy(h.userData.base);
      h.position.x += Math.sin(t * .7 + k * 2) * .01 * amb;
      if (k === 1) h.position.y += Math.abs(Math.sin(dealer.tap * 18)) * .03 * dealer.tap;
    });

    // the hand: deal in, fan, hover lift, Balatro-ish sway and tilt
    const n = inHand.length, { hh, hw, ch, cw } = M;
    const spacing = n > 1 ? Math.min(cw * 1.05, (hw * 1.84 - cw) / (n - 1)) : 0;
    const dip = speech ? 1 : 0;
    inHand.forEach((idx, k) => {
      const m = cards[idx], u = m.userData;
      u.deal = Math.max(u.deal, reduced ? 1 : easeOut(clamp((p - .6 - k * .045) / .2)));
      const off = k - (n - 1) / 2, isH = idx === hover;
      let hop = 0;
      if (amb && !touched && calm > 1) { const ph = (calm - 1) % 3.4 - k * .11; if (ph > 0 && ph < .38) hop = Math.sin(ph / .38 * Math.PI) * ch * .12; }
      const ty = -hh + ch * .36 - off * off * ch * .028 - (1 - u.deal) * ch * 1.6 - dip * ch * .5 + (isH ? ch * .34 : 0) + hop;
      const tx = off * spacing, tz = -M.D + k * .004 + (isH ? .06 : 0);
      const trz = isH ? 0 : -off * .055;
      const ts = cw * (isH ? 1.08 : 1);
      const kf = Math.min(1, dt * (reduced ? 60 : 11));
      u.p.x += (tx - u.p.x) * kf; u.p.y += (ty - u.p.y) * kf; u.p.z += (tz - u.p.z) * kf;
      u.r.x += (0 - u.r.x) * kf; u.r.y += (0 - u.r.y) * kf; u.r.z += (trz - u.r.z) * kf;
      u.s += (ts - u.s) * kf;
      u.tilt.x += ((isH ? (hoverUv.y - .5) * -.45 : 0) - u.tilt.x) * kf;
      u.tilt.y += ((isH ? (hoverUv.x - .5) * .5 : 0) - u.tilt.y) * kf;
      const bob = amb * Math.sin(t * 1.6 + idx * 1.3) * ch * .012, sway = amb * Math.sin(t * 1.1 + idx) * .025;
      m.position.set(u.p.x, u.p.y + bob, u.p.z);
      m.rotation.set(u.r.x + u.tilt.x, u.r.y + u.tilt.y, u.r.z + sway * (isH ? .3 : 1));
      m.scale.setScalar(u.s);
      m.material.color.setHex(isH ? 0xffffff : 0xe2d8c6);
    });

    // tweens + puffs
    for (let i = tweens.length - 1; i >= 0; i--) {
      const tw = tweens[i], k = clamp((performance.now() - tw.t0) / tw.dur); tw.fn(k);
      if (k >= 1) { tweens.splice(i, 1); tw.res(); }
    }
    for (let i = puffs.length - 1; i >= 0; i--) {
      const f = puffs[i]; f.t += dt / .45; f.m.scale.setScalar(1 + f.t * 3.5); f.m.material.opacity = .6 * (1 - f.t);
      if (f.t >= 1) { scene.remove(f.m); puffs.splice(i, 1); }
    }
  }
  function render() {
    renderer.setRenderTarget(tWorld); renderer.setClearColor(0x050706, 1); renderer.render(scene, camera);
    renderer.setRenderTarget(tHand); renderer.setClearColor(0x000000, 0); renderer.render(handScene, handCam);
    renderer.setRenderTarget(null); renderer.render(postScene, postCam);
  }
  const hv = new THREE.Vector3();
  let hintKey = '';
  function screenOf(obj, cam, localY) {
    hv.set(0, localY, 0).applyMatrix4(obj.matrixWorld).project(cam);
    return { x: (hv.x + 1) / 2 * W, y: (1 - hv.y) / 2 * H };
  }
  function updateHint(t) {
    let text = '', at = null;
    if (seated && !speech && !busy && !G.dialog.open) {
      const mid = inHand[Math.floor((inHand.length - 1) / 2)];
      // right after the first case closes, point at the table for a few seconds
      if (t < boardHintUntil && onBoard.length && hover < 0 && touchLift < 0) {
        const b = cards[onBoard[onBoard.length - 1]], pt = screenOf(b, camera, 0);
        place('Сыгранные карты тоже открываются', pt.x, pt.y - 22); return;
      }
      if (touchOnly) {
        if (touchLift >= 0 && inHand.includes(touchLift)) { text = 'Нажми ещё раз — сыграть'; at = cards[touchLift]; }
        else if (inHand.length) { text = 'Нажми на карту'; at = cards[mid]; }
      } else {
        if (hover >= 0) { text = 'Нажми, чтобы сыграть'; at = cards[hover]; }
        else if (inHand.length) { text = 'Выбери карту из руки'; at = cards[mid]; }
      }
    }
    if (!text) { hintEl.classList.remove('on'); return; }
    const pt = screenOf(at, handCam, .72);
    place(text, pt.x, pt.y - 8);
  }
  function place(text, x, y) {
    if (text !== hintKey) { hintText.textContent = text; hintKey = text; }
    const half = hintEl.offsetWidth / 2 + 8;
    hintEl.style.left = clamp(x, half, W - half) + 'px';
    hintEl.style.top = Math.max(70, y) + 'px';
    hintEl.classList.add('on');
  }
  function loop(now) {
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    update(dt, now / 1000); render(); updateHint(now / 1000);
    if (running) requestAnimationFrame(loop);
  }
  new IntersectionObserver(([e]) => {
    const was = running; running = e.isIntersecting;
    if (running && !was) { last = performance.now(); requestAnimationFrame(loop); }
  }).observe(stage);
  // keep the scroll-driven intro in step even between intersection callbacks
  update(0, performance.now() / 1000); render();
}
main();
