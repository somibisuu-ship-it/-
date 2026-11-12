'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { io: connect } = require('socket.io-client');
const World = require('../public/shared/world.js');
const { server, io, rooms } = require('../server.js');

// 건배 연출 대기 시간만 줄여서 테스트가 빨리 끝나게 한다.
Object.assign(World.CHEERS.timing, { gatherMs: 4000, readyMs: 60, shoutMs: 60, respondMs: 1500, afterMs: 60 });

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const open = [];
let port;

test.before(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});
test.after(async () => {
  for (const c of open) c.disconnect();
  await new Promise(resolve => io.close(resolve));
});
test.afterEach(async () => {
  for (const c of open.splice(0)) c.disconnect();
  await until(() => rooms.size === 0);
});

async function until(fn, ms = 3000) {
  const start = Date.now();
  for (;;) {
    const value = fn();
    if (value) return value;
    if (Date.now() - start > ms) throw new Error(`until() timeout: ${fn}`);
    await wait(10);
  }
}

async function client() {
  const c = connect(`http://127.0.0.1:${port}`, { transports: ['websocket'], forceNew: true });
  open.push(c);
  c.log = [];
  for (const ev of ['roomState', 'systemMessage', 'chat', 'bubble', 'bubbleClear', 'pourEffect', 'heartEffect', 'playerAction', 'cheers', 'interaction', 'playerMoved', 'channelsState']) {
    c.on(ev, data => c.log.push([ev, data]));
  }
  await new Promise((resolve, reject) => { c.once('connect', resolve); c.once('connect_error', reject); });
  return c;
}
const emit = (c, event, ...args) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`ack timeout: ${event}`)), 3000);
  c.emit(event, ...args, res => { clearTimeout(timer); resolve(res); });
});
const events = (c, name) => c.log.filter(([e]) => e === name).map(([, d]) => d);
const state = c => events(c, 'roomState').at(-1);
const me = c => state(c)?.players.find(p => p.id === c.id);
const cheersOf = c => state(c)?.cheers;

async function join(c, name, room = 'MP1', avatar) {
  const res = await emit(c, 'joinRoom', { room, name, avatar });
  assert.equal(res.ok, true, JSON.stringify(res));
  await until(() => me(c));
  return res;
}

// 서버의 속도 제한을 지키는 걸음으로 걸어서 간다. (한 번에 순간이동하면 서버가 거부해야 한다)
async function walk(c, points) {
  const start = World.toWorld(me(c).x, me(c).y);
  let cur = { x: start.x, y: start.y };
  for (const to of points) {
    for (let guard = 0; ; guard++) {
      const dx = to.x - cur.x, dy = to.y - cur.y;
      const len = Math.hypot(dx, dy / World.SPEED_Y);
      if (len < 6) break;
      assert.ok(guard < 200, `길이 막혔어요: (${Math.round(cur.x)},${Math.round(cur.y)}) -> (${to.x},${to.y}) ${World.blockedAt(cur.x, cur.y)?.id || ''}`);
      const step = Math.min(len, World.SPEED * 0.05);
      cur = World.resolveMove(cur.x, cur.y, cur.x + (dx / len) * step, cur.y + (dy / len) * step);
      const n = World.toNorm(cur.x, cur.y);
      c.emit('move', { x: n.x, y: n.y, dir: 'right' });
      await wait(50);
    }
  }
  await wait(60);
  return cur;
}

// 출입문 근처에서 시작한 플레이어가 4번/5번 의자 앞까지 가는 길(장애물을 피하는 경유점)
const ROUTE = {
  3: [{ x: 620, y: 990 }, { x: 646, y: 790 }, { x: 918, y: 792 }],
  4: [{ x: 620, y: 990 }, { x: 646, y: 800 }],
  5: [{ x: 620, y: 990 }, { x: 610, y: 720 }, { x: 592, y: 706 }]
};
async function seatAt(c, index) {
  await walk(c, ROUTE[index]);
  const res = await emit(c, 'sit', index);
  assert.equal(res.ok, true, `sit ${index}: ${JSON.stringify(res)}`);
  await until(() => me(c)?.seat === index);
}

