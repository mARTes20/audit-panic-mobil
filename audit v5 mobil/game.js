/* ============================================================
   AUDIT PANIC — game.js  v5.1  "Mobile Fix"
   ── Base: v5 "Oficina Viva" ──
   v5.1 agrega SOLO soporte táctil y responsive. Sin cambios gameplay.
     - Joystick virtual (touchstart/touchmove/touchend)
     - Botón táctil E para recoger documentos
     - updatePlayer() combina teclado + touchInput
     - resizeCanvas() reescrito para móvil: resta HUD + controles
     - Controles táctiles visibles solo en dispositivos touch/pequeños
     - Ocultar cursor del canvas en móvil
   ============================================================ */

"use strict";

// ──────────────────────────────────────────────
// 1. REFERENCIAS AL DOM
// ──────────────────────────────────────────────
const canvas      = document.getElementById("gameCanvas");
const ctx         = canvas.getContext("2d");

const screenStart    = document.getElementById("screen-start");
const screenGame     = document.getElementById("screen-game");
const screenGameover = document.getElementById("screen-gameover");
const screenWin      = document.getElementById("screen-win");
const screenPause    = document.getElementById("screen-pause");

const hudTimer    = document.getElementById("hud-timer");
const hudDocs     = document.getElementById("hud-docs");
const hudScore    = document.getElementById("hud-score");
const hudTarget   = document.getElementById("hud-target");   // objetivo actual
const suspBar     = document.getElementById("suspicion-bar");
const hudEl       = document.getElementById("hud");

const hudCoffeeEl = document.getElementById("hud-coffee");
const hudCoffeeTEl= document.getElementById("hud-coffee-t");
const hudClipsEl  = document.getElementById("hud-clips");
const hudClipsTEl = document.getElementById("hud-clips-t");

// ──────────────────────────────────────────────
// 1b. REFERENCIAS MÓVILES (v5.1)
// ──────────────────────────────────────────────
const mobileControls = document.getElementById("mobile-controls");
const touchJoystick  = document.getElementById("touch-joystick");
const joystickKnob   = document.getElementById("joystick-knob");
const touchActionBtn = document.getElementById("touch-action");

/**
 * touchInput — estado del joystick virtual.
 *
 * active:  hay un toque activo sobre el joystick
 * id:      identifier del toque (para multi-touch correcto)
 * startX/Y: coordenadas donde comenzó el toque
 * dx/dy:   dirección normalizada -1..1
 * maxDist: radio máximo del joystick en px (≈ radio del elemento)
 */
const touchInput = {
  active: false,
  id:     null,
  startX: 0,
  startY: 0,
  dx:     0,
  dy:     0,
  maxDist: 38,   // ≈ la mitad del diámetro del joystick (90/2 - margen)
};

// Detectar si el dispositivo es táctil y mostrar controles en ese caso
// (CSS también lo hace vía media query, esto es un refuerzo para JS)
if ("ontouchstart" in window || navigator.maxTouchPoints > 0) {
  mobileControls.style.opacity    = "1";
  mobileControls.style.visibility = "visible";
  canvas.style.cursor = "none";
}

// ──────────────────────────────────────────────
// 2. CONSTANTES DE DISEÑO
// ──────────────────────────────────────────────
const TILE          = 32;
const MAP_COLS      = 25;
const MAP_ROWS      = 18;
const TOTAL_DOCS    = 12;          // documentos a recolectar en la partida
const MAX_SUSPICION = 100;
const GAME_DURATION = 90;          // segundos

const AUDITOR_PATROL_SPEED = 62;
const AUDITOR_CHASE_SPEED  = 130;
const VISION_RANGE_PATROL  = 3.5 * TILE;
const VISION_RANGE_CHASE   = 5.5 * TILE;
const CHASE_TOUCH_RANGE    = TILE * 0.85;
const CHASE_TIMEOUT        = 3.5;

// Umbral de tiempo sin avanzar antes de saltar al siguiente waypoint
const STUCK_THRESHOLD = 1.2;   // segundos
const STUCK_MIN_DIST  = 4;      // px mínimos de movimiento para no contar como atascado

// ──────────────────────────────────────────────
// 3. DEFINICIÓN DE TIPOS DE DOCUMENTO
// Cada tipo tiene: nombre, color, forma, icono ASCII
// Esto permite diferenciación visual clara en el canvas
// ──────────────────────────────────────────────
const DOC_DEFS = [
  {
    id:    "factura",
    name:  "FACTURA",
    color: "#ffe94d",   // amarillo
    dark:  "#b8a000",
    shape: "rect",      // rectángulo normal
    icon:  "$",
  },
  {
    id:    "nomina",
    name:  "NÓMINA",
    color: "#4dff91",   // verde
    dark:  "#00a040",
    shape: "wide",      // más ancho
    icon:  "¥",
  },
  {
    id:    "impuesto",
    name:  "IMPUESTO",
    color: "#ff6b6b",   // rojo
    dark:  "#990000",
    shape: "tall",      // más alto
    icon:  "%",
  },
  {
    id:    "contrato",
    name:  "CONTRATO",
    color: "#a78bfa",   // violeta
    dark:  "#4c1d95",
    shape: "scroll",    // dibuja líneas decorativas extra
    icon:  "✎",
  },
  {
    id:    "bancario",
    name:  "BANCARIO",
    color: "#38bdf8",   // azul claro
    dark:  "#0369a1",
    shape: "diamond",   // rotado 45°
    icon:  "B",
  },
];

// ──────────────────────────────────────────────
// 4. POWER-UP DEFS
// ──────────────────────────────────────────────
const POWERUP_DEFS = [
  {
    id:       "coffee",
    label:    "☕ CAFÉ",
    color:    "#c8691a",
    dark:     "#7a3c00",
    duration: 5,         // segundos activo
    count:    3,         // cuántos aparecen en el mapa por partida
  },
  {
    id:       "clips",
    label:    "📎 CLIPS",
    color:    "#aaaaee",
    dark:     "#444488",
    duration: 5,
    count:    3,
  },
];

// ──────────────────────────────────────────────
// 5. PALETA GENERAL
// ──────────────────────────────────────────────
const C = {
  floor:    "#2a2a4a",
  floorAlt: "#252445",
  wall:     "#111122",
  desk:     "#5c3d1e",
  deskTop:  "#7a5230",
  computer: "#1a3a5c",
  screen:   "#4daaff",
  cabinet:  "#3a3a6a",
  printer:  "#555588",
  plant:    "#1a4a1a",
  leaf:     "#2ecc40",
  player:   "#39ff6a",
  playerDk: "#00a040",
  auditor:  "#ff4444",
  auditorDk:"#800000",
  shadow:   "rgba(0,0,0,0.35)",
  light:    "rgba(255,255,200,0.06)",
};

// ──────────────────────────────────────────────
// 6. AUDIO ENGINE (Web Audio API)
// ──────────────────────────────────────────────
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function playTone(freq, type, duration, vol = 0.18) {
  try {
    const ac   = getAudioCtx();
    const osc  = ac.createOscillator();
    const gain = ac.createGain();
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ac.currentTime);
    gain.gain.setValueAtTime(vol, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + duration);
    osc.start(ac.currentTime);
    osc.stop(ac.currentTime + duration);
  } catch(e) {}
}

const SFX = {
  step()      { playTone(180 + Math.random()*40, "square", 0.06, 0.055); },
  pickup()    { playTone(440,"square",0.08,0.13); setTimeout(()=>playTone(660,"square",0.1,0.13),80); },
  correct()   { [440,550,660,880].forEach((f,i)=>setTimeout(()=>playTone(f,"square",0.1,0.13),i*55)); },
  wrong()     { playTone(200,"sawtooth",0.12,0.18); setTimeout(()=>playTone(150,"sawtooth",0.15,0.18),100); },
  alert()     { playTone(880,"square",0.08,0.22); setTimeout(()=>playTone(660,"square",0.08,0.22),120); },
  touch()     { playTone(100,"sawtooth",0.3,0.28); },
  powerup()   { [330,440,550,660].forEach((f,i)=>setTimeout(()=>playTone(f,"square",0.09,0.14),i*50)); },
  gameover()  { [300,250,200,150].forEach((f,i)=>setTimeout(()=>playTone(f,"sawtooth",0.2,0.2),i*120)); },
  win()       { [440,550,660,880,1100].forEach((f,i)=>setTimeout(()=>playTone(f,"square",0.18,0.16),i*80)); },

  // ── Sonidos ambientales de oficina (volumen muy bajo) ──

  /**
   * Impresora: ruido de banda (noise filtrado)
   * Simula el mecanismo de arrastre de papel.
   */
  printer() {
    try {
      const ac   = getAudioCtx();
      const buf  = ac.createBuffer(1, ac.sampleRate * 0.4, ac.sampleRate);
      const data = buf.getChannelData(0);
      for (let i=0; i<data.length; i++) data[i] = (Math.random()*2-1) * 0.35;
      const src    = ac.createBufferSource();
      const filter = ac.createBiquadFilter();
      const gain   = ac.createGain();
      src.buffer = buf;
      filter.type            = "bandpass";
      filter.frequency.value = 600;
      filter.Q.value         = 0.8;
      src.connect(filter); filter.connect(gain); gain.connect(ac.destination);
      gain.gain.setValueAtTime(0.07, ac.currentTime);
      gain.gain.linearRampToValueAtTime(0, ac.currentTime+0.35);
      src.start(); src.stop(ac.currentTime+0.4);
    } catch(e) {}
  },

  /**
   * Teclado lejano: ráfaga de clics cortos a frecuencias random,
   * muy atenuados para simular distancia.
   */
  keyboard() {
    try {
      const ac  = getAudioCtx();
      const count = 4 + Math.floor(Math.random()*5);
      for (let i=0; i<count; i++) {
        const delay = i * (0.04 + Math.random()*0.06);
        const osc   = ac.createOscillator();
        const gain  = ac.createGain();
        osc.connect(gain); gain.connect(ac.destination);
        osc.type = "square";
        osc.frequency.value = 800 + Math.random()*400;
        const t = ac.currentTime + delay;
        gain.gain.setValueAtTime(0.04, t);
        gain.gain.exponentialRampToValueAtTime(0.0001, t+0.03);
        osc.start(t); osc.stop(t+0.04);
      }
    } catch(e) {}
  },

  /**
   * Ventilación: ruido blanco muy suave y breve,
   * filtro pasa-bajos para textura de zumbido de fondo.
   */
  ventilation() {
    try {
      const ac   = getAudioCtx();
      const dur  = 1.2;
      const buf  = ac.createBuffer(1, ac.sampleRate*dur, ac.sampleRate);
      const data = buf.getChannelData(0);
      for (let i=0; i<data.length; i++) data[i] = (Math.random()*2-1);
      const src    = ac.createBufferSource();
      const filter = ac.createBiquadFilter();
      const gain   = ac.createGain();
      src.buffer = buf;
      filter.type            = "lowpass";
      filter.frequency.value = 180;
      src.connect(filter); filter.connect(gain); gain.connect(ac.destination);
      gain.gain.setValueAtTime(0, ac.currentTime);
      gain.gain.linearRampToValueAtTime(0.055, ac.currentTime+0.3);
      gain.gain.linearRampToValueAtTime(0.055, ac.currentTime+dur-0.3);
      gain.gain.linearRampToValueAtTime(0, ac.currentTime+dur);
      src.start(); src.stop(ac.currentTime+dur);
    } catch(e) {}
  },

  /**
   * Hojas de papel: ruido blanco en ráfaga muy breve,
   * filtro de alta frecuencia para simular el roce del papel.
   */
  papers() {
    try {
      const ac   = getAudioCtx();
      const dur  = 0.25;
      const buf  = ac.createBuffer(1, ac.sampleRate*dur, ac.sampleRate);
      const data = buf.getChannelData(0);
      for (let i=0; i<data.length; i++) data[i] = (Math.random()*2-1);
      const src    = ac.createBufferSource();
      const filter = ac.createBiquadFilter();
      const gain   = ac.createGain();
      src.buffer = buf;
      filter.type            = "highpass";
      filter.frequency.value = 3000;
      src.connect(filter); filter.connect(gain); gain.connect(ac.destination);
      gain.gain.setValueAtTime(0.06, ac.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime+dur);
      src.start(); src.stop(ac.currentTime+dur);
    } catch(e) {}
  },
};

