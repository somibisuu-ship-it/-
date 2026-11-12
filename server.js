'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const helmet = require('helmet');
const { Server } = require('socket.io');
const World = require('./public/shared/world.js');

const { CHANNELS, ROOM_CAPACITY, SEATS, LIMITS, CHEERS, DRINKS } = World;
const T = CHEERS.timing;

const app = express();
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));
app.get('/health', (_req, res) => res.status(200).json({ ok: true, uptime: process.uptime() }));
app.use(express.static(path.join(__dirname, 'public'), { setHeaders: res => res.setHeader('Cache-Control', 'no-cache') }));
// 확장자가 있는 요청(없는 asset 등)은 index.html 대신 404를 돌려줘야 asset slot 로더가 정확히 판단한다.
app.get('*', (req, res) => (path.extname(req.path)
  ? res.status(404).end()
  : res.sendFile(path.join(__dirname, 'public', 'index.html'))));

const server = http.createServer(app);
const io = new Server(server, {
  transports: ['polling', 'websocket'],
  maxHttpBufferSize: 200_000,
  pingTimeout: 20_000,
  pingInterval: 25_000
});

const rooms = new Map();
const now = () => Date.now();
const cleanText = (v, max = 80) => String(v ?? '').replace(/[<>]/g, '').trim().slice(0, max);
const roomId = v => cleanText(v, 12).toUpperCase().replace(/[^A-Z0-9가-힣_-]/g, '') || 'MP1';
const clamp01 = v => Math.max(0, Math.min(1, v));

/* ---------- 방 / 플레이어 ---------- */
function getRoom(id) {
  if (!rooms.has(id)) rooms.set(id, { id, players: new Map(), seats: Array(SEATS.length).fill(null), cheers: null });
  return rooms.get(id);
}

function pickSpawn(room) {
  let best = World.SPAWNS[0], bestGap = -1;
  for (const s of World.SPAWNS) {
    let gap = Infinity;
    for (const p of room.players.values()) {
      const w = World.toWorld(p.x, p.y);
      gap = Math.min(gap, World.dist(s.x, s.y, w.x, w.y));
    }
    if (gap > 90) return s;
    if (gap > bestGap) { best = s; bestGap = gap; }
  }
  return best;
}

function createPlayer(id, payload, room) {
  const point = pickSpawn(room);
  const spawn = World.toNorm(point.x, point.y);
  return {
    id,
    name: cleanText(payload.name, LIMITS.nameMax) || '친구',
    avatar: World.normalizeAvatar(payload.avatar),
    x: spawn.x, y: spawn.y, dir: 'up', seat: null,
    drinkId: World.DEFAULT_DRINK, ratio: null, glass: 0, drinkCount: 0, raisedGlass: false,
    bubble: '', heartUntil: 0, emote: null, emoteUntil: 0, lastEmoteAt: 0, moveBudget: 80,
    bubbleTimer: null, lastMoveAt: now(), lastChatAt: 0
  };
}

// 클라이언트에 내려 주는 모습. raised/drunk/drink 문자열은 예전 클라이언트를 위한 별칭이다.
function view(p) {
  const drink = World.drinkById(p.drinkId);
  const drunkLevel = World.drunkLevelFor(p.drinkCount);
  return {
    id: p.id, name: p.name, avatar: p.avatar,
    x: p.x, y: p.y, dir: p.dir, seat: p.seat,
    drink: drink ? drink.label : '빈 잔', drinkId: p.drinkId, ratio: p.ratio,
    glass: p.glass, drinkCount: p.drinkCount, drunkLevel, raisedGlass: p.raisedGlass,
    bubble: p.bubble, heartMs: Math.max(0, p.heartUntil - now()),
    emote: p.emote, emoteMs: Math.max(0, p.emoteUntil - now()),
    raised: p.raisedGlass, drunk: drunkLevel
  };
}

