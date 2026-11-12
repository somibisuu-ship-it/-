'use strict';

const channelList = document.getElementById('channel-list');
const notice = document.getElementById('notice');
const nicknameInput = document.getElementById('nickname');
const socket = io();
let channels = [];
let joinedChannel = null;
let pendingChannel = null;
let autoJoinTried = false;

function showNotice(message, isError = false) {
  notice.textContent = message;
  notice.dataset.error = String(isError);
}

function renderChannels() {
  channelList.replaceChildren();
  if (channels.length === 0) {
    const loading = document.createElement('p');
    loading.className = 'loading';
    loading.textContent = '채널 정보를 불러오는 중입니다.';
    channelList.append(loading);
    return;
  }

  channels.forEach(channel => {
    const isFull = channel.full;
    const card = document.createElement('article');
    card.className = 'channel-card';

    const top = document.createElement('div');
    top.className = 'channel-top';
    const name = document.createElement('h3');
    name.className = 'channel-name';
    name.textContent = channel.id;
    const status = document.createElement('span');
    status.className = 'channel-status';
    const dot = document.createElement('i');
    dot.className = `status-dot ${isFull ? 'full' : 'available'}`;
    dot.setAttribute('aria-hidden', 'true');
    const statusText = document.createElement('span');
    statusText.textContent = isFull ? '정원 마감' : '입장 가능';
    status.append(dot, statusText);
    top.append(name, status);

    const count = document.createElement('p');
    count.className = 'channel-count';
    const occupied = document.createElement('strong');
    occupied.textContent = String(channel.count);
    count.append(occupied, document.createTextNode(` / ${channel.capacity}명`));

    const button = document.createElement('button');
    button.className = joinedChannel === channel.id ? 'leave-button' : 'join-button';
    button.type = 'button';
    button.textContent = joinedChannel === channel.id ? '채널 나가기' : '입장하기';
    button.disabled = isFull && joinedChannel !== channel.id
      || joinedChannel !== null && joinedChannel !== channel.id
      || pendingChannel !== null;
    button.addEventListener('click', () => {
      if (joinedChannel === channel.id) leaveChannel();
      else joinChannel(channel.id);
    });

    card.append(top, count, button);
    channelList.append(card);
  });
}

function joinChannel(id) {
  if (pendingChannel || joinedChannel) return;
  pendingChannel = id;
  renderChannels();
  socket.emit('joinRoom', { room: id, name: nicknameInput.value, avatar: myAvatar }, result => {
    pendingChannel = null;
    if (!result?.ok) {
      showNotice(result?.message || '채널에 입장하지 못했습니다.', true);
      renderChannels();
      return;
    }
    joinedChannel = result.room;
    showNotice(`${result.room} 채널에 입장했습니다.`);
    renderChannels();
    enterTudari(result);
  });
}

function leaveChannel() {
  if (!joinedChannel) return;
  socket.emit('leaveRoom', result => {
    if (!result?.ok) {
      showNotice('채널에서 나가지 못했습니다. 다시 시도해 주세요.', true);
      return;
    }
    const leftChannel = joinedChannel;
    joinedChannel = null;
    exitTudari();
    showNotice(`${leftChannel} 채널에서 나왔습니다.`);
    renderChannels();
  });
}

socket.on('channelsState', state => {
  channels = state;
  renderChannels();
  const wanted = (new URLSearchParams(location.search).get('room') || '').toUpperCase();
  if (wanted && !autoJoinTried && !joinedChannel && state.some(c => c.id === wanted && !c.full)) {
    autoJoinTried = true;
    joinChannel(wanted);
  }
});

socket.on('connect', () => showNotice('채널에 입장할 수 있습니다.'));
socket.on('disconnect', () => {
  joinedChannel = null;
  pendingChannel = null;
  exitTudari();
  showNotice('서버 연결이 끊겼습니다. 다시 연결 중입니다.', true);
  renderChannels();
});
socket.on('connect_error', () => showNotice('서버에 연결하지 못했습니다.', true));