// Música de fondo
let bgMusicNodes   = [];
let bgMusicPlaying = false;
let bgMusicNextTime= 0;
const BG_SCALE     = [130,146,164,174,196,220,246];

function startBGMusic() {
  if (bgMusicPlaying) return;
  bgMusicPlaying  = true;
  bgMusicNextTime = getAudioCtx().currentTime;
  scheduleBGMusic();
}
function stopBGMusic() {
  bgMusicPlaying = false;
  bgMusicNodes.forEach(n => { try { n.stop(); } catch(e){} });
  bgMusicNodes = [];
}
function scheduleBGMusic() {
  if (!bgMusicPlaying) return;
  const ac      = getAudioCtx();
  const pattern = [0,0,2,4,5,5,4,2];
  const noteLen = 0.18;
  const gap     = 0.02;
  pattern.forEach((deg, i) => {
    const freq = BG_SCALE[deg % BG_SCALE.length] *
                 (state?.auditor?.mode === "chase" ? 2 : 1);
    const t    = bgMusicNextTime + i*(noteLen+gap);
    const osc  = ac.createOscillator();
    const gain = ac.createGain();
    osc.connect(gain); gain.connect(ac.destination);
    osc.type = "square";
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0.07, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t+noteLen);
    osc.start(t); osc.stop(t+noteLen+0.05);
    bgMusicNodes.push(osc);
  });
  bgMusicNextTime += pattern.length*(noteLen+gap);
  const lookahead = (bgMusicNextTime - ac.currentTime)*1000 - 50;
  setTimeout(scheduleBGMusic, Math.max(50, lookahead));
}

// ──────────────────────────────────────────────────────────────
// SONIDOS AMBIENTALES — scheduler independiente de la música
//
// Cada sonido tiene un intervalo mínimo y uno máximo (segundos).
// Se activan de forma aleatoria dentro de ese rango mientras el
// juego está en fase "play".  Volumen bajo para no competir con
// la música ni los SFX de gameplay.
// ──────────────────────────────────────────────────────────────

const AMBIENT_SOUNDS = [
  { fn: ()=>SFX.printer(),     minGap: 8,  maxGap: 18, nextIn: 6  },
  { fn: ()=>SFX.keyboard(),    minGap: 5,  maxGap: 12, nextIn: 3  },
  { fn: ()=>SFX.ventilation(), minGap: 14, maxGap: 28, nextIn: 10 },
  { fn: ()=>SFX.papers(),      minGap: 7,  maxGap: 16, nextIn: 5  },
];

/**
 * Avanza los timers de sonidos ambientales.
 * Llamar desde update(dt) solo cuando phase==="play".
 * @param {number} dt - delta time en segundos
 */
function updateAmbientAudio(dt) {
  for (const s of AMBIENT_SOUNDS) {
    s.nextIn -= dt;
    if (s.nextIn <= 0) {
      s.fn();
      // Programar la siguiente reproducción con intervalo aleatorio
      s.nextIn = s.minGap + Math.random() * (s.maxGap - s.minGap);
    }
  }
}

/** Reinicia los timers al comenzar una partida */
function resetAmbientAudio() {
  for (const s of AMBIENT_SOUNDS) {
    s.nextIn = s.minGap * 0.3 + Math.random() * s.minGap;
  }
}