test('입장: ack ok 응답, 6명 정원, 채널 인원 갱신, 나가면 자리가 비워진다', async () => {
  const clients = [];
  for (let i = 0; i < 6; i++) {
    const c = await client();
    clients.push(c);
    const res = await join(c, `손님${i}`);
    assert.equal(res.selfId, c.id);
    assert.ok(World.canStand(...Object.values(World.toWorld(me(c).x, me(c).y))), '시작 위치는 걸을 수 있는 바닥이어야 한다');
  }
  await until(() => state(clients[0]).players.length === 6);

  const seventh = await client();
  const full = await emit(seventh, 'joinRoom', { room: 'MP1', name: '일곱째' });
  assert.deepEqual([full.ok, full.code], [false, 'ROOM_FULL']);
  const invalid = await emit(seventh, 'joinRoom', { room: 'ZZ9', name: 'x' });
  assert.equal(invalid.code, 'INVALID_CHANNEL');

  const mp1 = () => events(seventh, 'channelsState').at(-1).find(ch => ch.id === 'MP1');
  await until(() => mp1()?.full === true);
  assert.equal(mp1().count, 6);

  assert.equal((await emit(clients[0], 'leaveRoom')).ok, true);
  await until(() => mp1().count === 5 && !mp1().full);
  const again = await emit(seventh, 'joinRoom', { room: 'MP1', name: '일곱째' });
  assert.equal(again.ok, true);
});

test('입장: 아바타는 허용된 값만 남고 예전 gender 값도 base로 받는다', async () => {
  const c = await client();
  await join(c, '  <b>민수</b>  ', 'MP2', { gender: 'female', hair: 'ponytail', eyes: 'bad', hairColor: 'red', outfit: 'kia', accessory: 'cap' });
  assert.deepEqual(me(c).avatar, {
    base: 'female', gender: 'female', eyes: 'round', hair: 'ponytail', hairStyle: 'B03', hairColor: '#201a25', outfit: 'kia', accessory: 'cap'
  });
  assert.equal(me(c).name, 'b민수/b');
});

test('헤어: 이전 프로필을 보존하고 신규 8종과 모든 기존 머리색을 동기화한다', async () => {
  const c = await client();
  const legacy = { hair: 'long', eyes: 'sleepy', hairColor: '#6e35d4', outfit: 'hanwha', accessory: 'glasses' };
  await join(c, '헤어', 'MP1', legacy);
  assert.equal(me(c).avatar.hairStyle, 'B02');
  for (const [style, , hair] of World.HAIR_STYLES) {
    for (const color of World.AVATAR.hairColors) {
      await emit(c, 'leaveRoom');
      await join(c, '헤어', 'MP1', { ...legacy, hairStyle: style, hairColor: color });
      assert.deepEqual([me(c).avatar.hairStyle, me(c).avatar.hair, me(c).avatar.hairColor,
        me(c).avatar.eyes, me(c).avatar.outfit, me(c).avatar.accessory],
      [style, hair, color, legacy.eyes, legacy.outfit, legacy.accessory]);
    }
  }
});

test('액세서리: 기존 선택과 추가 4종이 다른 사용자에게 그대로 전달되고 재입장해도 보존된다', async () => {
  const a = await client(), b = await client();
  await join(b, '장식확인', 'MP3');
  const appearance = { base: 'female', hairStyle: 'B03', eyes: 'upturned', hairColor: '#7a4b2a', outfit: 'ragged' };
  for (const accessory of ['none', 'glasses', 'cap', 'ribbon', 'headset', 'catEars', 'bunnyEars', 'crown', 'starClip']) {
    const expected = World.normalizeAvatar({ ...appearance, accessory });
    assert.equal(expected.accessory, accessory);
    await join(a, '장식', 'MP3', { ...appearance, accessory });
    const remote = await until(() => state(b).players.find(p => p.id === a.id));
    assert.deepEqual(me(a).avatar, expected);
    assert.deepEqual(remote.avatar, expected);
    const saved = { ...me(a).avatar };
    await emit(a, 'leaveRoom');
    await until(() => !state(b).players.some(p => p.id === a.id));
    await join(a, '장식', 'MP3', saved);
    assert.deepEqual(me(a).avatar, expected);
    await emit(a, 'leaveRoom');
    await until(() => !state(b).players.some(p => p.id === a.id));
  }
});

