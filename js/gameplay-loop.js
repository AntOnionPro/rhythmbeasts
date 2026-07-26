/* ========================================
   RHYTHM BEASTS — Gameplay preview loop
   El jugador es el vacío en el centro. Los proyectiles
   entran desde el borde por el sector de su tecla y se
   "paran" en el instante exacto del beat.

   AJUSTA ESTOS DOS VALORES A TU CANCIÓN:
     BPM        — tempo de assets/cancion.mp3
     OFFSET_MS  — milisegundos desde el inicio del archivo
                  hasta el primer tiempo fuerte
   ======================================== */
(() => {
  const BPM = 126;
  const OFFSET_MS = 0;

  const canvas = document.getElementById('gameplayLoop');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const soundToggle = document.getElementById('soundToggle');
  const audioEl = document.getElementById('cancion');
  const secLabel = document.getElementById('secLabel');
  const barLabel = document.getElementById('barLabel');
  const bpmLabel = document.getElementById('bpmLabel');
  if (bpmLabel) bpmLabel.textContent = BPM;

  const fx = document.createElement('canvas');
  const fctx = fx.getContext('2d');
  const CAN_BLUR = typeof ctx.filter !== 'undefined';
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const KEYS = [
    { label: 'D', color: '#4de8e0', rgb: [77, 232, 224] },
    { label: 'F', color: '#6fffb0', rgb: [111, 255, 176] },
    { label: '\u2423', color: '#ffe14d', rgb: [255, 225, 77] },
    { label: 'J', color: '#ff3dae', rgb: [255, 61, 174] },
    { label: 'K', color: '#b06bff', rgb: [176, 107, 255] },
  ];

  const BEAT = 60000 / BPM;
  const BAR = BEAT * 4;
  const TRAVEL = BEAT * 2;
  const SECTION_BARS = 8;
  const SECTOR = (Math.PI * 2) / KEYS.length;

  let W, H, cx, cy, u, PARRY, OUTER, dpr;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    if (!W || !H) return;
    canvas.width = fx.width = Math.round(W * dpr);
    canvas.height = fx.height = Math.round(H * dpr);
    cx = W / 2;
    cy = H / 2;
    u = Math.min(W, H) / 720;
    PARRY = Math.max(46, 92 * u);
    OUTER = Math.hypot(W, H) / 2 + 40;
  }
  window.addEventListener('resize', resize);

  /* ---------- Audio real + análisis por bandas ---------- */
  let audioCtx = null, analyser = null, freqData = null, srcNode = null;
  let audioReady = false;
  const audioPlaying = () => audioReady && audioEl && !audioEl.paused && !audioEl.ended;

  function initAudio() {
    if (audioReady) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.72;
    freqData = new Uint8Array(analyser.frequencyBinCount);
    srcNode = audioCtx.createMediaElementSource(audioEl);
    srcNode.connect(analyser);
    analyser.connect(audioCtx.destination);
    audioReady = true;
  }

  if (soundToggle) {
    soundToggle.addEventListener('click', () => {
      initAudio();
      audioCtx.resume();
      if (audioEl.paused) {
        audioEl.play();
        soundToggle.textContent = 'Silenciar';
      } else {
        audioEl.pause();
        soundToggle.textContent = 'Activar sonido';
      }
      resetSchedule(songMs());
    });
  }

  const bands = { bass: 0, mid: 0, high: 0, onset: 0 };
  let bassPrev = 0, fluxAvg = 0, onsetEnv = 0;

  function readBands() {
    if (!audioPlaying()) {
      bands.bass *= 0.9; bands.mid *= 0.9; bands.high *= 0.9;
      onsetEnv *= 0.86;
      bands.onset = onsetEnv;
      return;
    }
    analyser.getByteFrequencyData(freqData);
    const binHz = audioCtx.sampleRate / analyser.fftSize;
    const avg = (fromHz, toHz) => {
      const a = Math.max(1, Math.floor(fromHz / binHz));
      const b = Math.min(freqData.length - 1, Math.ceil(toHz / binHz));
      let s = 0;
      for (let i = a; i <= b; i++) s += freqData[i];
      return s / (b - a + 1) / 255;
    };
    bands.bass = avg(30, 160);
    bands.mid = avg(160, 2000);
    bands.high = avg(2000, 9000);

    // el golpe es la SUBIDA del grave, no su nivel: un bajo sostenido
    // mantiene bands.bass alto todo el tiempo y saturaría el anillo.
    const flux = Math.max(0, bands.bass - bassPrev);
    bassPrev = bands.bass;
    fluxAvg += (flux - fluxAvg) * 0.08;
    if (flux > fluxAvg * 1.8 + 0.006) onsetEnv = Math.min(1, onsetEnv + flux * 6);
    onsetEnv *= 0.86;
    bands.onset = onsetEnv;
  }

  // espectro real repartido en el círculo, en espejo para que quede simétrico
  const HALF_SPEC = 48;
  function readSpectrum() {
    const binHz = audioCtx.sampleRate / analyser.fftSize;
    for (let j = 0; j <= HALF_SPEC; j++) {
      const f = 40 * Math.pow(300, j / HALF_SPEC);
      const bin = Math.min(freqData.length - 1, Math.max(1, Math.round(f / binHz)));
      const tilt = 0.6 + 1.25 * (j / HALF_SPEC);
      const target = Math.min(1, Math.pow(freqData[bin] / 255, 1.5) * tilt);
      const i2 = (SPEC_N - j) % SPEC_N;
      const rate = target > spec[j] ? 0.5 : 0.12;
      spec[j] += (target - spec[j]) * rate;
      spec[i2] = spec[j];
    }
  }

  /* ---------- Reloj ---------- */
  let clockBase = performance.now();
  let clockPaused = 0;
  function songMs() {
    if (audioPlaying()) return audioEl.currentTime * 1000 - OFFSET_MS;
    return performance.now() - clockBase;
  }

  /* ---------- Generación de notas ---------- */
  const DENSITY = [
    [1, 0, 0, 0, 1, 0, 0, 0.18],
    [1, 0, 0.35, 0, 1, 0, 0.55, 0.35],
    [1, 0.45, 0.7, 0.4, 1, 0.45, 0.7, 0.6],
  ];
  const SECTION_NAME = ['calma', 'build', 'drop'];

  let notes = [], barCursor = 0, lastKey = 2;

  function resetSchedule(t) {
    notes = [];
    projectiles.length = 0;
    rings.length = 0;
    teles.length = 0;
    barCursor = Math.max(0, Math.floor(t / BAR));
    combo = 0;
  }

  function pickKey(section) {
    if (Math.random() < (section === 2 ? 0.45 : 0.25)) {
      lastKey = Math.floor(Math.random() * KEYS.length);
    } else {
      lastKey = (lastKey + (Math.random() < 0.5 ? 1 : KEYS.length - 1)) % KEYS.length;
    }
    return lastKey;
  }

  function genBar(bar) {
    const section = Math.floor(bar / SECTION_BARS) % 3;
    const t0 = bar * BAR;
    const P = DENSITY[section];
    for (let s = 0; s < 8; s++) {
      if (Math.random() >= P[s]) continue;
      const hit = t0 + s * (BEAT / 2);
      const key = pickKey(section);
      const miss = section !== 2 && s !== 0 && Math.random() < 0.05;
      notes.push({ hit, key, miss, spawned: false, tele: false });
      if (section === 2 && s % 4 === 0 && Math.random() < 0.4) {
        notes.push({ hit, key: (key + 2) % KEYS.length, miss: false, spawned: false, tele: false });
      }
    }
  }

  /* ---------- Estado visual ---------- */
  const projectiles = [], rings = [], shockwaves = [], sparks = [], popups = [], teles = [];
  const SPEC_N = 96;
  const spec = new Float32Array(SPEC_N);
  const flash = new Float32Array(SPEC_N);
  const keyFlash = new Array(KEYS.length).fill(0);
  let combo = 0, comboScale = 1, kickEnv = 0, missFlash = 0, section = 0, bar = 0;

  // ---- Estado BEAST ----
  // Sube con el combo sostenido, cae de golpe al fallar. Mientras está alto,
  // el centro deja de comportarse como objeto y empieza a comportarse como algo vivo.
  const BEAST_FROM = 12, BEAST_TO = 26;
  let beast = 0, beastLatch = false;

  // color acumulado de los parrys recientes (canal cromático)
  const accum = { r: 245, g: 245, b: 245, a: 0 };
  function mixAccum(rgb, amount) {
    accum.r += (rgb[0] - accum.r) * amount;
    accum.g += (rgb[1] - accum.g) * amount;
    accum.b += (rgb[2] - accum.b) * amount;
    accum.a = Math.min(1, accum.a + amount * 0.9);
  }
  const accumCss = (alpha) =>
    `rgba(${accum.r | 0},${accum.g | 0},${accum.b | 0},${alpha})`;

  function bumpSpec(fromIdx, count, amount) {
    for (let i = 0; i < count; i++) {
      const idx = (Math.round(fromIdx) + i + SPEC_N) % SPEC_N;
      flash[idx] = Math.min(1, flash[idx] + amount * (1 - i / count));
    }
  }

  function schedule(t) {
    while (barCursor * BAR < t + BAR * 2) {
      rings.push({ hit: barCursor * BAR, born: barCursor * BAR - TRAVEL });
      genBar(barCursor);
      barCursor++;
    }
    for (const n of notes) {
      if (!n.tele && t >= n.hit - TRAVEL - 300) {
        n.tele = true;
        teles.push({ key: n.key, life: 1 });
      }
      if (!n.spawned && t >= n.hit - TRAVEL) {
        n.spawned = true;
        const jitter = (Math.random() - 0.5) * SECTOR * 0.55;
        projectiles.push({
          angle: -Math.PI / 2 + (n.key - 2) * SECTOR + jitter,
          key: n.key, color: KEYS[n.key].color, miss: n.miss,
          born: n.hit - TRAVEL, trail: [], dead: 0, x: cx, y: cy,
        });
      }
    }
    notes = notes.filter((n) => n.hit > t - 500);
  }

  function parry(p, x, y) {
    combo++;
    comboScale = 1.5;
    keyFlash[p.key] = 1;
    mixAccum(KEYS[p.key].rgb, 0.55);
    shockwaves.push({ x, y, r: PARRY * 0.5, life: 1, color: p.color });
    const norm = ((p.angle + Math.PI * 2.5) % (Math.PI * 2)) / (Math.PI * 2);
    bumpSpec(norm * SPEC_N, 10, 0.9);
    STARS.forEach((s) => { if (s.key === p.key) s.boost = Math.min(1.6, s.boost + 0.9); });
    for (let i = 0; i < 20; i++) {
      const a = (Math.PI * 2 * i) / 20 + Math.random() * 0.3;
      const sp = (2 + Math.random() * 4.5) * u;
      sparks.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, color: p.color });
    }
    popups.push({
      x, y: y - 22 * u, life: 1, color: p.color,
      text: combo > 0 && combo % 12 === 0 ? 'PERFECT' : 'PARRY',
    });
  }

  function updateProjectiles(t) {
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i];
      if (p.dead) {
        p.dead -= 0.06;
        if (p.dead <= 0) projectiles.splice(i, 1);
        continue;
      }
      const prog = (t - p.born) / TRAVEL;
      if (prog >= 1) {
        const x = cx + Math.cos(p.angle) * PARRY;
        const y = cy + Math.sin(p.angle) * PARRY;
        if (p.miss) { combo = 0; missFlash = 1; p.dead = 1; p.x = x; p.y = y; }
        else { parry(p, x, y); projectiles.splice(i, 1); }
        continue;
      }
      const dist = PARRY + (OUTER - PARRY) * (1 - prog);
      p.x = cx + Math.cos(p.angle) * dist;
      p.y = cy + Math.sin(p.angle) * dist;
      p.trail.push({ x: p.x, y: p.y });
      if (p.trail.length > 18) p.trail.shift();
    }
  }

  /* ---------- Capa emisiva (va al canvas de bloom) ---------- */
  // contorno con deformación radial: suma de senos inconmensurables para que
  // el ciclo nunca se repita igual y no se lea como una animación en bucle.
  function wobblePath(c, r, amp, t, seed) {
    const N = 54;
    c.beginPath();
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      const w = 1 + amp * (
        Math.sin(a * 3 + t * 0.0011 + seed) * 0.5 +
        Math.sin(a * 5 - t * 0.0007 + seed * 1.7) * 0.3 +
        Math.sin(a * 2 + t * 0.00041) * 0.4
      );
      const x = Math.cos(a) * r * w;
      const y = Math.sin(a) * r * w;
      if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.closePath();
  }

  function drawEmissive(c) {
    c.lineCap = 'round';

    for (let i = 0; i < SPEC_N; i++) {
      const v = Math.min(1, spec[i] + flash[i]);
      if (v < 0.02) continue;
      const a = (i / SPEC_N) * Math.PI * 2 - Math.PI / 2;
      const r0 = PARRY + 8 * u;
      const r1 = r0 + v * 46 * u;
      const ki = (((Math.round((a + Math.PI / 2) / SECTOR) + 2) % KEYS.length) + KEYS.length) % KEYS.length;
      c.strokeStyle = KEYS[ki].color;
      c.globalAlpha = 0.16 + v * 0.5;
      c.lineWidth = 2.2 * u;
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      c.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      c.stroke();
    }
    c.globalAlpha = 1;

    const teleR = Math.min(W, H) * 0.47;
    teles.forEach((tl) => {
      const a0 = -Math.PI / 2 + (tl.key - 2) * SECTOR - SECTOR * 0.42;
      c.strokeStyle = KEYS[tl.key].color;
      c.globalAlpha = tl.life * 0.5;
      c.lineWidth = (2 + tl.life * 7) * u;
      c.beginPath();
      c.arc(cx, cy, teleR, a0, a0 + SECTOR * 0.84);
      c.stroke();
    });
    c.globalAlpha = 1;

    rings.forEach((rg) => {
      const prog = (songMsCache - rg.born) / TRAVEL;
      if (prog < 0 || prog > 1.25) return;
      const r = prog <= 1
        ? PARRY + (OUTER - PARRY) * (1 - prog)
        : PARRY + (prog - 1) * 260 * u;
      c.strokeStyle = '#f5f5f5';
      c.globalAlpha = prog <= 1 ? 0.05 + prog * 0.09 : Math.max(0, 0.14 - (prog - 1) * 0.6);
      c.lineWidth = (prog <= 1 ? 1 : 3) * u;
      c.beginPath();
      c.arc(cx, cy, r, 0, Math.PI * 2);
      c.stroke();
    });
    c.globalAlpha = 1;

    projectiles.forEach((p) => {
      const fade = p.dead ? p.dead : 1;
      for (let i = 1; i < p.trail.length; i++) {
        const a = p.trail[i - 1], b = p.trail[i], k = i / p.trail.length;
        c.strokeStyle = p.color;
        c.globalAlpha = k * 0.55 * fade;
        c.lineWidth = (1.5 + k * 6) * u;
        c.beginPath();
        c.moveTo(a.x, a.y);
        c.lineTo(b.x, b.y);
        c.stroke();
      }
      c.globalAlpha = fade;
      c.fillStyle = p.color;
      c.beginPath();
      c.arc(p.x, p.y, 7 * u * fade, 0, Math.PI * 2);
      c.fill();
    });
    c.globalAlpha = 1;

    shockwaves.forEach((s) => {
      c.strokeStyle = s.color;
      c.globalAlpha = s.life;
      c.lineWidth = 3 * u * s.life;
      c.beginPath();
      c.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      c.stroke();
    });
    sparks.forEach((s) => {
      c.fillStyle = s.color;
      c.globalAlpha = s.life;
      c.beginPath();
      c.arc(s.x, s.y, 2.6 * u * s.life, 0, Math.PI * 2);
      c.fill();
    });
    c.globalAlpha = 1;

    const ringR = PARRY + 62 * u;
    c.font = `500 ${13 * u}px Ubuntu, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    KEYS.forEach((k, i) => {
      const a0 = -Math.PI / 2 + (i - 2) * SECTOR - SECTOR * 0.44;
      const a1 = a0 + SECTOR * 0.88;
      c.strokeStyle = k.color;
      c.globalAlpha = 0.18 + keyFlash[i] * 0.82;
      c.lineWidth = (2 + keyFlash[i] * 6) * u;
      c.beginPath();
      c.arc(cx, cy, ringR, a0, a1);
      c.stroke();
      const am = (a0 + a1) / 2;
      c.globalAlpha = 0.45 + keyFlash[i] * 0.55;
      c.fillStyle = k.color;
      c.fillText(k.label, cx + Math.cos(am) * (ringR + 16 * u), cy + Math.sin(am) * (ringR + 16 * u));
    });
    c.globalAlpha = 1;

    // filamentos: solo existen mientras la cadena aguanta
    if (beast > 0.02) {
      const n = Math.round(2 + beast * 6);
      const len = PARRY * (0.9 + beast * 1.5);
      c.strokeStyle = accumCss(1);
      for (let k = 0; k < n; k++) {
        const base = (k / n) * Math.PI * 2 + songMsCache * 0.00006 + k * 1.7;
        let px = 0, py = 0;
        for (let s = 0; s <= 16; s++) {
          const p = s / 16;
          const a = base + Math.sin(p * 3.1 + songMsCache * 0.0012 + k) * 0.3 * p;
          const r = PARRY * 0.5 + len * p;
          const x = cx + Math.cos(a) * r;
          const y = cy + Math.sin(a) * r;
          if (s > 0) {
            c.globalAlpha = (0.1 + beast * 0.32) * (1 - p) * (1 - p);
            c.lineWidth = (2.4 - p * 1.8) * u;
            c.beginPath();
            c.moveTo(px, py);
            c.lineTo(x, y);
            c.stroke();
          }
          px = x; py = y;
        }
      }
      c.globalAlpha = 1;
    }

    // el bombo manda cuando beast es bajo; la respiración propia cuando es alto
    const breathe = beast * 0.075 *
      (Math.sin(songMsCache * 0.0016) + Math.sin(songMsCache * 0.00097 + 1.3)) * 0.5;
    const pulse = 1 + kickEnv * 0.16 * (1 - beast * 0.55) + breathe;
    c.save();
    c.translate(cx, cy);
    c.scale(pulse, pulse);
    c.strokeStyle = accumCss(1);
    c.globalAlpha = 0.5 + kickEnv * 0.5 + beast * 0.25;
    c.lineWidth = (2.5 + beast * 1.2) * u;
    if (beast > 0.02) wobblePath(c, 24 * u, beast * 0.18, songMsCache, 0);
    else { c.beginPath(); c.arc(0, 0, 24 * u, 0, Math.PI * 2); }
    c.stroke();
    c.globalAlpha = 0.1 + kickEnv * 0.12 + beast * 0.1;
    c.lineWidth = 1 * u;
    if (beast > 0.02) wobblePath(c, PARRY, beast * 0.055, songMsCache, 2.4);
    else { c.beginPath(); c.arc(0, 0, PARRY, 0, Math.PI * 2); }
    c.stroke();
    c.restore();
    c.globalAlpha = 1;

    c.textBaseline = 'alphabetic';
    popups.forEach((p) => {
      c.globalAlpha = Math.min(1, p.life);
      c.fillStyle = p.color;
      c.font = `700 ${(p.size || 12) * u}px Ubuntu, sans-serif`;
      c.fillText(p.text, p.x, p.y);
    });
    c.globalAlpha = 1;

    if (combo > 1) {
      c.save();
      c.translate(cx, cy + PARRY + 108 * u);
      c.scale(comboScale, comboScale);
      c.fillStyle = beast > 0.5 ? accumCss(1) : '#f5f5f5';
      c.globalAlpha = 0.9;
      c.font = `700 ${(24 + beast * 6) * u}px Ubuntu, sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('x' + combo, 0, 0);
      c.restore();
      c.globalAlpha = 1;
    }
  }

  /* ---------- Estrellas ---------- */
  const STARS = Array.from({ length: 190 }, () => {
    const k = Math.floor(Math.random() * KEYS.length);
    return {
      a: Math.random() * Math.PI * 2,
      d: Math.random(),
      r: Math.random() * 1.4 + 0.3,
      key: k,
      color: KEYS[k].color,
      boost: 0,
      phase: Math.random() * Math.PI * 2,
    };
  });

  function drawStars(t, dt) {
    const speed = 0.00004 * dt * (1 + kickEnv * 6 + section * 0.5 + bands.high * 3);
    STARS.forEach((s) => {
      s.d += speed * (0.3 + s.d);
      if (s.d > 1) { s.d = 0.02; s.a = Math.random() * Math.PI * 2; }
      s.boost *= 0.9;
      const dist = s.d * OUTER;
      const tw = 0.3 + 0.45 * Math.abs(Math.sin(t * 0.0013 + s.phase));
      ctx.beginPath();
      ctx.arc(cx + Math.cos(s.a) * dist, cy + Math.sin(s.a) * dist,
        s.r * (0.4 + s.d) * (1 + s.boost), 0, Math.PI * 2);
      ctx.fillStyle = s.color;
      ctx.globalAlpha = Math.min(1, tw * s.d * 0.55 + s.boost * 0.5);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  /* ---------- Título ---------- */
  let stretch = 2.4, presence = 1;
  const STRETCH_BY_SECTION = [2.2, 2.6, 3.1];
  const PRESENCE_BY_SECTION = [1, 0.85, 0.6];

  function drawTitle() {
    // el bloque se ancla debajo del nav y crece hacia el juego;
    // el tamaño sale de la banda libre entre el nav y el aro de parry.
    const navSafe = Math.max(78, 94 * u);
    const band = Math.max(70, cy - PARRY * 0.9 - navSafe);
    const size = Math.min(W * 0.17, 200, band / 2.6 / 0.72);
    ctx.save();
    ctx.font = `700 ${size}px Ubuntu, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const m = ctx.measureText('RHYTHM BEASTS');
    const ascent = m.actualBoundingBoxAscent || size * 0.72;
    const pivotY = navSafe + ascent * stretch;

    ctx.translate(W / 2, pivotY);
    ctx.scale(1, stretch);
    ctx.translate(-W / 2, -pivotY);

    // cuando la bestia despierta, la marca se retira y deja la pantalla al juego
    const pres = presence * (1 - beast * 0.45);

    // 1. cuerpo blanco: sólido arriba, alpha 0 exacto en la baseline
    const white = ctx.createLinearGradient(0, pivotY - ascent, 0, pivotY);
    white.addColorStop(0, `rgba(245,245,245,${0.34 * pres})`);
    white.addColorStop(0.55, `rgba(245,245,245,${0.14 * pres})`);
    white.addColorStop(1, 'rgba(245,245,245,0)');
    ctx.fillStyle = white;
    ctx.fillText('RHYTHM BEASTS', W / 2, pivotY);

    // 2. luz de color que sube desde el juego, sin llegar arriba
    if (accum.a > 0.02) {
      const tint = ctx.createLinearGradient(0, pivotY - ascent * 0.72, 0, pivotY);
      tint.addColorStop(0, accumCss(0));
      tint.addColorStop(0.72, accumCss(0.3 * accum.a * presence * (1 + beast * 0.6)));
      tint.addColorStop(1, accumCss(0));
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = tint;
      ctx.fillText('RHYTHM BEASTS', W / 2, pivotY);
      ctx.globalCompositeOperation = 'source-over';
    }

    // 3. aberración cromática solo en el golpe
    if (!REDUCED && kickEnv > 0.12) {
      const off = kickEnv * 3.2;
      ctx.globalCompositeOperation = 'screen';
      const ab = (color, dx) => {
        const g = ctx.createLinearGradient(0, pivotY - ascent, 0, pivotY);
        g.addColorStop(0, `rgba(${color},${0.22 * kickEnv * pres})`);
        g.addColorStop(1, `rgba(${color},0)`);
        ctx.fillStyle = g;
        ctx.fillText('RHYTHM BEASTS', W / 2 + dx, pivotY);
      };
      ab('77,232,224', -off);
      ab('255,61,174', off);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
  }

  /* ---------- Bucle ---------- */
  let last = performance.now();
  let running = false, rafId = 0;
  let songMsCache = 0;

  function frame(ts) {
    if (!running) return;
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(50, ts - last);
    last = ts;

    const t = songMs();
    // la canción hizo loop o hubo un salto: resincroniza
    if (t < songMsCache - 400 || t > songMsCache + 2000) resetSchedule(t);
    songMsCache = t;

    bar = Math.floor(t / BAR);
    section = Math.floor(bar / SECTION_BARS) % 3;
    if (secLabel) secLabel.textContent = SECTION_NAME[section];
    if (barLabel) barLabel.textContent = (bar % SECTION_BARS) + 1;

    readBands();

    const beatPhase = (t % BEAT) / BEAT;
    const grid = Math.max(0, 1 - beatPhase * 5);
    const playing = audioPlaying();
    kickEnv = playing ? Math.max(grid * 0.3, bands.onset) : grid;

    if (playing) {
      readSpectrum();
    } else {
      const hatEnv = Math.max(0, 1 - ((t % (BEAT / 2)) / (BEAT / 2)) * 9);
      if (grid > 0.55) bumpSpec(0, 22, 0.13);
      if (hatEnv > 0.6) bumpSpec(SPEC_N / 2, 14, 0.07);
      for (let i = 0; i < SPEC_N; i++) spec[i] *= 0.9;
    }
    for (let i = 0; i < SPEC_N; i++) flash[i] *= 0.88;

    stretch += (STRETCH_BY_SECTION[section] - stretch) * 0.02;
    presence += (PRESENCE_BY_SECTION[section] - presence) * 0.02;

    schedule(t);
    updateProjectiles(t);

    for (let i = teles.length - 1; i >= 0; i--) {
      teles[i].life -= dt / 300;
      if (teles[i].life <= 0) teles.splice(i, 1);
    }
    for (let i = rings.length - 1; i >= 0; i--) if (t - rings[i].hit > 400) rings.splice(i, 1);
    for (let i = shockwaves.length - 1; i >= 0; i--) {
      const s = shockwaves[i];
      s.r += 6 * u; s.life *= 0.88;
      if (s.life < 0.03) shockwaves.splice(i, 1);
    }
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.x += s.vx; s.y += s.vy; s.vx *= 0.93; s.vy *= 0.93; s.life *= 0.91;
      if (s.life < 0.03) sparks.splice(i, 1);
    }
    for (let i = popups.length - 1; i >= 0; i--) {
      const p = popups[i];
      p.y -= 0.6; p.life *= 0.93;
      if (p.life < 0.04) popups.splice(i, 1);
    }
    for (let i = 0; i < KEYS.length; i++) keyFlash[i] *= 0.86;
    comboScale += (1 - comboScale) * 0.18;
    missFlash *= 0.9;
    accum.a *= 0.965;

    // sube lento (cuesta ganarlo), cae rápido (cuesta poco perderlo)
    const beastTarget = Math.max(0, Math.min(1, (combo - BEAST_FROM) / (BEAST_TO - BEAST_FROM)));
    beast += (beastTarget - beast) * (beastTarget > beast ? 0.018 : 0.16);
    if (!beastLatch && beast > 0.6) {
      beastLatch = true;
      popups.push({
        x: cx, y: cy - PARRY - 42 * u, life: 1.7, size: 22,
        color: accumCss(1), text: 'BEAST',
      });
    }
    if (beast < 0.2) beastLatch = false;

    const zoom = 1 + kickEnv * 0.012;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // el centro es el agujero: negro puro. La luz vive en la banda exterior.
    const lift = 15 + kickEnv * 15;
    const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) / 1.05);
    bg.addColorStop(0, '#000');
    bg.addColorStop(0.3, '#030307');
    bg.addColorStop(0.72, `rgb(${lift | 0},${lift * 0.78 | 0},${lift * 1.3 | 0})`);
    bg.addColorStop(1, '#000');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // lavado de color desde el borde hacia adentro
    if (accum.a > 0.02) {
      const wash = ctx.createRadialGradient(cx, cy, Math.min(W, H) * 0.16, cx, cy, Math.max(W, H) * 0.72);
      wash.addColorStop(0, accumCss(0));
      wash.addColorStop(1, accumCss((0.16 + beast * 0.13) * accum.a));
      ctx.fillStyle = wash;
      ctx.fillRect(0, 0, W, H);
    }

    ctx.save();
    ctx.translate(cx, cy); ctx.scale(zoom, zoom); ctx.translate(-cx, -cy);
    drawStars(t, dt);
    drawTitle();
    ctx.restore();

    // horizonte de sucesos: se traga fondo, estrellas y el pie del título.
    // Va antes del bloom, así que lo emisivo (compuesto con screen) sigue vivo.
    const holeR = PARRY * (2.3 + beast * 0.5);
    const hole = ctx.createRadialGradient(cx, cy, 0, cx, cy, holeR);
    hole.addColorStop(0, 'rgba(0,0,0,1)');
    hole.addColorStop(0.42, 'rgba(0,0,0,0.95)');
    hole.addColorStop(0.75, 'rgba(0,0,0,0.6)');
    hole.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = hole;
    ctx.fillRect(cx - holeR, cy - holeR, holeR * 2, holeR * 2);

    fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fctx.clearRect(0, 0, W, H);
    fctx.save();
    fctx.translate(cx, cy); fctx.scale(zoom, zoom); fctx.translate(-cx, -cy);
    drawEmissive(fctx);
    fctx.restore();

    ctx.globalCompositeOperation = 'screen';
    if (CAN_BLUR) {
      ctx.filter = `blur(${9 * u}px)`;
      ctx.drawImage(fx, 0, 0, W, H);
      ctx.filter = 'none';
    }
    ctx.drawImage(fx, 0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';

    if (missFlash > 0.02) {
      const v = ctx.createRadialGradient(cx, cy, Math.min(W, H) * 0.2, cx, cy, Math.max(W, H) * 0.62);
      v.addColorStop(0, 'rgba(255,40,60,0)');
      v.addColorStop(1, `rgba(255,40,60,${missFlash * 0.32})`);
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function start() {
    if (running) return;
    running = true;
    last = performance.now();
    if (clockPaused) { clockBase += performance.now() - clockPaused; clockPaused = 0; }
    rafId = requestAnimationFrame(frame);
  }
  function stop() {
    if (!running) return;
    running = false;
    cancelAnimationFrame(rafId);
    clockPaused = performance.now();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop(); else start();
  });

  window.RB = { start, stop, resize };

  resize();
  start();
})();