// ──────────────────────────────────────────────
// 7. MAPA
// 0=suelo libre  1=pared  2=escritorio
// 3=archivador   4=impresora  5=planta
// ──────────────────────────────────────────────
const MAP_LAYOUT = [
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  [1,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,2,2,0,0,2,2,0,0,1,0,0,2,2,0,0,2,2,0,0,0,3,0,1],
  [1,0,2,2,0,0,2,2,0,0,1,0,0,2,2,0,0,2,2,0,0,0,3,0,1],
  [1,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,0,0,4,0,0,0,0,0,1,0,0,0,4,0,0,0,0,0,5,0,0,0,1],
  [1,0,2,2,0,0,2,2,0,0,1,0,0,2,2,0,0,2,2,0,0,0,0,0,1],
  [1,0,2,2,0,0,2,2,0,0,1,0,0,2,2,0,0,2,2,0,0,0,3,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,2,2,0,0,2,2,0,0,1,0,0,2,2,0,0,2,2,0,0,0,0,0,1],
  [1,0,2,2,0,0,2,2,0,0,1,0,0,2,2,0,0,2,2,0,0,0,3,0,1],
  [1,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,0,0,5,0,0,0,0,0,1,0,0,0,0,0,4,0,0,0,0,0,0,0,1],
  [1,0,2,2,0,0,2,2,0,0,1,0,0,2,2,0,0,2,2,0,0,0,0,0,1],
  [1,0,2,2,0,0,2,2,0,0,1,0,0,2,2,0,0,2,2,0,0,0,3,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
];

function getFreeTiles() {
  const free = [];
  for (let r=0; r<MAP_ROWS; r++)
    for (let c=0; c<MAP_COLS; c++)
      if (MAP_LAYOUT[r][c] === 0) free.push({col:c, row:r});
  return free;
}

function isSolid(col, row) {
  if (row<0||row>=MAP_ROWS||col<0||col>=MAP_COLS) return true;
  return MAP_LAYOUT[row][col] !== 0;
}

// ──────────────────────────────────────────────
// 8. RAYCASTING — hasLineOfSight
// ──────────────────────────────────────────────
const LOS_BLOCKING = new Set([1,2,3,4]);
const LOS_STEP_PX  = TILE / 2;

let losCache    = null;
let losCacheTTL = 0;
const LOS_TTL   = 0.05;

/**
 * Recorre la línea entre (x1,y1)→(x2,y2) en pasos de TILE/2 px.
 * Devuelve false si algún tile bloqueante la intersecta, true si está libre.
 */
function hasLineOfSight(x1, y1, x2, y2) {
  const dx    = x2-x1, dy = y2-y1;
  const dist  = Math.hypot(dx,dy);
  if (dist < TILE) return true;
  const ux = dx/dist, uy = dy/dist;
  const steps = Math.ceil(dist/LOS_STEP_PX);
  for (let i=1; i<steps; i++) {
    const sx = x1 + ux*LOS_STEP_PX*i;
    const sy = y1 + uy*LOS_STEP_PX*i;
    const tc = Math.floor(sx/TILE);
    const tr = Math.floor(sy/TILE);
    if (tr<0||tr>=MAP_ROWS||tc<0||tc>=MAP_COLS) return false;
    if (LOS_BLOCKING.has(MAP_LAYOUT[tr][tc])) return false;
  }
  return true;
}

/** Combina distancia + LOS con caché de 50 ms. */
function canAuditorSeePlayer() {
  const a    = state.auditor;
  const audCX = a.x+a.w/2, audCY = a.y+a.h/2;
  const plCX  = state.player.x+state.player.w/2;
  const plCY  = state.player.y+state.player.h/2;
  if (Math.hypot(plCX-audCX, plCY-audCY) > a.visionRange) return false;
  if (losCache !== null && losCacheTTL > 0) return losCache;
  losCache    = hasLineOfSight(audCX, audCY, plCX, plCY);
  losCacheTTL = LOS_TTL;
  return losCache;
}

// ──────────────────────────────────────────────
// 9. ESTADO GLOBAL & INPUT
// ──────────────────────────────────────────────
let state      = {};
let gameLoopId = null;
let lastTime   = 0;

const keys = {};
document.addEventListener("keydown", e => {
  keys[e.code] = true;
  if (e.code === "Escape") {
    if (state.phase === "play") togglePause();
    else if (state.phase === "paused") togglePause();
    return;
  }
  // Recoger documento con E o Espacio (solo en fase "play")
  if ((e.code === "KeyE" || e.code === "Space") && state.phase === "play") {
    tryPickup();
  }
});
document.addEventListener("keyup", e => { keys[e.code] = false; });

// ──────────────────────────────────────────────
// 10. PANTALLAS
// ──────────────────────────────────────────────
function showScreen(name) {
  [screenStart, screenGame, screenGameover, screenWin, screenPause]
    .forEach(s => s.classList.remove("active"));
  document.getElementById("screen-"+name).classList.add("active");
}

function togglePause() {
  if (state.phase === "paused") {
    state.phase = "play";
    screenPause.classList.remove("active");
    lastTime   = performance.now();
    gameLoopId = requestAnimationFrame(gameLoop);
  } else {
    state.phase = "paused";
    cancelAnimationFrame(gameLoopId);
    screenPause.classList.add("active");
    stopBGMusic();
  }
}

// ──────────────────────────────────────────────
// 11. INICIAR JUEGO
// ──────────────────────────────────────────────
function startGame() {
  resizeCanvas();
  stopBGMusic();
  losCache = null; losCacheTTL = 0;

  // ── Distribuir documentos en tiles libres ──
  const freeTiles = shuffle(getFreeTiles());
  // Excluir tile de inicio del jugador
  const safeStart = {col:4, row:4};
  const docTiles  = freeTiles.filter(
    t => !(t.col===safeStart.col && t.row===safeStart.row)
  ).slice(0, TOTAL_DOCS);

  // Asignar tipos cíclicamente y mezclarlos
  const docs = shuffle(docTiles.map((t, i) => ({
    col:       t.col,
    row:       t.row,
    def:       DOC_DEFS[i % DOC_DEFS.length],   // referencia al DOC_DEF
    collected: false,
    bobOffset: Math.random() * Math.PI * 2,
  })));

  // ── Distribuir power-ups en tiles libres (distintos de los docs) ──
  const usedSet = new Set(docs.map(d => `${d.col},${d.row}`));
  const puTiles = freeTiles.filter(t => !usedSet.has(`${t.col},${t.row}`));
  const powerups = [];
  let puIdx = 0;
  for (const puDef of POWERUP_DEFS) {
    for (let k=0; k<puDef.count && puIdx<puTiles.length; k++, puIdx++) {
      powerups.push({
        col:       puTiles[puIdx].col,
        row:       puTiles[puIdx].row,
        def:       puDef,
        collected: false,
        bobOffset: Math.random()*Math.PI*2,
      });
    }
  }

  // ── Ruta de patrulla corregida — waypoints en tiles de suelo libre ──
  const patrolRoute = [
    {col:4, row:4},
    {col:8, row:4},
    {col:8, row:8},
    {col:12,row:8},
    {col:16,row:8},
    {col:21,row:8},
    {col:21,row:16},
    {col:12,row:16},
    {col:4, row:16},
    {col:4, row:9},
  ];

  // ── Elegir primer objetivo ──
  const firstTarget = pickNewTarget(docs, null);

  state = {
    phase:         "play",
    timer:         GAME_DURATION,
    timerAcc:      0,
    score:         0,
    suspicion:     0,
    suspAcc:       0,
    docsCollected: 0,
    elapsed:       0,

    // Objetivo actual: id del DOC_DEF que el jugador debe buscar
    targetId: firstTarget,

    docs,
    powerups,

    // ── Cámara ──
    cam: { x:0, y:0, shake:0, shakeX:0, shakeY:0 },

    // ── Jugador ──
    player: {
    x: 4*TILE, y: 4*TILE,
      baseSpeed: 120,
      speed:     120,
      w: TILE-4, h: TILE-4,
      facing:    "down",
      walkCycle: 0,
      moving:    false,
      stepAcc:   0,
      // Power-up café
      coffeeTimer: 0,
    },

    // ── Auditor ──
    auditor: {
      x:          21*TILE,
      y:          16*TILE,
      w:          TILE-4,
      h:          TILE-4,
      patrolRoute,
      patrolIdx:  0,
      walkCycle:  0,
      mode:       "patrol",      // "patrol" | "chase"
      chaseTimeout: 0,
      alertScale: 0,
      alertAcc:   0,
      touchCooldown: 0,
      visionRange: VISION_RANGE_PATROL,
      // Anti-atasco
      stuckAcc:     0,           // acumulador de tiempo sin avanzar
      lastX:        21*TILE,     // posición en último chequeo de atasco
      lastY:        16*TILE,
      // Power-up clips
      clipsTimer:   0,
    },

    // ── Efectos ──
    particles:  [],
    flashColor: null,
    flashAcc:   0,
    hudFlashAcc:0,

    // Mensaje de feedback en pantalla (correcto/incorrecto)
    feedbackMsg:   "",
    feedbackTimer: 0,
    feedbackColor: "#fff",

    // ── Ambiente — v5 ──
    // Estado de la animación de la oficina.
    // Se inicializa aquí para que sea coherente entre partidas.
    ambience: {
      // Partículas de polvo ambiental (pool de 20 max)
      dustParticles: initDustParticles(),
    },
  };

  showScreen("game");
  screenPause.classList.remove("active");

  if (gameLoopId) cancelAnimationFrame(gameLoopId);
  lastTime = performance.now();
  resetAmbientAudio();
  startBGMusic();
  gameLoop(lastTime);
}

/**
 * Elige un nuevo targetId aleatorio entre los documentos no recogidos.
 * @param {Array} docs     - lista de documentos
 * @param {string} current - id actual (para no repetir si hay más opciones)
 * @returns {string|null}
 */
function pickNewTarget(docs, current) {
  const pending = docs.filter(d => !d.collected);
  if (pending.length === 0) return null;
  // Reunir ids disponibles (sin duplicar)
  const ids = [...new Set(pending.map(d => d.def.id))];
  if (ids.length > 1) {
    const filtered = ids.filter(id => id !== current);
    return filtered[Math.floor(Math.random()*filtered.length)];
  }
  return ids[0];
}

// ──────────────────────────────────────────────
// 12. GAME LOOP
// ──────────────────────────────────────────────
function gameLoop(ts) {
  const dt = Math.min((ts-lastTime)/1000, 0.05);
  lastTime = ts;

  if (state.phase === "play") {
    update(dt);
    updateCamera(dt);
    draw();
    updateHUD();
  }

  gameLoopId = requestAnimationFrame(gameLoop);
}

// ──────────────────────────────────────────────
// 13. UPDATE
// ──────────────────────────────────────────────
function update(dt) {
  state.elapsed += dt;
  updateTimer(dt);
  updatePlayer(dt);
  updateAuditor(dt);
  updateSuspicion(dt);
  updateParticles(dt);
  updateFeedback(dt);
  updateAmbientAudio(dt);    // ← v5: sonidos ambientales ocasionales
  updateOfficeAmbience(dt);  // ← v5: partículas de polvo ambiental
  checkWin();
}

// ── Temporizador ──
function updateTimer(dt) {
  state.timerAcc += dt;
  if (state.timerAcc >= 1) {
    state.timerAcc -= 1;
    state.timer--;
    if (state.timer <= 0) triggerGameOver();
  }
}

// ── Jugador ──
function updatePlayer(dt) {
  const p = state.player;

  // Power-up café: descontar tiempo
  if (p.coffeeTimer > 0) {
    p.coffeeTimer -= dt;
    if (p.coffeeTimer <= 0) {
      p.coffeeTimer = 0;
      p.speed = p.baseSpeed;
    }
  }

  // ── Entrada combinada: teclado + joystick táctil ──
  // Ambas fuentes son aditivas: si el jugador usa teclado en desktop
  // no hay interferencia con touchInput (siempre en 0,0).
  let dx = 0, dy = 0;

  // ── Teclado (desktop, sin cambios respecto a versiones anteriores) ──
  if (keys["ArrowUp"]    || keys["KeyW"]) { dy -= 1; p.facing = "up"; }
  if (keys["ArrowDown"]  || keys["KeyS"]) { dy += 1; p.facing = "down"; }
  if (keys["ArrowLeft"]  || keys["KeyA"]) { dx -= 1; p.facing = "left"; }
  if (keys["ArrowRight"] || keys["KeyD"]) { dx += 1; p.facing = "right"; }

  // ── Joystick táctil (móvil) ──
  // touchInput.dx/dy ya están normalizados a -1..1 por el handler.
  // Solo se aplican si el joystick está activo (no interfieren en desktop).
  if (touchInput.active) {
    dx += touchInput.dx;
    dy += touchInput.dy;
    // Actualizar facing según la dirección predominante del joystick
    if (Math.abs(touchInput.dy) >= Math.abs(touchInput.dx)) {
      p.facing = touchInput.dy < 0 ? "up" : "down";
    } else {
      p.facing = touchInput.dx < 0 ? "left" : "right";
    }
  }

  // Normalizar diagonal (teclado + joystick pueden acumularse)
  const mag = Math.hypot(dx, dy);
  if (mag > 1) { dx /= mag; dy /= mag; }

  const nx = p.x + dx * p.speed * dt;
  const ny = p.y + dy * p.speed * dt;
  if (!collidesTile(nx, p.y, p.w, p.h)) p.x = nx;
  if (!collidesTile(p.x, ny, p.w, p.h)) p.y = ny;

  p.moving = mag > 0.05;

  if (p.moving) {
    p.walkCycle += dt * 8;
    p.stepAcc   += dt;
    if (p.stepAcc > 0.28) { p.stepAcc = 0; SFX.step(); }
  } else {
    p.walkCycle *= 0.85;
    p.stepAcc    = 0;
  }
}

// Colisión con tiles sólidos
function collidesTile(px, py, pw, ph) {
  const m=3;
  const l=Math.floor((px+m)/TILE),   r=Math.floor((px+pw-m-1)/TILE);
  const t=Math.floor((py+m)/TILE),   b=Math.floor((py+ph-m-1)/TILE);
  for (let row=t; row<=b; row++)
    for (let col=l; col<=r; col++)
      if (isSolid(col,row)) return true;
  return false;
}

// ── Auditor ──
function updateAuditor(dt) {
  const a = state.auditor;

  // Power-up clips: ralentiza al auditor
  const effectiveSpeed = a.clipsTimer > 0
    ? (a.mode==="chase" ? AUDITOR_CHASE_SPEED*0.45 : AUDITOR_PATROL_SPEED*0.45)
    : (a.mode==="chase" ? AUDITOR_CHASE_SPEED      : AUDITOR_PATROL_SPEED);

  if (a.clipsTimer > 0) a.clipsTimer -= dt;

  // Decrementar caché de LOS
  if (losCacheTTL > 0) losCacheTTL -= dt;
  else losCache = null;

  const audCX = a.x+a.w/2, audCY = a.y+a.h/2;
  const plCX  = state.player.x+state.player.w/2;
  const plCY  = state.player.y+state.player.h/2;
  const distPlayer = Math.hypot(plCX-audCX, plCY-audCY);

  const canSee = canAuditorSeePlayer();

  // Transición patrol → chase
  if (canSee && a.mode==="patrol") {
    a.mode         = "chase";
    a.chaseTimeout = CHASE_TIMEOUT;
    a.visionRange  = VISION_RANGE_CHASE;
    SFX.alert();
    triggerShake(5);
    state.flashColor = "rgba(255,68,68,0.22)";
    state.flashAcc   = 0.4;
  }

  if (a.mode === "chase") {
    if (canSee) {
      a.chaseTimeout = CHASE_TIMEOUT;
      addSuspicion(18*dt);
    } else {
      a.chaseTimeout -= dt;
      if (a.chaseTimeout <= 0) {
        a.mode        = "patrol";
        a.visionRange = VISION_RANGE_PATROL;
        losCache      = null;
      }
    }
    a.alertScale = Math.min(1.4, a.alertScale+dt*6);
    moveToward(a, plCX-a.w/2, plCY-a.h/2, effectiveSpeed, dt);

    // Toque físico
    if (distPlayer < CHASE_TOUCH_RANGE && a.touchCooldown <= 0) {
      addSuspicion(40);
      a.touchCooldown  = 1.5;
      triggerShake(8);
      SFX.touch();
      state.flashColor = "rgba(255,0,0,0.38)";
      state.flashAcc   = 0.5;
    }
    state.hudFlashAcc += dt;

  } else {
    // ── PATRULLA ──
    a.alertScale      = Math.max(0, a.alertScale-dt*4);
    a.alertAcc        = 0;
    state.hudFlashAcc = 0;

    const wp   = a.patrolRoute[a.patrolIdx];
    const tx   = wp.col*TILE + TILE/2 - a.w/2;
    const ty   = wp.row*TILE + TILE/2 - a.h/2;
    const dist = Math.hypot(tx-a.x, ty-a.y);

    if (dist < 6) {
      // Llegó al waypoint → siguiente, reiniciar anti-atasco
      a.patrolIdx = (a.patrolIdx+1) % a.patrolRoute.length;
      a.stuckAcc  = 0;
      a.lastX = a.x; a.lastY = a.y;
    } else {
      moveToward(a, tx, ty, effectiveSpeed, dt);

      // ── Anti-atasco: si no avanza lo suficiente, salta al siguiente wp ──
      a.stuckAcc += dt;
      if (a.stuckAcc >= STUCK_THRESHOLD) {
        const moved = Math.hypot(a.x-a.lastX, a.y-a.lastY);
        if (moved < STUCK_MIN_DIST) {
          // Atascado: salta al siguiente waypoint
          a.patrolIdx = (a.patrolIdx+1) % a.patrolRoute.length;
        }
        a.stuckAcc = 0;
        a.lastX = a.x; a.lastY = a.y;
      }
    }

    // Detectar documentos en rango (sin LOS — lo "huele")
    let nearDoc = false;
    for (const doc of state.docs) {
      if (doc.collected) continue;
      if (Math.hypot(doc.col*TILE+TILE/2-audCX, doc.row*TILE+TILE/2-audCY) < a.visionRange) {
        nearDoc = true; break;
      }
    }
    if (nearDoc) {
      a.alertAcc += dt;
      if (a.alertAcc > 0.5) addSuspicion(6*dt);
    } else {
      a.alertAcc = Math.max(0, a.alertAcc-dt);
    }
  }

  if (a.touchCooldown > 0) a.touchCooldown -= dt;
  a.walkCycle = (a.walkCycle||0) + dt*(a.mode==="chase"?12:6);
}

function moveToward(entity, tx, ty, speed, dt) {
  const ddx=tx-entity.x, ddy=ty-entity.y;
  const d=Math.hypot(ddx,ddy);
  if (d<2) return;
  const nx=entity.x+(ddx/d)*speed*dt;
  const ny=entity.y+(ddy/d)*speed*dt;
  if (!collidesTile(nx, entity.y, entity.w, entity.h)) entity.x=nx;
  if (!collidesTile(entity.x, ny, entity.w, entity.h)) entity.y=ny;
}

// ── Sospecha pasiva ──
function updateSuspicion(dt) {
  state.suspAcc += dt;
  if (state.suspAcc > 5) { state.suspAcc-=5; addSuspicion(1); }
}
function addSuspicion(v) {
  state.suspicion = Math.min(MAX_SUSPICION, state.suspicion+v);
  if (state.suspicion >= MAX_SUSPICION) triggerGameOver();
}
function reduceSuspicion(v) {
  state.suspicion = Math.max(0, state.suspicion-v);
}

// ── Partículas ──
function updateParticles(dt) {
  for (let i=state.particles.length-1; i>=0; i--) {
    const p=state.particles[i];
    p.x+=p.vx*dt; p.y+=p.vy*dt; p.vy+=120*dt; p.life-=dt;
    if (p.life<=0) state.particles.splice(i,1);
  }
}
function spawnParticles(x, y, color, count=8) {
  for (let i=0;i<count;i++) {
    const a=(Math.PI*2*i/count)+Math.random()*0.5;
    const s=60+Math.random()*80;
    state.particles.push({
      x, y, vx:Math.cos(a)*s, vy:Math.sin(a)*s-40,
      life:0.5+Math.random()*0.4, maxLife:1,
      color, size:3+Math.random()*3,
    });
  }
}

// ── Feedback en pantalla ──
function updateFeedback(dt) {
  if (state.feedbackTimer > 0) state.feedbackTimer -= dt;
}
function showFeedback(msg, color) {
  state.feedbackMsg   = msg;
  state.feedbackColor = color;
  state.feedbackTimer = 1.4;
}

// ── Victoria ──
function checkWin() {
  if (state.docs.every(d=>d.collected)) triggerWin();
}

// ── Camera shake ──
function triggerShake(intensity) {
  state.cam.shake = Math.max(state.cam.shake, intensity);
}

// ──────────────────────────────────────────────
// 14. CÁMARA
// ──────────────────────────────────────────────
function updateCamera(dt) {
  const cam = state.cam;
  const p   = state.player;
  const vw  = canvas.width;
  const vh  = canvas.height;

  const tx = p.x + p.w/2 - vw/2;
  const ty = p.y + p.h/2 - vh/2;

  const maxX = MAP_COLS*TILE - vw;
  const maxY = MAP_ROWS*TILE - vh;

  const cx = Math.max(0, Math.min(maxX, tx));
  const cy = Math.max(0, Math.min(maxY, ty));

  cam.x += (cx-cam.x) * Math.min(1, dt*10);
  cam.y += (cy-cam.y) * Math.min(1, dt*10);

  if (cam.shake > 0) {
    cam.shake  = Math.max(0, cam.shake-dt*18);
    cam.shakeX = (Math.random()*2-1)*cam.shake;
    cam.shakeY = (Math.random()*2-1)*cam.shake;
  } else {
    cam.shakeX = 0; cam.shakeY = 0;
  }
}

// ──────────────────────────────────────────────
// 15. INTERACCIÓN — RECOGER ITEMS
// ──────────────────────────────────────────────
function tryPickup() {
  const px = state.player.x + state.player.w/2;
  const py = state.player.y + state.player.h/2;
  const range = TILE*1.6;

  // ── Power-ups primero ──
  for (const pu of state.powerups) {
    if (pu.collected) continue;
    const dx = pu.col*TILE + TILE/2 - px;
    const dy = pu.row*TILE + TILE/2 - py;
    if (Math.hypot(dx,dy) < range) {
      collectPowerup(pu);
      return;
    }
  }

  // ── Documentos ──
  // Solo recoge el documento más cercano dentro del rango
  let closest = null, closestDist = range;
  for (const doc of state.docs) {
    if (doc.collected) continue;
    const dx = doc.col*TILE + TILE/2 - px;
    const dy = doc.row*TILE + TILE/2 - py;
    const d  = Math.hypot(dx,dy);
    if (d < closestDist) { closestDist=d; closest=doc; }
  }
  if (closest) {
    SFX.pickup();
    collectDoc(closest);
  }
}

function collectPowerup(pu) {
  pu.collected = true;
  SFX.powerup();
  spawnParticles(pu.col*TILE+TILE/2, pu.row*TILE+TILE/2, pu.def.color, 10);

  if (pu.def.id === "coffee") {
    state.player.coffeeTimer = pu.def.duration;
    state.player.speed = state.player.baseSpeed * 1.8;
    showFeedback("☕ ¡TURBO CAFÉ! +80% velocidad", "#ffcc44");
  } else if (pu.def.id === "clips") {
    state.auditor.clipsTimer = pu.def.duration;
    showFeedback("📎 ¡AUDITOR TRABADO! -55% velocidad", "#aaaaee");
  }
}

/**
 * Lógica de recolección de documento:
 * - Si coincide con el objetivo → correcto
 * - Si no coincide → incorrecto
 */
function collectDoc(doc) {
  if (doc.def.id === state.targetId) {
    // ── CORRECTO ──
    doc.collected = true;
    state.docsCollected++;
    state.score += 100;
    reduceSuspicion(10);
    SFX.correct();
    spawnParticles(doc.col*TILE+TILE/2, doc.row*TILE+TILE/2, doc.def.color, 12);
    showFeedback("✔ +" + doc.def.name + " ARCHIVADO! +100pts", doc.def.color);

    // Elegir nuevo objetivo
    state.targetId = pickNewTarget(state.docs, state.targetId);

  } else {
    // ── INCORRECTO ──
    addSuspicion(15);
    state.score = Math.max(0, state.score - 25);
    SFX.wrong();
    triggerShake(4);
    state.flashColor = "rgba(255,0,0,0.28)";
    state.flashAcc   = 0.4;
    showFeedback("✘ INCORRECTO —25pts +15 sospecha", "#ff5555");
  }
}

// ──────────────────────────────────────────────
// 16. GAME OVER / WIN
// ──────────────────────────────────────────────
function triggerGameOver() {
  if (state.phase==="gameover"||state.phase==="win") return;
  state.phase = "gameover";
  stopBGMusic(); SFX.gameover();
  document.getElementById("go-docs").textContent  = state.docsCollected;
  document.getElementById("go-score").textContent = state.score;
  setTimeout(() => showScreen("gameover"), 900);
}
function triggerWin() {
  if (state.phase==="win"||state.phase==="gameover") return;
  state.phase = "win";
  stopBGMusic(); SFX.win();
  document.getElementById("win-docs").textContent  = state.docsCollected;
  document.getElementById("win-score").textContent = state.score;
  setTimeout(() => showScreen("win"), 800);
}

// ──────────────────────────────────────────────
// 17. DIBUJO
// ──────────────────────────────────────────────
function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  // Aplicar cámara + shake
  ctx.translate(
    -Math.round(state.cam.x) + state.cam.shakeX,
    -Math.round(state.cam.y) + state.cam.shakeY
  );

  drawMap();
  drawAmbientParticles();    // ← v5: motas de polvo (encima del suelo, debajo de todo lo demás)
  drawAnimatedMonitors();    // ← v5: pantallas animadas de computadoras
  drawAnimatedPrinters();    // ← v5: papel expulsado + LEDs de impresoras
  drawAnimatedPlants();      // ← v5: hojas balanceándose
  drawPowerups();
  drawDocs();
  drawAuditor();
  drawPlayer();
  drawParticles();
  drawVisionCone();
  drawPickupHints();

  ctx.restore();

  // Cosas en espacio de pantalla (sin cámara)
  drawFlash();
  drawFeedbackMsg();
}