test('감정: 두 사용자에게 전달되고 좌석·프로필·취기는 그대로이며 연타/잘못된 값은 거부한다', async () => {
  const a = await client(), b = await client();
  await join(a, 'A'); await join(b, 'B');
  const p = rooms.get('MP1').players.get(a.id);
  p.drinkCount = 15; p.seat = 4; p.raisedGlass = true;
  for (const c of [a, b]) c.on('emote', data => c.log.push(['emote', data]));
  const before = { avatar: { ...p.avatar }, seat: p.seat, drinkCount: p.drinkCount, raisedGlass: p.raisedGlass };
  for (const kind of Object.keys(World.EMOTES)) {
    p.lastEmoteAt = 0;
    assert.equal((await emit(a, 'emote', kind)).ok, true);
    await until(() => events(b, 'emote').at(-1)?.kind === kind);
    assert.equal(events(a, 'emote').at(-1).ms, 2600);
    assert.equal((await emit(a, 'emote', kind)).ok, false);
  }
  assert.equal((await emit(a, 'emote', 'invalid')).ok, false);
  assert.deepEqual({ avatar: p.avatar, seat: p.seat, drinkCount: p.drinkCount, raisedGlass: p.raisedGlass }, before);
  assert.equal(World.drunkLevelFor(p.drinkCount), 3);
});

test('직원: 거리 검증, 0잔은 미소비, 20% 감소와 취기 재계산, 재입장해도 세션당 1회', async () => {
  const a = await client(), b = await client();
  await join(a, 'A'); await join(b, 'B');
  let p = rooms.get('MP1').players.get(a.id);
  assert.equal((await emit(a, 'staffInteraction', { receive: true })).ok, false);
  Object.assign(p, World.toNorm(World.STAFF.x, World.STAFF.y));
  assert.equal((await emit(a, 'staffInteraction', { receive: true })).canReceive, false);
  p.drinkCount = 10;
  assert.equal((await emit(a, 'staffInteraction', {})).canReceive, true);
  assert.equal(p.drinkCount, 10, '말만 걸면 횟수가 줄지 않는다');
  assert.equal((await emit(a, 'staffInteraction', { receive: true, drinkCount: 0 })).received, true);
  await until(() => state(b).players.find(v => v.id === a.id).drinkCount === 8);
  assert.equal(state(b).players.find(v => v.id === a.id).drunkLevel, 1);
  assert.equal(events(b, 'bubble').at(-1).text, '숙취 -20%!');
  assert.equal(events(b, 'bubble').at(-1).ms, 3000);
  assert.match((await emit(a, 'staffInteraction', { receive: true })).message, /아까/);
  assert.equal(p.drinkCount, 8);
  const avatar = { ...p.avatar };
  await emit(a, 'leaveRoom');
  await join(a, 'A', 'MP1', avatar);
  p = rooms.get('MP1').players.get(a.id);
  Object.assign(p, World.toNorm(World.STAFF.x, World.STAFF.y), { drinkCount: 20 });
  assert.match((await emit(a, 'staffInteraction', { receive: true })).message, /아까/);
  assert.equal(p.drinkCount, 20);
});

test('직원: 5→4, 20→16과 소수점 반올림을 기존 취기 함수에 반영한다', async () => {
  for (const [count, expected, level] of [[5, 4, 0], [20, 16, 3], [7, 6, 1]]) {
    const c = await client();
    await join(c, '숙취');
    const p = rooms.get('MP1').players.get(c.id);
    Object.assign(p, World.toNorm(World.STAFF.x, World.STAFF.y), { drinkCount: count });
    await emit(c, 'staffInteraction', { receive: true });
    assert.deepEqual([me(c).drinkCount, me(c).drunkLevel], [expected, level]);
    await emit(c, 'leaveRoom');
  }
});

