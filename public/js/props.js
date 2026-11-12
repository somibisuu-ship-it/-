/*
 * 투다리 중앙 술자리 소품 레이어 (window.TudariProps)
 * 제공된 배경 PNG는 그대로 두고, 그 위에 런타임으로 픽셀 아트를 얹는다.
 *   - 원목 데크: 배경에 구워진 식탁 장면(사람 포함)을 가린다.
 *   - 바닥 보정: 데크 뒤쪽에서 삐져나오는 구워진 인물은 빈 바닥으로 덮는다.
 *   - 테이블 + 의자 6개: 서버 좌석 위치(TudariWorld.SEATS)와 같은 좌표. 깊이 정렬되는 조각으로 내보낸다.
 *   - 출입문: 넓은 유리문 오버레이와 안/밖 상태에 맞는 표지.
 * 1 아트 픽셀 = 4x4 월드 픽셀. 좌표는 모두 월드 픽셀(1536x1024).
 */
(function (root) {
  'use strict';

  // 빈 배경(사람이 없는 배경)을 받으면 false 로 바꿔 인물 덮개를 끈다.
  const hasBakedPeople = true;
  const S = 4;
  const DECK = { cx: 785, cy: 605, rx: 300, ry: 183, n: 2.3, side: 10 };
  const DOOR = root.TudariWorld.DOOR.bounds;

  const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const hexN = h => parseInt(h.slice(1), 16);
  const K = h => 0x1000000 | hexN(h);
  const PAL = {
    out: K('#2a1a14'), outDeep: K('#1a100c'),
    wood: K('#b07a43'), woodDk: K('#8a5a2e'), woodLt: K('#d9a066'), woodDeep: K('#6e4524'), woodHi: K('#e8b87c'),
    char: K('#2b2a30'), charDk: K('#1f1e24'), charLt: K('#3b3a42'), charHi: K('#55545d'),
    red: K('#c8242b'), redDk: K('#8e1a20'), redLt: K('#e2565a'), white: K('#f4efe6'), cream: K('#e8dcc4'), steel: K('#9aa3ad')
  };

  /* ---------- 작은 픽셀 캔버스 ---------- */
  class Pix {
    constructor(w, h) { this.w = w; this.h = h; this.u = new Uint32Array(w * h); }
    set(x, y, c) { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.u[y * this.w + x] = c; }
    get(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.u[y * this.w + x] : 0; }
    rect(x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c); }
    ell(cx, cy, rx, ry, c) {
      for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy < 1) this.set(x, y, c);
      }
    }
    outline(c) {
      const src = this.u.slice();
      for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
        if (src[y * this.w + x]) continue;
        if ((x > 0 && src[y * this.w + x - 1]) || (x < this.w - 1 && src[y * this.w + x + 1]) || (y > 0 && src[(y - 1) * this.w + x]) || (y < this.h - 1 && src[(y + 1) * this.w + x])) this.u[y * this.w + x] = c;
      }
    }
    canvas(scale) {
      const small = mkCanvas(this.w, this.h), g = small.getContext('2d'), id = g.createImageData(this.w, this.h);
      for (let i = 0; i < this.u.length; i++) { const c = this.u[i]; if (c) { id.data[i * 4] = (c >> 16) & 255; id.data[i * 4 + 1] = (c >> 8) & 255; id.data[i * 4 + 2] = c & 255; id.data[i * 4 + 3] = 255; } }
      g.putImageData(id, 0, 0);
      if (!scale || scale === 1) return small;
      const big = mkCanvas(this.w * scale, this.h * scale), bg = big.getContext('2d');
      bg.imageSmoothingEnabled = false;
      bg.drawImage(small, 0, 0, big.width, big.height);
      return big;
    }
  }
  const hash2 = (a, b) => { let h = (a * 374761393 + b * 668265263) >>> 0; h = ((h ^ (h >>> 13)) * 1274126177) >>> 0; return (h ^ (h >>> 16)) >>> 0; };

  /* ---------- 원목 데크 ---------- */
  function buildDeck() {
    const { cx, cy, rx, ry, n, side } = DECK;
    const x0 = Math.floor((cx - rx - 24) / S) * S, y0 = Math.floor((cy - ry - 24) / S) * S;
    const x1 = Math.ceil((cx + rx + 24) / S) * S, y1 = Math.ceil((cy + ry + side + 24) / S) * S;
    const w = (x1 - x0) / S, h = (y1 - y0) / S;
    const px = new Pix(w, h);
    const kk = (wx, wy) => Math.pow(Math.pow(Math.abs(wx - cx) / rx, n) + Math.pow(Math.abs(wy - cy) / ry, n), 1 / n);
    const kRim = 1 - 13 / rx, kInA = 1 - 21 / rx;
    const plankH = 4;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const wx = x0 + (i + 0.5) * S, wy = y0 + (j + 0.5) * S;
      const k = kk(wx, wy), kSide = kk(wx, wy - side);
      if (k <= 1) {
        let c;
        if (k > kRim) {
          const edge = (1 - k) * rx;
          c = edge < S * 0.9 ? (wy < cy ? PAL.charHi : PAL.charLt) : PAL.char;
        } else if (k > kInA) {
          c = k > kInA + (kRim - kInA) * 0.5 ? PAL.woodDeep : PAL.red;
        } else {
          const row = Math.floor(j / plankH), inRow = ((j % plankH) + plankH) % plankH;
          const len = 17 + (hash2(row, 7) % 7), off = hash2(row, 3) % len;
          const col = Math.floor((i + off) / len);
          const tone = hash2(row * 31 + col, 11) % 3;
          c = tone === 0 ? PAL.wood : tone === 1 ? PAL.woodLt : PAL.woodDk;
          if (tone === 1) c = PAL.wood;
          if (inRow === 0) c = PAL.woodDk;
          if ((i + off) % len === 0) c = PAL.woodDeep;
          if (inRow === 1 && hash2(i * 13 + row, 5) % 9 === 0) c = tone === 2 ? PAL.woodDeep : PAL.woodLt;
        }
        px.set(i, j, c);
      } else if (kSide <= 1) {
        let c = (i % 11 === 5) ? PAL.charLt : PAL.char;
        if (kk(wx, wy - side - S) > 1) c = PAL.charDk;
        px.set(i, j, c);
      }
    }
    px.outline(PAL.outDeep);
    return { canvas: px.canvas(S), x: x0, y: y0 };
  }

  // 데크 둘레의 부드러운 그림자
  function deckShadow(g) {
    const { cx, cy, rx, ry, side } = DECK;
    g.save();
    g.translate(cx, cy + side + 8);
    g.scale(1, ry / rx);
    const grad = g.createRadialGradient(0, 0, rx * 0.86, 0, 0, rx * 1.12);
    grad.addColorStop(0, 'rgba(30,18,22,.34)');
    grad.addColorStop(1, 'rgba(30,18,22,0)');
    g.fillStyle = grad;
    g.beginPath(); g.arc(0, 0, rx * 1.12, 0, Math.PI * 2); g.fill();
    g.restore();
  }

  /* ---------- 테이블 ---------- */
  function buildTable(world) {
    const T = world.TABLE, rx = Math.round(T.top.rx / S), ry = Math.round(T.top.ry / S), hh = Math.round(T.height / S);
    const w = rx * 2 + 6, h = ry * 2 + hh + 6, cx = w / 2, cy = ry + 3;
    const px = new Pix(w, h);
    // 옆면(숯색 원통) + 빨간 띠
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const inTop = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 < 1;
      const inBot = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy - hh) / ry) ** 2 < 1;
      const inMid = Math.abs(x + 0.5 - cx) < rx && y >= cy && y <= cy + hh;
      if (!inTop && !inBot && !inMid) continue;
      const rel = y - cy;
      let c = (x % 7 === 3) ? PAL.woodDeep : PAL.woodDk;
      if (!inTop && rel > 3 && rel < 6) c = PAL.red;
      else if (!inTop && rel === 6) c = PAL.redDk;
      if (y > cy + hh + ry - 4) c = PAL.charDk;
      else if (y > cy + hh + ry - 6) c = PAL.char;
      px.set(x, y, c);
    }
    // 상판
    px.ell(cx, cy, rx, ry, PAL.woodHi);
    px.ell(cx, cy + 0.6, rx - 1, ry - 1, PAL.wood);
    px.ell(cx, cy + 1, rx - 3, ry - 2.4, PAL.woodLt);
    px.ell(cx, cy + 1.4, rx - 4.4, ry - 3.6, PAL.wood);
    for (let y = Math.round(cy - ry + 5); y < cy + ry - 4; y += 3) for (let x = Math.round(cx - rx + 8); x < cx + rx - 8; x++) {
      if (px.get(x, y) === PAL.wood && hash2(x >> 2, y) % 5 < 2) px.set(x, y, PAL.woodDk);
    }
    // 가운데 냄비(오뎅탕)
    px.ell(cx, cy + 0.5, 11, 6.4, PAL.charDk);
    px.ell(cx, cy, 11, 6.2, PAL.charHi);
    px.ell(cx, cy + 0.4, 9.2, 5, PAL.char);
    px.ell(cx, cy + 0.6, 8.2, 4.2, K('#d9482a'));
    for (const p of [[-5, 0], [-1, -2], [3, 1], [6, -1], [0, 2], [-3, 2]]) px.set(cx + p[0], cy + p[1], K('#ffd36a'));
    for (const p of [[-4, 1], [2, -1], [5, 2]]) px.set(cx + p[0], cy + p[1], K('#f08a3c'));
    px.rect(Math.round(cx) - 12, Math.round(cy) - 1, 2, 2, PAL.charHi);
    px.rect(Math.round(cx) + 10, Math.round(cy) - 1, 2, 2, PAL.charHi);
    // 안주 접시
    const dish = (x, y, rxd, ryd, food, spot) => {
      px.ell(x, y + 0.6, rxd + 0.8, ryd + 0.8, PAL.charLt);
      px.ell(x, y, rxd, ryd, PAL.white);
      px.ell(x, y - 0.2, rxd - 1.6, ryd - 1.1, food);
      if (spot) for (let i = 0; i < 4; i++) px.set(x - rxd * 0.5 + i * (rxd * 0.34), y - 0.5 + (i % 2), spot);
    };
    dish(cx - 21, cy - 5, 7.5, 3.8, K('#cf4a2a'), K('#ffd36a'));
    dish(cx + 22, cy - 6, 7.5, 3.8, K('#a85a2c'), K('#e8c068'));
    dish(cx - 2, cy + 12, 7, 3.6, K('#b8302e'), K('#f4e6c8'));
    dish(cx + 15, cy + 7, 5.4, 3, K('#e8c04a'), null);
    dish(cx - 17, cy + 6, 5.2, 2.8, K('#6aa84a'), K('#cfe8a0'));
    // 메뉴 스탠드
    px.rect(Math.round(cx) + 3, Math.round(cy) + 5, 4, 5, PAL.cream);
    px.rect(Math.round(cx) + 3, Math.round(cy) + 5, 4, 1, PAL.red);
    // 술병(소주 2병, 맥주 1병)과 빈 소주잔: 플레이어 잔 자리가 아닌 테이블 가운데 쪽에 둔다
    const bottle = (x, y, body, label, cap) => {
      px.ell(x, y + 5.2, 2.6, 1.2, PAL.charDk);
      px.rect(Math.round(x) - 1, Math.round(y) - 3, 3, 8, body);
      px.rect(Math.round(x), Math.round(y) - 5, 1, 3, body);
      px.rect(Math.round(x), Math.round(y) - 6, 1, 1, cap);
      px.rect(Math.round(x) - 1, Math.round(y), 3, 2, label);
      px.set(Math.round(x) - 1, Math.round(y) - 3, K('#8fd6a4'));
    };
    bottle(cx - 10, cy - 8, K('#3f9a5a'), PAL.white, K('#1d5a35'));
    bottle(cx + 11, cy - 9, K('#3f9a5a'), PAL.white, K('#1d5a35'));
    bottle(cx + 8, cy + 9, K('#7a4a22'), K('#f2e6c8'), K('#d9a441'));
    for (const g of [[-8, 6], [14, -3], [-24, 0]]) {
      px.ell(cx + g[0], cy + g[1] + 1.4, 2.2, 1, PAL.charLt);
      px.rect(Math.round(cx + g[0]) - 1, Math.round(cy + g[1]) - 1, 3, 3, K('#e9f6ff'));
      px.set(Math.round(cx + g[0]), Math.round(cy + g[1]) + 1, K('#bfe3f5'));
    }
    // 좌석별 숟가락/젓가락 받침(잔 자리는 비워 둔다)
    world.SEATS.forEach(s => {
      const lx = (s.place.x - (T.top.x - w * S / 2)) / S, ly = (s.place.y - (T.top.y - cy * S)) / S;
      const ix = (cx - lx) * 0.5, iy = (cy - ly) * 0.5;
      px.ell(lx + ix, ly + iy + 0.4, 3.4, 1.7, PAL.charLt);
      px.ell(lx + ix, ly + iy, 3.2, 1.5, PAL.white);
      px.rect(Math.round(lx + ix) + 3, Math.round(ly + iy) - 1, 1, 3, PAL.steel);
    });
    px.outline(PAL.out);
    return { canvas: px.canvas(S), x: T.top.x - cx * S, y: T.top.y - cy * S, potX: T.top.x, potY: T.top.y };
  }

  /* ---------- 의자 ---------- */
  function buildStool() {
    const w = 20, h = 28, gx = 10, gy = 27;
    const px = new Pix(w, h);
    const legTone = x => (x % 2 ? PAL.char : PAL.charLt);
    for (let y = 11; y < gy; y++) {
      const t = (y - 11) / (gy - 11);
      for (const [x0, dx] of [[5, -2], [14, 2], [9, 0]]) { const x = Math.round(x0 + dx * t); px.set(x, y, legTone(x)); px.set(x + 1, y, PAL.charDk); }
    }
    for (let x = 3; x <= 16; x++) { const dy = Math.round(Math.sqrt(Math.max(0, 1 - ((x - 9.5) / 7) ** 2)) * 2.5); px.set(x, 19 + dy, PAL.charLt); px.set(x, 19 - dy + 4, PAL.charDk); }
    px.ell(gx, 9.5, 8.2, 4.4, K('#7e2428'));
    px.ell(gx, 8, 8.2, 4.2, K('#b23a3a'));
    px.ell(gx, 7.6, 6.6, 3.2, K('#c64a4a'));
    for (const x of [6, 7, 8, 9]) px.set(x, 5, K('#e07a78'));
    px.outline(PAL.out);
    return { canvas: px.canvas(S), anchorX: gx * S, anchorY: gy * S };
  }

  /* ---------- 출입문 (유리문 오버레이) ---------- */
  const doorTop = x => 588 + (x - 305) * 0.36;
  const doorBottom = x => (x <= 431 ? 891 + (x - 305) * 0.38 : 939 + (x - 431) * 0.2);
  function drawDoor(g) {
    const G = S, mid = (DOOR.left + DOOR.right) / 2;
    for (let x = DOOR.left; x < DOOR.right; x += G) {
      const yt = Math.round(doorTop(x + 2) / G) * G, yb = Math.round(doorBottom(x + 2) / G) * G;
      for (let y = yt; y < yb; y += G) {
        const k = (y - yt) / (yb - yt);
        let c = k < 0.3 ? '#a9c0c6' : k < 0.6 ? '#98b1b8' : k < 0.85 ? '#8aa3ab' : '#a49c8d';
        const d = (((x - DOOR.left) / G + y / G) % 17 + 17) % 17;
        if (d === 3 || d === 4) c = '#dce9ea'; else if (d === 10) c = '#c3d5d9';
        g.fillStyle = c;
        g.fillRect(x, y, G, G);
      }
      g.fillStyle = '#1f1d22';
      g.fillRect(x, yt, G, 2 * G);
      g.fillRect(x, yb - 2 * G, G, 2 * G);
      g.fillStyle = '#3b3a42';
      g.fillRect(x, yt, G, 1);
      g.fillStyle = '#55545d';
      g.fillRect(x, yt + G, G, 1);
    }
    for (const bx of [DOOR.left, mid, DOOR.right - G]) {
      const yt = Math.round(doorTop(bx + 2) / G) * G, yb = Math.round(doorBottom(bx + 2) / G) * G;
      g.fillStyle = '#1f1d22'; g.fillRect(bx, yt, 2 * G, yb - yt);
      g.fillStyle = '#3b3a42'; g.fillRect(bx, yt, 1, yb - yt);
    }
    const my = Math.round((doorTop(mid) + doorBottom(mid)) / 2 / G) * G;
    for (const hx of [mid - 14, mid + 14]) { g.fillStyle = '#c8242b'; g.fillRect(hx, my - 14, 4, 30); g.fillStyle = '#ffd36a'; g.fillRect(hx, my - 14, 4, 4); }
  }

  /* ---------- 초기화 ---------- */
  const state = { ready: false, world: null, backdrop: null, pieces: [], door: null };

  function init(plateImage, world, floorRepair) {
    state.world = world;
    const W = world.WORLD.w, H = world.WORLD.h;
    const bd = mkCanvas(W, H), g = bd.getContext('2d');
    g.drawImage(plateImage, 0, 0, W, H);
    if (hasBakedPeople) {
      drawDoor(g);
      g.drawImage(floorRepair, 556, 332);
      deckShadow(g);
      const deck = buildDeck();
      g.drawImage(deck.canvas, deck.x, deck.y);
    }
    g.fillStyle = '#24232a';
    g.fillRect(54, 654, 137, 168);
    g.fillStyle = '#f4efe6';
    g.font = '700 12px Galmuri11, sans-serif';
    g.textAlign = 'center';
    g.fillText('개발자 Ryuna Kim', 122, 723);
    g.fillStyle = '#29252b';
    g.beginPath();
    [[235, 872], [431, 936], [334, 1017], [137, 944]].forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y));
    g.closePath(); g.fill();
    g.save();
    g.translate(282, 946); g.rotate(0.32);
    g.fillStyle = '#e8b87c';
    g.font = '700 15px Galmuri11, sans-serif';
    g.fillText('환영합니다. 고객님~', 0, 0);
    g.restore();
    state.backdrop = bd;

    const pieces = [];
    const table = buildTable(world);
    pieces.push({
      id: 'table', sortY: world.TABLE.ground.y,
      draw(ctx, t) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(table.canvas, Math.round(table.x), Math.round(table.y));
        steam(ctx, table.potX, table.potY, t || 0);
      }
    });
    const stool = buildStool();
    world.SEATS.forEach((s, i) => {
      pieces.push({ id: `stool${i}`, sortY: s.y - 0.5, draw(ctx) { ctx.imageSmoothingEnabled = false; ctx.drawImage(stool.canvas, Math.round(s.x - stool.anchorX), Math.round(s.y - stool.anchorY)); } });
    });
    state.pieces = pieces;
    state.ready = true;
  }

  // 냄비에서 올라오는 김
  function steam(ctx, x, y, t) {
    ctx.fillStyle = 'rgb(255 255 255 / 70%)';
    for (let i = 0; i < 6; i++) {
      const p = ((t / 1800) + i / 6) % 1;
      const sx = x + Math.sin(p * 6 + i * 2) * 12 + (i - 2.5) * 6;
      const sy = y - 14 - p * 70;
      ctx.globalAlpha = Math.max(0, 0.75 - p * 0.75);
      const size = 8 + Math.floor(p * 8);
      ctx.fillRect(Math.round(sx / 4) * 4, Math.round(sy / 4) * 4, size - (size % 4), size - (size % 4));
    }
    ctx.globalAlpha = 1;
  }

  function drawBackdrop(ctx) { if (state.backdrop) ctx.drawImage(state.backdrop, 0, 0); }

  // 따뜻한 조명 번짐과 출입문 표지(깜빡임/펄스)
  function drawAnimated(ctx, t, st) {
    if (!state.ready) return;
    const flick = 0.17 + Math.sin(t / 700) * 0.015 + Math.sin(t / 230) * 0.008;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(785, 560);
    ctx.scale(1, 0.62);
    const g = ctx.createRadialGradient(0, 0, 20, 0, 0, 420);
    g.addColorStop(0, `rgba(255,170,80,${flick})`);
    g.addColorStop(1, 'rgba(255,170,80,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, 420, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    if (hasBakedPeople) drawDoorSign(ctx, t, Boolean(st && st.nearDoor), Boolean(st && st.outside));
  }

  function drawDoorSign(ctx, t, near, outside) {
    const mid = (DOOR.left + DOOR.right) / 2;
    const x = mid - 36, y = Math.round(doorTop(mid) + 34);
    const pulse = near ? 0.55 + 0.45 * Math.sin(t / 150) : 0.82;
    if (near) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(80,255,150,${0.16 * pulse})`;
      ctx.fillRect(x - 18, y - 14, 128, 52);
      ctx.restore();
    }
    ctx.fillStyle = '#0f3d24'; ctx.fillRect(x - 4, y - 4, 80, 32);
    ctx.fillStyle = near ? '#31e07a' : '#1fae5c'; ctx.fillRect(x, y, 72, 24);
    ctx.fillStyle = `rgba(255,255,255,${pulse})`;
    ctx.font = '700 15px Galmuri11, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(outside ? '들어가기' : '나가기', x + 36, y + 13);
    ctx.fillStyle = '#c8f5d8'; ctx.fillRect(x, y, 72, 2);
  }

  function pieces() { return state.pieces; }
  function seatPlace(i) { const p = state.world.SEATS[i].place; return { x: p.x, y: p.y }; }

  root.TudariProps = { hasBakedPeople, init, drawBackdrop, drawAnimated, pieces, seatPlace };
})(typeof self !== 'undefined' ? self : this);