// ── Mapa ──
function drawMap() {
  // Solo renderizar tiles visibles en el viewport de la cámara
  const startC = Math.max(0, Math.floor(state.cam.x/TILE)-1);
  const endC   = Math.min(MAP_COLS-1, startC + Math.ceil(canvas.width/TILE)+2);
  const startR = Math.max(0, Math.floor(state.cam.y/TILE)-1);
  const endR   = Math.min(MAP_ROWS-1, startR + Math.ceil(canvas.height/TILE)+2);

  for (let r=startR; r<=endR; r++) {
    for (let c=startC; c<=endC; c++) {
      const x=c*TILE, y=r*TILE;
      switch(MAP_LAYOUT[r][c]) {
        case 0: drawFloor(x,y,r,c); break;
        case 1: drawWall(x,y);      break;
        case 2: drawDesk(x,y);      break;
        case 3: drawCabinet(x,y);   break;
        case 4: drawPrinter(x,y);   break;
        case 5: drawPlant(x,y);     break;
      }
    }
  }
}

function drawFloor(x,y,r,c) {
  ctx.fillStyle = (r+c)%2===0 ? C.floor : C.floorAlt;
  ctx.fillRect(x,y,TILE,TILE);
  // Luz fluorescente tenue en ciertas filas
  if (r%5===1) { ctx.fillStyle=C.light; ctx.fillRect(x,y,TILE,TILE); }
}
function drawWall(x,y) {
  ctx.fillStyle=C.wall; ctx.fillRect(x,y,TILE,TILE);
  ctx.fillStyle="#1a1a2e"; ctx.fillRect(x+2,y+2,TILE-4,TILE-4);
}
function drawDesk(x,y) {
  ctx.fillStyle=C.desk;    ctx.fillRect(x+1,y+4,TILE-2,TILE-5);
  ctx.fillStyle=C.deskTop; ctx.fillRect(x+2,y+5,TILE-4,8);
  ctx.fillStyle=C.computer;ctx.fillRect(x+6,y+6,10,8);
  ctx.fillStyle=C.screen;  ctx.fillRect(x+7,y+7,8,5);
  ctx.fillStyle="#000088";
  for(let i=0;i<3;i++) ctx.fillRect(x+8,y+8+i*1.5,4,1);
}
function drawCabinet(x,y) {
  ctx.fillStyle=C.cabinet; ctx.fillRect(x+3,y+2,TILE-6,TILE-4);
  ctx.fillStyle="#9999cc";
  ctx.fillRect(x+TILE/2-3,y+8,6,3); ctx.fillRect(x+TILE/2-3,y+18,6,3); ctx.fillRect(x+TILE/2-3,y+26,6,3);
  ctx.fillStyle="#55559a"; ctx.fillRect(x+3,y+2,TILE-6,3);
}
function drawPrinter(x,y) {
  ctx.fillStyle=C.printer; ctx.fillRect(x+2,y+6,TILE-4,TILE-10);
  ctx.fillStyle="#777799"; ctx.fillRect(x+3,y+7,TILE-6,6);
  ctx.fillStyle="#fff";    ctx.fillRect(x+8,y+4,12,4);
  ctx.fillStyle="#ccc";    ctx.fillRect(x+9,y+5,6,1); ctx.fillRect(x+9,y+7,8,1);
}
function drawPlant(x,y) {
  ctx.fillStyle="#7b4c1e"; ctx.fillRect(x+10,y+22,12,8);
  ctx.fillStyle=C.plant;   ctx.fillRect(x+8,y+12,16,12);
  ctx.fillStyle=C.leaf;    ctx.fillRect(x+10,y+8,12,6);
  ctx.fillRect(x+6,y+16,8,4); ctx.fillRect(x+18,y+16,8,4);
}