test('이동: 걸음은 받아들이고 순간이동과 가구 통과는 서버가 되돌린다', async () => {
  const [a, b] = [await client(), await client()];
  await join(a, 'A');
  await join(b, 'B');
  const before = { ...me(a) };

  const start = World.toWorld(before.x, before.y);
  const ok = World.toNorm(start.x + 10, start.y);
  a.emit('move', { x: ok.x, y: ok.y, dir: 'right' });
  const moved = await until(() => events(b, 'playerMoved').find(m => m.id === a.id));
  assert.ok(Math.abs(moved.x - ok.x) < 1e-9);

  const tele = World.toNorm(1000, 600);
  a.emit('move', { x: tele.x, y: tele.y, dir: 'up' });
  const snap = await until(() => events(a, 'playerMoved').find(m => m.snap));
  assert.ok(Math.abs(snap.x - ok.x) < 1e-9, '서버가 마지막 정상 위치로 되돌려야 한다');

  // 한 걸음 거리라도 탁자 안쪽이면 거부 (서버 쪽 위치를 탁자 옆으로 옮겨 놓고 확인)
  const near = { x: 610, y: 690 };
  const inside = { x: 611, y: 668 };
  assert.equal(World.canStand(near.x, near.y), true);
  assert.equal(World.canStand(inside.x, inside.y), false, '테스트 전제: 탁자 안쪽');
  Object.assign(rooms.get('MP1').players.get(a.id), World.toNorm(near.x, near.y));
  const n = World.toNorm(inside.x, inside.y);
  a.emit('move', { x: n.x, y: n.y, dir: 'up' });
  await until(() => events(a, 'playerMoved').filter(m => m.snap).length >= 2);
  const back = events(a, 'playerMoved').filter(m => m.snap).at(-1);
  assert.deepEqual([back.x, back.y], [World.toNorm(near.x, near.y).x, World.toNorm(near.x, near.y).y]);
});

test('이동: 이동 요청을 짧은 간격으로 쏟아내도 평균 속도 제한을 못 넘는다', async () => {
  const a = await client();
  await join(a, 'A');
  const start = World.toWorld(me(a).x, me(a).y);
  // 150ms 동안 5px씩 40번(=초당 1300px 이상)을 요청한다. 허용되는 건 대략 80px(+걷는 속도 150ms 분량) 안팎이다.
  for (let i = 1; i <= 40; i++) {
    const n = World.toNorm(start.x + i * 5, start.y);
    a.emit('move', { x: n.x, y: n.y, dir: 'right' });
    await wait(4);
  }
  await wait(200);
  const server = rooms.get('MP1').players.get(a.id);
  const moved = (server.x - World.toNorm(start.x, start.y).x) * World.WORLD.w;
  assert.ok(moved > 0, '일부는 받아들여진다');
  assert.ok(moved < 140, `서버가 속도를 제한해야 한다 (실제 ${Math.round(moved)}px)`);
  assert.ok(events(a, 'playerMoved').some(m => m.snap), '넘치는 요청은 서버 위치로 되돌린다');
});

test('착석: 가까이서만 앉고, 사용 중인 자리는 못 앉고, 일어나거나 나가면 자리가 풀린다', async () => {
  const [a, b] = [await client(), await client()];
  await join(a, 'A');
  await join(b, 'B');

  const far = await emit(a, 'sit', 4);
  assert.equal(far.ok, false, '멀리서는 앉을 수 없다');

  await seatAt(a, 4);
  await until(() => state(b).seats[4] === a.id);
  assert.equal(me(a).glass, 100, '앉으면 기본 잔이 채워진다');

  await walk(b, ROUTE[4]);
  const taken = await emit(b, 'sit', 4);
  assert.equal(taken.ok, false);
  assert.match(taken.message, /사용 중/);

  // TEST 3: 일어서기 -> 좌석 해제, 서 있는 자리는 걸을 수 있는 곳
  assert.equal((await emit(a, 'stand')).ok, true);
  await until(() => state(b).seats[4] === null);
  assert.equal(World.canStand(...Object.values(World.toWorld(me(a).x, me(a).y))), true);

  // TEST 4: A가 나간 뒤 B가 그 자리에 앉는다
  assert.equal((await emit(a, 'sit', 4)).ok, true, '서 있던 자리 근처에서 다시 앉을 수 있다');
  await until(() => state(b).seats[4] === a.id);
  assert.equal((await emit(a, 'leaveRoom')).ok, true);
  await until(() => state(b).seats[4] === null);
  const sat = await emit(b, 'sit', 4);
  assert.equal(sat.ok, true);
});

