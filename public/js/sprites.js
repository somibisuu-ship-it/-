/*
 * TudariSprites - 코드로 그리는 도트 아바타 (48x60 프레임, 게임 배율은 배경 직원의 실제 노출 높이 기준)
 *
 * 레이어(그리는 순서): base, backHair, face, eyebrows, eyes, frontHair, top, bottom, shoes, accessory, handItem
 *   앞/뒤/오른쪽을 그리고 왼쪽은 오른쪽을 좌우 반전한다. 서 있는 자세 기준 좌표로 그린 뒤 자세에 따라 오프셋만 준다.
 *   앉는 자세(sit/pour/raise-glass/drink/cheers)는 SIT_LIFT 만큼 위로 올려 그린다(의자 높이).
 * 에셋 슬롯(나중에 손그림 PNG/WebP로 교체): 슬롯 키 = `${layer}/${variant}/${dir}-${action}-${frame}`
 *   variant: base->base, backHair/frontHair->hair, face->`${base}-blush${0..3}`,
 *            eyebrows->strong|soft, eyes->normal-${eyes}|drunk_1|drunk_2|dizzy, top/bottom/shoes->outfit,
 *            accessory->accessory, handItem->glass/bottle 종류
 *   이미지는 FRAME(48x60) 크기, 같은 앵커에 1:1로 합성된다. manifest.json 의 slots 에 적힌 키만 내려받고,
 *   슬롯이 있는 레이어만 이미지로 바뀌며 나머지는 코드 그림을 그대로 쓴다.
 */