// ── Power-ups ──
function drawPowerups() {
  const t = state.elapsed;
  for (const pu of state.powerups) {
    if (pu.collected) continue;
    const bx = pu.col*TILE;
    const by = pu.row*TILE + Math.sin(t*4+pu.bobOffset)*3;

    // Sombra
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(bx+6, by+24, 20, 4);

    ctx.save();
    ctx.translate(bx+TILE/2, by+TILE/2);

    if (pu.def.id === "coffee") {
      // Taza de café
      ctx.fillStyle = pu.def.dark;
      ctx.fillRect(-8,-8,16,14);
      ctx.fillStyle = pu.def.color;
      ctx.fillRect(-7,-7,14,12);
      // Café interior oscuro
      ctx.fillStyle = "#5c2800";
      ctx.fillRect(-5,-5,10,8);
      // Humo ondulante
      const smk = Math.sin(t*6+pu.bobOffset)*2;
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.fillRect(-2-smk, -12, 2, 4);
      ctx.fillRect( 1+smk, -14, 2, 4);
      // asa
      ctx.fillStyle = pu.def.dark;
      ctx.fillRect(8,-4,3,8);
    } else {
      // Clips (📎) — representados como pequeño montón de clips
      ctx.fillStyle = pu.def.dark;
      ctx.fillRect(-8,-8,16,16);
      ctx.fillStyle = pu.def.color;
      // 3 clips superpuestos
      for (let k=0; k<3; k++) {
        ctx.fillRect(-5+k*2, -5+k*2, 10, 3);
        ctx.fillRect(-5+k*2,  0+k*2, 10, 3);
        ctx.fillRect(-5+k*2, -5+k*2, 3, 11);
      }
    }
    ctx.restore();

    // Label
    ctx.fillStyle = pu.def.color;
    ctx.font = "bold 6px monospace";
    ctx.textAlign = "center";
    ctx.fillText(pu.def.id==="coffee"?"CAFÉ":"CLIPS", bx+TILE/2, by+TILE+2);
  }
}

// ── Documentos — con identidad visual clara por tipo ──
function drawDocs() {
  const t = state.elapsed;
  for (const doc of state.docs) {
    if (doc.collected) continue;
    const bx  = doc.col*TILE;
    const by  = doc.row*TILE + Math.sin(t*3+doc.bobOffset)*2;
    const def = doc.def;
    // Resaltar el documento objetivo con un aura pulsante
    const isTarget = (def.id === state.targetId);

    if (isTarget) {
      const aura = 0.3 + Math.sin(t*5)*0.25;
      ctx.save();
      ctx.shadowColor = def.color;
      ctx.shadowBlur  = 12;
      ctx.fillStyle   = `rgba(${hexToRgb(def.color)},${aura})`;
      ctx.fillRect(bx, by, TILE, TILE);
      ctx.restore();
    }

    // Sombra base
    ctx.fillStyle = C.shadow;
    ctx.fillRect(bx+5, by+23, 22, 4);

    ctx.save();
    ctx.translate(bx+TILE/2, by+TILE/2);

    drawDocShape(def);

    ctx.restore();

    // Nombre corto abajo
    ctx.fillStyle = isTarget ? def.color : "#ccccaa";
    ctx.font      = "bold 5px monospace";
    ctx.textAlign = "center";
    ctx.fillText(def.name, bx+TILE/2, by+TILE+2);
  }
}

/**
 * Dibuja la forma característica de cada tipo de documento.
 * Llamar con ctx ya trasladado al centro del tile.
 */
function drawDocShape(def) {
  switch(def.shape) {

    case "rect": // Factura — papel amarillo estándar
      ctx.fillStyle = def.dark;
      ctx.fillRect(-9,-12,18,22);
      ctx.fillStyle = def.color;
      ctx.fillRect(-8,-11,16,20);
      ctx.fillStyle = def.dark;
      for(let i=0;i<4;i++) ctx.fillRect(-5,-6+i*4,10,2);
      // Icono
      ctx.font = "bold 9px monospace";
      ctx.fillStyle = def.dark;
      ctx.textAlign = "center";
      ctx.fillText(def.icon, 4, -3);
      break;

    case "wide": // Nómina — más ancho, verde
      ctx.fillStyle = def.dark;
      ctx.fillRect(-12,-8,24,18);
      ctx.fillStyle = def.color;
      ctx.fillRect(-11,-7,22,16);
      // Columnas de números
      ctx.fillStyle = def.dark;
      ctx.fillRect(-9,-4,6,8);
      ctx.fillRect(-1,-4,6,8);
      ctx.fillRect(5,-4,4,8);
      ctx.font = "bold 9px monospace";
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.fillText(def.icon, 0, 4);
      break;

    case "tall": // Impuesto — más alto, rojo
      ctx.fillStyle = def.dark;
      ctx.fillRect(-7,-14,14,28);
      ctx.fillStyle = def.color;
      ctx.fillRect(-6,-13,12,26);
      // Línea de datos
      ctx.fillStyle = def.dark;
      for(let i=0;i<5;i++) ctx.fillRect(-4,-8+i*5,8,2);
      ctx.font = "bold 10px monospace";
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.fillText(def.icon, 0, 8);
      break;

    case "scroll": // Contrato — pergamino con bordes curvos simulados
      ctx.fillStyle = def.dark;
      ctx.fillRect(-8,-13,16,26);
      ctx.fillStyle = def.color;
      ctx.fillRect(-7,-12,14,24);
      // Bordes de pergamino (óvalos en top/bottom)
      ctx.fillStyle = def.dark;
      ctx.fillRect(-9,-14,18,4);
      ctx.fillRect(-9, 10,18,4);
      ctx.fillStyle = "#d4b8ff";
      ctx.fillRect(-9,-14,18,2);
      ctx.fillRect(-9, 12,18,2);
      // Líneas de texto
      ctx.fillStyle = def.dark;
      for(let i=0;i<4;i++) ctx.fillRect(-5,-8+i*5,10,2);
      ctx.font = "bold 10px monospace";
      ctx.fillStyle = def.dark;
      ctx.textAlign = "center";
      ctx.fillText(def.icon, 0, 6);
      break;

    case "diamond": // Bancario — forma de diamante (rotado 45°)
      ctx.save();
      ctx.rotate(Math.PI/4);
      ctx.fillStyle = def.dark;
      ctx.fillRect(-9,-9,18,18);
      ctx.fillStyle = def.color;
      ctx.fillRect(-8,-8,16,16);
      ctx.restore();
      ctx.font = "bold 10px monospace";
      ctx.fillStyle = def.dark;
      ctx.textAlign = "center";
      ctx.fillText(def.icon, 0, 4);
      break;
  }
}

// ── Jugador (pixel art con animación de pasos fluida) ──
function drawPlayer() {
  const p    = state.player;
  const cx   = p.x+p.w/2;
  const cy   = p.y+p.h/2;
  const sway = Math.sin(p.walkCycle)*(p.moving?2.5:0);
  const legL = Math.max(0, Math.sin(p.walkCycle))*(p.moving?3:0);
  const legR = Math.max(0,-Math.sin(p.walkCycle))*(p.moving?3:0);
  const armS = Math.cos(p.walkCycle)*(p.moving?3:0);

  // Tinte de velocidad si café activo
  const hasCoffee = p.coffeeTimer > 0;

  ctx.save();
  ctx.translate(cx, cy+sway*0.3);

  // Sombra
  ctx.fillStyle = C.shadow;
  ctx.fillRect(-p.w/2+2, p.h/2-2, p.w-4, 6);

  // Piernas
  ctx.fillStyle = "#1a4a2a";
  ctx.fillRect(-5, 4-legL, 5, 10+legL);
  ctx.fillRect( 0, 4-legR, 5, 10+legR);

  // Cuerpo
  ctx.fillStyle = p.playerDk || C.playerDk;
  ctx.fillRect(-p.w/2, -p.h/2+2, p.w, p.h-6);
  ctx.fillStyle = hasCoffee ? "#88ffaa" : C.player;
  ctx.fillRect(-p.w/2+1, -p.h/2+1, p.w-2, p.h-8);
  // Camisa
  ctx.fillStyle = hasCoffee ? "#55ff88" : "#00cc50";
  ctx.fillRect(-p.w/2+3, -p.h/2+8, p.w-6, 8);

  // Brazos
  ctx.fillStyle = C.playerDk;
  ctx.fillRect(-p.w/2-3, -p.h/2+6+armS, 4, 8);
  ctx.fillRect( p.w/2-1, -p.h/2+6-armS, 4, 8);

  // Cabeza
  ctx.fillStyle = "#f4c06f";
  ctx.fillRect(-6, -p.h/2-6, 12, 12);
  // Ojos según dirección
  ctx.fillStyle = "#333";
  if (p.facing==="down"||p.facing==="up") {
    ctx.fillRect(-4,-p.h/2-2,3,3); ctx.fillRect(1,-p.h/2-2,3,3);
  } else {
    ctx.fillRect(p.facing==="right"?2:-5, -p.h/2-2, 3, 3);
  }

  // Ícono café si activo
  if (hasCoffee) {
    ctx.font = "8px serif";
    ctx.textAlign = "center";
    ctx.fillText("☕", 0, -p.h/2-10);
  }

  ctx.restore();
}

// ── Auditor ──
function drawAuditor() {
  const a = state.auditor;
  const cx = a.x+a.w/2, cy = a.y+a.h/2;
  const isChase  = a.mode==="chase";
  const isSlowed = a.clipsTimer > 0;
  const shiver   = isChase ? (Math.random()-0.5)*2 : 0;
  const sway     = Math.sin(a.walkCycle||0)*(isChase?3:1.5);
  const legL     = Math.max(0, Math.sin(a.walkCycle||0))*(isChase?4:2);
  const legR     = Math.max(0,-Math.sin(a.walkCycle||0))*(isChase?4:2);
  const armSw    = Math.cos(a.walkCycle||0)*(isChase?4:2);

  ctx.save();
  ctx.translate(cx+shiver, cy+sway*0.3);

  // Sombra (roja en chase)
  ctx.fillStyle = isChase ? "rgba(255,0,0,0.22)" : C.shadow;
  ctx.fillRect(-a.w/2+2, a.h/2-2, a.w-4, isChase?10:6);

  // Piernas
  ctx.fillStyle = "#220000";
  ctx.fillRect(-5, 4-legL, 5, 10+legL);
  ctx.fillRect( 0, 4-legR, 5, 10+legR);

  // Cuerpo
  ctx.fillStyle = isSlowed ? "#554444" : (isChase ? "#cc2222" : C.auditorDk);
  ctx.fillRect(-a.w/2, -a.h/2+2, a.w, a.h-6);
  ctx.fillStyle = isSlowed ? "#998888" : (isChase ? "#ff6666" : C.auditor);
  ctx.fillRect(-a.w/2+1, -a.h/2+1, a.w-2, a.h-8);
  // Traje
  ctx.fillStyle="#220000"; ctx.fillRect(-a.w/2+3,-a.h/2+8,a.w-6,8);
  ctx.fillStyle="#990000"; ctx.fillRect(-1,-a.h/2+8,2,8);
  // Brazos
  ctx.fillStyle=C.auditorDk;
  ctx.fillRect(-a.w/2-3,-a.h/2+6+armSw,4,8);
  ctx.fillRect( a.w/2-1,-a.h/2+6-armSw,4,8);
  // Cabeza
  ctx.fillStyle="#d4a04f"; ctx.fillRect(-6,-a.h/2-6,12,12);
  // Gafas
  ctx.fillStyle="#222"; ctx.fillRect(-5,-a.h/2-3,4,3); ctx.fillRect(1,-a.h/2-3,4,3);
  ctx.fillRect(-1,-a.h/2-2,2,1);
  // Portapapeles
  ctx.fillStyle="#8B6914"; ctx.fillRect(a.w/2-2,-6,9,12);
  ctx.fillStyle="#ffe566"; ctx.fillRect(a.w/2-1,-5,7,10);
  ctx.fillStyle="#aa8800"; for(let i=0;i<3;i++) ctx.fillRect(a.w/2+1,-3+i*3,4,1);

  // Icono clips si está ralentizado
  if (isSlowed) {
    ctx.font = "8px serif";
    ctx.textAlign = "center";
    ctx.fillText("📎", 0, -a.h/2-10);
  }

  // Signo de alerta "!" o "?"
  if (a.alertScale > 0.05) {
    ctx.save();
    ctx.translate(0, -a.h/2-18);
    ctx.scale(a.alertScale, a.alertScale);
    ctx.fillStyle = isChase ? "#ff2222" : "#ffdd00";
    ctx.fillRect(-8,-10,16,18);
    ctx.fillStyle = "#000";
    ctx.font = "bold 16px monospace";
    ctx.textAlign = "center";
    ctx.fillText(isChase?"!":"?", 0, 5);
    ctx.restore();
  }

  ctx.restore();
}