/* ---------- 캐릭터 만들기 ---------- */
const DEFAULT_AVATAR = { gender: 'male', eyes: 'round', hair: 'short', hairColor: '#201a25', outfit: 'basic' };
const AVATAR_CHOICES = [
  ['gender', '성별', [['male', '남자'], ['female', '여자']]],
  ['eyes', '눈 모양', [['round', '동그란 눈'], ['smile', '웃는 눈'], ['sleepy', '졸린 눈']]],
  ['hair', '머리', [['short', '짧은 머리'], ['bob', '단발'], ['long', '긴 머리']]],
  ['outfit', '옷', [['basic', '기본(흰 티)'], ['uplus', 'U+'], ['lg', 'LG'], ['hanwha', '한화'], ['samsung', '삼성'], ['doosan', '두산'], ['kia', 'KIA'], ['casual', '캐주얼']]]
];
const PROFILE_KEY = 'tudari.profile';
const previewCanvas = document.getElementById('avatar-preview');
const previewCtx = previewCanvas.getContext('2d');
let myAvatar = { ...DEFAULT_AVATAR };

try {
  const saved = JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}');
  nicknameInput.value = String(saved.name || '').slice(0, 10);
  for (const [key, , options] of AVATAR_CHOICES) {
    if (options.some(([v]) => v === saved.avatar?.[key])) myAvatar[key] = saved.avatar[key];
  }
} catch { /* 저장된 프로필이 없거나 손상됨 */ }

function saveProfile() {
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify({ name: nicknameInput.value, avatar: myAvatar })); } catch { /* 저장 불가 환경 */ }
}

function drawPreview() {
  const c = previewCtx, w = previewCanvas.width, h = previewCanvas.height;
  c.clearRect(0, 0, w, h);
  c.fillStyle = 'rgb(0 0 0 / 28%)'; c.beginPath(); c.ellipse(w / 2, h * .9, 52, 14, 0, 0, Math.PI * 2); c.fill();
  drawFigure(c, w / 2, h * .9, 28, myAvatar);
}

function renderAvatarOptions() {
  const box = document.getElementById('avatar-options');
  box.replaceChildren();
  for (const [key, label, options] of AVATAR_CHOICES) {
    const row = document.createElement('div');
    row.className = 'option-group';
    const title = document.createElement('span');
    title.textContent = label;
    row.append(title);
    for (const [value, text] of options) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.setAttribute('aria-pressed', String(myAvatar[key] === value));
      b.addEventListener('click', () => {
        myAvatar[key] = value;
        saveProfile();
        renderAvatarOptions();
        drawPreview();
      });
      row.append(b);
    }
    box.append(row);
  }
}
nicknameInput.addEventListener('input', saveProfile);
renderAvatarOptions();

/* ---------- 투다리 내부 ---------- */
const lobby = document.getElementById('lobby');
const tudari = document.getElementById('tudari');
const canvas = document.getElementById('scene');
const ctx = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;
const roomName = document.getElementById('room-name');
const roomCount = document.getElementById('room-count');
const chatLog = document.getElementById('chat-log');
const chatInput = document.getElementById('chat-input');
const seatButtons = document.getElementById('seat-buttons');
const drinkButtons = document.getElementById('drink-buttons');
const cheersBanner = document.getElementById('cheers-banner');
const joystick = document.getElementById('joystick');

const DRINKS = ['소주', '맥주', '사케', '하이볼', '막걸리'];
const DRINK_COLORS = { 소주: '#dff3ee', 맥주: '#f1b934', 사케: '#f4efe2', 하이볼: '#e8b04a', 막걸리: '#f3efe0' };
const OUTFITS = { basic: '#ffffff', uplus: '#e6007e', lg: '#a50034', hanwha: '#f37321', samsung: '#1428a0', doosan: '#3b4f8f', kia: '#16202b', casual: '#6b8e7f' };
const SKIN = '#f6d2b5';
const SEAT_POS = [[.50, .43], [.62, .49], [.61, .61], [.50, .66], [.38, .61], [.37, .49]];
const TABLE = { x: .5, y: .545, rx: .095, ry: .085 };
const STEP_MS = 50;

let selfId = null;
let players = new Map();
let seats = Array(6).fill(null);
let me = null;
let keys = new Set();
let stick = { x: 0, y: 0 };
let rafId = null;
let lastFrame = 0;
let lastSend = 0;
let effects = [];
let selectedDrink = null;