function cheersView(room) {
  const c = room.cheers;
  if (!c) {
    return { state: 'idle', step: 0, initiator: null, message: '', lines: [], shouts: [], participants: [], raised: [], responded: [], ms: 0 };
  }
  const initiator = room.players.get(c.initiator);
  let lines = [];
  if (c.state === 'gathering') lines = CHEERS.opening;
  else if (c.state === 'ready') lines = CHEERS.ready;
  return {
    state: c.state, step: c.step,
    initiator: initiator ? { id: initiator.id, name: initiator.name } : null,
    message: c.message, lines,
    shouts: c.shouts.slice(0, c.step),
    participants: [...c.participants], raised: [...c.raised], responded: [...c.responded],
    ms: Math.max(0, c.deadline - now())
  };
}

const snapshot = room => ({ players: [...room.players.values()].map(view), seats: room.seats, cheers: cheersView(room) });
const broadcast = id => { const room = rooms.get(id); if (room) io.to(id).emit('roomState', snapshot(room)); };
const broadcastChannels = () => io.emit('channelsState', channelSnapshot());
function channelSnapshot() {
  return CHANNELS.map(id => {
    const count = rooms.get(id)?.players.size || 0;
    return { id, count, capacity: ROOM_CAPACITY, full: count >= ROOM_CAPACITY };
  });
}

function setBubble(room, p, text, ms = LIMITS.bubbleMs) {
  clearTimeout(p.bubbleTimer);
  p.bubble = text;
  io.to(room.id).emit('bubble', { id: p.id, text, ms });
  p.bubbleTimer = setTimeout(() => {
    p.bubble = '';
    io.to(room.id).emit('bubbleClear', p.id);
  }, ms);
}
const announceAction = (room, p, action) => io.to(room.id).emit('playerAction', { id: p.id, action, ms: LIMITS.actionMs });

// 한 모금: 잔이 비어 있으면 아무 일도 없다.
function sip(p) {
  if (p.glass <= 0) return false;
  p.glass = Math.max(0, p.glass - World.SIP_AMOUNT);
  p.drinkCount += 1;
  return true;
}

/* ---------- 건배 상태머신 ----------
 * gathering(전원 잔 들기 대기) -> ready(안내) -> shouting(위하여 1,2회) -> responding(3회째, 참가자 응답) -> 종료
 * 건배제의자가 외치는 "위하여"는 shouts 배열의 3개뿐이고, 참가자의 응답은 횟수에 포함하지 않는다. */
function setCheersTimer(room, ms, fn) {
  const c = room.cheers;
  clearTimeout(c.timer);
  c.deadline = now() + ms;
  c.timer = setTimeout(() => { if (room.cheers === c) fn(); }, ms);
}

function endCheers(room, notice) {
  const c = room.cheers;
  if (!c) return;
  clearTimeout(c.timer);
  for (const id of c.participants) {
    const p = room.players.get(id);
    if (p) p.raisedGlass = false;
  }
  room.cheers = null;
  if (notice) io.to(room.id).emit('systemMessage', notice);
  broadcast(room.id);
}

function startCheers(room, p, raw) {
  if (room.cheers) return { ok: false, code: 'CHEERS_ACTIVE', message: '이미 건배가 진행 중이에요.' };
  if (p.seat === null) return { ok: false, code: 'NOT_SEATED', message: '테이블에 앉아야 건배를 제의할 수 있어요.' };
  const message = CHEERS.sanitize(raw);
  const seated = [...room.players.values()].filter(x => x.seat !== null);
  p.raisedGlass = true;
  room.cheers = {
    state: 'gathering', step: 0, initiator: p.id, message, shouts: CHEERS.shouts(message),
    participants: new Set(seated.map(x => x.id)), raised: new Set([p.id]), responded: new Set(),
    deadline: 0, timer: null
  };
  setCheersTimer(room, T.gatherMs, () => gatherTimeout(room));
  broadcast(room.id);
  checkGathered(room);
  return { ok: true };
}

function checkGathered(room) {
  const c = room.cheers;
  if (c && c.state === 'gathering' && [...c.participants].every(id => c.raised.has(id))) toReady(room);
}