// ── Cono de visión del auditor (con rayo LOS) ──
function drawVisionCone() {
  const a  = state.auditor;
  const cx = a.x+a.w/2, cy = a.y+a.h/2;
  const isChase = a.mode==="chase";

  const grad = ctx.createRadialGradient(cx,cy,0,cx,cy,a.visionRange);
  grad.addColorStop(0,   isChase?"rgba(255,0,0,0.13)":"rgba(255,68,68,0.06)");
  grad.addColorStop(0.7, isChase?"rgba(255,0,0,0.05)":"rgba(255,68,68,0.02)");
  grad.addColorStop(1,   "rgba(255,0,0,0)");

  ctx.beginPath();
  ctx.arc(cx,cy,a.visionRange,0,Math.PI*2);
  ctx.fillStyle = grad;
  ctx.fill();

  // Rayo LOS visible si puede ver al jugador
  if (losCache === true) {
    const plCX = state.player.x+state.player.w/2;
    const plCY = state.player.y+state.player.h/2;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx,cy); ctx.lineTo(plCX,plCY);
    ctx.strokeStyle = isChase?"rgba(255,40,40,0.55)":"rgba(255,200,0,0.28)";
    ctx.lineWidth   = isChase?2.5:1.5;
    ctx.setLineDash(isChase?[]:[4,4]);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(plCX,plCY,isChase?5:3,0,Math.PI*2);
    ctx.fillStyle = isChase?"rgba(255,60,60,0.7)":"rgba(255,220,0,0.5)";
    ctx.fill();
    ctx.restore();
  }
}

// ── Hints de recogida ──
function drawPickupHints() {
  const px = state.player.x+state.player.w/2;
  const py = state.player.y+state.player.h/2;
  const range = TILE*1.6;
  const alpha = 0.5+Math.sin(state.elapsed*8)*0.4;

  // Power-ups
  for (const pu of state.powerups) {
    if (pu.collected) continue;
    const dx=pu.col*TILE+TILE/2-px, dy=pu.row*TILE+TILE/2-py;
    if (Math.hypot(dx,dy)<range) {
      ctx.fillStyle = `rgba(255,200,50,${alpha})`;
      ctx.font = "bold 8px monospace";
      ctx.textAlign = "center";
      ctx.fillText("[E]", pu.col*TILE+TILE/2, pu.row*TILE-5);
    }
  }

  // Documentos
  for (const doc of state.docs) {
    if (doc.collected) continue;
    const dx=doc.col*TILE+TILE/2-px, dy=doc.row*TILE+TILE/2-py;
    if (Math.hypot(dx,dy)<range) {
      const isTarget = doc.def.id===state.targetId;
      ctx.fillStyle = isTarget
        ? `rgba(255,233,77,${alpha})`
        : `rgba(180,180,180,${alpha*0.7})`;
      ctx.font = "bold 8px monospace";
      ctx.textAlign = "center";
      ctx.fillText(isTarget?"[E] ¡ESTE!":"[E]", doc.col*TILE+TILE/2, doc.row*TILE-5);
    }
  }
}

// ── Flash de pantalla ──
function drawFlash() {
  if (!state.flashColor||state.flashAcc<=0) return;
  state.flashAcc -= 0.016;
  ctx.fillStyle = state.flashColor;
  ctx.fillRect(0,0,canvas.width,canvas.height);
}