test('채팅: 보낸 사람 id와 함께 전달되고 머리 위 말풍선도 생긴다', async () => {
  const [a, b] = [await client(), await client()];
  await join(a, 'A');
  await join(b, 'B');
  await emit(a, 'chat', '안녕하세요 <script>');
  const msg = await until(() => events(b, 'chat').find(m => m.id === a.id));
  assert.equal(msg.text, '안녕하세요 script');
  assert.equal(msg.name, 'A');
  const bubble = await until(() => events(b, 'bubble').find(x => x.id === a.id && x.text === msg.text));
  assert.equal(bubble.ms, World.LIMITS.bubbleMs);
  const hello = events(a, 'bubble').find(x => x.id === a.id && x.text === '퇴근했다!');
  assert.ok(hello, '새로 들어오면 "퇴근했다!" 말풍선');
});

test('따라주기: 특정 사람/모두에게, 자기 자신 제외, 하트 5초', async () => {
  const [a, b, c] = [await client(), await client(), await client()];
  await join(a, 'A'); await join(b, 'B'); await join(c, 'C');
  await Promise.all([seatAt(a, 4), seatAt(b, 5), seatAt(c, 3)]);

  const nobody = await emit(a, 'pourDrink', a.id);
  assert.equal(nobody.ok, false, '자기 자신에게는 따라줄 수 없다');

  await emit(a, 'selectDrink', { id: 'beer' });
  await emit(b, 'drinkSip'); await emit(b, 'drinkSip');
  await until(() => state(a).players.find(p => p.id === b.id).glass === 50);

  const one = await emit(a, 'pourDrink', b.id);
  assert.deepEqual([one.ok, one.count], [true, 1]);
  await until(() => state(a).players.find(p => p.id === b.id).glass === 100);
  const bv = state(a).players.find(p => p.id === b.id);
  assert.equal(bv.drinkId, 'beer', '따라준 술로 잔이 채워진다');
  assert.ok(bv.heartMs > 4000 && bv.heartMs <= World.LIMITS.heartMs);
  await until(() => events(c, 'heartEffect').some(h => h.id === b.id));
  assert.equal(events(c, 'heartEffect').filter(h => h.id === b.id).length, 1);
  assert.equal(events(c, 'heartEffect').filter(h => h.id === c.id).length, 0, '다른 사람에게는 하트가 가지 않는다');

  const all = await emit(a, 'pourDrink', 'all');
  assert.deepEqual([all.ok, all.count], [true, 2]);
  await until(() => events(a, 'heartEffect').filter(h => h.id === c.id).length === 1);
  assert.equal(events(a, 'heartEffect').filter(h => h.id === a.id).length, 0);
  assert.equal(events(a, 'heartEffect').find(h => h.id === c.id).ms, 5000);
});

test('술 선택: 소맥 비율은 허용 범위로 맞춰지고 알 수 없는 술은 거부된다', async () => {
  const a = await client();
  await join(a, 'A');
  await seatAt(a, 4);
  assert.equal((await emit(a, 'selectDrink', { id: 'somaek', ratio: 33 })).ok, true);
  await until(() => me(a).drinkId === 'somaek');
  assert.equal(me(a).ratio, 35);
  assert.equal((await emit(a, 'selectDrink', { id: 'somaek', ratio: 999 })).ok, true);
  await until(() => me(a).ratio === 90);
  assert.equal((await emit(a, 'selectDrink', { label: '사케' })).ok, false);
  assert.equal((await emit(a, 'selectDrink', { label: '맥주' })).ok, true);
  await until(() => me(a).drinkId === 'beer' && me(a).ratio === null);
});

test('마시기: 5/10/15잔에서 취기 1/2/3단계가 되고 잔이 비면 마실 수 없다', async () => {
  const a = await client();
  await join(a, 'A');
  await seatAt(a, 4);
  const levels = {};
  for (let n = 1; n <= 15; n++) {
    if (n % 4 === 1) await emit(a, 'selectDrink', { id: 'beer' });
    assert.equal((await emit(a, 'drinkSip')).ok, true);
    await until(() => me(a).drinkCount === n);
    levels[n] = me(a).drunkLevel;
  }
  assert.deepEqual([levels[4], levels[5], levels[9], levels[10], levels[14], levels[15]], [0, 1, 1, 2, 2, 3]);
  assert.equal(me(a).drunk, 3, '예전 클라이언트용 별칭');
  while (me(a).glass > 0) { await emit(a, 'drinkSip'); await wait(15); }
  const dry = await emit(a, 'drinkSip');
  assert.equal(dry.ok, false);
  const count = me(a).drinkCount;
  await wait(50);
  assert.equal(me(a).drinkCount, count);
});