function toReady(room) {
  room.cheers.state = 'ready';
  setCheersTimer(room, T.readyMs, () => shout(room, 1));
  broadcast(room.id);
}

function gatherTimeout(room) {
  const c = room.cheers;
  if (!c || c.state !== 'gathering') return;
  const raised = [...c.participants].filter(id => c.raised.has(id));
  if (raised.length <= 1) return endCheers(room, '아무도 잔을 들지 않아 건배가 취소됐어요.');
  c.participants = new Set(raised);
  toReady(room);
}

function shout(room, step) {
  const c = room.cheers;
  const initiator = c && room.players.get(c.initiator);
  if (!initiator) return endCheers(room);
  c.step = step;
  c.state = step < 3 ? 'shouting' : 'responding';
  if (step === 1) io.to(room.id).emit('cheers', { by: initiator.name, text: c.shouts[0] });
  if (step === 3) {
    setBubble(room, initiator, c.shouts[2], 2800);
    c.responded.add(initiator.id);
    sip(initiator);
    initiator.raisedGlass = false;
    announceAction(room, initiator, 'cheers');
  }
  broadcast(room.id);
  if (step < 3) setCheersTimer(room, T.shoutMs, () => shout(room, step + 1));
  else {
    setCheersTimer(room, T.respondMs, () => endCheers(room));
    checkResponded(room);
  }
}

function checkResponded(room) {
  const c = room.cheers;
  if (c && c.state === 'responding' && [...c.participants].every(id => c.responded.has(id))) {
    setCheersTimer(room, T.afterMs, () => endCheers(room));
  }
}

function respondCheers(room, p) {
  const c = room.cheers;
  if (!c || c.state !== 'responding') return { ok: false, code: 'NOT_NOW', message: '지금은 위하여를 외칠 때가 아니에요.' };
  if (!c.participants.has(p.id) || p.id === c.initiator) return { ok: false, code: 'NOT_PARTICIPANT', message: '이번 건배 참여자가 아니에요.' };
  if (c.responded.has(p.id)) return { ok: false, code: 'DUPLICATE', message: '이미 위하여를 외쳤어요.' };
  c.responded.add(p.id);
  p.raisedGlass = false;
  sip(p);
  setBubble(room, p, c.shouts[2], 2800);
  announceAction(room, p, 'cheers');
  broadcast(room.id);
  checkResponded(room);
  return { ok: true };
}

// 자리를 떠난 사람을 건배 참가자에서 뺀다. 제의자가 떠나면 건배를 취소한다.
function cheersMemberGone(room, id) {
  const c = room.cheers;
  if (!c) return;
  if (c.initiator === id) return endCheers(room, '건배제의자가 자리를 비워 건배가 취소됐어요.');
  c.participants.delete(id);
  c.raised.delete(id);
  c.responded.delete(id);
  checkGathered(room);
  checkResponded(room);
}

function removePlayer(socket, reason) {
  const id = socket.data.room, room = rooms.get(id);
  if (!room) return;
  const player = room.players.get(socket.id);
  if (player) {
    if (player.seat !== null) room.seats[player.seat] = null;
    clearTimeout(player.bubbleTimer);
    room.players.delete(socket.id);
    cheersMemberGone(room, player.id);
  }
  socket.leave(id);
  socket.data.room = null;
  if (room.players.size === 0) {
    clearTimeout(room.cheers?.timer);
    rooms.delete(id);
  } else {
    const name = player?.name || '사용자';
    io.to(id).emit('systemMessage', reason === 'leave' ? `${name}님이 잠시 매장 밖으로 나갔습니다.` : `${name}님이 나갔습니다.`);
    broadcast(id);
  }
  broadcastChannels();
}

/* ---------- 소켓 ---------- */
function context(socket) {
  const id = socket.data.room;
  const room = id ? rooms.get(id) : undefined;
  return { id, room, p: room?.players.get(socket.id) };
}