// ── Partículas ──
function drawParticles() {
  for (const p of state.particles) {
    ctx.globalAlpha = p.life/(p.maxLife||1);
    ctx.fillStyle   = p.color;
    ctx.fillRect(p.x-p.size/2, p.y-p.size/2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
}

// ── Mensaje de feedback flotante (en espacio de pantalla) ──
function drawFeedbackMsg() {
  if (!state.feedbackMsg || state.feedbackTimer <= 0) return;
  const alpha = Math.min(1, state.feedbackTimer / 0.4);
  const y     = canvas.height * 0.15 - (1-state.feedbackTimer/1.4)*20;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font        = "bold 11px monospace";
  ctx.textAlign   = "center";
  ctx.fillStyle   = "#000";
  // Sombra
  ctx.fillText(state.feedbackMsg, canvas.width/2+1, y+1);
  ctx.fillStyle = state.feedbackColor;
  ctx.fillText(state.feedbackMsg, canvas.width/2, y);
  ctx.restore();
}

// ══════════════════════════════════════════════════════════════════
// 18. OFICINA VIVA — v6  "Oficina Viva Mejorada"
//
// Regla de oro: NADA aquí afecta gameplay, colisiones, documentos,
// auditor, puntuación ni estado de partida.
//
// Cambios v6 vs v5:
//   - Monitores más brillantes: pantallas más saturadas, brillo
//     (shadowBlur) alrededor del monitor, 3 paletas fijas por tile
//     (azul / verde / ámbar) en lugar de interpolación única
//   - Hojas de cálculo animadas: filas y columnas con celdas
//   - Impresoras: papel sube 8-12 px, animación más clara
//   - LEDs en computadoras, impresoras Y archivadores
//   - Reloj digital decorativo en pared del mapa
//   - Polvo: máximo 25 partículas, opacidad ligeramente mayor
//   - drawOfficeLeds()  — LEDs de estado en archivadores
//   - drawOfficeClock() — reloj decorativo en pared
// ══════════════════════════════════════════════════════════════════

// ──────────────────────────────────────────────
// 18a. CATÁLOGO DE TILES ANIMADOS
//
// Construido una sola vez al cargar el script.
// Cada entrada almacena posición, fase aleatoria y — para monitores —
// un "modo de paleta" fijo (0=azul, 1=verde, 2=ámbar) para que
// distintos monitores tengan esquemas de color permanentemente distintos.
// ──────────────────────────────────────────────

function collectTiles(tileType) {
  const list = [];
  let idx = 0;
  for (let r=0; r<MAP_ROWS; r++)
    for (let c=0; c<MAP_COLS; c++)
      if (MAP_LAYOUT[r][c] === tileType)
        list.push({
          col:        c,
          row:        r,
          phase:      Math.random() * Math.PI * 2,
          id:         r * MAP_COLS + c,
          colorMode:  idx++ % 3,   // 0=azul  1=verde  2=ámbar
        });
  return list;
}

const DESK_TILES    = collectTiles(2);
const PRINTER_TILES = collectTiles(4);
const PLANT_TILES   = collectTiles(5);
const CABINET_TILES = collectTiles(3);

// ──────────────────────────────────────────────
// 18b. PALETAS DE MONITOR  (3 estilos fijos, más saturados que v5)
// ──────────────────────────────────────────────

// Cada modo tiene: color de fondo de pantalla, color de "celda activa",
// color de líneas, y color del brillo exterior (glow).
const MONITOR_PALETTES = [
  // 0 — Azul (hoja de cálculo clásica)
  { bg: "#0a2a6e", cell: "#1a4acc", line: "#4d8cff", glow: "rgba(60,110,255,0.35)" },
  // 1 — Verde (terminal contable)
  { bg: "#062010", cell: "#0a5020", line: "#2ecc71", glow: "rgba(46,204,113,0.32)" },
  // 2 — Ámbar (pantalla vieja, cálida)
  { bg: "#2a1400", cell: "#6b3800", line: "#ffb84d", glow: "rgba(255,160,40,0.30)" },
];

// ──────────────────────────────────────────────
// 18c. PARTÍCULAS DE POLVO (máx 25, levemente más visibles que v5)
// ──────────────────────────────────────────────

const MAX_DUST = 25;

function initDustParticles() {
  const pool = [];
  for (let i=0; i<MAX_DUST; i++) pool.push(createDustParticle(true));
  return pool;
}

function createDustParticle(scatter = false) {
  const wW = MAP_COLS * TILE;
  const wH = MAP_ROWS * TILE;
  return {
    x:       scatter ? Math.random()*wW : Math.random()*wW,
    y:       scatter ? Math.random()*wH : (MAP_ROWS-1)*TILE,
    vx:      (Math.random()-0.5) * 5,
    vy:      -(1.5 + Math.random()*3.5),
    life:    0,
    maxLife: 7 + Math.random()*9,
    size:    1 + Math.random()*1.8,
    alpha:   0.07 + Math.random()*0.15,    // v6: ligeramente más visible
    phase:   Math.random()*Math.PI*2,
    freq:    0.3 + Math.random()*0.5,
  };
}

// ──────────────────────────────────────────────
// 18d. updateOfficeAmbience(dt)
//
// Avanza SOLO el estado de animaciones ambientales.
// Sin efectos de gameplay.
// ──────────────────────────────────────────────

function updateOfficeAmbience(dt) {
  const dust = state.ambience.dustParticles;
  const wW   = MAP_COLS * TILE;

  for (let i=0; i<dust.length; i++) {
    const p = dust[i];
    p.life += dt;
    p.y    += p.vy * dt;
    p.x    += p.vx * dt + Math.sin(p.phase + p.life * p.freq) * 0.28;

    if (p.life >= p.maxLife || p.y < 0 || p.x < 0 || p.x > wW) {
      dust[i]   = createDustParticle(false);
      dust[i].x = Math.random() * wW;
      dust[i].y = (1 + Math.random() * (MAP_ROWS-2)) * TILE;
    }
  }
}

// ──────────────────────────────────────────────
// 18e. drawAmbientParticles()
// ──────────────────────────────────────────────

function drawAmbientParticles() {
  const dust = state.ambience.dustParticles;
  const prev = ctx.globalAlpha;

  for (const p of dust) {
    const lr    = p.life / p.maxLife;
    const fadeI = Math.min(1, lr / 0.15);
    const fadeO = lr > 0.8 ? 1 - (lr-0.8)/0.2 : 1;
    ctx.globalAlpha = p.alpha * fadeI * fadeO;
    ctx.fillStyle   = "#d8d4cc";
    ctx.fillRect(p.x - p.size/2, p.y - p.size/2, p.size, p.size);
  }
  ctx.globalAlpha = prev;
}

// ──────────────────────────────────────────────
// 18f. drawAnimatedMonitors()
//
// v6 mejoras:
//   - Cada monitor tiene paleta fija (azul / verde / ámbar)
//   - Brillo exterior (shadowBlur) pulsante
//   - Hoja de cálculo con filas y celdas animadas
//   - Cursor parpadeante
//   - LED de estado mejorado
// ──────────────────────────────────────────────

function drawAnimatedMonitors() {
  const elapsed = state.elapsed;

  // Viewport culling
  const sC = Math.max(0, Math.floor(state.cam.x/TILE)-1);
  const eC = Math.min(MAP_COLS-1, sC + Math.ceil(canvas.width/TILE)+2);
  const sR = Math.max(0, Math.floor(state.cam.y/TILE)-1);
  const eR = Math.min(MAP_ROWS-1, sR + Math.ceil(canvas.height/TILE)+2);

  for (const tile of DESK_TILES) {
    if (tile.col < sC || tile.col > eC || tile.row < sR || tile.row > eR) continue;

    const x   = tile.col * TILE;
    const y   = tile.row * TILE;
    const t   = elapsed + tile.phase;
    const pal = MONITOR_PALETTES[tile.colorMode];

    // ── Parpadeo ocasional: señal de baja frecuencia con dos sinusoides primas ──
    const flickSig  = Math.sin(t*0.28) * Math.sin(t*1.73 + tile.phase);
    const isFlicker = flickSig < -0.85;

    if (isFlicker) {
      // Pantalla apagada momentáneamente
      ctx.fillStyle = "#030308";
      ctx.fillRect(x+7, y+7, 8, 5);
    } else {
      // ── Brillo exterior (glow) — pulso lento 0.4 Hz ──
      const glowPulse = 0.65 + Math.sin(t * 0.8) * 0.35;
      ctx.save();
      ctx.shadowColor = pal.glow;
      ctx.shadowBlur  = 6 * glowPulse;

      // Fondo de pantalla
      ctx.fillStyle = pal.bg;
      ctx.fillRect(x+7, y+7, 8, 5);

      ctx.restore();   // restaurar shadowBlur antes de líneas de datos

      // ── Hoja de cálculo: 3 filas × 2 celdas ──
      // La "celda activa" cambia de fila cada ~2 s
      const activeRow = Math.floor(((t*0.5) % 3));

      for (let row=0; row<3; row++) {
        const ly = y + 7 + row * 1.6;
        if (row === activeRow) {
          // Celda activa — color brillante
          ctx.fillStyle = pal.cell;
          ctx.fillRect(x+8, ly, 3, 1);
          ctx.fillStyle = pal.line;
          ctx.fillRect(x+12, ly, 2, 1);
        } else {
          // Celda inactiva — línea suave
          ctx.fillStyle = pal.line;
          ctx.globalAlpha = 0.45;
          ctx.fillRect(x+8, ly, 6, 1);
          ctx.globalAlpha = 1;
        }
      }

      // ── Cursor parpadeante (1 Hz) ──
      if (Math.sin(t * Math.PI * 2) > 0.1) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(x+13, y+11, 1, 2);
      }
    }

    // ── LED de estado: verde brillante, pulso lento (~0.5 Hz) ──
    const ledBright = 0.6 + Math.sin(t * Math.PI) * 0.4;   // 0.2..1.0
    const ledR = Math.round(0   * ledBright);
    const ledG = Math.round(255 * ledBright);
    const ledB = Math.round(68  * ledBright);
    ctx.fillStyle = `rgb(${ledR},${ledG},${ledB})`;
    ctx.fillRect(x+14, y+6, 2, 2);
  }
}

// ──────────────────────────────────────────────
// 18g. drawAnimatedPrinters()
//
// v6 mejoras:
//   - Papel sube entre 8 y 12 px (antes 7)
//   - Animación con 3 líneas de texto en el papel
//   - LED más brillante con parpadeo a 6 Hz durante impresión
//   - Indicador de standby naranja visible
// ──────────────────────────────────────────────

function drawAnimatedPrinters() {
  const elapsed = state.elapsed;

  const sC = Math.max(0, Math.floor(state.cam.x/TILE)-1);
  const eC = Math.min(MAP_COLS-1, sC + Math.ceil(canvas.width/TILE)+2);
  const sR = Math.max(0, Math.floor(state.cam.y/TILE)-1);
  const eR = Math.min(MAP_ROWS-1, sR + Math.ceil(canvas.height/TILE)+2);

  for (const tile of PRINTER_TILES) {
    if (tile.col < sC || tile.col > eC || tile.row < sR || tile.row > eR) continue;

    const x      = tile.col * TILE;
    const y      = tile.row * TILE;
    const t      = elapsed + tile.phase;

    // ── Ciclo de impresión: período 3.5 s ──
    const PERIOD  = 3.5;
    const phase   = t % PERIOD;
    const ACTIVE  = 1.6;     // ventana de animación en segundos

    // Altura máxima variable según fase de tile (8–12 px)
    const maxRise = 8 + (tile.colorMode * 2);   // 8, 10 o 12 px

    if (phase < ACTIVE) {
      const progress  = phase / ACTIVE;
      // Ease-out cuadrático para subida natural
      const eased     = 1 - (1-progress)*(1-progress);
      const paperRise = eased * maxRise;

      // Fade: aparece en primero 40%, desaparece en último 25%
      const alpha = progress < 0.4
        ? progress / 0.4
        : progress > 0.75 ? 1 - (progress-0.75)/0.25 : 1;

      ctx.save();
      ctx.globalAlpha = alpha;

      // Cuerpo del papel
      ctx.fillStyle = "#f5f5ee";
      ctx.fillRect(x+7, y+4 - paperRise, 16, 6);

      // Borde superior del papel (más oscuro)
      ctx.fillStyle = "#ccccbb";
      ctx.fillRect(x+7, y+4 - paperRise, 16, 1);

      // 3 líneas de texto simulado en el papel
      ctx.fillStyle = "#888877";
      ctx.fillRect(x+9,  y+5 - paperRise, 10, 1);
      ctx.fillRect(x+9,  y+7 - paperRise,  7, 1);
      ctx.fillRect(x+9,  y+9 - paperRise,  9, 1);

      ctx.restore();

      // ── LED activo: verde brillante parpadeando a 6 Hz ──
      const blinkOn = Math.sin(t * Math.PI * 12) > 0;
      ctx.fillStyle = blinkOn ? "#55ff55" : "#003300";
      ctx.fillRect(x+3, y+7, 3, 3);

    } else {
      // ── LED standby: naranja suave ──
      const standbyPulse = 0.5 + Math.sin(t * 0.6) * 0.3;
      const sb = Math.round(80 * standbyPulse);
      ctx.fillStyle = `rgb(${Math.round(120*standbyPulse)},${sb},0)`;
      ctx.fillRect(x+3, y+7, 3, 3);
    }
  }
}

// ──────────────────────────────────────────────
// 18h. drawAnimatedPlants()
//
// Sin cambios estructurales respecto a v5.
// Balanceo mejorado: amplitud levemente mayor en hojas laterales.
// ──────────────────────────────────────────────

function drawAnimatedPlants() {
  const elapsed = state.elapsed;

  const sC = Math.max(0, Math.floor(state.cam.x/TILE)-1);
  const eC = Math.min(MAP_COLS-1, sC + Math.ceil(canvas.width/TILE)+2);
  const sR = Math.max(0, Math.floor(state.cam.y/TILE)-1);
  const eR = Math.min(MAP_ROWS-1, sR + Math.ceil(canvas.height/TILE)+2);

  for (const tile of PLANT_TILES) {
    if (tile.col < sC || tile.col > eC || tile.row < sR || tile.row > eR) continue;

    const x = tile.col * TILE;
    const y = tile.row * TILE;
    const t = elapsed + tile.phase;

    const swayMain  = Math.sin(t * 1.5)        * 1.8;
    const swayLeft  = Math.sin(t * 1.2 + 1.0)  * 1.7;
    const swayRight = Math.sin(t * 1.8 - 0.8)  * 1.7;

    ctx.save();

    // Maceta — repintada para que las hojas no la cubran
    ctx.fillStyle = "#7b4c1e";
    ctx.fillRect(x+10, y+22, 12, 8);

    // Tallo
    ctx.fillStyle = "#2a6a2a";
    ctx.fillRect(x+15, y+16, 2, 8);

    // Hoja central
    ctx.save();
    ctx.translate(x+16, y+20);
    ctx.rotate(swayMain * 0.026);
    ctx.fillStyle = C.plant;
    ctx.fillRect(-8, -8, 16, 12);
    ctx.fillStyle = C.leaf;
    ctx.fillRect(-6, -12, 12, 6);
    // Nervadura central
    ctx.fillStyle = "#1a6a1a";
    ctx.fillRect(-1, -11, 1, 14);
    ctx.restore();

    // Hoja izquierda
    ctx.save();
    ctx.translate(x+10, y+19);
    ctx.rotate(swayLeft * 0.026);
    ctx.fillStyle = C.leaf;
    ctx.fillRect(-5, -5, 9, 5);
    ctx.fillStyle = "#1a6a1a";
    ctx.fillRect(-4, -3, 8, 1);
    ctx.restore();

    // Hoja derecha
    ctx.save();
    ctx.translate(x+22, y+19);
    ctx.rotate(swayRight * 0.026);
    ctx.fillStyle = C.leaf;
    ctx.fillRect(-4, -5, 9, 5);
    ctx.fillStyle = "#1a6a1a";
    ctx.fillRect(-3, -3, 8, 1);
    ctx.restore();

    ctx.restore();
  }
}

// ──────────────────────────────────────────────
// 18i. drawOfficeLeds()
//
// LEDs de estado en archivadores (CABINET_TILES).
// Pequeño indicador de 2×2 px, color según el tile.colorMode.
// Los archivadores no tienen animación de objeto, solo el LED.
// ──────────────────────────────────────────────

function drawOfficeLeds() {
  const elapsed = state.elapsed;

  const sC = Math.max(0, Math.floor(state.cam.x/TILE)-1);
  const eC = Math.min(MAP_COLS-1, sC + Math.ceil(canvas.width/TILE)+2);
  const sR = Math.max(0, Math.floor(state.cam.y/TILE)-1);
  const eR = Math.min(MAP_ROWS-1, sR + Math.ceil(canvas.height/TILE)+2);

  // ── LEDs en archivadores ──
  for (const tile of CABINET_TILES) {
    if (tile.col < sC || tile.col > eC || tile.row < sR || tile.row > eR) continue;

    const x = tile.col * TILE;
    const y = tile.row * TILE;
    const t = elapsed + tile.phase;

    // 3 colores distintos según colorMode: naranja, azul, rojo
    const ledColors = [
      { on:"#ff8800", dim:"#3a1800" },   // 0 naranja
      { on:"#4488ff", dim:"#0a1840" },   // 1 azul
      { on:"#ff3333", dim:"#2a0000" },   // 2 rojo
    ];
    const lc = ledColors[tile.colorMode % 3];

    // Pulso lento: período ~3 s, breve encendido
    const pulse = Math.sin(t * 0.67 * Math.PI);
    const on    = pulse > 0.7;

    ctx.fillStyle = on ? lc.on : lc.dim;
    // Posición: esquina superior derecha del archivador
    ctx.fillRect(x + TILE - 6, y + 4, 3, 3);
  }
}

// ──────────────────────────────────────────────
// 18j. drawOfficeClock()
//
// Reloj digital decorativo. Puramente visual, sin efecto en gameplay.
// Posición fija en la pared superior derecha del mapa (col 22, row 0).
// Muestra MM:SS usando state.elapsed como fuente de tiempo.
// ──────────────────────────────────────────────

function drawOfficeClock() {
  // Posición del reloj en el mundo (pared superior, cerca de col 21)
  const CLOCK_X = 21 * TILE + 2;
  const CLOCK_Y = 0  * TILE + 3;

  // Viewport culling simple para el reloj
  if (CLOCK_X + 28 < state.cam.x || CLOCK_X > state.cam.x + canvas.width ||
      CLOCK_Y + 14 < state.cam.y || CLOCK_Y > state.cam.y + canvas.height) return;

  // Calcular minutos y segundos a partir del tiempo de juego transcurrido
  // (El reloj empieza en 00:00 y cuenta hacia adelante — solo decoración)
  const totalSec = Math.floor(state.elapsed);
  const mm       = Math.floor(totalSec / 60) % 60;
  const ss       = totalSec % 60;
  const timeStr  = (mm < 10 ? "0"+mm : ""+mm) + ":" + (ss < 10 ? "0"+ss : ""+ss);

  // Parpadeo de los dos puntos (1 Hz)
  const colonOn  = Math.sin(state.elapsed * Math.PI * 2) > 0;
  const display  = colonOn ? timeStr : timeStr.replace(":", " ");

  // Fondo del reloj — marco oscuro tipo LCD
  ctx.fillStyle = "#0a0a18";
  ctx.fillRect(CLOCK_X, CLOCK_Y, 28, 12);

  // Borde del reloj
  ctx.fillStyle = "#2a2a55";
  ctx.fillRect(CLOCK_X,     CLOCK_Y,     28, 1);    // top
  ctx.fillRect(CLOCK_X,     CLOCK_Y+11,  28, 1);    // bottom
  ctx.fillRect(CLOCK_X,     CLOCK_Y,     1,  12);   // left
  ctx.fillRect(CLOCK_X+27,  CLOCK_Y,     1,  12);   // right

  // Texto del reloj — verde LCD característico
  ctx.fillStyle   = "#22ff88";
  ctx.font        = "bold 8px monospace";
  ctx.textAlign   = "center";
  ctx.textBaseline= "middle";
  ctx.fillText(display, CLOCK_X + 14, CLOCK_Y + 6);
  ctx.textBaseline = "alphabetic";  // restaurar valor por defecto

  // Destello suave alrededor del texto
  ctx.save();
  ctx.fillStyle = "rgba(34,255,136,0.08)";
  ctx.fillRect(CLOCK_X+1, CLOCK_Y+1, 26, 10);
  ctx.restore();
}

// ──────────────────────────────────────────────
// 18. HUD
// ──────────────────────────────────────────────
function updateHUD() {
  // Timer
  hudTimer.textContent = Math.max(0, Math.ceil(state.timer));
  hudTimer.style.color = state.timer<15?"#ff4444": state.timer<30?"#ff9800":"#ffe94d";

  // Documentos
  hudDocs.textContent = state.docsCollected+"/"+TOTAL_DOCS;

  // Objetivo actual
  const targetDef = DOC_DEFS.find(d=>d.id===state.targetId);
  hudTarget.textContent = targetDef ? targetDef.name : "—";
  hudTarget.style.borderColor = targetDef ? targetDef.color : "#ff9800";
  hudTarget.style.color       = targetDef ? targetDef.color : "#fff";

  // Score
  hudScore.textContent = state.score;

  // Barra de sospecha
  const pct = (state.suspicion/MAX_SUSPICION)*100;
  suspBar.style.width      = pct+"%";
  suspBar.style.background = pct>70?"#ff4444": pct>40?"#ffe94d":"#39ff6a";

  // Parpadeo HUD en chase
  if (state.auditor.mode==="chase") {
    const fl = Math.sin(state.hudFlashAcc*8)>0;
    hudEl.style.borderBottomColor = fl?"#ff2222":"#ff8888";
    hudEl.style.background        = fl?"#2a0000":"#14142b";
  } else {
    hudEl.style.borderBottomColor = "";
    hudEl.style.background        = "";
  }

  // Power-up timers
  const p = state.player;
  const a = state.auditor;
  if (p.coffeeTimer > 0) {
    hudCoffeeEl.classList.remove("hidden");
    hudCoffeeTEl.textContent = Math.ceil(p.coffeeTimer);
  } else {
    hudCoffeeEl.classList.add("hidden");
  }
  if (a.clipsTimer > 0) {
    hudClipsEl.classList.remove("hidden");
    hudClipsTEl.textContent = Math.ceil(a.clipsTimer);
  } else {
    hudClipsEl.classList.add("hidden");
  }
}

// ──────────────────────────────────────────────
// 19. RESIZE — v5.1 mobile-aware
// ──────────────────────────────────────────────

/**
 * resizeCanvas()
 *
 * Calcula el tamaño visual del canvas para que encaje en pantalla
 * sin scroll, respetando:
 *   1. Ancho disponible (ventana, máx 900 px)
 *   2. Alto disponible = ventana − HUD − controles táctiles (si visibles)
 *   3. Relación de aspecto del mapa (MAP_COLS×TILE : MAP_ROWS×TILE)
 *
 * La resolución interna del canvas (canvas.width/height) se mantiene
 * en MAP_COLS×TILE × MAP_ROWS×TILE para que el juego dibuje siempre
 * en la misma resolución pixel-art; solo el tamaño CSS cambia.
 */
function resizeCanvas() {
  const HUD_H = parseInt(
    getComputedStyle(document.documentElement)
      .getPropertyValue("--hud-height") || "46", 10
  );

  // Detectar si los controles móviles están visibles
  const ctrlVisible = mobileControls &&
    getComputedStyle(mobileControls).visibility !== "hidden" &&
    getComputedStyle(mobileControls).opacity !== "0";

  const CTRL_H = ctrlVisible
    ? parseInt(
        getComputedStyle(document.documentElement)
          .getPropertyValue("--mobile-ctrl-h") || "120", 10
      )
    : 0;

  const availW = Math.min(window.innerWidth,  900);
  const availH = window.innerHeight - HUD_H - CTRL_H;

  // Escala máxima que cabe en el espacio disponible (sin superar 1×)
  const scaleX = availW / (MAP_COLS * TILE);
  const scaleY = availH / (MAP_ROWS * TILE);
  const scale  = Math.min(scaleX, scaleY, 1);

  // Resolución interna fija (pixel-art)
  canvas.width  = MAP_COLS * TILE;
  canvas.height = MAP_ROWS * TILE;

  // Tamaño visual escalado
  canvas.style.width  = Math.floor(canvas.width  * scale) + "px";
  canvas.style.height = Math.floor(canvas.height * scale) + "px";
}

window.addEventListener("resize",       () => { if (state?.phase) resizeCanvas(); });
window.addEventListener("orientationchange", () => {
  // Pequeño delay para que el navegador reporte las dimensiones correctas
  setTimeout(() => { if (state?.phase) resizeCanvas(); }, 200);
});

// ──────────────────────────────────────────────
// 19b. CONTROLES TÁCTILES — v5.1
//
// El joystick captura touchstart en su área, luego sigue el toque
// aunque salga del elemento (usando el id del toque, no el target).
// El botón E llama directamente a tryPickup().
//
// IMPORTANTE: e.preventDefault() en todos los handlers para evitar:
//   - scroll de página
//   - doble-toque zoom
//   - ghostclick (click fantasma 300ms después del touch)
// ──────────────────────────────────────────────

// ── JOYSTICK — touchstart ──
touchJoystick.addEventListener("touchstart", e => {
  e.preventDefault();
  const touch = e.changedTouches[0];
  touchInput.active = true;
  touchInput.id     = touch.identifier;

  // Centro del joystick en coordenadas de página
  const rect       = touchJoystick.getBoundingClientRect();
  touchInput.startX = rect.left + rect.width  / 2;
  touchInput.startY = rect.top  + rect.height / 2;

  touchJoystick.classList.add("active");
  updateJoystick(touch.clientX, touch.clientY);
}, { passive: false });

// ── JOYSTICK — touchmove (global para no perder el toque) ──
// Escucha en document para que funcione aunque el dedo salga del círculo
document.addEventListener("touchmove", e => {
  if (!touchInput.active) return;
  e.preventDefault();

  // Buscar el toque que inició el joystick por su identifier
  for (const touch of e.changedTouches) {
    if (touch.identifier === touchInput.id) {
      updateJoystick(touch.clientX, touch.clientY);
      break;
    }
  }
}, { passive: false });

// ── JOYSTICK — touchend / touchcancel ──
document.addEventListener("touchend", e => {
  for (const touch of e.changedTouches) {
    if (touch.identifier === touchInput.id) {
      resetJoystick();
      break;
    }
  }
}, { passive: false });

document.addEventListener("touchcancel", () => resetJoystick(), { passive: false });

/**
 * Actualiza la posición visual del knob y los valores dx/dy normalizados.
 * @param {number} cx - clientX del toque actual
 * @param {number} cy - clientY del toque actual
 */
function updateJoystick(cx, cy) {
  let rawX = cx - touchInput.startX;
  let rawY = cy - touchInput.startY;
  const dist = Math.hypot(rawX, rawY);

  // Limitar el knob al radio máximo
  if (dist > touchInput.maxDist) {
    rawX = (rawX / dist) * touchInput.maxDist;
    rawY = (rawY / dist) * touchInput.maxDist;
  }

  // Normalizar a -1..1 con zona muerta pequeña (5 px)
  const DEAD = 5;
  touchInput.dx = Math.abs(rawX) > DEAD ? rawX / touchInput.maxDist : 0;
  touchInput.dy = Math.abs(rawY) > DEAD ? rawY / touchInput.maxDist : 0;

  // Mover el knob visualmente (centrado en el joystick)
  joystickKnob.style.transform =
    `translate(calc(-50% + ${rawX}px), calc(-50% + ${rawY}px))`;
}

/** Reinicia el joystick a estado neutro. */
function resetJoystick() {
  touchInput.active = false;
  touchInput.id     = null;
  touchInput.dx     = 0;
  touchInput.dy     = 0;
  joystickKnob.style.transform = "translate(-50%, -50%)";
  touchJoystick.classList.remove("active");
}

// ── BOTÓN E (acción / recoger) ──
touchActionBtn.addEventListener("touchstart", e => {
  e.preventDefault();
  touchActionBtn.classList.add("pressed");
  // Desbloquear audio en móvil (requiere gesto del usuario)
  getAudioCtx();
  if (state.phase === "play") tryPickup();
}, { passive: false });

touchActionBtn.addEventListener("touchend", e => {
  e.preventDefault();
  touchActionBtn.classList.remove("pressed");
}, { passive: false });

// ──────────────────────────────────────────────
// 20. UTILIDADES
// ──────────────────────────────────────────────
function shuffle(arr) {
  for (let i=arr.length-1;i>0;i--) {
    const j=Math.floor(Math.random()*(i+1));
    [arr[i],arr[j]]=[arr[j],arr[i]];
  }
  return arr;
}

/** Convierte color hex "#rrggbb" a "r,g,b" para usar en rgba() */
function hexToRgb(hex) {
  const r=parseInt(hex.slice(1,3),16);
  const g=parseInt(hex.slice(3,5),16);
  const b=parseInt(hex.slice(5,7),16);
  return `${r},${g},${b}`;
}

// ──────────────────────────────────────────────
// 21. BOTONES
// ──────────────────────────────────────────────
document.getElementById("btn-start").addEventListener("click", () => {
  getAudioCtx();  // desbloquear audio en primer clic
  startGame();
});
document.getElementById("btn-restart").addEventListener("click", startGame);
document.getElementById("btn-menu").addEventListener("click", ()=>showScreen("start"));
document.getElementById("btn-restart-win").addEventListener("click", startGame);
document.getElementById("btn-menu-win").addEventListener("click", ()=>showScreen("start"));
document.getElementById("btn-resume").addEventListener("click", togglePause);
document.getElementById("btn-pause-menu").addEventListener("click", ()=>{
  stopBGMusic(); showScreen("start");
});