function resolveAvatar(p) {
  return { ...DEFAULT_AVATAR, ...p.avatar };
}

function applyState(state) {
  const next = new Map();
  for (const p of state.players) {
    const old = players.get(p.id);
    const view = { ...p, rx: old ? old.rx : p.x, ry: old ? old.ry : p.y };
    if (p.id === selfId && old) {
      const far = Math.hypot(old.x - p.x, old.y - p.y) > .12;
      if (far || p.seat !== old.seat) { view.x = p.x; view.y = p.y; }
      else { view.x = old.x; view.y = old.y; view.dir = old.dir; }
    }
    next.set(p.id, view);
  }
  players = next;
  seats = state.seats;
  me = players.get(selfId) || null;
  updateHud();
}

function enterTudari(result) {
  selfId = result.selfId;
  players = new Map();
  effects = [];
  selectedDrink = null;
  chatLog.replaceChildren();
  roomName.textContent = result.room;
  applyState(result.state);
  addLog(`${result.room} 투다리에 입장했습니다.`, true);
  lobby.hidden = true;
  tudari.hidden = false;
  joystick.hidden = !matchMedia('(pointer: coarse)').matches;
  lastFrame = performance.now();
  if (!rafId) rafId = requestAnimationFrame(frame);
}

function exitTudari() {
  tudari.hidden = true;
  lobby.hidden = false;
  keys.clear();
  stick = { x: 0, y: 0 };
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  players = new Map();
  me = null;
}

function addLog(text, system = false) {
  const li = document.createElement('li');
  if (system) li.className = 'sys';
  li.textContent = text;
  chatLog.append(li);
  while (chatLog.children.length > 60) chatLog.firstChild.remove();
  chatLog.scrollTop = chatLog.scrollHeight;
}

function updateHud() {
  roomCount.textContent = `${players.size} / 6명`;
  seatButtons.replaceChildren();
  const label = document.createElement('span');
  label.textContent = '좌석 ';
  label.style.cssText = 'align-self:center;font-size:13px;color:#aeb2c0';
  seatButtons.append(label);
  seats.forEach((occupant, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = String(i + 1);
    const mine = occupant === selfId;
    b.disabled = !!occupant && !mine;
    b.classList.toggle('active', mine);
    b.addEventListener('click', () => socket.emit('sit', i, r => { if (r && !r.ok && r.message) addLog(r.message, true); }));
    seatButtons.append(b);
  });
  if (me && me.seat !== null) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = '일어나기';
    b.addEventListener('click', () => socket.emit('stand'));
    seatButtons.append(b);
  }
  drinkButtons.replaceChildren();
  DRINKS.forEach(d => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = d;
    b.classList.toggle('active', me?.drink === d);
    b.addEventListener('click', () => socket.emit('selectDrink', { label: d }));
    drinkButtons.append(b);
  });
}

document.getElementById('leave-room').addEventListener('click', leaveChannel);
document.getElementById('act-raise').addEventListener('click', () => socket.emit('raiseGlass'));
document.getElementById('act-sip').addEventListener('click', () => socket.emit('drinkSip'));
document.getElementById('act-cheers').addEventListener('click', () => socket.emit('cheers', chatInput.value));
document.getElementById('act-pour').addEventListener('click', () => {
  let best = null, bestD = Infinity;
  for (const p of players.values()) {
    if (p.id === selfId || !me) continue;
    const d = Math.hypot(p.x - me.x, (p.y - me.y) * H / W);
    if (d < bestD) { bestD = d; best = p; }
  }
  if (best) socket.emit('pourDrink', best.id);
  else addLog('술을 따라줄 사람이 없어요.', true);
});
document.getElementById('chat-form').addEventListener('submit', e => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (text) socket.emit('chat', text);
  chatInput.value = '';
});

