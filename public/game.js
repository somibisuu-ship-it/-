'use strict';
(() => {
  const W = window.TudariWorld;
  const S = window.TudariSprites;
  const P = window.TudariProps;
  const UI = window.TudariUI;
  const Audio = window.TudariAudio;
  const $ = id => document.getElementById(id);
  const WW = W.WORLD.w, WH = W.WORLD.h;
  const SCALE = (S && S.SCALE) || 4;
  const params = new URLSearchParams(location.search);

  /* ================= 상태 =================
   * PLAYER PROFILE : playerProfile (닉네임 + 아바타, localStorage에 저장, 로비<->게임을 오가도 유지)
   * ROOM STATE     : joinedRoom, players, seats          (서버가 보내 주는 방 상태)
   * SESSION STATE  : 플레이어별 glass/drink/drinkCount/drunkLevel/raisedGlass, cheers (서버가 권위)   */
  const loaded = UI.loadProfile();
  const playerProfile = loaded.profile;
  const socket = io();
  let channels = [];
  let joinedRoom = null, outsideRoom = null, joinToken = 0, pendingJoin = false;
  let selfId = null;
  let players = new Map();
  let seats = Array(W.SEATS.length).fill(null);
  let cheers = { state: 'idle' };
  let me = null;
  let effects = [];
  let running = false, rafId = 0, lastFrame = 0, lastSend = 0, wasMoving = false;
  const keys = new Set();
  let stick = { x: 0, y: 0 };
  const cam = { x: WW / 2, y: WH / 2, z: 0.7, snap: true };
  let view = { w: 0, h: 0, dpr: 1, cover: false, uiBottom: 0 };

  const hash = s => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };
  const SHOUT3 = W.CHEERS.shouts('')[2];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const worldOf = p => ({ x: p.rx * WW, y: p.ry * WH });
  const nowMs = () => performance.now();

  /* ================= 배경/에셋 ================= */
  const plate = new Image();
  let propsReady = false;
  const plateReady = new Promise(resolve => { plate.onload = resolve; plate.onerror = resolve; });
  plate.src = '/assets/uplus-tudari-space.png';
  const floorRepair = new Image();
  const floorReady = new Promise(resolve => {
    floorRepair.onload = resolve;
    floorRepair.onerror = () => { console.error('테이블 뒤 바닥 이미지를 불러오지 못했습니다.'); resolve(); };
  });
  floorRepair.src = '/assets/table-floor-repair.png';
  const fontsReady = document.fonts
    ? Promise.all([document.fonts.load('400 12px Galmuri11'), document.fonts.load('700 12px Galmuri11')]).catch(() => {})
    : Promise.resolve();
  const assetsReady = Promise.all([plateReady, floorReady, fontsReady, S ? S.loadAssets('/assets/avatar/manifest.json') : null]).then(() => {
    if (P && plate.naturalWidth && floorRepair.naturalWidth) { P.init(plate, W, floorRepair); propsReady = true; }
  });

  /* ================= 로비 ================= */
  const chat = UI.createChat({
    selfId: () => selfId,
    avatarOf: id => players.get(id)?.avatar,
    onSend: text => socket.emit('chat', text, res => { if (res && !res.ok) UI.toast('메시지를 너무 빨리 보냈어요.'); })
  });
  const lobby = UI.createLobby({
    profile: playerProfile,
    onEnter: enterOutside,
    onProfileChange: () => {}
  });
  const wantedRoom = (params.get('room') || '').toUpperCase();
  if (wantedRoom) lobby.selectRoom(wantedRoom);
  lobby.show(loaded.saved ? 'saved' : 'fresh');

  socket.on('connect', () => lobby.notice('방에 입장할 수 있습니다.', false));
  socket.on('connect_error', () => lobby.notice('서버에 연결하지 못했습니다.', true));
  socket.on('disconnect', () => {
    joinToken++;
    pendingJoin = false;
    lobby.setBusy(false);
    if (joinedRoom) exitGame('returned', '서버 연결이 끊겼습니다. 다시 연결 중입니다.', true);
    else {
      lobby.notice('서버 연결이 끊겼습니다. 다시 연결 중입니다.', true);
      if (outsideRoom) UI.toast('서버 연결이 끊겼습니다. 다시 연결 중입니다.');
    }
  });
  socket.on('channelsState', list => {
    channels = list;
    lobby.setChannels(list);
  });

  function joinRoom(room) {
    if (pendingJoin || joinedRoom) return;
    pendingJoin = true;
    const token = ++joinToken;
    lobby.setBusy(true);
    lobby.notice(`${room} 방에 입장하는 중입니다.`, false);
    const giveUp = setTimeout(() => {
      if (token !== joinToken) return;
      pendingJoin = false;
      joinToken++;
      lobby.setBusy(false);
      lobby.notice('서버 응답이 없습니다. 잠시 후 다시 시도해 주세요.', true);
      if (outsideRoom) UI.toast('서버 응답이 없습니다. 잠시 후 다시 시도해 주세요.');
    }, 10000);
    socket.emit('joinRoom', { room, name: playerProfile.name, avatar: playerProfile.avatar }, async result => {
      clearTimeout(giveUp);
      if (token !== joinToken) return;
      pendingJoin = false;
      lobby.setBusy(false);
      if (!result || !result.ok) {
        lobby.notice((result && result.message) || '방에 입장하지 못했습니다.', true);
        if (outsideRoom) UI.toast((result && result.message) || '방에 입장하지 못했습니다.');
        return;
      }
      await assetsReady;
      enterGame(result);
      Audio.play('enter');
    });
  }

  function leaveRoom() {
    if (!joinedRoom) return;
    socket.emit('leaveRoom', res => {
      if (!res || !res.ok) { UI.toast('방에서 나가지 못했어요. 다시 시도해 주세요.'); return; }
      Audio.play('exit');
      const room = joinedRoom;
      exitGame('returned', '방에서 나왔습니다.');
      enterOutside(room);
    });
  }

  /* ================= 게임 화면 진입/퇴장 ================= */
  const gameEl = $('game');
  async function enterOutside(room) {
    if (pendingJoin || joinedRoom || outsideRoom) return;
    outsideRoom = room;
    lobby.setBusy(true);
    await assetsReady;
    lobby.setBusy(false);
    if (!propsReady) {
      outsideRoom = null;
      lobby.notice('매장 배경을 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.', true);
      return;
    }
    selfId = 'outside';
    const spawn = W.toNorm(W.DOOR.outsideSpawn.x, W.DOOR.outsideSpawn.y);
    players = new Map();
    effects = [];
    keys.clear();
    stick = { x: 0, y: 0 };
    wasMoving = false;
    applyState({
      players: [{
        id: selfId, name: playerProfile.name, avatar: playerProfile.avatar,
        ...spawn, dir: 'up', seat: null, drinkId: W.DEFAULT_DRINK, ratio: null,
        glass: 0, drinkCount: 0, drunkLevel: 0, raisedGlass: false
      }],
      seats: Array(W.SEATS.length).fill(null), cheers: { state: 'idle' }
    });
    chat.setOpen(false);
    lobby.hide();
    gameEl.hidden = false;
    gameEl.classList.add('outside');
    $('room-name').textContent = room;
    $('room-count').textContent = '매장 밖';
    $('btn-leave').textContent = '캐릭터 선택';
    $('outside-hint').hidden = false;
    $('action-bar').hidden = true;
    $('cheers-box').hidden = true;
    document.body.classList.add('in-game');
    ctxKey = '';
    resize();
    cam.snap = true;
    running = true;
    lastFrame = nowMs();
    rafId = requestAnimationFrame(frame);
  }

  function enterGame(result) {
    outsideRoom = null;
    joinedRoom = result.room;
    selfId = result.selfId;
    players = new Map();
    effects = [];
    cheers = { state: 'idle' };
    chat.clear();
    chat.setOpen(false);
    keys.clear();
    stick = { x: 0, y: 0 };
    wasMoving = false;
    gameEl.classList.remove('outside');
    $('btn-leave').textContent = '나가기';
    $('outside-hint').hidden = true;
    $('room-name').textContent = result.room;
    applyState(result.state);
    chat.system(`${result.room} 방에 입장했습니다.`);
    lobby.hide();
    gameEl.hidden = false;
    document.body.classList.add('in-game');
    resize();
    cam.snap = true;
    if (!running) {
      running = true;
      lastFrame = nowMs();
      rafId = requestAnimationFrame(frame);
    }
  }

  function exitGame(kind, message, isError) {
    UI.Modal.close();
    joinedRoom = null;
    outsideRoom = null;
    selfId = null;
    running = false;
    cancelAnimationFrame(rafId);
    keys.clear();
    stick = { x: 0, y: 0 };
    players = new Map();
    effects = [];
    me = null;
    cheers = { state: 'idle' };
    gameEl.hidden = true;
    document.body.classList.remove('in-game');
    lobby.show(kind);
    lobby.notice(message || '', Boolean(isError));
  }

  /* ================= 서버 상태 반영 ================= */
  function applyState(state) {
    const t = nowMs();
    const next = new Map();
    for (const v of state.players) {
      const old = players.get(v.id);
      const p = old || { id: v.id, rx: v.x, ry: v.y, phase: hash(v.id) % 997, walking: false, action: '', actionUntil: 0, actionMs: 1, bubble: '', bubbleUntil: 0, heartUntil: 0 };
      const prevSeat = old ? old.seat : v.seat, prevRaised = old ? old.raisedGlass : v.raisedGlass;
      const seatChanged = Boolean(old) && prevSeat !== v.seat;
      p.name = v.name;
      p.avatar = v.avatar;
      p.seat = v.seat;
      p.drinkId = v.drinkId;
      p.drinkLabel = v.drink;
      p.ratio = v.ratio;
      p.glass = v.glass;
      p.drinkCount = v.drinkCount;
      p.drunkLevel = v.drunkLevel;
      p.raisedGlass = v.raisedGlass;
      if (v.emoteMs > 0) {
        if (p.emote !== v.emote || p.emoteUntil <= t) p.emoteAt = t;
        p.emote = v.emote; p.emoteUntil = t + v.emoteMs;
      }
      if (v.heartMs > 0) p.heartUntil = t + v.heartMs;
      if (v.id === selfId) {
        const far = old && Math.hypot((old.x - v.x) * WW, (old.y - v.y) * WH) > 70;
        if (!old || far || seatChanged) { p.x = v.x; p.y = v.y; p.rx = v.x; p.ry = v.y; p.dir = v.dir; }
      } else {
        p.x = v.x; p.y = v.y; p.dir = v.dir;
        if (seatChanged || !old) { p.rx = v.x; p.ry = v.y; }
      }
      if (seatChanged && prevSeat === null && v.seat !== null) {
        const s = W.SEATS[v.seat];
        effects.push({ type: 'dust', x: s.x, y: s.y, start: t });
      }
      if (seatChanged && v.id === selfId) Audio.play(v.seat === null ? 'stand' : 'sit');
      if (old && !prevRaised && v.raisedGlass && v.id === selfId) Audio.play('raise');
      if (old && !prevRaised && v.raisedGlass) effects.push({ type: 'glint', id: v.id, start: t });
      next.set(v.id, p);
    }
    players = next;
    seats = state.seats;
    const before = cheers.step;
    cheers = state.cheers || { state: 'idle' };
    if (cheers.state === 'responding' && cheers.step === 3 && before !== 3) effects.push({ type: 'burst', start: t, seed: t });
    if (cheers.step === 3 && before !== 3) Audio.play('cheers');
    me = players.get(selfId) || null;
    refreshUI();
  }

  socket.on('roomState', state => { if (joinedRoom) applyState(state); });
  socket.on('playerMoved', m => {
    const p = players.get(m.id);
    if (!p) return;
    p.x = m.x; p.y = m.y; p.dir = m.dir;
    if (m.snap && m.id === selfId) { p.rx = m.x; p.ry = m.y; }
  });
  socket.on('systemMessage', text => { if (joinedRoom) chat.system(text); });
  socket.on('chat', m => { if (joinedRoom) { chat.add(m); Audio.play('chat'); } });
  socket.on('bubble', b => {
    const p = players.get(b.id);
    if (p) { p.bubble = b.text; p.bubbleUntil = nowMs() + b.ms; }
  });
  socket.on('bubbleClear', id => { const p = players.get(id); if (p) { p.bubble = ''; p.bubbleUntil = 0; } });
  socket.on('heartEffect', h => { const p = players.get(h.id); if (p) p.heartUntil = nowMs() + h.ms; });
  socket.on('pourEffect', e => {
    Audio.play('pour');
    const to = players.get(e.to);
    if (to && to.seat !== null) effects.push({ type: 'pour', seat: to.seat, drinkId: to.drinkId, ratio: to.ratio, start: nowMs() });
  });
  socket.on('playerAction', a => {
    const p = players.get(a.id);
    if (p) { p.action = a.action; p.actionMs = a.ms; p.actionUntil = nowMs() + a.ms; }
    if (p && a.action === 'drink') Audio.play('drink');
  });
  socket.on('emote', e => {
    const p = players.get(e.id);
    if (!p) return;
    p.emote = e.kind;
    p.emoteAt = nowMs();
    p.emoteUntil = p.emoteAt + e.ms;
    Audio.play('emote');
  });
  socket.on('interaction', m => {
    if (joinedRoom && m.id !== selfId) chat.system(`${m.name}님이 ${m.title}을(를) 살펴보고 있어요.`);
  });

  /* ================= 행동 ================= */
  const say = res => { if (res && !res.ok && res.message) UI.toast(res.message); };
  const seatedOthers = () => [...players.values()].filter(p => p.id !== selfId && p.seat !== null);
  const sit = index => socket.emit('sit', index, say);
  const stand = () => socket.emit('stand', say);
  const confirmLeave = () => UI.openDoor({ onLeave: leaveRoom });
  function lookAt(zone) {
    socket.emit('interaction', { id: zone.id }, res => {
      if (!res?.ok) { say(res); return; }
      Audio.play(zone.type);
      UI.openView(zone);
    });
  }
  function talkToStaff(receive = false) {
    socket.emit('staffInteraction', { receive }, res => {
      if (!res?.ok) { say(res); if (receive) $('staff-receive').disabled = false; return; }
      if (res.received) { Audio.play('remedy'); UI.Modal.close(); return; }
      Audio.play('npc');
      UI.openStaff({ message: res.message, canReceive: res.canReceive, onReceive: () => talkToStaff(true) });
    });
  }
  function pour() {
    UI.openPour({
      candidates: seatedOthers().map(p => ({ id: p.id, name: p.name, avatar: p.avatar })),
      onConfirm: target => socket.emit('pourDrink', target, say)
    });
  }
  function pickDrink() {
    if (!me) return;
    UI.openDrink({ current: { id: me.drinkId, ratio: me.ratio }, onSelect: d => socket.emit('selectDrink', d, say) });
  }
  function proposeCheers() {
    UI.openCheers({ onStart: text => socket.emit('cheersProposal', { text }, say) });
  }

  $('btn-leave').addEventListener('click', () => {
    if (pendingJoin) { UI.toast('입장 중입니다. 잠시 기다려 주세요.'); return; }
    if (outsideRoom) exitGame('returned', '');
    else confirmLeave();
  });
  $('act-drink').addEventListener('click', pickDrink);
  $('act-pour').addEventListener('click', pour);
  $('act-raise').addEventListener('click', () => socket.emit('raiseGlass', say));
  $('act-sip').addEventListener('click', () => socket.emit('drinkSip', say));
  $('act-cheers').addEventListener('click', proposeCheers);
  $('emote-toggle').addEventListener('click', () => {
    const expanded = $('emote-toggle').getAttribute('aria-expanded') !== 'true';
    $('emote-toggle').setAttribute('aria-expanded', String(expanded));
    $('emote-buttons').classList.toggle('expanded', expanded);
  });
  document.querySelectorAll('[data-emote]').forEach(button => button.addEventListener('click', () => {
    socket.emit('emote', button.dataset.emote, say);
    $('emote-toggle').setAttribute('aria-expanded', 'false');
    $('emote-buttons').classList.remove('expanded');
  }));
  $('chat-toggle').addEventListener('click', () => Audio.play('phone'));
  $('btn-cheers-reply').addEventListener('click', () => {
    $('btn-cheers-reply').disabled = true;
    socket.emit('cheersResponse', res => { say(res); refreshUI(); });
  });

  /* ================= 화면 갱신(버튼/건배창) ================= */
  let ctxKey = '', cheersKey = '', membersKey = '';

  function contextActions() {
    if (!me || UI.Modal.active || pendingJoin) return [];
    if (outsideRoom) {
      return W.nearDoor(me.x * WW, me.y * WH)
        ? [{ id: 'enter', label: '들어가기', run: () => UI.openDoor({ onEnter: () => joinRoom(outsideRoom) }) }]
        : [];
    }
    if (me.seat !== null) return [{ id: 'stand', label: '일어서기', run: stand }];
    const here = { x: me.x * WW, y: me.y * WH };
    const list = [];
    const seat = W.seatNear(here.x, here.y, seats, -1);
    if (seat >= 0) list.push({ id: `sit${seat}`, label: '앉기', run: () => sit(seat) });
    const zone = W.interactionNear(here.x, here.y);
    if (zone) list.push({ id: `look:${zone.id}`, label: zone.button, run: () => lookAt(zone) });
    if (W.nearStaff(here.x, here.y)) list.push({ id: 'staff', label: '말 걸기', run: () => talkToStaff() });
    if (W.nearDoor(here.x, here.y)) list.push({ id: 'door', label: W.DOOR.label, run: confirmLeave });
    return list;
  }
  let ctxList = [];
  function renderContext() {
    ctxList = contextActions();
    const key = ctxList.map(a => a.id).join('|');
    if (key === ctxKey) return;
    ctxKey = key;
    const box = $('ctx-actions');
    box.replaceChildren();
    const touch = matchMedia('(pointer: coarse)').matches;
    ctxList.forEach((a, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'px-btn primary';
      b.dataset.action = a.id.split(':')[0].replace(/\d+$/, '');
      b.textContent = a.label;
      if (i === 0 && !touch) { const k = document.createElement('kbd'); k.textContent = 'E'; b.append(k); }
      b.addEventListener('click', a.run);
      box.append(b);
    });
    measureUi();
  }

  function renderActionBar() {
    const seated = Boolean(me && me.seat !== null);
    const bar = $('action-bar');
    if (bar.hidden === seated) { bar.hidden = !seated; measureUi(); }
    if (!seated) return;
    const drink = W.drinkById(me.drinkId);
    const label = drink ? (drink.mix ? `${drink.label} ${me.ratio}:${100 - me.ratio}` : drink.label) : '술 고르기';
    $('act-drink-label').textContent = label;
    const icon = $('act-drink-icon');
    if (drink && icon.dataset.k !== `${drink.id}${me.ratio}`) {
      icon.dataset.k = `${drink.id}${me.ratio}`;
      icon.style.backgroundImage = `url(${UI.drinkIcon(drink, me.ratio, 44).toDataURL()})`;
    }
    const gathering = cheers.state === 'gathering' && cheers.participants && cheers.participants.includes(selfId);
    const raise = $('act-raise');
    raise.textContent = me.raisedGlass ? '잔 내리기' : '잔 들기';
    raise.classList.toggle('on', Boolean(gathering && !me.raisedGlass));
    $('act-sip').disabled = me.glass <= 0;
    $('act-pour').disabled = false;
    $('act-cheers').disabled = cheers.state !== 'idle';
  }

  function renderCheers() {
    const box = $('cheers-box');
    const c = cheers;
    if (!c || c.state === 'idle') { box.hidden = true; cheersKey = ''; membersKey = ''; measureUi(); return; }
    if (box.hidden) { box.hidden = false; measureUi(); }
    const gathering = c.state === 'gathering';
    const lines = gathering || c.state === 'ready' ? c.lines : c.shouts;
    const key = JSON.stringify([c.state, c.step, lines, c.initiator && c.initiator.id]);
    if (key !== cheersKey) {
      cheersKey = key;
      $('cheers-who').textContent = `${c.initiator ? c.initiator.name : ''}`;
      const holder = $('cheers-lines');
      holder.replaceChildren();
      lines.forEach((text, i) => {
        const line = document.createElement('span');
        line.className = `line${c.state === 'responding' && i === 2 ? ' big' : ''}`;
        line.textContent = text;
        holder.append(line);
      });
    }
    const done = gathering ? c.raised : c.responded;
    const total = c.participants.length;
    $('cheers-count').textContent = gathering ? `잔 들기 ${done.length} / ${total}`
      : c.state === 'ready' ? `잔 들기 ${c.raised.length} / ${total}` : `위하여 ${done.length} / ${total}`;
    const mKey = JSON.stringify([c.participants, c.state === 'ready' ? c.raised : done]);
    if (mKey !== membersKey) {
      membersKey = mKey;
      const list = $('cheers-members');
      list.replaceChildren();
      for (const id of c.participants) {
        const p = players.get(id);
        const li = document.createElement('li');
        li.dataset.id = id;
        if ((c.state === 'ready' ? c.raised : done).includes(id)) li.className = 'ok';
        li.title = p ? p.name : '';
        if (p) li.append(UI.faceCanvas(p.avatar, 30));
        list.append(li);
      }
    }
    const reply = $('btn-cheers-reply');
    const can = c.state === 'responding' && c.participants.includes(selfId) && c.initiator && c.initiator.id !== selfId && !c.responded.includes(selfId);
    reply.hidden = !can;
    if (can) reply.disabled = false;
  }

  function refreshUI() {
    if (!joinedRoom) return;
    $('room-count').textContent = `${players.size} / ${W.ROOM_CAPACITY}`;
    chat.setOnline(players.size);
    renderActionBar();
    renderCheers();
    renderContext();
  }

  function measureUi() {
    view.uiBottom = $('stage').querySelector('.bottom-ui').offsetHeight || 0;
  }

  /* ================= 입력 ================= */
  const KEY_DIRS = { w: [0, -1], arrowup: [0, -1], s: [0, 1], arrowdown: [0, 1], a: [-1, 0], arrowleft: [-1, 0], d: [1, 0], arrowright: [1, 0] };
  const typing = t => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement;
  addEventListener('keydown', e => {
    if (!running || e.metaKey || e.ctrlKey || e.altKey) return;
    if (typing(e.target) || UI.Modal.active) return;
    const k = e.key.toLowerCase();
    if (KEY_DIRS[k]) { keys.add(k); e.preventDefault(); return; }
    if ((k === 'e' || k === ' ') && ctxList[0]) { e.preventDefault(); ctxList[0].run(); return; }
    if (k === 'enter' && joinedRoom) { e.preventDefault(); chat.setOpen(true); chat.focus(); }
  });
  addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
  addEventListener('blur', () => keys.clear());
  // 화면을 누르면 채팅 입력창에서 빠져나와 바로 걸을 수 있다.
  $('stage').addEventListener('pointerdown', () => { if (typing(document.activeElement)) document.activeElement.blur(); });

  const joystick = $('joystick');
  (function setupJoystick() {
    let active = null;
    const knob = joystick.firstElementChild;
    const update = e => {
      const r = joystick.getBoundingClientRect();
      let dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      let dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      const len = Math.hypot(dx, dy);
      if (len > 1) { dx /= len; dy /= len; }
      stick = { x: Math.abs(dx) < 0.18 ? 0 : dx, y: Math.abs(dy) < 0.18 ? 0 : dy };
      knob.style.transform = `translate(${dx * 34}px, ${dy * 34}px)`;
    };
    const end = () => { active = null; stick = { x: 0, y: 0 }; knob.style.transform = ''; };
    joystick.addEventListener('pointerdown', e => {
      active = e.pointerId;
      try { joystick.setPointerCapture(active); } catch { /* 이미 끝난 포인터 */ }
      update(e);
      e.preventDefault();
    });
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

  /* ================= 이동 ================= */
  function updateLocal(dt, t) {
    if (!me || me.seat !== null || UI.Modal.active) {
      if (wasMoving) { wasMoving = false; me && (me.walking = false); }
      return;
    }
    const v = inputVector();
    let moved = false;
    if (v.x || v.y) {
      const px = me.x * WW, py = me.y * WH;
      const r = W.resolveMove(px, py, px + v.x * W.SPEED * dt, py + v.y * W.SPEED * W.SPEED_Y * dt,
        outsideRoom ? W.canWalkOutside : W.canStand);
      moved = r.x !== px || r.y !== py;
      if (moved) { me.x = r.x / WW; me.y = r.y / WH; Audio.play('walk'); }
      me.dir = Math.abs(v.x) > Math.abs(v.y) ? (v.x > 0 ? 'right' : 'left') : (v.y > 0 ? 'down' : 'up');
    }
    me.rx = me.x; me.ry = me.y;
    me.walking = moved;
    if ((moved && t - lastSend >= 50) || (!moved && wasMoving)) {
      lastSend = t;
      if (joinedRoom) socket.emit('move', { x: me.x, y: me.y, dir: me.dir });
    }
    wasMoving = moved;
  }

  function updateRemote(dt) {
    const k = Math.min(1, dt * 14);
    // 잔이 천천히 차오르거나 줄어들도록 화면에 보이는 양만 부드럽게 따라간다(진짜 값은 서버가 가진다).
    const fill = Math.min(1, dt * 5);
    for (const p of players.values()) {
      p.glassShown = p.glassShown === undefined ? p.glass : p.glassShown + (p.glass - p.glassShown) * fill;
      if (Math.abs(p.glass - p.glassShown) < 1) p.glassShown = p.glass;
      if (p.id === selfId) continue;
      const dx = (p.x - p.rx) * WW, dy = (p.y - p.ry) * WH;
      p.rx += (p.x - p.rx) * k;
      p.ry += (p.y - p.ry) * k;
      p.walking = p.seat === null && Math.hypot(dx, dy) > 3;
    }
  }

  /* ================= 카메라/캔버스 ================= */
  const canvas = $('scene');
  const ctx = canvas.getContext('2d');
  const hudTop = () => $('social-tools').getBoundingClientRect().bottom - $('stage').getBoundingClientRect().top + 12;
  // 앉아 있을 때 화면에 담을 테이블 주변(의자 6개 포함). 하단 UI가 커도 가려지지 않게 이 범위를 UI 위쪽에 맞춘다.
  const TABLE_FOCUS = { x: 790, y: 612, w: 640, h: 480 };

  function resize() {
    const rect = $('stage').getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    view = { ...view, w: Math.max(1, rect.width), h: Math.max(1, rect.height), dpr };
    canvas.width = Math.round(view.w * dpr);
    canvas.height = Math.round(view.h * dpr);
    view.cover = view.w < 760 || view.h < 520 || view.w / view.h < 1.2;
    const fit = Math.min(view.w / WW, view.h / WH);
    view.baseZ = view.cover ? Math.max(view.w / WW, view.h / WH) : fit;
    cam.z = view.baseZ;
    joystick.hidden = !((joinedRoom || outsideRoom) && (matchMedia('(pointer: coarse)').matches || view.w < 700));
    measureUi();
    cam.snap = true;
  }
  new ResizeObserver(() => { if (running) resize(); }).observe($('stage'));
  addEventListener('orientationchange', () => setTimeout(() => running && resize(), 200));

  // 서 있을 때: 넓은 화면은 전체를, 좁은 화면은 내 캐릭터를 따라간다. 앉으면 테이블이 하단 UI 위에 오도록 맞춘다.
  function cameraTarget() {
    const bottom = view.uiBottom;
    if (me && me.seat !== null) {
      const top = hudTop();
      const usableH = Math.max(140, view.h - bottom - top);
      const z = Math.min(view.baseZ, clamp(Math.min(view.w / TABLE_FOCUS.w, usableH / TABLE_FOCUS.h), 0.3, 1.6));
      return { x: TABLE_FOCUS.x, y: TABLE_FOCUS.y + (bottom - top) / (2 * z), z, free: true };
    }
    const z = view.baseZ;
    let x = WW / 2, y = WH / 2;
    if (outsideRoom) {
      x = W.DOOR.x;
      y = 870 + (bottom / 2) / z;
    } else if (me && view.cover) {
      const f = worldOf(me);
      x = f.x;
      y = f.y - 60 + (bottom / 2) / z;
    }
    return { x, y, z, free: false };
  }

  function updateCamera(dt) {
    const t = cameraTarget();
    const vw = view.w / t.z, vh = view.h / t.z;
    let { x, y } = t;
    x = vw >= WW ? WW / 2 : clamp(x, vw / 2, WW - vw / 2);
    if (!t.free) y = vh >= WH ? WH / 2 : clamp(y, vh / 2, WH - vh / 2);
    if (cam.snap) { cam.x = x; cam.y = y; cam.z = t.z; cam.snap = false; return; }
    const k = Math.min(1, dt * 8);
    cam.x += (x - cam.x) * k;
    cam.y += (y - cam.y) * k;
    cam.z += (t.z - cam.z) * k;
  }
  const toScreen = (x, y) => ({ x: (x - cam.x) * cam.z + view.w / 2, y: (y - cam.y) * cam.z + view.h / 2 });

  /* ================= 그리기 ================= */
  const itemCache = new Map();
  function item(kind, opts) {
    const key = kind + JSON.stringify(opts);
    let c = itemCache.get(key);
    if (!c) { c = S.item(kind, opts); if (itemCache.size > 400) itemCache.clear(); itemCache.set(key, c); }
    return c;
  }
  function blit(c, x, y, scale = SCALE, anchorX = 0.5, anchorY = 1) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(c, Math.round(x - c.width * scale * anchorX), Math.round(y - c.height * scale * anchorY), c.width * scale, c.height * scale);
  }

  function glassOf(p) {
    const d = W.drinkById(p.drinkId) || W.drinkById(W.DEFAULT_DRINK);
    const shown = p.glassShown === undefined ? p.glass : p.glassShown;
    return { type: 'glass', glass: d.glass, color: W.drinkColor(d.id, p.ratio), level: clamp(shown / 100, 0, 1), foam: d.foam };
  }

  // 지금 서버/로컬 상태에서 어떤 동작 스프라이트를 쓸지 정한다.
  function poseOf(p, t) {
    const seated = p.seat !== null;
    const pose = { dir: p.dir || 'down', action: seated ? 'sit' : p.walking ? 'walk' : 'idle', t: t + p.phase, drunkLevel: p.drunkLevel || 0, item: null };
    if (seated) {
      if (p.actionUntil > t) {
        const progress = 1 - (p.actionUntil - t) / p.actionMs;
        const action = p.action === 'cheers' && progress > 0.55 ? 'drink' : p.action;
        pose.action = action;
        if (action === 'pour') {
          const d = W.drinkById(p.drinkId);
          pose.item = { type: 'bottle', bottle: d ? d.bottle : 'soju', color: W.drinkColor(p.drinkId, p.ratio) };
        } else pose.item = glassOf(p);
      } else if (p.raisedGlass) {
        pose.action = 'raise-glass';
        pose.item = glassOf(p);
      }
    } else if (p.glass > 0) pose.item = glassOf(p);
    return pose;
  }
  const glassInHand = pose => pose.item && pose.item.type === 'glass' && ['raise-glass', 'drink', 'cheers'].includes(pose.action);

  function drawShadow(x, y, r) {
    ctx.fillStyle = 'rgb(35 26 46 / 26%)';
    for (let i = 0; i < 3; i++) ctx.fillRect(Math.round(x - r + i * 8), Math.round(y - 12 + i * 4), Math.round((r - i * 8) * 2), 4);
  }

  function drawPlayer(p, t) {
    const w = worldOf(p);
    const pose = poseOf(p, t);
    p._pose = pose;
    drawShadow(w.x, w.y + 2, 8 * SCALE);
    S.draw(ctx, p.avatar, pose, w.x, w.y - seatOffset(p), SCALE);
  }
  const seatOffset = p => p.seat !== null ? 68 - (S.FRAME.ay - 44 + S.SIT_LIFT) * SCALE : 0;

  function drawTableGlass(p) {
    if (p.seat === null) return;
    const pose = p._pose || poseOf(p, nowMs());
    if (glassInHand(pose)) return;
    const spot = W.SEATS[p.seat].place;
    const g = glassOf(p);
    blit(item('glass', { glass: g.glass, color: g.color, level: Math.round(g.level * 16) / 16, foam: g.foam }), spot.x, spot.y + 6, SCALE, 0.5, 1);
  }

  const EFFECT_MS = { dust: 520, pour: 1100, burst: 1000, glint: 700 };
  function drawEffects(t) {
    effects = effects.filter(e => t - e.start < (EFFECT_MS[e.type] || 1000));
    for (const e of effects) {
      const age = t - e.start;
      if (e.type === 'dust') {
        const frame = clamp(Math.floor(age / 175), 0, 2);
        blit(item('dust', { frame }), e.x, e.y + 4, SCALE, 0.5, 1);
      } else if (e.type === 'glint') {
        const p = players.get(e.id);
        if (!p) continue;
        const w = worldOf(p), hand = S.anchors(p.avatar, poseOf(p, t)).hand;
        const gx = w.x + hand.x, gy = w.y - seatOffset(p) + hand.y;
        for (let i = 0; i < 3; i++) {
          const f = (Math.floor(age / 120) + i) % 3;
          blit(item('sparkle', { frame: f }), gx + (i - 1) * 26, gy - 10 - ((i * 13 + age / 18) % 22), SCALE / 2, 0.5, 0.5);
        }
      } else if (e.type === 'pour') {
        const spot = W.SEATS[e.seat].place;
        const color = W.drinkColor(e.drinkId, e.ratio);
        const stream = clamp(age / 260, 0, 1);
        if (age < 800) {
          ctx.fillStyle = color;
          ctx.fillRect(spot.x - 4, spot.y - 78, 8, Math.round(70 * stream));
          ctx.fillStyle = 'rgb(255 255 255 / 70%)';
          ctx.fillRect(spot.x - 4, spot.y - 78, 3, Math.round(70 * stream));
        }
        ctx.fillStyle = 'rgb(255 255 255 / 85%)';
        for (let i = 0; i < 5; i++) {
          const rise = ((age / 900 + i * 0.21) % 1);
          ctx.fillRect(Math.round(spot.x - 12 + ((i * 7) % 5) * 6), Math.round(spot.y - 6 - rise * 34), 4, 4);
        }
      } else if (e.type === 'burst') {
        const c = W.TABLE.top;
        for (let i = 0; i < 9; i++) {
          const ang = (i / 9) * Math.PI * 2 + (e.seed % 7), dist = 30 + age * 0.11 + (i % 3) * 14;
          blit(item('sparkle', { frame: (Math.floor(age / 130) + i) % 3 }), c.x + Math.cos(ang) * dist * 1.6, c.y - 40 + Math.sin(ang) * dist * 0.9, SCALE, 0.5, 0.5);
        }
      }
    }
  }

  function drawHearts(t) {
    for (const p of players.values()) {
      if (p.heartUntil <= t) continue;
      const w = worldOf(p);
      const top = w.y - (p.seat !== null ? 50 : 42) * SCALE;
      const bob = Math.sin(t / 220) * 5;
      const fade = p.heartUntil - t < 600 && Math.floor(t / 90) % 2 === 0;
      if (!fade) blit(item('heart', {}), w.x - 58, top - 24 + bob, SCALE, 0.5, 1);
    }
  }

  /* ----- 화면 좌표(글자/말풍선) ----- */
  function wrap(text, maxW) {
    const lines = [];
    let line = '';
    for (const ch of [...text]) {
      if (ctx.measureText(line + ch).width > maxW && line) { lines.push(line); line = ch === ' ' ? '' : ch; } else line += ch;
    }
    if (line) lines.push(line);
    return lines.slice(0, 3);
  }

  function pixelBox(x, y, w, h, fill, edge) {
    ctx.fillStyle = edge;
    ctx.fillRect(x, y - 2, w, h + 4);
    ctx.fillRect(x - 2, y, w + 4, h);
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);
  }

  function drawNameTag(p, sx, sy) {
    ctx.font = '700 12px Galmuri11, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label = p.id === selfId ? `${p.name} (나)` : p.name;
    const w = Math.ceil(ctx.measureText(label).width) + 14, h = 18;
    pixelBox(Math.round(sx - w / 2), Math.round(sy - h / 2), w, h, p.id === selfId ? '#e6007e' : '#231a2e', '#fff');
    ctx.fillStyle = '#fff';
    ctx.fillText(label, Math.round(sx), Math.round(sy + 1));
  }

  function drawBubble(p, sx, sy, t) {
    const big = p.bubble === SHOUT3;
    const size = big ? 20 : 13;
    ctx.font = `700 ${size}px Galmuri11, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lines = wrap(p.bubble, big ? 200 : 150);
    const lh = size + 4;
    const w = Math.ceil(Math.max(...lines.map(l => ctx.measureText(l).width))) + 18, h = lines.length * lh + 12;
    const x = Math.round(sx - w / 2), y = Math.round(sy - h - 8);
    const remain = p.bubbleUntil - t;
    if (remain < 250 && Math.floor(t / 70) % 2 === 0) return;
    pixelBox(x, y, w, h, big ? '#ffe9a8' : '#fff', '#231a2e');
    ctx.fillStyle = '#231a2e';
    ctx.fillRect(Math.round(sx - 6), y + h, 12, 4);
    ctx.fillRect(Math.round(sx - 3), y + h + 4, 6, 4);
    ctx.fillStyle = big ? '#ffe9a8' : '#fff';
    ctx.fillRect(Math.round(sx - 4), y + h - 2, 8, 4);
    ctx.fillStyle = big ? '#b0005f' : '#231a2e';
    lines.forEach((l, i) => ctx.fillText(l, Math.round(sx), y + 6 + lh / 2 + i * lh));
  }

  // 이름표 -> 하트 -> 말풍선 순서로 머리 위에 쌓는다.
  function drawOverlays(t) {
    const list = [...players.values()].sort((a, b) => a.ry - b.ry);
    const hk = clamp(Math.round(cam.z * SCALE), 2, 4);
    for (const p of list) {
      const w = worldOf(p);
      const headWorld = -S.anchors(p.avatar, poseOf(p, t)).head.y + seatOffset(p);
      const s = toScreen(w.x, w.y);
      const tagY = s.y - headWorld * cam.z - 14;
      drawNameTag(p, s.x, tagY);
      let top = tagY - 11;
      if (p.emote && p.emoteUntil > t) {
        const elapsed = t - (p.emoteAt || 0), phase = Math.floor(elapsed / 160) % 2;
        const emotion = item('emote', { kind: p.emote, frame: phase });
        const shake = p.emote === 'angry' ? (phase ? 2 : -2) : 0;
        const bob = Math.round(Math.sin(elapsed / 140) * 3);
        blit(emotion, s.x + shake, top - bob, hk, 0.5, 1);
        top -= emotion.height * hk + 12;
      }
      if (p.heartUntil > t) {
        const heart = item('heart', {});
        const blink = p.heartUntil - t < 600 && Math.floor(t / 90) % 2 === 0;
        const bob = Math.round(Math.sin(t / 220) * 3);
        if (!blink) blit(heart, s.x, top - bob, hk, 0.5, 1);
        top -= heart.height * hk + 6;
      }
      if (p.bubble && p.bubbleUntil > t) drawBubble(p, s.x, top, t);
    }
  }

  /* ----- 프레임 ----- */
  const drawables = [];
  function render(t) {
    const { dpr } = view;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#171221';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const k = dpr * cam.z;
    ctx.setTransform(k, 0, 0, k, Math.round(dpr * (view.w / 2 - cam.x * cam.z)), Math.round(dpr * (view.h / 2 - cam.y * cam.z)));
    ctx.imageSmoothingEnabled = true;
    if (propsReady) {
      P.drawBackdrop(ctx);
      P.drawAnimated(ctx, t, {
        nearDoor: Boolean(me && me.seat === null && W.nearDoor(me.x * WW, me.y * WH)),
        outside: Boolean(outsideRoom)
      });
    } else {
      ctx.drawImage(plate, 0, 0);
    }

    drawables.length = 0;
    const tableY = W.TABLE.ground.y;
    for (const p of players.values()) {
      const w = worldOf(p);
      drawables.push({ y: w.y, draw: () => drawPlayer(p, t) });
      if (p.seat !== null) drawables.push({ y: tableY + 0.2, draw: () => drawTableGlass(p) });
    }
    if (propsReady) for (const piece of P.pieces()) drawables.push({ y: piece.sortY, draw: () => piece.draw(ctx, t) });
    drawables.sort((a, b) => a.y - b.y);
    for (const d of drawables) d.draw();
    drawEffects(t);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    drawOverlays(t);
  }

  function frame(t) {
    if (!running) return;
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (t - lastFrame) / 1000);
    lastFrame = t;
    updateLocal(dt, t);
    updateRemote(dt);
    updateCamera(dt);
    renderContext();
    render(t);
  }

  if (params.has('debug')) {
    window.__tudari = {
      get me() { return me; }, get players() { return players; }, get seats() { return seats; }, get cheers() { return cheers; },
      get cam() { return cam; }, get view() { return view; }, get ctx() { return ctxList; },
      get joinedRoom() { return joinedRoom; }, get outsideRoom() { return outsideRoom; }, W
    };
  }
})();