test('건배: 제의자는 위하여를 정확히 3번만 외치고 응답은 한 번씩만 인정된다', async () => {
  const [a, b] = [await client(), await client()];
  await join(a, 'A'); await join(b, 'B');
  await Promise.all([seatAt(a, 4), seatAt(b, 5)]);

  assert.equal((await emit(b, 'cheersResponse')).code, 'NOT_NOW', '건배 전에는 응답할 수 없다');
  const started = await emit(a, 'cheersProposal', { text: '오늘도 무사히 퇴근한 우리를 위하여!' });
  assert.equal(started.ok, true);
  assert.equal((await emit(b, 'cheersProposal', { text: '두 번째' })).code, 'CHEERS_ACTIVE');

  let c = await until(() => cheersOf(b)?.state === 'gathering' && cheersOf(b));
  assert.equal(c.initiator.name, 'A');
  assert.deepEqual(c.lines, World.CHEERS.opening);
  assert.deepEqual([c.raised.length, c.participants.length], [1, 2], '제의자만 잔을 든 상태 1/2');
  assert.equal(c.message, '오늘도 무사히 퇴근한 우리를');

  await emit(b, 'raiseGlass');
  c = await until(() => cheersOf(a)?.state === 'ready' && cheersOf(a));
  assert.deepEqual(c.lines, World.CHEERS.ready);

  const seen = [];
  await until(() => {
    const s = cheersOf(a);
    if (s.state === 'shouting' || s.state === 'responding') { if (seen.at(-1) !== s.step) seen.push(s.step); }
    return s.state === 'responding';
  });
  assert.deepEqual(seen, [1, 2, 3], '1,2,3회차가 시간차를 두고 차례로 나온다');
  c = cheersOf(b);
  assert.deepEqual(c.shouts, ['오늘도 무사히 퇴근한 우리를 위하여!', '위하여.', '위.하.여!']);
  const total = c.shouts.join(' ').replace(/\./g, '').match(/위하여/g).length;
  assert.equal(total, 3, '위하여는 정확히 3번');

  assert.equal(events(b, 'bubble').some(x => x.id === a.id && x.text === '위.하.여!'), true, '제의자 머리 위 위.하.여!');
  assert.equal(me(a).drinkCount, 1, '제의자도 마신다');

  const r1 = await emit(b, 'cheersResponse');
  const r2 = await emit(b, 'cheersResponse');
  assert.equal(r1.ok, true);
  assert.equal(r2.code, 'DUPLICATE');
  await until(() => cheersOf(a).state === 'idle');
  assert.deepEqual([me(b).drinkCount, me(b).glass, me(b).raisedGlass, me(a).raisedGlass], [1, 75, false, false]);
  assert.equal(events(a, 'bubble').filter(x => x.text === '위.하.여!' && x.id === b.id).length, 1);

  // 끝난 뒤에는 새 건배를 다시 시작할 수 있다
  assert.equal((await emit(b, 'cheersProposal', { text: '다시' })).ok, true);
});

test('건배: 제의자가 떠나면 취소되고, 참가자가 빠지면 나머지로 이어진다', async () => {
  const [a, b, c] = [await client(), await client(), await client()];
  await join(a, 'A'); await join(b, 'B'); await join(c, 'C');
  await Promise.all([seatAt(a, 4), seatAt(b, 5), seatAt(c, 3)]);

  await emit(a, 'cheersProposal', { text: '건강을' });
  await until(() => cheersOf(b)?.state === 'gathering');
  await emit(b, 'raiseGlass');
  await emit(c, 'stand');
  await until(() => cheersOf(a).participants.length === 2);
  await until(() => cheersOf(a).state === 'ready', 1500);

  await until(() => cheersOf(a).state === 'responding');
  await emit(a, 'leaveRoom');
  await until(() => cheersOf(b).state === 'idle');
  assert.ok(events(b, 'systemMessage').includes('A님이 잠시 매장 밖으로 나갔습니다.'));
});