socket.on('roomState', state => { if (joinedChannel) applyState(state); });
socket.on('playerMoved', m => {
  const p = players.get(m.id);
  if (p) Object.assign(p, { x: m.x, y: m.y, dir: m.dir });
});
socket.on('systemMessage', t => addLog(t, true));
socket.on('chat', m => {
  addLog(`${m.name}: ${m.text}`);
  const p = players.get(m.id);
  if (p) p.bubble = m.text;
});
socket.on('bubbleClear', id => { const p = players.get(id); if (p) p.bubble = ''; });
socket.on('pourEffect', e => effects.push({ id: e.to, until: performance.now() + 1200 }));
let bannerTimer = 0;
socket.on('cheers', c => {
  cheersBanner.textContent = `🍻 ${c.by}: ${c.text}`;
  cheersBanner.hidden = false;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { cheersBanner.hidden = true; }, 2800);
  addLog(`${c.by}: ${c.text}`, true);
});

/* 입력 */
const KEY_DIRS = { w: [0, -1], arrowup: [0, -1], s: [0, 1], arrowdown: [0, 1], a: [-1, 0], arrowleft: [-1, 0], d: [1, 0], arrowright: [1, 0] };
addEventListener('keydown', e => {
  if (tudari.hidden || e.target instanceof HTMLInputElement) return;
  const k = e.key.toLowerCase();
  if (KEY_DIRS[k]) { keys.add(k); e.preventDefault(); }
});
addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());

(function setupJoystick() {
  let active = null;
  const knob = joystick.firstElementChild;
  const update = e => {
    const r = joystick.getBoundingClientRect();
    let dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    let dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    stick = { x: Math.abs(dx) < .2 ? 0 : dx, y: Math.abs(dy) < .2 ? 0 : dy };
    knob.style.transform = `translate(${dx * 30}px, ${dy * 30}px)`;
  };
  const end = () => { active = null; stick = { x: 0, y: 0 }; knob.style.transform = ''; };
  joystick.addEventListener('pointerdown', e => { active = e.pointerId; joystick.setPointerCapture(active); update(e); });
  joystick.addEventListener('pointermove', e => { if (e.pointerId === active) update(e); });
  joystick.addEventListener('pointerup', end);
  joystick.addEventListener('pointercancel', end);
})();

function inputVector() {
  let x = stick.x, y = stick.y;
  for (const k of keys) { x += KEY_DIRS[k][0]; y += KEY_DIRS[k][1]; }
  const len = Math.hypot(x, y);
  return len > 1 ? { x: x / len, y: y / len } : { x, y };
}

function blockedByTable(x, y) {
  const dx = (x - TABLE.x) / (TABLE.rx + .02), dy = (y - TABLE.y) / (TABLE.ry + .03);
  return dx * dx + dy * dy < 1;
}

function update(dt, now) {
  if (me && me.seat === null) {
    const v = inputVector();
    if (v.x || v.y) {
      const speed = .26;
      const nx = Math.max(.08, Math.min(.92, me.x + v.x * speed * dt));
      const ny = Math.max(.18, Math.min(.90, me.y + v.y * speed * dt * W / H));
      if (!blockedByTable(nx, me.y)) me.x = nx;
      if (!blockedByTable(me.x, ny)) me.y = ny;
      me.dir = Math.abs(v.x) > Math.abs(v.y) ? (v.x > 0 ? 'right' : 'left') : (v.y > 0 ? 'down' : 'up');
      if (now - lastSend >= STEP_MS) {
        lastSend = now;
        socket.emit('move', { x: me.x, y: me.y, dir: me.dir });
      }
    }
  }
  const k = Math.min(1, dt * 14);
  for (const p of players.values()) {
    if (p.id === selfId) { p.rx = p.x; p.ry = p.y; continue; }
    p.rx += (p.x - p.rx) * k;
    p.ry += (p.y - p.ry) * k;
  }
  effects = effects.filter(e => e.until > now);
}