(function (root) {
  'use strict';

  const W = 48, H = 60;
  const FRAME = Object.freeze({ w: W, h: H, ax: 24, ay: 54 });
  const REFERENCE_HEIGHT = 46;
  const SCALE = root.TudariWorld ? root.TudariWorld.STAFF.bounds.h / REFERENCE_HEIGHT : 4;
  const SIT_LIFT = 8;
  const DIRS = ['down', 'up', 'left', 'right'];
  const LAYERS = ['base', 'backHair', 'face', 'eyebrows', 'eyes', 'frontHair', 'top', 'bottom', 'shoes', 'accessory', 'handItem'];
  const ACTIONS = { idle: 2, walk: 4, sit: 2, pour: 2, 'raise-glass': 2, drink: 3, cheers: 2 };
  const SEATED = { sit: 1, pour: 1, 'raise-glass': 1, drink: 1, cheers: 1 };
  const PERIOD = { idle: 520, walk: 130, sit: 600, pour: 250, 'raise-glass': 400, drink: 260, cheers: 300 };
  const CACHE_MAX = 700;

  /* ---------- 색 (0이면 투명, 불투명은 0x1000000 | RGB) ---------- */
  const c8 = v => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
  const mk = (r, g, b) => 0x1000000 | (c8(r) << 16) | (c8(g) << 8) | c8(b);
  const K = hex => 0x1000000 | (parseInt(String(hex).replace('#', ''), 16) || 0);
  const rgb = c => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
  const shade = (c, f) => { const v = rgb(c); return mk(v[0] * f, v[1] * f, v[2] * f); };
  const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return mk(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t); };
  const lum = c => { const v = rgb(c); return (v[0] * 0.299 + v[1] * 0.587 + v[2] * 0.114) / 255; };
  const WHITE = K('#ffffff'), INK = K('#2b1d2c');

  const SKIN = ['#ffdcbc', '#ffdcbc', '#ffcdb3', '#ffbfa9'].map(K);
  const SKIN_SH = ['#f0b692', '#f0b692', '#eaa58b', '#e4998a'].map(K);
  const BLUSH = ['#ffc6b0', '#ffa7a2', '#ff8a92', '#ff6a84'].map(K);
  const BLUSH_PTS = [
    [[14, 32], [15, 32]],
    [[14, 32], [15, 32], [16, 32]],
    [[15, 31], [16, 31], [17, 31], [15, 32], [16, 32], [17, 32]],
    [[14, 31], [15, 31], [16, 31], [17, 31], [14, 32], [15, 32], [16, 32], [17, 32], [15, 33]]
  ];

  const OUTFITS = {
    basic: { kind: 'tee', main: '#f7f7fb', sh: '#c9cde2', pants: '#454b6c', len: 3, shoe: '#f1f2fa', sole: '#8d92ae' },
    uplus: { kind: 'uplus', main: '#f7f7fb', sh: '#c9cde2', vest: '#e6007e', vestSh: '#a9005f', mark: '#ffffff', pants: '#383a55', len: 6, shoe: '#34303f', sole: '#15131d' },
    lg: { kind: 'jersey', main: '#c8103e', sh: '#93092b', trim: '#1b1a23', trim2: '#ffffff', num: '#ffffff', numTxt: '51', pants: '#f4f4f9', stripe: '#c8103e', len: 6, shoe: '#2a2833', sole: '#c8103e', cap: '#c8103e' },
    hanwha: { kind: 'jersey', main: '#f26b21', sh: '#bd4a10', trim: '#0a1f44', trim2: '#ffffff', num: '#0a1f44', numTxt: '11', pants: '#f4f4f9', stripe: '#0a1f44', len: 6, shoe: '#2a2833', sole: '#f26b21', cap: '#f26b21' },
    samsung: { kind: 'jersey', main: '#1f4fa8', sh: '#143678', trim: '#ffffff', trim2: '#0e2a66', num: '#ffffff', numTxt: '22', pants: '#e4e8f4', stripe: '#1f4fa8', len: 6, shoe: '#2a2833', sole: '#1f4fa8', cap: '#1f4fa8' },
    doosan: { kind: 'jersey', main: '#14183c', sh: '#0b0e27', trim: '#e0242c', trim2: '#ffffff', num: '#ffffff', numTxt: '24', pants: '#d2d5e0', stripe: '#e0242c', len: 6, shoe: '#2a2833', sole: '#e0242c', cap: '#14183c' },
    kia: { kind: 'track', main: '#2c2d36', sh: '#1b1c24', trim: '#e0242c', trim2: '#ffffff', num: '#e0242c', numTxt: '33', pants: '#2c2d36', stripe: '#e0242c', len: 6, shoe: '#23212c', sole: '#e0242c', cap: '#2c2d36' },
    casual: { kind: 'tee', main: '#7cb89d', sh: '#5a9680', pants: '#4f74ac', len: 6, shoe: '#f6f6fb', sole: '#8d92ae', jeans: true },
    ragged: { kind: 'tattered', main: '#a18c70', sh: '#77634e', pants: '#83715e', patch: '#c4ae85', stain: '#695a4c', len: 3, shoe: '#8c8172', sole: '#534a41' }
  };
  const OUT = {};
  for (const k in OUTFITS) {
    OUT[k] = {};
    for (const f in OUTFITS[k]) { const v = OUTFITS[k][f]; OUT[k][f] = typeof v === 'string' && v[0] === '#' ? K(v) : v; }
  }
  const FX = {
    mouth: K('#9a4552'), lip: K('#c54860'), lipHi: K('#e87c8c'), eyeD: K('#2a1c33'), eyeI: K('#6f5a94'), eyeL: K('#b198c5'), eyeS: K('#fff4e8'), eyeW: WHITE,
    capNavy: K('#1f2a5c'), glassFr: K('#33243a'), ribbon: WHITE, ribbonSh: K('#f3a8c8'), ribbonPk: K('#ff7fb0'),
    hsBand: K('#2e2c3a'), hsBandHi: K('#585570'), hsCup: K('#3a3850'), hsAccent: K('#e6007e'),
    faceEdge: K('#9c5a52')
  };

  const OPT = {
    base: ['male', 'female'], hair: ['short', 'spiky', 'slick', 'parted', 'bob', 'long', 'ponytail', 'wavy'],
    eyes: ['round', 'circle', 'soft', 'clear', 'droop', 'upturned', 'smile', 'sleepy'],
    outfit: Object.keys(OUTFITS), accessory: ['none', 'glasses', 'cap', 'ribbon', 'headset', 'catEars', 'bunnyEars', 'crown', 'starClip']
  };
  const DEFAULTS = { base: 'male', eyes: 'round', hair: 'short', hairColor: '#201a25', outfit: 'basic', accessory: 'none' };
  function normAvatar(raw) {
    const TW = root.TudariWorld;
    if (TW && TW.normalizeAvatar) return TW.normalizeAvatar(raw);
    const a = raw && typeof raw === 'object' ? raw : {};
    const pick = (k, v) => (OPT[k].indexOf(v) >= 0 ? v : DEFAULTS[k]);
    const base = pick('base', a.base != null ? a.base : a.gender);
    const index = /^[AB]0[1-4]$/.test(a.hairStyle)
      ? (a.hairStyle[0] === 'B' ? 4 : 0) + Number(a.hairStyle[2]) - 1 : Math.max(0, OPT.hair.indexOf(a.hair));
    return { base, gender: base, hairStyle: `${index < 4 ? 'A' : 'B'}0${index % 4 + 1}`, eyes: pick('eyes', a.eyes), hair: OPT.hair[index], outfit: pick('outfit', a.outfit), accessory: pick('accessory', a.accessory), hairColor: /^#[0-9a-f]{6}$/i.test(a.hairColor || '') ? a.hairColor.toLowerCase() : DEFAULTS.hairColor };
  }

  const PAL_CACHE = new Map();
  function palette(a, d) {
    const key = a.hairColor + a.outfit + d;
    let P = PAL_CACHE.get(key);
    if (P) return P;
    const h = K(a.hairColor), dark = lum(h) < 0.22;
    P = Object.assign({
      o: OUT[a.outfit] || OUT.basic, skin: SKIN[d], skinSh: SKIN_SH[d], blush: BLUSH[d],
      h, hHi: dark ? mix(h, K('#8a7fb0'), 0.5) : mix(h, WHITE, 0.4), hSh: dark ? mix(h, K('#000000'), 0.35) : shade(h, 0.72), hOl: dark ? K('#0d0912') : shade(h, 0.34),
      browStrong: shade(h, 0.65), browSoft: mix(h, SKIN[0], 0.6)
    }, FX);
    if (PAL_CACHE.size > 200) PAL_CACHE.clear();
    PAL_CACHE.set(key, P);
    return P;
  }

  /* ---------- 픽셀 버퍼 ---------- */
  let OX = 0, OY = 0;
  const off = (x, y) => { OX = x; OY = y; };
  const newBuf = () => new Uint32Array(W * H);
  function put(B, x, y, c) { x += OX; y += OY; if (x >= 0 && y >= 0 && x < W && y < H) B[y * W + x] = c; }
  function at(B, x, y) { x += OX; y += OY; return x >= 0 && y >= 0 && x < W && y < H ? B[y * W + x] : 0; }
  function paintOn(B, x, y, c) { if (at(B, x, y)) put(B, x, y, c); }
  function box(B, x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(B, x + i, y + j, c); }
  function sell(B, cx, cy, rx, ry, n, c) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = Math.abs(x + 0.5 - cx) / rx, dy = Math.abs(y + 0.5 - cy) / ry;
        if (Math.pow(dx, n) + Math.pow(dy, n) < 1) put(B, x, y, c);
      }
    }
  }
  const ell = (B, cx, cy, rx, ry, c) => sell(B, cx, cy, rx, ry, 2, c);
  function carve(B, test) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (B[y * W + x] && test(x - OX, y - OY)) B[y * W + x] = 0;
  }
  function art(B, rows, x, y, pal, flip) {
    for (let j = 0; j < rows.length; j++) {
      const r = flip ? rows[j].split('').reverse().join('') : rows[j];
      for (let i = 0; i < r.length; i++) { const c = pal[r[i]]; if (c) put(B, x + i, y + j, c); }
    }
  }
  function line(B, x0, y0, x1, y1, bw, bh, c, limit) {
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy, n = 0;
    for (;;) {
      if (limit == null || n < limit) box(B, x0 - Math.floor(bw / 2), y0, bw, bh, c);
      n++;
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
    }
  }
  function rim(B, c) {
    const src = B.slice();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!src[y * W + x]) continue;
      if ((x < W - 1 && !src[y * W + x + 1]) || (y < H - 1 && !src[(y + 1) * W + x])) B[y * W + x] = c;
    }
  }
  // 레이어를 합성한다. edge 가 있으면 앞서 그린 픽셀과 맞닿는 가장자리에 윤곽선을 넣는다(바깥 윤곽은 마지막에 한 번에).
  function addLayer(F, L, edge) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x, c = L[i];
        if (!c) continue;
        F[i] = edge && ((x > 0 && !L[i - 1] && F[i - 1]) || (x < W - 1 && !L[i + 1] && F[i + 1]) || (y > 0 && !L[i - W] && F[i - W]) || (y < H - 1 && !L[i + W] && F[i + W])) ? edge : c;
      }
    }
  }
  function outline(F, ink) {
    const src = F.slice();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (src[i]) continue;
      if ((x > 0 && src[i - 1]) || (x < W - 1 && src[i + 1]) || (y > 0 && src[i - W]) || (y < H - 1 && src[i + W])) F[i] = ink;
    }
  }
  function mirror(B) {
    const out = newBuf();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out[y * W + (W - 1 - x)] = B[y * W + x];
    return out;
  }

  /* ---------- 포즈 해석 ---------- */
  const ci = (v, lo, hi) => Math.max(lo, Math.min(hi, v | 0));
  function resolvePose(p) {
    p = p || {};
    const dir = DIRS.indexOf(p.dir) >= 0 ? p.dir : 'down';
    const action = ACTIONS[p.action] ? p.action : 'idle';
    const n = ACTIONS[action];
    const t = Number.isFinite(+p.t) ? Math.max(0, +p.t) : 0;
    const frame = Number.isInteger(p.frame) ? ((p.frame % n) + n) % n : Math.floor(t / PERIOD[action]) % n;
    const drunk = ci(Math.round(+p.drunkLevel || 0), 0, 3);
    let eye = 'normal', phase = 0;
    if (drunk === 2) eye = Math.floor(t / 600) % 2 ? 'drunk_2' : 'drunk_1';
    else if (drunk === 3) { eye = 'dizzy'; phase = Math.floor(t / 150) % 4; }
    const sway = drunk === 3 ? (Math.floor(t / 450) % 2 ? 1 : -1) : 0;
    return { dir, action, frame, drunk, eye, phase, sway, seated: !!SEATED[action], item: p.item && typeof p.item === 'object' ? p.item : null };
  }

  /* ---------- 자세 기하 (서 있는 기준 좌표) ---------- */
  // 손 위치: 활동하는 팔(앞/뒤 보기에서는 화면 오른쪽, 옆 보기에서는 가까운 팔)의 끝점과 어깨
  const SHOULDER = { down: { r: [31, 38], l: [16, 38] }, up: { r: [31, 38], l: [16, 38] }, right: { r: [23, 38], l: [26, 38] } };
  const HANDS = {
    down: { idle: [[31, 44], [31, 44]], sit: [[29, 43], [29, 43]], 'raise-glass': [[34, 32], [34, 31]], drink: [[30, 35], [29, 33], [30, 35]], cheers: [[35, 28], [36, 27]], pour: [[33, 42], [33, 43]] },
    up: { idle: [[31, 44], [31, 44]], sit: [[29, 43], [29, 43]], 'raise-glass': [[34, 32], [34, 31]], drink: [[34, 30], [34, 28], [34, 30]], cheers: [[35, 28], [36, 27]], pour: [[33, 41], [33, 42]] },
    right: { idle: [[23, 44], [23, 44]], sit: [[28, 42], [28, 42]], 'raise-glass': [[31, 32], [31, 31]], drink: [[31, 35], [30, 33], [31, 35]], cheers: [[35, 29], [36, 28]], pour: [[32, 41], [32, 42]] }
  };
  function geom(st, view) {
    const f = st.frame, A = st.action;
    const g = { ly: st.seated ? -SIT_LIFT : 0, uy: 0, ux: st.sway, hy: 0, lf: { l: 0, r: 0 }, legX: { l: 0, r: 0 }, hand: null, handL: null, farHand: null };
    g.uy = g.ly;
    if (A === 'idle' || A === 'sit') g.uy += f ? -1 : 0;
    if (A === 'walk') g.uy += f % 2 ? -1 : 0;
    if (A === 'drink' && f === 1) g.hy = -1;
    const tbl = HANDS[view];
    if (A === 'walk') {
      const sw = [[-1, 1], [0, 0], [1, -1], [0, 0]][f];
      if (view === 'right') { g.hand = [23 + sw[0] * 4, 44 - Math.abs(sw[0])]; g.farHand = [26 - sw[0] * 4 + 1, 44 - Math.abs(sw[0])]; g.legX = { l: -sw[0] * 3, r: sw[0] * 3 }; }
      else { g.hand = [31, 44 + sw[0]]; g.handL = [16, 44 + sw[1]]; }
      if (f === 0) g.lf.l = 2; if (f === 2) g.lf.r = 2;
    } else {
      const arr = tbl[A] || tbl.idle;
      g.hand = arr[f % arr.length];
    }
    return g;
  }

  /* ---------- 머리 ---------- */
  const HAIR = {
    short: { bang: [27, 26, 24, 23, 23, 24, 24, 23, 22, 22, 23, 24, 24, 23, 22, 22, 23, 24, 24, 23, 23, 24, 26, 27] },
    spiky: { bang: [27, 26, 24, 24, 23, 23, 25, 25, 23, 22, 22, 23, 24, 24, 23, 22, 23, 25, 25, 24, 23, 24, 26, 27] },
    slick: { bang: [28, 27, 25, 24, 23, 23, 22, 22, 21, 21, 20, 20, 20, 20, 20, 20, 20, 21, 21, 22, 22, 23, 24, 26] },
    parted: { bang: [27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 18, 19, 19, 18, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27] },
    bob: { bang: [30, 29, 25, 24, 23, 23, 23, 23, 24, 24, 23, 23, 23, 23, 24, 24, 23, 23, 23, 23, 24, 25, 29, 30] },
    long: { bang: [30, 28, 25, 24, 23, 22, 21, 20, 20, 19, 19, 19, 19, 19, 19, 20, 20, 21, 22, 23, 24, 25, 28, 30] },
    ponytail: { bang: [28, 26, 25, 24, 23, 23, 22, 22, 23, 24, 24, 23, 22, 22, 22, 23, 23, 23, 24, 24, 24, 25, 27, 29] },
    wavy: { bang: [29, 28, 25, 24, 24, 23, 22, 21, 21, 20, 20, 20, 20, 21, 22, 22, 23, 24, 24, 23, 23, 24, 27, 29] }
  };
  const CAP_BANDS = [[10, 18, 12, 1], [11, 14, 20, 1], [12, 12, 24, 1], [13, 10, 28, 2],
    [15, 9, 30, 3], [18, 8, 32, 7], [25, 9, 30, 5], [30, 11, 26, 4], [34, 14, 20, 2]];
  const EYE_ART = {
    round: { dy: 2, rows: ['.EEEEEE.', 'EsiwPPiE', 'EsiiPPiE', '.EilliE.', '..EEEE..'] },
    circle: { dy: 2, rows: ['..EEEE..', '.EiwPiE.', 'EsiPPPiE', '.EilllE.', '..EEEE..'] },
    soft: { dy: 2, rows: ['..EEEEE.', '.EiwPPiE', 'EsiiPPiE', '.EilliE.', '..EEEE..'] },
    clear: { dy: 2, rows: ['EEEEEEEE', 'EsiwPPPE', 'EsiPPPPE', 'EsiilllE', '.EEEEEE.'] },
    droop: { dy: 2, rows: ['EEEE....', '.EiwEEE.', 'EsiiPPiE', '.EilliEs', '..EEEE..'] },
    upturned: { dy: 2, rows: ['....EEEE', '.EEEPPiE', 'EsiwPPiE', 'sEilliE.', '..EEEE..'] },
    smile: { dy: 2, rows: ['........', '..EEEE..', '.EE..EE.', 'EE....EE', '........'] },
    sleepy: { dy: 2, rows: ['........', 'EEEEEEEE', 'EsiwPPiE', '.EilliE.', '..EEEE..'] },
    drunk_1: { dy: 3, rows: ['EEEEEE', '.EwEEE', '..EEE.'] },
    drunk_2: { dy: 4, rows: ['.EE.EE', 'E..E..'] }
  };
  const SPIRAL = ['EEEEE', 'E....', 'E.EEE', 'E...E', 'EEEEE'];
  function rot90(rows) {
    const h = rows.length, w = rows[0].length, out = [];
    for (let x = 0; x < w; x++) { let r = ''; for (let y = h - 1; y >= 0; y--) r += rows[y][x]; out.push(r); }
    return out;
  }
  function headOff(c) { off(c.g.ux, c.g.uy + c.g.hy); }

  function drawMouth(L, c, x) {
    const soft = c.a.hairStyle.startsWith('B');
    box(L, x, 34, 2, 1, soft ? c.P.lip : c.P.mouth);
    if (soft) put(L, x + 1, 35, c.P.lipHi);
  }

  function drawFace(L, c) {
    const { P, st } = c;
    headOff(c);
    if (c.view === 'right') {
      for (const [y, x, w, h] of [[18, 22, 10, 2], [20, 19, 16, 3], [23, 18, 19, 8],
        [31, 20, 17, 3], [34, 23, 13, 2], [36, 26, 8, 1]]) box(L, x, y, w, h, P.skin);
      rim(L, P.skinSh);
      if (st.dir !== 'up') {
        for (const p of BLUSH_PTS[st.drunk]) paintOn(L, p[0] + 17, p[1], P.blush);
        drawMouth(L, c, 32);
      }
      return;
    }
    for (const [y, x, w, h] of [[18, 15, 18, 3], [21, 13, 22, 10], [31, 14, 20, 3],
      [34, 16, 16, 2], [36, 19, 10, 1]]) box(L, x, y, w, h, P.skin);
    rim(L, P.skinSh);
    if (c.view === 'up') { box(L, 11, 26, 1, 4, P.skin); box(L, 36, 26, 1, 4, P.skin); return; }
    for (const p of BLUSH_PTS[st.drunk]) { paintOn(L, p[0], p[1], P.blush); paintOn(L, 47 - p[0], p[1], P.blush); }
    drawMouth(L, c, 23);
  }

  function drawEyebrows(L, c) {
    if (c.view === 'up') return;
    headOff(c);
    const soft = c.a.hairStyle.startsWith('B'), color = soft ? c.P.browSoft : c.P.browStrong;
    if (c.view === 'right') {
      box(L, 29, 23, soft ? 3 : 4, 1, color);
    } else {
      box(L, 16, 23, soft ? 3 : 4, 1, color);
      box(L, 28, 23, soft ? 3 : 4, 1, color);
    }
  }

  function drawEyes(L, c) {
    const { P, a, st } = c;
    if (st.dir === 'up') return;
    headOff(c);
    const pal = { E: P.eyeD, P: P.eyeD, i: P.eyeI, l: P.eyeL, s: P.eyeS, w: P.eyeW };
    let def;
    if (st.eye === 'dizzy') { let rows = SPIRAL; for (let i = 0; i < st.phase; i++) rows = rot90(rows); def = { dy: 1, rows }; } else def = st.eye === 'normal' ? EYE_ART[a.eyes] : EYE_ART[st.eye];
    const top = 23 + def.dy;
    const inset = Math.floor((8 - def.rows[0].length) / 2);
    if (c.view === 'right') {
      art(L, def.rows, 27 + inset, top, pal, false);
    } else {
      art(L, def.rows, 14 + inset, top, pal, false);
      art(L, def.rows, 26 + inset, top, pal, true);
    }
  }

  function spikes(L, P, view) {
    const peaks = view === 'right' ? [[12, 11, 12, -3], [25, 10, 13, 2], [36, 13, 10, 3]]
      : [[12, 12, 12, -3], [25, 10, 14, 1], [37, 13, 10, 3]];
    for (const [x, y, width, lean] of peaks) {
      for (let row = 0; row <= 8; row++) {
        const w = Math.max(1, Math.round(width * row / 8));
        box(L, Math.round(x + lean * (1 - row / 8) - w / 2), y + row, w, 1, P.h);
      }
    }
  }

  function hairCap(L, c) {
    const { P, a, view } = c;
    const dx = view === 'right' ? -1 : 0;
    for (const [y, x, w, h] of CAP_BANDS) {
      if (a.hair !== 'spiky' || a.accessory === 'cap' || y >= 18) box(L, x + dx, y, w, h, P.h);
    }
    if (a.hair === 'spiky' && a.accessory !== 'cap') {
      spikes(L, P, view);
    } else if (a.hair === 'parted') {
      carve(L, (x, y) => y < 15);
      sell(L, 17 + dx, 20, 10, 10, 2.4, P.h);
      sell(L, 31 + dx, 20, 10, 10, 2.4, P.h);
      carve(L, (x, y) => y < 14 && Math.abs(x - (24 + dx)) < 14 - y);
    } else if (a.hair === 'slick') {
      carve(L, (x, y) => x < 22 && y < 16 - (x - 11) * 0.5);
    } else if (a.hair === 'bob') {
      box(L, 7 + dx, 21, 34, 9, P.h);
    }
  }

  function hairShine(L, c) {
    const { P, a } = c;
    const x0 = c.view === 'right' ? 12 : 13;
    const rows = a.hair === 'parted' ? ['.hhhh.....hhhh.', 'hhhhhh...hhhhhh', '..hhhh...hhhh..']
      : a.hair === 'slick' ? ['..........hhhh.', '......hhhhhhhh.', '..hhhhhhhhhh...', 'hhhhhhhh.......']
        : ['...hhhhhhhh....', '.hhhhhhhhhhhh..', '...hhhhhhhhhh..'];
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) if (row[x] === 'h') paintOn(L, x0 + x, 14 + y, P.hHi);
    });
    for (let y = 18; y < 35; y++) for (let x = 36; x < 41; x++) paintOn(L, x, y, P.hSh);
  }

  // 앞머리/정수리 머리카락
  function drawFrontHair(L, c) {
    const { P, a } = c;
    headOff(c);
    const style = a.hair, def = HAIR[style];
    if (c.view === 'down') {
      hairCap(L, c);
      carve(L, (x, y) => x >= 12 && x <= 35 && y >= def.bang[x - 12]);
      for (let x = 12; x <= 35; x++) paintOn(L, x, def.bang[x - 12] - 1, P.hSh);
    } else if (c.view === 'up') {
      hairCap(L, c);
      box(L, 16, 34, 16, 3, P.h);
      box(L, 18, 35, 12, 2, P.hSh);
    } else {
      hairCap(L, c);
      carve(L, (x, y) => x >= 23 && y >= (x < 27 ? 25 : 23));
      if (style === 'bob') box(L, 20, 24, 3, 12, P.h);
      if (style === 'long' || style === 'wavy') box(L, 20, 24, 3, 15, P.h);
      if (!['bob', 'long', 'wavy'].includes(style)) {
        box(L, 21, 28, 3, 3, P.skin); put(L, 22, 29, P.skinSh);
      }
    }
    hairShine(L, c);
    if (style === 'parted') {
      line(L, c.view === 'right' ? 23 : 24, 14, c.view === 'right' ? 22 : 23, 19, 1, 1, P.hSh);
    }
  }

  // 몸 뒤쪽 머리카락(긴 머리, 단발 옆머리, 포니테일)
  function drawBackHair(L, c) {
    const { P, a } = c;
    headOff(c);
    const style = a.hair;
    if (c.view === 'down') {
      if (style === 'long') {
        box(L, 9, 22, 30, 24, P.h);
        carve(L, (x, y) => y >= 36 && x >= 16 && x <= 31);
        box(L, 10, 46, 5, 1, P.h); box(L, 33, 46, 5, 1, P.h);
      }
      if (style === 'bob') sell(L, 24, 27, 17, 13, 2.6, P.h);
      if (style === 'ponytail') {
        sell(L, 39, 26, 6, 9, 2.4, P.h); sell(L, 38, 35, 5, 8, 2.4, P.h);
        box(L, 35, 18, 4, 2, P.hHi); box(L, 35, 41, 5, 2, P.h);
      }
    } else if (c.view === 'right') {
      if (style === 'long') { box(L, 7, 23, 16, 23, P.h); box(L, 8, 46, 13, 1, P.h); }
      if (style === 'bob') sell(L, 16, 27, 12, 13, 2.6, P.h);
      if (style === 'ponytail') {
        sell(L, 8, 26, 6, 9, 2.4, P.h); sell(L, 9, 35, 5, 8, 2.4, P.h);
        box(L, 10, 18, 3, 2, P.hHi); box(L, 9, 41, 5, 2, P.h);
      }
    } else if (c.view === 'up') {
      if (style === 'long') { box(L, 9, 22, 30, 24, P.h); box(L, 10, 46, 28, 1, P.h); }
      if (style === 'ponytail') { sell(L, 24, 28, 7, 11, 2.4, P.h); sell(L, 25, 37, 5, 7, 2.4, P.h); }
    }
    if (style === 'wavy') {
      const xs = c.view === 'right' ? [9, 17] : [11, 36];
      for (const x of xs) {
        [[25, 0], [34, x < 24 ? -1 : 1], [42, 0]].forEach(([y, dx]) => sell(L, x + dx, y, 5, 6, 2.4, P.h));
        box(L, x - 1, 31, 3, 3, P.hHi); box(L, x, 40, 2, 2, P.hHi);
      }
    }
    if (c.view === 'up' && style === 'bob') sell(L, 24, 27, 17, 13, 2.6, P.h);
    if (style === 'bob' && c.view !== 'up') carve(L, (x, y) => y >= 35 && (c.view === 'right' ? x >= 20 : x >= 17 && x <= 30));
    rim(L, P.hSh);
  }

  /* ---------- 몸 ---------- */
  const DIGITS = [
    ['xxx', 'x.x', 'x.x', 'x.x', 'xxx'], ['.x.', 'xx.', '.x.', '.x.', 'xxx'], ['xxx', '..x', 'xxx', 'x..', 'xxx'],
    ['xxx', '..x', 'xxx', '..x', 'xxx'], ['x.x', 'x.x', 'xxx', '..x', '..x'], ['xxx', 'x..', 'xxx', '..x', 'xxx'],
    ['xxx', 'x..', 'xxx', 'x.x', 'xxx'], ['xxx', '..x', '..x', '.x.', '.x.'], ['xxx', 'x.x', 'xxx', 'x.x', 'xxx'], ['xxx', 'x.x', 'xxx', '..x', 'xxx']
  ];
  const torsoBox = c => (c.view === 'right' ? [20, 8] : [18, 12]);
  const legXs = (c, g) => (c.view === 'right'
    ? { l: 21 + g.legX.l, r: 24 + g.legX.r }
    : { l: 19, r: 25 });
  const legLen = (g, side) => 6 - g.lf[side];

  function drawBase(L, c) {
    const { P, g } = c;
    off(0, g.ly);
    const lx = legXs(c, g);
    if (c.view === 'right') {
      box(L, lx.r, 45, 4, legLen(g, 'r'), P.skinSh);
      box(L, lx.l, 45, 4, legLen(g, 'l'), P.skin);
    } else {
      box(L, lx.l, 45, 4, legLen(g, 'l'), P.skin);
      box(L, lx.r, 45, 4, legLen(g, 'r'), P.skin);
    }
    off(g.ux, g.uy);
    const tb = torsoBox(c);
    box(L, tb[0] + 1, 37, tb[1] - 2, 8, P.skin);
    box(L, tb[0], 38, tb[1], 6, P.skin);
    armSkin(L, c);
  }

  function armPaths(c) {
    const g = c.g, sh = SHOULDER[c.view];
    const r = { from: sh.r, to: g.hand };
    let l;
    if (c.view === 'right') l = { from: sh.l, to: g.farHand || [26, 44] };
    else l = { from: sh.l, to: g.handL || (c.st.action === 'sit' ? [18, 43] : [16, 44]) };
    if (c.view !== 'right' && ['raise-glass', 'drink', 'cheers', 'pour'].indexOf(c.st.action) >= 0) l.to = [17, 43];
    return { r, l };
  }
  function armSkin(L, c) {
    const p = armPaths(c);
    if (c.view === 'right') {
      line(L, p.l.from[0], p.l.from[1], p.l.to[0], p.l.to[1], 3, 2, c.P.skinSh);
      return;
    }
    line(L, p.l.from[0], p.l.from[1], p.l.to[0], p.l.to[1], 3, 2, c.P.skin);
    line(L, p.r.from[0], p.r.from[1], p.r.to[0], p.r.to[1], 3, 2, c.P.skin);
  }

  function drawTop(L, c) {
    const { P, a, g } = c, o = P.o;
    off(g.ux, g.uy);
    const tb = torsoBox(c), tx = tb[0], tw = tb[1], cx = tx + tw / 2;
    box(L, tx + 1, 37, tw - 2, 8, o.main);
    box(L, tx, 38, tw, 6, o.main);
    box(L, tx + tw - 1, 38, 1, 6, o.sh);
    box(L, tx + 1, 44, tw - 2, 1, o.sh);
    if (o.kind === 'tee' && c.view !== 'up') box(L, Math.floor(cx) - 1, 38, 3, 1, o.sh);
    if (o.kind === 'uplus') {
      if (c.view === 'right') box(L, tx + 3, 37, tw - 3, 8, o.vest);
      else box(L, tx + 2, 37, tw - 4, 8, o.vest);
      box(L, tx + tw - 3, 38, 1, 6, o.vestSh);
      if (c.view === 'down') {
        art(L, ['x.x', 'x.x', 'xxx'], tx + 3, 39, { x: o.mark }, false);
        art(L, ['.x.', 'xxx', '.x.'], tx + tw - 6, 39, { x: o.mark }, false);
      }
    } else if (o.kind === 'jersey') {
      if (c.view === 'down') { box(L, Math.floor(cx) - 1, 38, 2, 7, o.trim2); box(L, Math.floor(cx) - 2, 37, 4, 1, o.trim); put(L, Math.floor(cx) - 1, 40, o.trim); put(L, Math.floor(cx) - 1, 42, o.trim); box(L, tx + 1, 39, 2, 2, o.trim2); }
      else if (c.view === 'up') {
        box(L, tx + 1, 37, tw - 2, 1, o.trim);
        const s = o.numTxt || '00', x0 = tx + Math.floor((tw - 7) / 2);
        art(L, DIGITS[+s[0]], x0, 39, { x: o.num }, false);
        art(L, DIGITS[+s[1]], x0 + 4, 39, { x: o.num }, false);
      } else { box(L, tx, 37, tw, 1, o.trim); box(L, tx + tw - 4, 40, 3, 2, o.trim2); }
    } else if (o.kind === 'track') {
      box(L, tx + 1, 38, 1, 7, o.trim); box(L, tx + tw - 2, 38, 1, 7, o.trim);
      if (c.view === 'down') box(L, Math.floor(cx), 38, 1, 7, o.trim2);
      if (c.view === 'up') { const s = o.numTxt, x0 = tx + Math.floor((tw - 7) / 2); art(L, DIGITS[+s[0]], x0, 39, { x: o.num }, false); art(L, DIGITS[+s[1]], x0 + 4, 39, { x: o.num }, false); }
    } else if (o.jeans && c.view === 'down') { box(L, tx + 2, 40, 2, 2, o.sh); }
    // 소매 + 팔(가까운 팔은 몸통 위에 다시 그린다)
    const p = armPaths(c), long = o.kind === 'track';
    const arm = (a2, skin, sleeve) => {
      line(L, a2.from[0], a2.from[1], a2.to[0], a2.to[1], 3, 2, skin);
      line(L, a2.from[0], a2.from[1], a2.to[0], a2.to[1], 3, 2, sleeve, long ? null : 3);
    };
    if (c.view === 'right') {
      arm(p.r, P.skin, o.main);
    } else { arm(p.l, P.skin, o.main); arm(p.r, P.skin, o.main); }
    if (o.kind === 'tattered') {
      box(L, tx + 1, 39, 3, 2, o.patch);
      put(L, tx + 2, 39, o.stain);
      box(L, tx + tw - 3, 42, 2, 2, P.skinSh);
      box(L, tx + 3, 43, 2, 2, P.skin);
      put(L, tx, 44, 0);
      put(L, tx + tw - 1, 43, 0);
      put(L, tx + tw - 2, 40, o.stain);
      for (const part of [p.r, p.l]) put(L, part.from[0] - 1, part.from[1] + 2, P.skin);
    }
    if (c.view === 'up' && (a.hair === 'long' || a.hair === 'wavy')) { box(L, 15, 36, 18, 12, P.h); carve(L, (x, y) => y >= 46 && (x <= 17 || x >= 30)); }
    if (c.view === 'up' && a.hair === 'ponytail') { box(L, 21, 33, 6, 12, P.h); box(L, 21, 31, 6, 2, P.hHi); }
  }

  function drawBottom(L, c) {
    const { P, g } = c, o = P.o;
    off(0, g.ly);
    const lx = legXs(c, g);
    const waist = c.view === 'right' ? [21, 7] : [19, 10];
    box(L, waist[0], 44, waist[1], 2, o.pants);
    const dress = (x, side) => {
      const n = Math.min(3, legLen(g, side));
      box(L, x, 45, 4, n, o.pants);
      if (o.stripe && o.len === 6) box(L, c.view === 'right' ? x + 3 : (side === 'l' ? x : x + 3), 45, 1, n, o.stripe);
      if (o.jeans) box(L, x + 1, 45 + n - 1, 2, 1, shade(o.pants, 0.8));
      if (o.kind === 'tattered') {
        put(L, x + 1, 45, o.patch);
        box(L, x + (side === 'l' ? 0 : 2), 45 + n - 1, 2, 1, 0);
      }
    };
    if (c.view === 'right') { dress(lx.r, 'r'); dress(lx.l, 'l'); } else { dress(lx.l, 'l'); dress(lx.r, 'r'); }
    if (c.a.hairStyle.startsWith('B')) {
      const left = c.view === 'right' ? 19 : 17;
      box(L, left + 1, 44, 12, 2, o.pants);
      box(L, left, 46, 14, 3, o.pants);
      for (const dx of [3, 7, 11]) box(L, left + dx, 46, 2, 3, shade(o.pants, 0.72));
      box(L, left, 48, 14, 1, o.stripe || o.sh);
      if (o.kind === 'tattered') {
        box(L, left + 3, 45, 2, 2, o.patch);
        box(L, left, 48, 2, 1, 0);
        box(L, left + 12, 47, 2, 2, 0);
        box(L, left + 5, 48, 2, 1, 0);
      }
    }
  }

  function drawShoes(L, c) {
    const { P, g } = c, o = P.o;
    off(0, g.ly);
    const lx = legXs(c, g);
    const shoe = (x, side) => {
      const lift = g.lf[side];
      if (c.view === 'right') { box(L, x - 1, 51 - lift, 6, 3, o.shoe); box(L, x - 1, 53 - lift, 6, 1, o.sole); put(L, x + 4, 52 - lift, o.shoe); }
      else { box(L, x - 1, 51 - lift, 6, 3, o.shoe); box(L, x - 1, 53 - lift, 6, 1, o.sole); box(L, x + 4, 51 - lift, 1, 3, INK); }
      box(L, x, 51 - lift, 3, 1, mix(o.shoe, WHITE, 0.25));
    };
    if (c.view === 'right') { shoe(lx.r, 'r'); shoe(lx.l, 'l'); } else { shoe(lx.l, 'l'); shoe(lx.r, 'r'); }
  }

  /* ---------- 액세서리 / 손에 든 것 ---------- */
  function drawAccessory(L, c) {
    const { P, a } = c, o = P.o;
    headOff(c);
    const acc = a.accessory;
    if (acc === 'glasses' && c.view !== 'up') {
      if (c.view === 'down') {
        for (const x of [13, 25]) {
          box(L, x + 1, 24, 8, 1, P.glassFr); box(L, x + 1, 30, 8, 1, P.glassFr);
          box(L, x, 25, 1, 5, P.glassFr); box(L, x + 9, 25, 1, 5, P.glassFr);
        }
        box(L, 23, 27, 2, 1, P.glassFr);
      } else {
        box(L, 27, 24, 8, 1, P.glassFr); box(L, 27, 30, 8, 1, P.glassFr);
        box(L, 26, 25, 1, 5, P.glassFr); box(L, 35, 25, 1, 5, P.glassFr);
        box(L, 22, 27, 4, 1, P.glassFr);
      }
    } else if (acc === 'cap') {
      const main = o.cap || P.capNavy, sh = shade(main, 0.72), hi = mix(main, WHITE, 0.3);
      for (const [y, x, w, h] of CAP_BANDS) if (y <= 18) box(L, x, y, w, h, main);
      box(L, 15, 14, 9, 2, hi); box(L, 35, 17, 4, 6, sh);
      if (c.view === 'right') { box(L, 28, 22, 14, 2, sh); box(L, 31, 24, 10, 1, sh); }
      else if (c.view === 'up') { box(L, 18, 23, 12, 2, sh); box(L, 21, 24, 6, 1, hi); }
      else { box(L, 11, 22, 26, 2, sh); box(L, 13, 24, 22, 1, sh); }
    } else if (acc === 'ribbon') {
      const rx = c.view === 'right' ? 9 : 11;
      art(L, ['ww.......ww', 'wwww...wwww', 'wwwwpppwwww', '.wwspppsww.', '..ss...ss..', '..w.....w..'],
        rx, 17, { w: P.ribbon, s: P.ribbonSh, p: P.ribbonPk }, false);
    } else if (acc === 'headset') {
      const band = (cx, cy, rx, ry, yMax) => { for (let y = 10; y <= yMax; y++) for (let x = 5; x < 43; x++) { const v = Math.pow((x + 0.5 - cx) / rx, 2) + Math.pow((y + 0.5 - cy) / ry, 2); if (v > 0.9 && v < 1.18) put(L, x, y, P.hsBand); } };
      if (c.view === 'right') {
        band(23, 23, 17, 12, 24);
        box(L, 19, 26, 5, 7, P.hsCup); box(L, 20, 28, 3, 2, P.hsAccent);
        line(L, 24, 32, 30, 35, 1, 1, P.hsBand); box(L, 30, 35, 2, 2, P.hsCup);
      } else {
        band(24, 23, 17, 12, 24);
        box(L, 6, 24, 5, 8, P.hsCup); box(L, 37, 24, 5, 8, P.hsCup);
        box(L, 7, 27, 2, 3, P.hsAccent); box(L, 39, 27, 2, 3, P.hsAccent);
        if (c.view === 'down') { line(L, 10, 32, 16, 35, 1, 1, P.hsBand); box(L, 16, 35, 2, 2, P.hsCup); }
      }
    } else if (acc === 'catEars') {
      const rows = ['....o....', '...omo...', '..omimo..', '.omiiimo.', 'omiiiiimo', 'ommmmmmmo', '.ooooooo.'];
      const pal = { o: INK, m: K('#484052'), i: c.view === 'up' ? K('#726075') : K('#efa8bb') };
      for (const x of c.view === 'right' ? [10, 27] : [8, 31]) art(L, rows, x, 11, pal, false);
    } else if (acc === 'bunnyEars') {
      const rows = ['.oooo.', 'omwwmo', 'omwwmo', 'omiimo', 'omiimo', 'omiimo',
        'omiimo', 'omiimo', 'omwwmo', 'omwwmo', '.ommo.', '..oo..'];
      const pal = { o: INK, m: K('#f4dedb'), w: WHITE, i: c.view === 'up' ? K('#e0bfc9') : K('#ee9fb7') };
      for (const x of c.view === 'right' ? [12, 25] : [12, 29]) art(L, rows, x, 10, pal, false);
    } else if (acc === 'crown') {
      const x0 = c.view === 'right' ? 15 : 16;
      const gold = K('#edbf51'), hi = K('#fff0ad'), sh = K('#b77b35');
      for (const x of [x0 + 2, x0 + 8, x0 + 14]) {
        put(L, x, 10, hi); box(L, x - 1, 11, 3, 3, gold); box(L, x - 2, 14, 5, 2, gold);
      }
      box(L, x0, 15, 17, 5, gold); box(L, x0 + 1, 16, 15, 1, hi); box(L, x0, 19, 17, 1, sh);
      box(L, x0 + 7, 17, 3, 2, K('#dc6284'));
      for (const x of [x0 + 3, x0 + 12]) put(L, x, 17, K('#82d4ce'));
    } else if (acc === 'starClip') {
      const rows = ['....m....', '...mmm...', '...mmm...', 'mmmmmmmmm', '.mmmmmmm.',
        '..mmmmm..', '..mmmmm..', '.mmm.mmm.', '.mm...mm.'];
      const x = c.view === 'right' ? 10 : 8, y = c.view === 'right' ? 18 : 16;
      art(L, rows, x, y, { m: K('#f6cb59') }, false);
      box(L, x + 3, y + 3, 3, 2, K('#fff1b1')); put(L, x + 4, y + 6, K('#bc803e'));
    }
  }

  function drawHandItem(L, c) {
    const it = c.st.item;
    if (!it) return;
    const { g } = c;
    off(g.ux, g.uy);
    const spr = it.type === 'bottle' ? bottleBuf(it) : glassBuf(it);
    const hand = g.hand;
    const a = c.st.action;
    let x = hand[0], y = hand[1] + 2;
    if (it.type === 'bottle') { blitBuf(L, flipV(spr), x, y + spr.h - 1, 0.5, 1); return; }
    if (a === 'drink' && c.view === 'down') { x = hand[0] - 1; y = hand[1] + 1; }
    if (a === 'idle' || a === 'walk') y = hand[1] + 3;
    blitBuf(L, spr, x, y, 0.5, 1);
  }

  /* ---------- 소품(잔/병/하트...)을 작은 버퍼로 만든다 ---------- */
  const GLASS_ART = {
    shot: { rows: ['oooooo', 'oiiiio', 'oiiiio', '.oiio.', '.oiio.', '..oo..'], x: [1, 4], y: [1, 4] },
    mug: { rows: ['.oooooo..', '.oiiiiooo', '.oiiiio.o', '.oiiiio.o', '.oiiiio.o', '.oiiiiooo', '.oiiiio..', '.oiiiio..', '.oooooo..'], x: [2, 5], y: [1, 7] },
    highball: { rows: ['oooooo', 'oiiiio', 'oiiiio', 'oiiiio', 'oiiiio', 'oiiiio', 'oiiiio', 'oiiiio', 'oooooo'], x: [1, 4], y: [1, 7] },
    wine: { rows: ['.ooooo.', 'oiiiiio', 'oiiiiio', 'oiiiiio', '.oiiio.', '..ooo..', '...o...', '...o...', '..ooo..'], x: [1, 5], y: [1, 4] },
    cocktail: { rows: ['ooooooooo', '.oiiiiio.', '..oiiio..', '...ooo...', '....o....', '....o....', '..ooooo..'], x: [2, 6], y: [1, 2] }
  };
  function glassBuf(it) {
    const def = GLASS_ART[it.glass] || GLASS_ART.mug, rows = def.rows;
    const w = rows[0].length, h = rows.length;
    const B = { w, h, px: new Uint32Array(w * h) };
    const liquid = K(it.color || '#f2b632'), edge = K('#31506b'), empty = K('#e9f6ff'), foam = WHITE;
    const iy0 = def.y[0], iy1 = def.y[1];
    const span = iy1 - iy0 + 1, lvl = Math.max(0, Math.min(1, +it.level || 0));
    const fill = lvl <= 0 ? 0 : Math.max(1, Math.round(lvl * span));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ch = rows[y][x];
        if (ch === '.') continue;
        let col = edge;
        if (ch === 'i') {
          const fromBottom = iy1 - y;
          if (fromBottom < fill) col = it.foam && fromBottom === fill - 1 && fill > 1 ? foam : liquid;
          else col = empty;
        }
        B.px[y * w + x] = col;
      }
    }
    if (def.rows[1][1] === 'i' && lvl > 0) B.px[1 * w + (it.glass === 'wine' ? 1 : 1)] = B.px[1 * w + 1] ? mix(B.px[1 * w + 1], WHITE, 0.45) : 0;
    if (it.glass === 'cocktail') B.px[0 * w + 8] = K('#e0242c');
    return B;
  }
  const BOTTLES = {
    soju: { body: '#3f9a5a', label: '#ffffff', cap: '#1d5a35', h: 13 }, beer: { body: '#7a4a22', label: '#f2e6c8', cap: '#d9a441', h: 13 },
    yeontae: { body: '#cfe7e4', label: '#c8242b', cap: '#c8242b', h: 13 }, whisky: { body: '#a8671f', label: '#f2e6c8', cap: '#2b1d2c', h: 12 },
    wine: { body: '#27402f', label: '#c8242b', cap: '#7a1b24', h: 14 }, shaker: { body: '#c9d2dc', label: '#6e35d4', cap: '#e8eef4', h: 12 },
    soda: { body: '#6ec1e8', label: '#ffffff', cap: '#e0242c', h: 12 }
  };
  function bottleBuf(it) {
    const d = BOTTLES[it.bottle] || BOTTLES.soju, h = d.h, w = 5;
    const B = { w, h, px: new Uint32Array(w * h) }, edge = K('#2b1d2c'), body = K(d.body), body2 = shade(body, 0.78);
    const set = (x, y, c) => { B.px[y * w + x] = c; };
    for (let y = 0; y < h; y++) {
      const neck = y < 4, x0 = neck ? 1 : 0, x1 = neck ? 3 : 4;
      for (let x = x0; x <= x1; x++) set(x, y, x === x1 && !neck ? body2 : body);
    }
    for (let y = 0; y < h; y++) { const neck = y < 4, x0 = neck ? 1 : 0, x1 = neck ? 3 : 4; if (B.px[y * w + x0]) set(x0, y, mix(body, WHITE, 0.15)); if (y === 0 || y === h - 1) for (let x = x0; x <= x1; x++) set(x, y, y === 0 ? K(d.cap) : edge); }
    for (let x = 0; x < w; x++) for (let y = 7; y <= 9; y++) if (B.px[y * w + x]) set(x, y, K(d.label));
    if (it.bottle === 'shaker') for (let y = 4; y <= 6; y++) for (let x = 0; x < w; x++) set(x, y, K(d.cap));
    return B;
  }
  const flipV = B => { const o = { w: B.w, h: B.h, px: new Uint32Array(B.px.length) }; for (let y = 0; y < B.h; y++) for (let x = 0; x < B.w; x++) o.px[(B.h - 1 - y) * B.w + x] = B.px[y * B.w + x]; return o; };
  function blitBuf(L, B, ax, ay, fx, fy) {
    const x0 = Math.round(ax - B.w * fx), y0 = Math.round(ay - B.h * fy);
    // 소품 윤곽선(글라스는 자체 윤곽이 있어 몸 위에서도 구분된다)
    for (let y = 0; y < B.h; y++) for (let x = 0; x < B.w; x++) { const c = B.px[y * B.w + x]; if (c) put(L, x0 + x, y0 + y, c); }
  }

  const HEART = [
    '.ooo...ooo.', 'oRRRo.oRRRo', 'oRWRRoRRRRo', 'oRWRRRRRRRo', 'oRRRRRRRRro', '.oRRRRRRro.', '..oRRRRro..', '...oRRro...', '....oRo....', '.....o.....'
  ];
  function heartBuf() {
    const w = 11, h = 10, B = { w, h, px: new Uint32Array(w * h) };
    const pal = { o: K('#7a1233'), R: K('#ff4f7b'), r: K('#d62c5c'), W: WHITE };
    HEART.forEach((r, y) => { for (let x = 0; x < w; x++) { const c = pal[r[x]]; if (c) B.px[y * w + x] = c; } });
    return B;
  }
  function dustBuf(frame) {
    const w = 18, h = 10, B = { w, h, px: new Uint32Array(w * h) };
    const dust = K('#ece6f4'), dust2 = K('#c9c0d8');
    const blobs = [[[4, 7, 2], [9, 8, 2], [14, 7, 2]], [[3, 6, 3], [9, 6, 3], [15, 6, 3]], [[2, 4, 2], [9, 3, 2], [16, 4, 2]]][Math.max(0, Math.min(2, frame | 0))];
    for (const b of blobs) for (let y = -b[2]; y <= b[2]; y++) for (let x = -b[2]; x <= b[2]; x++) {
      if (x * x + y * y > b[2] * b[2] + 1) continue;
      const px = b[0] + x, py = b[1] + y;
      if (px >= 0 && px < w && py >= 0 && py < h) B.px[py * w + px] = y > 0 ? dust2 : dust;
    }
    return B;
  }
  function sparkleBuf(frame) {
    const w = 9, h = 9, B = { w, h, px: new Uint32Array(w * h) };
    const r = [1, 3, 2][Math.max(0, Math.min(2, frame | 0))], y0 = K('#ffe27a'), c = 4;
    for (let i = -r; i <= r; i++) { B.px[c * w + c + i] = i === 0 ? WHITE : y0; B.px[(c + i) * w + c] = i === 0 ? WHITE : y0; }
    return B;
  }
  function emoteBuf(kind, frame) {
    if (kind === 'heart') return heartBuf();
    const w = 18, h = 20, B = { w, h, px: new Uint32Array(w * h) };
    const put = (x, y, color) => { if (x >= 0 && x < w && y >= 0 && y < h) B.px[y * w + x] = color; };
    const rect = (x, y, width, height, color) => {
      for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) put(x + i, y + j, color);
    };
    const ink = K('#493047'), tear = K('#52b8ed'), light = K('#d4f4ff');
    const fill = K(kind === 'angry' ? '#f3947d' : kind === 'cry' ? '#c1dcf0' : '#ffe396');
    const shadow = K(kind === 'angry' ? '#d86565' : kind === 'cry' ? '#8db7d7' : '#e8b960');
    for (let y = 3; y < 18; y++) for (let x = 1; x < 17; x++) {
      if (((x - 8.5) / 7.5) ** 2 + ((y - 10) / 7.5) ** 2 >= 1) continue;
      put(x, y, y > 14 ? shadow : fill);
    }
    const face = B.px.slice();
    for (let y = 3; y < 18; y++) for (let x = 1; x < 17; x++) {
      const i = y * w + x;
      if (face[i] && (!face[i - 1] || !face[i + 1] || !face[i - w] || !face[i + w])) put(x, y, ink);
    }
    if (kind === 'smile' || kind === 'laugh') {
      for (const x of [4, 11]) {
        rect(x + 1, 7, 2, 1, ink); put(x, 8, ink); put(x + 3, 8, ink);
      }
      if (kind === 'smile') {
        put(5, 12, ink); put(12, 12, ink); rect(6, 13, 6, 1, ink);
        if (frame) rect(7, 14, 4, 1, K('#e27785'));
      } else {
        rect(5, 11, 8, frame ? 5 : 4, ink);
        rect(6, 11, 6, 1, WHITE); rect(7, 14, 4, 1, K('#ef8a9b'));
        rect(1, frame ? 10 : 9, 2, 3, tear); rect(15, frame ? 9 : 10, 2, 3, tear);
      }
      for (const x of [3, 13]) rect(x, 11, 2, 1, K('#ef9c94'));
    } else if (kind === 'cry') {
      for (const x of [4, 11]) {
        rect(x, 8, 3, 1, ink); put(x + 2, 7, ink);
        rect(x + 1, 10, 2, frame ? 8 : 6, tear);
        rect(x + 1, 11, 1, frame ? 6 : 4, light);
      }
      rect(7, 13, 4, 1, ink); put(6, 14, ink); put(11, 14, ink);
    } else if (kind === 'angry') {
      rect(4, 7, 2, 1, ink); rect(6, 8, 2, 1, ink);
      rect(10, 8, 2, 1, ink); rect(12, 7, 2, 1, ink);
      rect(5, 10, 2, 2, ink); rect(11, 10, 2, 2, ink);
      rect(7, 13, 4, 1, ink); put(6, 14, ink); put(11, 14, ink);
      const red = K('#d53a54'), x = frame ? 13 : 12;
      rect(x, 0, 2, 2, red); rect(x + 4, 0, 2, 2, red);
      rect(x, 4, 2, 2, red); rect(x + 4, 4, 2, 2, red);
      rect(x + 2, 2, 2, 2, red);
    }
    return B;
  }
  function bufCanvas(B) {
    const cv = document.createElement('canvas');
    cv.width = B.w; cv.height = B.h;
    const g = cv.getContext('2d'), id = g.createImageData(B.w, B.h);
    for (let i = 0; i < B.px.length; i++) { const c = B.px[i]; if (c) { id.data[i * 4] = (c >> 16) & 255; id.data[i * 4 + 1] = (c >> 8) & 255; id.data[i * 4 + 2] = c & 255; id.data[i * 4 + 3] = 255; } }
    g.putImageData(id, 0, 0);
    return cv;
  }
  function item(kind, opts) {
    opts = opts || {};
    if (kind === 'glass') return bufCanvas(glassBuf(opts));
    if (kind === 'bottle') return bufCanvas(bottleBuf(opts));
    if (kind === 'heart') return bufCanvas(heartBuf());
    if (kind === 'emote') return bufCanvas(emoteBuf(opts.kind, opts.frame));
    if (kind === 'dust') return bufCanvas(dustBuf(opts.frame));
    if (kind === 'sparkle') return bufCanvas(sparkleBuf(opts.frame));
    return bufCanvas({ w: 1, h: 1, px: new Uint32Array(1) });
  }

  /* ---------- 합성 ---------- */
  const SLOTS = new Map();
  function slotVariant(layer, a, st) {
    switch (layer) {
      case 'base': return a.base;
      case 'backHair': case 'frontHair': return a.hair;
      case 'face': return `${a.base}-blush${st.drunk}`;
      case 'eyebrows': return a.hairStyle.startsWith('B') ? 'soft' : 'strong';
      case 'eyes': return st.eye === 'normal' ? `normal-${a.eyes}` : st.eye;
      case 'top': case 'bottom': case 'shoes': return a.outfit;
      case 'accessory': return a.accessory;
      default: return st.item ? (st.item.glass || st.item.bottle || st.item.type) : '';
    }
  }
  function slotLookup(layer, a, st) {
    if (!SLOTS.size) return null;
    const v = slotVariant(layer, a, st), tail = `-${st.action}-${st.frame}`;
    const own = SLOTS.get(`${layer}/${v}/${st.dir}${tail}`);
    if (own) return own;
    const right = st.dir === 'left' ? SLOTS.get(`${layer}/${v}/right${tail}`) : null;
    return right ? mirror(right) : null;
  }
  const LAYER_FN = { base: drawBase, backHair: drawBackHair, face: drawFace, eyebrows: drawEyebrows, eyes: drawEyes, frontHair: drawFrontHair, top: drawTop, bottom: drawBottom, shoes: drawShoes, accessory: drawAccessory, handItem: drawHandItem };
  const EDGE = {
    base: P => P.faceEdge, backHair: null, face: P => P.faceEdge, eyebrows: null, eyes: null, frontHair: P => P.hOl,
    top: P => shade(P.o.main, 0.55), bottom: P => shade(P.o.pants, 0.55), shoes: () => INK, accessory: () => INK, handItem: null
  };

  function renderFrame(a, st) {
    const view = st.dir === 'left' ? 'right' : st.dir;
    const c = { a, st, view, P: palette(a, st.drunk), g: null };
    c.g = geom(st, view);
    const F = newBuf();
    for (let i = 0; i < LAYERS.length; i++) {
      const name = LAYERS[i];
      let L = slotLookup(name, a, st);
      let edge = null;
      if (!L) {
        L = newBuf();
        LAYER_FN[name](L, c);
        edge = EDGE[name] ? EDGE[name](c.P) : null;
        off(0, 0);
        if (st.dir === 'left') L = mirror(L);
      }
      addLayer(F, L, edge);
    }
    outline(F, INK);
    return F;
  }

  const CACHE = new Map();
  function itemSig(it) {
    if (!it) return '';
    return it.type === 'bottle' ? `b${it.bottle}${it.color}` : `g${it.glass}${it.color}${Math.round((+it.level || 0) * 8)}${it.foam ? 'f' : ''}`;
  }
  function toCanvas(F) {
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d'), id = g.createImageData(W, H);
    for (let i = 0; i < F.length; i++) { const c = F[i]; if (c) { id.data[i * 4] = (c >> 16) & 255; id.data[i * 4 + 1] = (c >> 8) & 255; id.data[i * 4 + 2] = c & 255; id.data[i * 4 + 3] = 255; } }
    g.putImageData(id, 0, 0);
    return cv;
  }
  function frame(avatar, pose) {
    const a = normAvatar(avatar), st = resolvePose(pose);
    const key = `${a.base}${a.hair}${a.hairColor}${a.eyes}${a.outfit}${a.accessory}|${st.dir}${st.action}${st.frame}|${st.drunk}${st.drunk > 1 ? st.eye + st.phase : ''}${st.sway}|${itemSig(st.item)}`;
    let cv = CACHE.get(key);
    if (cv) { CACHE.delete(key); CACHE.set(key, cv); return cv; }
    cv = toCanvas(renderFrame(a, st));
    CACHE.set(key, cv);
    if (CACHE.size > CACHE_MAX) CACHE.delete(CACHE.keys().next().value);
    return cv;
  }
  function draw(ctx, avatar, pose, x, y, scale) {
    scale = scale > 0 ? scale : SCALE;
    const cv = frame(avatar, pose), prev = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(cv, Math.round(x - FRAME.ax * scale), Math.round(y - FRAME.ay * scale), W * scale, H * scale);
    ctx.imageSmoothingEnabled = prev;
  }
  // 채팅은 얼굴 초상, 선택 썸네일은 긴 머리와 장식까지 담는다.
  const PORTRAIT_CACHE = new Map();
  function portrait(avatar, size, opts) {
    size = size || 64;
    const a = normAvatar(avatar);
    const full = !!(opts && opts.full);
    const key = `${a.base}${a.hair}${a.hairColor}${a.eyes}${a.outfit}${a.accessory}|${size}|${(opts && opts.drunkLevel) || 0}|${full}`;
    let cv = PORTRAIT_CACHE.get(key);
    if (!cv) {
      cv = document.createElement('canvas');
      cv.width = cv.height = size;
      const g = cv.getContext('2d');
      g.imageSmoothingEnabled = false;
      const crop = full ? [0, 7, 48, 48] : [8, 9, 32, 32];
      g.drawImage(frame(a, { dir: 'down', action: 'idle', frame: 0, drunkLevel: (opts && opts.drunkLevel) || 0 }), ...crop, 0, 0, size, size);
      if (PORTRAIT_CACHE.size > 120) PORTRAIT_CACHE.clear();
      PORTRAIT_CACHE.set(key, cv);
    }
    const out = document.createElement('canvas');
    out.width = out.height = size;
    out.getContext('2d').drawImage(cv, 0, 0);
    return out;
  }

  function eyeThumbnail(avatar) {
    const a = normAvatar(avatar), st = resolvePose({ dir: 'down', action: 'idle', frame: 0 });
    const c = { a, st, view: 'down', P: palette(a, 0), g: geom(st, 'down') };
    const F = newBuf();
    box(F, 0, 0, W, H, c.P.skin);
    drawEyebrows(F, c);
    drawEyes(F, c);
    off(0, 0);
    const cv = document.createElement('canvas');
    cv.width = 96; cv.height = 48;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(toCanvas(F), 12, 21, 24, 12, 0, 0, 96, 48);
    return cv;
  }

  /* ---------- 에셋 슬롯 불러오기 ---------- */
  function loadAssets(url) {
    return fetch(url || '/assets/avatar/manifest.json', { cache: 'no-cache' })
      .then(r => (r.ok ? r.json() : null))
      .then(manifest => {
        const slots = manifest && manifest.slots ? Object.entries(manifest.slots) : [];
        return Promise.all(slots.map(([key, src]) => new Promise(resolve => {
          const img = new Image();
          img.onload = () => {
            const cv = document.createElement('canvas');
            cv.width = W; cv.height = H;
            const g = cv.getContext('2d');
            g.drawImage(img, 0, 0, W, H);
            const d = g.getImageData(0, 0, W, H).data, B = newBuf();
            for (let i = 0; i < B.length; i++) if (d[i * 4 + 3] > 127) B[i] = mk(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
            SLOTS.set(key, B);
            resolve();
          };
          img.onerror = () => resolve();
          img.src = src;
        }))).then(() => { if (slots.length) CACHE.clear(); });
      })
      .catch(() => {});
  }

  function anchors(avatar, pose) {
    const st = resolvePose(pose), g = geom(st, st.dir === 'left' ? 'right' : st.dir);
    const hx = st.dir === 'left' ? W - 1 - g.hand[0] - g.ux : g.hand[0] + g.ux;
    return {
      head: { x: 0, y: (9 + g.uy + g.hy - FRAME.ay) * SCALE },
      hand: { x: (hx - FRAME.ax) * SCALE, y: (g.hand[1] + g.uy - FRAME.ay) * SCALE }
    };
  }
  root.TudariSprites = { FRAME, SCALE, SIT_LIFT, REFERENCE_HEIGHT, anchors, DIRS, LAYERS, ACTIONS, frame, draw, portrait, eyeThumbnail, item, normalize: normAvatar, loadAssets };
})(typeof window !== 'undefined' ? window : this);