test('나가기: leaveRoom 뒤 같은 소켓으로 처음 상태로 다시 입장할 수 있다', async () => {
  const [a, b] = [await client(), await client()];
  const avatar = { base: 'female', hair: 'long', hairColor: '#e6007e', eyes: 'smile', outfit: 'uplus', accessory: 'ribbon' };
  await join(a, 'A', 'MP3', avatar); await join(b, 'B', 'MP3');
  await seatAt(a, 4);
  for (let i = 0; i < 6; i++) {
    if (i === 4) await emit(a, 'selectDrink', { id: 'soju' });
    assert.equal((await emit(a, 'drinkSip')).ok, true);
  }
  await until(() => me(a).drinkCount === 6);

  await emit(a, 'leaveRoom');
  await until(() => events(b, 'systemMessage').includes('A님이 잠시 매장 밖으로 나갔습니다.'));
  assert.equal(state(b).players.length, 1);
  assert.equal(state(b).seats[4], null);

  await join(a, 'A', 'MP3', avatar);
  assert.deepEqual([me(a).seat, me(a).drinkCount, me(a).glass], [null, 0, 0], '술자리 상태는 새로 시작');
  assert.deepEqual(me(a).avatar, World.normalizeAvatar(avatar), '아바타는 그대로');
  assert.equal((await emit(a, 'joinRoom', { room: 'MP1', name: 'A' })).code, 'ALREADY_IN_CHANNEL');
});

test('매장 상호작용: 구역 안에서만 열리고 다른 사람에게 알려진다', async () => {
  const [a, b] = [await client(), await client()];
  await join(a, 'A'); await join(b, 'B');
  const plan = World.interactionById('phone_55');
  assert.equal((await emit(a, 'interaction', { id: plan.id })).ok, false, '멀리서는 볼 수 없다');
  assert.equal((await emit(a, 'interaction', { id: 'nope' })).ok, false);
  assert.equal(World.nearDoor(...Object.values(World.toWorld(me(a).x, me(a).y))), false, '시작 위치는 출입문 구역 밖');

  Object.assign(rooms.get('MP1').players.get(a.id), World.toNorm(plan.x, plan.y));
  assert.equal((await emit(a, 'interaction', { id: plan.id })).ok, true);
  const seen = await until(() => events(b, 'interaction').find(e => e.id === a.id));
  assert.deepEqual([seen.interaction, seen.title], ['phone_55', '55요금제']);
});

test('출입문: 문 밖 이동은 앞마당으로 제한되고 입장 시작점은 매장 안쪽이다', () => {
  const outside = World.DOOR.outsideSpawn;
  assert.equal(World.canWalkOutside(outside.x, outside.y), true);
  assert.equal(World.nearDoor(outside.x, outside.y), false);
  const approach = { x: 385, y: 945 };
  assert.equal(World.canWalkOutside(approach.x, approach.y), true);
  assert.equal(World.nearDoor(approach.x, approach.y), true);
  assert.equal(World.nearDoor(World.DOOR.inside.x, World.DOOR.inside.y), true);
  assert.equal(World.canStand(World.DOOR.inside.x, World.DOOR.inside.y), true);
  for (const p of World.SPAWNS) assert.equal(World.canWalkOutside(p.x, p.y), false);
  const blocked = World.resolveMove(385, 945, 385, 900, World.canWalkOutside);
  assert.deepEqual(blocked, { x: 385, y: 945 });
});

test('월드 데이터: 모든 구역 중심과 시작/일어서기 위치는 걸어갈 수 있는 바닥이다', () => {
  const spots = [
    ...World.SPAWNS.map((p, i) => [`spawn${i}`, p]),
    ...World.SEATS.map((s, i) => [`stand${i}`, s.stand]),
    ...World.STORE_INTERACTIONS.map(z => [z.id, z]),
    ['door', World.DOOR]
  ];
  for (const [name, p] of spots) assert.equal(World.canStand(p.x, p.y), true, `${name}: ${World.blockedAt(p.x, p.y)?.id || 'WALK 밖'}`);
  World.SEATS.forEach((s, i) => assert.equal(World.canStand(s.x, s.y), false, `의자 ${i}는 걸어 들어갈 수 없다`));
  World.SPAWNS.forEach((p, i) => assert.equal(World.nearDoor(p.x, p.y), false, `spawn${i}가 출입문 구역 안에 있다`));
});