/* 렌더링 */
function drawRoom(now) {
  const wallH = H * .3;
  const wall = ctx.createLinearGradient(0, 0, 0, wallH);
  wall.addColorStop(0, '#3a1f17'); wall.addColorStop(1, '#2a1610');
  ctx.fillStyle = wall; ctx.fillRect(0, 0, W, wallH);
  ctx.fillStyle = 'rgb(0 0 0 / 22%)';
  for (let x = 0; x < W; x += 60) ctx.fillRect(x, 0, 3, wallH);
  const floor = ctx.createLinearGradient(0, wallH, 0, H);
  floor.addColorStop(0, '#6b4528'); floor.addColorStop(1, '#4a2e1a');
  ctx.fillStyle = floor; ctx.fillRect(0, wallH, W, H - wallH);
  ctx.strokeStyle = 'rgb(0 0 0 / 18%)'; ctx.lineWidth = 2;
  for (let y = wallH + 34; y < H; y += 34) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  // 선반과 술병
  ctx.fillStyle = '#5a3822'; ctx.fillRect(W * .06, H * .17, W * .34, 8); ctx.fillRect(W * .6, H * .17, W * .34, 8);
  const cols = ['#3d8f5a', '#c9d8e0', '#d9a441', '#7a4b2a', '#3d8f5a', '#e8e1c8'];
  for (let i = 0; i < 12; i++) {
    const x = (i < 6 ? W * .08 + i * 44 : W * .62 + (i - 6) * 44);
    ctx.fillStyle = cols[i % cols.length];
    ctx.fillRect(x, H * .17 - 40, 14, 40); ctx.fillRect(x + 4, H * .17 - 52, 6, 14);
  }

  // 투다리 간판
  const sx = W / 2, sy = H * .1;
  ctx.fillStyle = '#7a1a16'; ctx.beginPath(); ctx.roundRect(sx - 120, sy - 32, 240, 64, 14); ctx.fill();
  ctx.strokeStyle = '#f2c14e'; ctx.lineWidth = 4; ctx.stroke();
  ctx.fillStyle = '#ffe9a8'; ctx.font = '800 38px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = '#ffb347'; ctx.shadowBlur = 14; ctx.fillText('투다리', sx, sy + 2); ctx.shadowBlur = 0;

  // 등
  for (const lx of [W * .18, W * .34, W * .66, W * .82]) {
    ctx.strokeStyle = '#2a1610'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(lx, 0); ctx.lineTo(lx, H * .2); ctx.stroke();
    const glow = ctx.createRadialGradient(lx, H * .24, 2, lx, H * .24, 46);
    glow.addColorStop(0, 'rgb(255 200 110 / 55%)'); glow.addColorStop(1, 'rgb(255 200 110 / 0%)');
    ctx.fillStyle = glow; ctx.fillRect(lx - 50, H * .24 - 50, 100, 100);
    ctx.fillStyle = '#e8553a'; ctx.beginPath(); ctx.ellipse(lx, H * .24, 15, 20, 0, 0, Math.PI * 2); ctx.fill();
  }

  // 출입구
  const dx = W * .05, dy = H * .66;
  ctx.fillStyle = '#2a1a12'; ctx.fillRect(dx, dy, W * .1, H * .27);
  ctx.fillStyle = '#7a1a16'; ctx.fillRect(dx, dy, W * .1, 22);
  ctx.fillStyle = '#ffe9a8'; ctx.font = '700 13px sans-serif'; ctx.fillText('출입구', dx + W * .05, dy + 11);
}