// 핸들러 안의 예외가 서버 프로세스를 죽이지 않게 감싼다. ack 콜백은 있으면 마지막 인자로 받는다.
function handle(socket, event, fn) {
  socket.on(event, (...args) => {
    const reply = typeof args[args.length - 1] === 'function' ? args.pop() : () => {};
    try {
      fn(args[0], reply);
    } catch (err) {
      console.error(`[${event}]`, err);
      try { reply({ ok: false, message: '처리 중 오류가 발생했어요.' }); } catch { /* 이미 끊긴 연결 */ }
    }
  });
}

io.on('connection', socket => {
  socket.emit('channelsState', channelSnapshot());

  handle(socket, 'joinRoom', (payload, reply) => {
    payload = payload && typeof payload === 'object' ? payload : {};
    const id = roomId(payload.room);
    if (!CHANNELS.includes(id)) {
      return reply({ ok: false, code: 'INVALID_CHANNEL', message: 'MP1, MP2, MP3 중 하나를 선택해 주세요.' });
    }
    if (socket.data.room) {
      const current = rooms.get(socket.data.room);
      if (socket.data.room === id && current?.players.has(socket.id)) {
        return reply({ ok: true, room: id, selfId: socket.id, state: snapshot(current) });
      }
      return reply({ ok: false, code: 'ALREADY_IN_CHANNEL', message: '이미 다른 채널에 입장했습니다.' });
    }
    const room = getRoom(id);
    if (room.players.size >= ROOM_CAPACITY) return reply({ ok: false, code: 'ROOM_FULL', message: '이 방은 6명 정원입니다.' });
    const p = createPlayer(socket.id, payload, room);
    room.players.set(socket.id, p);
    socket.join(id);
    socket.data.room = id;
    reply({ ok: true, room: id, selfId: socket.id, state: snapshot(room) });
    socket.to(id).emit('systemMessage', `${p.name}님이 들어왔습니다.`);
    setBubble(room, p, '퇴근했다!');
    broadcast(id);
    broadcastChannels();
  });

  handle(socket, 'leaveRoom', (_data, reply) => {
    removePlayer(socket, 'leave');
    reply({ ok: true });
  });

  handle(socket, 'move', data => {
    const { id, p } = context(socket);
    if (!p || p.seat !== null) return;
    const x = Number(data?.x), y = Number(data?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const t = now();
    // 걸을 수 있는 거리를 시간에 비례해 쌓아 두고(최대 80px), 이동할 때마다 쓴다. 이동 요청을 많이 보내도 평균 속도는 못 넘는다.
    p.moveBudget = Math.min(80, p.moveBudget + ((t - p.lastMoveAt) / 1000) * World.SPEED * 1.4);
    p.lastMoveAt = t;
    const next = World.toWorld(clamp01(x), clamp01(y)), cur = World.toWorld(p.x, p.y);
    const step = Math.hypot(next.x - cur.x, (next.y - cur.y) / World.SPEED_Y);
    // 너무 빠르거나 벽/가구 안쪽이면 받아들이지 않고 서버 위치로 되돌린다.
    if (step > p.moveBudget + 1 || !World.canStand(next.x, next.y)) {
      socket.emit('playerMoved', { id: p.id, x: p.x, y: p.y, dir: p.dir, snap: true });
      return;
    }
    p.moveBudget -= step;
    p.x = clamp01(x);
    p.y = clamp01(y);
    if (['up', 'down', 'left', 'right'].includes(data.dir)) p.dir = data.dir;
    socket.to(id).emit('playerMoved', { id: p.id, x: p.x, y: p.y, dir: p.dir });
  });

  handle(socket, 'sit', (seatIndex, reply) => {
    const { id, room, p } = context(socket);
    const i = Number(seatIndex);
    if (!p || !Number.isInteger(i) || i < 0 || i >= SEATS.length) return reply({ ok: false });
    if (room.seats[i] && room.seats[i] !== socket.id) return reply({ ok: false, message: '이미 사용 중인 좌석입니다.' });
    const here = World.toWorld(p.x, p.y);
    if (p.seat !== i && World.dist(here.x, here.y, SEATS[i].x, SEATS[i].y) > World.SEAT_RANGE + 25) {
      return reply({ ok: false, message: '의자 가까이에서 앉을 수 있어요.' });
    }
    if (p.seat !== null) room.seats[p.seat] = null;
    room.seats[i] = socket.id;
    p.seat = i;
    Object.assign(p, World.toNorm(SEATS[i].x, SEATS[i].y), { dir: SEATS[i].dir, raisedGlass: false });
    if (p.glass <= 0) p.glass = 100;
    broadcast(id);
    reply({ ok: true });
  });

  handle(socket, 'stand', (_data, reply) => {
    const { id, room, p } = context(socket);
    if (!p || p.seat === null) return reply({ ok: false });
    room.seats[p.seat] = null;
    Object.assign(p, World.toNorm(SEATS[p.seat].stand.x, SEATS[p.seat].stand.y), { seat: null, raisedGlass: false });
    cheersMemberGone(room, p.id);
    broadcast(id);
    reply({ ok: true });
  });

  handle(socket, 'chat', (raw, reply) => {
    const { room, p } = context(socket);
    if (!p) return reply({ ok: false });
    const text = cleanText(raw, LIMITS.chatMax);
    const t = now();
    if (!text || t - p.lastChatAt < 250) return reply({ ok: false });
    p.lastChatAt = t;
    io.to(room.id).emit('chat', { id: p.id, name: p.name, text, at: t });
    setBubble(room, p, text);
    reply({ ok: true });
  });

  handle(socket, 'selectDrink', (data, reply) => {
    const { id, p } = context(socket);
    if (!p) return reply({ ok: false });
    if (p.seat === null) return reply({ ok: false, message: '먼저 의자에 앉아 주세요.' });
    const drink = World.drinkById(data?.id) || DRINKS.find(d => d.label === data?.label);
    if (!drink) return reply({ ok: false, message: '고를 수 없는 술이에요.' });
    p.drinkId = drink.id;
    p.ratio = drink.mix ? World.clampRatio(data?.ratio ?? drink.mix.ratio) : null;
    p.glass = 100;
    broadcast(id);
    reply({ ok: true });
  });

  handle(socket, 'pourDrink', (target, reply) => {
    const { id, room, p } = context(socket);
    if (!p) return reply({ ok: false });
    if (p.seat === null) return reply({ ok: false, message: '먼저 의자에 앉아 주세요.' });
    const wanted = target && typeof target === 'object' ? target.target ?? target.id : target;
    const pool = wanted === 'all' ? [...room.players.values()] : [room.players.get(String(wanted))];
    const targets = pool.filter(x => x && x.id !== p.id && x.seat !== null);
    if (targets.length === 0) return reply({ ok: false, message: '술을 따라줄 사람이 테이블에 없어요.' });
    const drink = World.drinkById(p.drinkId);
    for (const to of targets) {
      to.drinkId = p.drinkId;
      to.ratio = p.ratio;
      to.glass = 100;
      to.heartUntil = now() + LIMITS.heartMs;
      io.to(id).emit('pourEffect', { from: p.id, to: to.id, drink: drink ? drink.label : '' });
      io.to(id).emit('heartEffect', { id: to.id, by: p.id, ms: LIMITS.heartMs });
    }
    announceAction(room, p, 'pour');
    broadcast(id);
    reply({ ok: true, count: targets.length });
  });

  handle(socket, 'raiseGlass', (_data, reply) => {
    const { id, room, p } = context(socket);
    if (!p || p.seat === null) return reply({ ok: false });
    p.raisedGlass = !p.raisedGlass;
    const c = room.cheers;
    if (c && c.participants.has(p.id)) {
      if (p.raisedGlass) c.raised.add(p.id); else c.raised.delete(p.id);
    }
    broadcast(id);
    checkGathered(room);
    reply({ ok: true, raisedGlass: p.raisedGlass });
  });

  handle(socket, 'drinkSip', (_data, reply) => {
    const { id, room, p } = context(socket);
    if (!p || p.seat === null) return reply({ ok: false });
    if (!sip(p)) return reply({ ok: false, message: '잔이 비었어요. 따라주기나 술 선택으로 채워 주세요.' });
    p.raisedGlass = false;
    if (room.cheers) room.cheers.raised.delete(p.id);
    announceAction(room, p, 'drink');
    broadcast(id);
    reply({ ok: true });
  });

  const propose = (raw, reply) => {
    const { room, p } = context(socket);
    if (!p) return reply({ ok: false });
    reply(startCheers(room, p, raw && typeof raw === 'object' ? raw.text ?? raw.message : raw));
  };
  handle(socket, 'cheersProposal', propose);
  handle(socket, 'cheers', propose); // 예전 이벤트 이름도 같은 건배 흐름으로 처리한다.

  handle(socket, 'cheersReady', (_data, reply) => {
    const { id, room, p } = context(socket);
    if (!p || p.seat === null) return reply({ ok: false });
    p.raisedGlass = true;
    if (room.cheers?.participants.has(p.id)) room.cheers.raised.add(p.id);
    broadcast(id);
    checkGathered(room);
    reply({ ok: true });
  });

  handle(socket, 'cheersResponse', (_data, reply) => {
    const { room, p } = context(socket);
    if (!p) return reply({ ok: false });
    reply(respondCheers(room, p));
  });

  handle(socket, 'interaction', (data, reply) => {
    const { id, p } = context(socket);
    const item = World.interactionById(data?.id ?? data);
    if (!p || !item) return reply({ ok: false });
    const here = World.toWorld(p.x, p.y);
    if (World.dist(here.x, here.y, item.x, item.y) > item.r + 30) return reply({ ok: false, message: '조금 더 가까이 가야 볼 수 있어요.' });
    io.to(id).emit('interaction', { id: p.id, name: p.name, interaction: item.id, title: item.title });
    reply({ ok: true });
  });

  handle(socket, 'emote', (kind, reply) => {
    const { id, p } = context(socket);
    if (!p || !Object.hasOwn(World.EMOTES, kind)) return reply({ ok: false, message: '사용할 수 없는 감정표현이에요.' });
    const t = now();
    if (t - p.lastEmoteAt < 900) return reply({ ok: false, message: '잠시 뒤 다시 표현해 주세요.' });
    p.lastEmoteAt = t;
    p.emote = kind;
    p.emoteUntil = t + 2600;
    io.to(id).emit('emote', { id: p.id, kind, ms: 2600 });
    reply({ ok: true });
  });

  handle(socket, 'staffInteraction', (data, reply) => {
    const { id, room, p } = context(socket);
    if (!p) return reply({ ok: false, message: '먼저 매장에 들어와 주세요.' });
    const here = World.toWorld(p.x, p.y);
    if (p.seat !== null || !World.nearStaff(here.x, here.y)) {
      return reply({ ok: false, message: '카운터 직원 가까이 와서 말을 걸어 주세요.' });
    }
    if (socket.data.remedyReceived) {
      return reply({ ok: true, canReceive: false, message: '숙취해소제는 아까 드렸어요~\n물도 많이 드세요!' });
    }
    if (p.drinkCount === 0) {
      return reply({ ok: true, canReceive: false, message: '아직 멀쩡해 보이시는데요?\n필요할 때 다시 오세요!' });
    }
    if (data?.receive !== true) {
      return reply({ ok: true, canReceive: true, message: '많이 드셨네요~\n숙취해소제 하나 드릴게요!' });
    }
    socket.data.remedyReceived = true;
    p.drinkCount = Math.round(p.drinkCount * 0.8);
    setBubble(room, p, '숙취 -20%!', 3000);
    broadcast(id);
    reply({ ok: true, received: true, canReceive: false, message: '숙취 -20%!' });
  });

  socket.on('disconnect', () => removePlayer(socket, 'disconnect'));
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => console.log(`Random Today Tudari listening on ${PORT}`));
}

module.exports = { app, server, io, rooms };