function drawTable() {
  const cx = TABLE.x * W, cy = TABLE.y * H, rx = TABLE.rx * W, ry = TABLE.ry * H;
  ctx.fillStyle = 'rgb(0 0 0 / 30%)'; ctx.beginPath(); ctx.ellipse(cx, cy + 14, rx + 6, ry + 4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#4a2b17'; ctx.beginPath(); ctx.ellipse(cx, cy + 10, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#a8703d'; ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#c28a52'; ctx.beginPath(); ctx.ellipse(cx, cy, rx * .86, ry * .82, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#d8d3c8'; ctx.beginPath(); ctx.ellipse(cx, cy, 22, 14, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#e8553a'; ctx.beginPath(); ctx.ellipse(cx, cy - 2, 16, 9, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#f5f0e0';
  for (const [ox, oy] of [[-58, -6], [56, 4], [-14, 24], [20, -26]]) { ctx.beginPath(); ctx.ellipse(cx + ox, cy + oy, 12, 6, 0, 0, Math.PI * 2); ctx.fill(); }
}

function drawStools() {
  SEAT_POS.forEach(([x, y], i) => {
    ctx.fillStyle = seats[i] ? '#5a3a22' : '#7c5230';
    ctx.beginPath(); ctx.ellipse(x * W, y * H + 2, 20, 9, 0, 0, Math.PI * 2); ctx.fill();
    if (!seats[i]) { ctx.fillStyle = '#ffe9a8'; ctx.font = '700 11px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(String(i + 1), x * W, y * H + 3); }
  });
}

function drawFigure(c, x, y, u, a, { dir = 'down', drunk = 0 } = {}) {
  const female = a.gender === 'female';
  const tw = female ? 2 * u : 2.4 * u;
  const hy = y - u * 4.9;

  c.fillStyle = a.hairColor;
  if (a.hair !== 'short') { c.beginPath(); c.roundRect(x - u * 1.45, hy - u * .6, u * 2.9, a.hair === 'long' ? u * 3.2 : u * 1.9, u * .8); c.fill(); }

  // 다리와 흰 반바지
  c.fillStyle = SKIN;
  for (const sx of [-.55, .55]) c.fillRect(x + sx * u - u * .3, y - u, u * .6, u);
  c.fillStyle = '#2b2b33';
  for (const sx of [-.55, .55]) { c.beginPath(); c.roundRect(x + sx * u - u * .42, y - u * .3, u * .84, u * .32, u * .12); c.fill(); }
  c.fillStyle = '#fff';
  c.beginPath(); c.roundRect(x - tw / 2, y - u * 2.1, tw, u * 1.2, u * .2); c.fill();
  c.fillStyle = 'rgb(0 0 0 / 10%)'; c.fillRect(x - u * .03, y - u * 1.6, u * .06, u * .7);

  // 팔
  c.fillStyle = SKIN;
  for (const s of [-1, 1]) { c.beginPath(); c.roundRect(x + s * (tw / 2 + u * .05) - u * .3, y - u * 3.6, u * .6, u * 1.5, u * .3); c.fill(); }

  // 상의
  const shirt = OUTFITS[a.outfit] || OUTFITS.basic;
  c.fillStyle = shirt;
  c.beginPath(); c.roundRect(x - tw / 2, y - u * 3.9, tw, u * 1.9, u * .5); c.fill();
  for (const s of [-1, 1]) { c.beginPath(); c.roundRect(x + s * (tw / 2 + u * .05) - u * .35, y - u * 3.7, u * .7, u * .8, u * .3); c.fill(); }
  c.strokeStyle = 'rgb(0 0 0 / 14%)'; c.lineWidth = 1;
  c.beginPath(); c.roundRect(x - tw / 2, y - u * 3.9, tw, u * 1.9, u * .5); c.stroke();
  if (a.outfit === 'uplus') { c.fillStyle = '#fff'; c.font = `800 ${u * .8}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('U+', x, y - u * 2.9); }
  else if (a.outfit === 'casual') { c.fillStyle = 'rgb(255 255 255 / 55%)'; c.fillRect(x - tw / 2, y - u * 3, tw, u * .25); }
  else if (a.outfit !== 'basic') { c.fillStyle = '#fff'; c.font = `800 ${u * .55}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(a.outfit === 'kia' ? 'KIA' : a.outfit.toUpperCase().slice(0, 2), x, y - u * 2.9); }

  // 머리
  c.fillStyle = SKIN;
  c.beginPath(); c.arc(x, hy, u * 1.25, 0, Math.PI * 2); c.fill();
  c.fillStyle = a.hairColor;
  c.beginPath(); c.arc(x, hy - u * .15, u * 1.3, Math.PI, 0); c.fill();

  if (dir !== 'up') {
    c.fillStyle = c.strokeStyle = '#2a1f24'; c.lineWidth = Math.max(1.4, u * .1);
    const off = dir === 'left' ? -u * .25 : dir === 'right' ? u * .25 : 0;
    const ey = hy + u * .1;
    for (const sx of [-u * .5, u * .5]) {
      const ex = x + sx + off;
      if (a.eyes === 'round') { c.beginPath(); c.arc(ex, ey, u * .17, 0, Math.PI * 2); c.fill(); }
      else if (a.eyes === 'smile') { c.beginPath(); c.arc(ex, ey + u * .1, u * .22, Math.PI, 0); c.stroke(); }
      else { c.beginPath(); c.moveTo(ex - u * .2, ey); c.lineTo(ex + u * .2, ey); c.stroke(); }
      if (female) { c.beginPath(); c.moveTo(ex + Math.sign(sx) * u * .2, ey - u * .05); c.lineTo(ex + Math.sign(sx) * u * .4, ey - u * .22); c.stroke(); }
    }
    c.strokeStyle = '#b5675f'; c.lineWidth = Math.max(1, u * .08);
    c.beginPath(); c.arc(x + off, hy + u * .5, u * .22, .15 * Math.PI, .85 * Math.PI); c.stroke();
  }
  if (drunk > 0) { c.fillStyle = `rgb(255 80 90 / ${Math.min(.5, drunk * .12)})`; for (const sx of [-u * .75, u * .75]) { c.beginPath(); c.arc(x + sx, hy + u * .55, u * .3, 0, Math.PI * 2); c.fill(); } }
  return hy;
}

function drawAvatar(p, now) {
  const x = p.rx * W, y = p.ry * H, u = H * .026;
  const a = resolveAvatar(p);
  const seated = p.seat !== null;
  ctx.fillStyle = 'rgb(0 0 0 / 30%)'; ctx.beginPath(); ctx.ellipse(x, y, u * 1.4, u * .55, 0, 0, Math.PI * 2); ctx.fill();
  const bob = seated ? 0 : (p.id === selfId && (keys.size || stick.x || stick.y) ? Math.sin(now / 90) * 2 : 0);
  const by = y - (seated ? u * .6 : 0) + bob;
  const hy = drawFigure(ctx, x, by, u, a, { dir: p.dir, drunk: p.drunk });

  if (p.glass > 0) {
    const gx = x + u * 1.8, gy = by - (p.raised ? u * 3.4 : u * 1.8), gw = u * .8, gh = u * 1.1;
    ctx.fillStyle = 'rgb(255 255 255 / 35%)'; ctx.fillRect(gx - gw / 2, gy - gh, gw, gh);
    ctx.fillStyle = DRINK_COLORS[p.drink] || '#f1b934';
    const fh = gh * p.glass / 100; ctx.fillRect(gx - gw / 2, gy - fh, gw, fh);
  }
  if (effects.some(e => e.id === p.id)) {
    ctx.fillStyle = '#ffe27a'; ctx.font = `${u * 1.4}px sans-serif`; ctx.textAlign = 'center'; ctx.fillText('✨', x + u * 1.6, by - u * 4.8 - ((now / 20) % 10));
  }

  ctx.font = '700 12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  const label = p.id === selfId ? `${p.name} (나)` : p.name;
  const nameY = hy - u * 1.9;
  const tw = ctx.measureText(label).width + 12;
  ctx.fillStyle = p.id === selfId ? 'rgb(182 162 238 / 90%)' : 'rgb(0 0 0 / 55%)';
  ctx.beginPath(); ctx.roundRect(x - tw / 2, nameY - 13, tw, 18, 9); ctx.fill();
  ctx.fillStyle = p.id === selfId ? '#1a1725' : '#fff'; ctx.fillText(label, x, nameY);

  if (p.bubble) {
    ctx.font = '600 13px sans-serif';
    const bw = Math.min(220, ctx.measureText(p.bubble).width + 20);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.roundRect(x - bw / 2, nameY - 48, bw, 28, 10); ctx.fill();
    ctx.fillStyle = '#222'; ctx.fillText(p.bubble.length > 22 ? `${p.bubble.slice(0, 21)}…` : p.bubble, x, nameY - 29);
  }
}

function frame(now) {
  rafId = requestAnimationFrame(frame);
  const dt = Math.min(.1, (now - lastFrame) / 1000);
  lastFrame = now;
  update(dt, now);
  ctx.clearRect(0, 0, W, H);
  drawRoom(now);
  drawStools();
  const sorted = [...players.values()].sort((a, b) => a.ry - b.ry);
  for (const p of sorted) if (p.ry < TABLE.y) drawAvatar(p, now);
  drawTable();
  for (const p of sorted) if (p.ry >= TABLE.y) drawAvatar(p, now);
}

drawPreview();
