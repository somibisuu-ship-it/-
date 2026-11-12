/* 로비, 채팅, 팝업 같은 DOM 화면 부품. 게임 상태는 game.js가 갖고, 여기서는 콜백으로만 이어진다. */
(function () {
  'use strict';
  const W = window.TudariWorld;
  const S = window.TudariSprites;
  const $ = id => document.getElementById(id);
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const isNarrow = () => matchMedia('(max-width: 899px)').matches;

  /* ---------- 플레이어 프로필 (닉네임 + 아바타만 저장) ---------- */
  const LEGACY_KEY = 'tudari.profile';
  function cleanProfile(raw) {
    const { gender, ...avatar } = W.normalizeAvatar(raw && raw.avatar);
    return { name: String((raw && raw.name) || '').replace(/[<>]/g, '').trim().slice(0, W.LIMITS.nameMax), avatar };
  }
  function loadProfile() {
    try {
      for (const key of [W.PROFILE_KEY, LEGACY_KEY]) {
        const saved = JSON.parse(localStorage.getItem(key) || 'null');
        if (saved && typeof saved === 'object') return { profile: cleanProfile(saved), saved: true };
      }
    } catch { /* 저장소를 쓸 수 없는 환경 */ }
    return { profile: cleanProfile(null), saved: false };
  }
  function saveProfile(profile) {
    try { localStorage.setItem(W.PROFILE_KEY, JSON.stringify({ name: profile.name, avatar: profile.avatar })); } catch { /* 저장 불가 */ }
  }

  /* ---------- 토스트 ---------- */
  let toastTimer = 0;
  function toast(text, ms = 2600) {
    const box = $('toast');
    box.textContent = text;
    box.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { box.hidden = true; }, ms);
  }

  /* ---------- 아이콘 ---------- */
  const iconCache = new Map();
  function drinkIcon(drink, ratio, px = 52) {
    const key = `${drink.id}:${ratio}:${px}`;
    if (iconCache.has(key)) return iconCache.get(key);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = px;
    if (S) {
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      const color = W.drinkColor(drink.id, ratio);
      const bottle = S.item('bottle', { bottle: drink.bottle, color });
      const glass = S.item('glass', { glass: drink.glass, color, level: 0.8, foam: drink.foam });
      const k = Math.max(1, Math.floor(px / 22));
      ctx.drawImage(bottle, 2, px - bottle.height * k - 2, bottle.width * k, bottle.height * k);
      ctx.drawImage(glass, px - glass.width * k - 2, px - glass.height * k - 2, glass.width * k, glass.height * k);
    }
    iconCache.set(key, canvas);
    return canvas;
  }
  function faceCanvas(avatar, px) {
    if (!S) return el('canvas', 'face');
    const canvas = S.portrait(avatar, px);
    canvas.classList.add('face');
    return canvas;
  }

  /* ---------- 팝업 관리 ---------- */
  const Modal = {
    active: null,
    onClose: null,
    open(id, focus) {
      this.close();
      const modal = $(id);
      modal.hidden = false;
      this.active = modal;
      const target = focus ? modal.querySelector(focus) : modal.querySelector('button.primary');
      if (target) setTimeout(() => target.focus(), 30);
    },
    close() {
      if (!this.active) return;
      this.active.hidden = true;
      this.active = null;
      const cb = this.onClose;
      this.onClose = null;
      if (cb) cb();
    }
  };
  document.addEventListener('click', e => {
    const modal = e.target.closest('.modal');
    if (!modal || modal.hidden) return;
    if (e.target === modal || e.target.closest('[data-close]')) Modal.close();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && Modal.active) { e.preventDefault(); Modal.close(); } });

  function openPour({ candidates, onConfirm }) {
    const list = $('pour-list'), confirm = $('pour-confirm');
    list.replaceChildren();
    const options = candidates.length ? [...candidates, { id: 'all', name: '모두에게' }] : [];
    options.forEach((c, i) => {
      const li = el('li');
      const label = el('label');
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'pour-target';
      input.value = c.id;
      input.checked = i === 0;
      label.append(input, el('span', 'mark'));
      if (c.avatar) label.append(faceCanvas(c.avatar, 30));
      label.append(el('span', null, c.name));
      li.append(label);
      list.append(li);
    });
    $('pour-empty').hidden = options.length > 0;
    confirm.disabled = options.length === 0;
    confirm.onclick = () => {
      const picked = list.querySelector('input:checked');
      if (!picked) return;
      Modal.close();
      onConfirm(picked.value);
    };
    Modal.open('modal-pour', options.length ? 'input:checked' : '[data-close]');
  }

  function openCheers({ onStart }) {
    const input = $('cheers-input');
    const start = () => {
      Modal.close();
      onStart(input.value);
    };
    $('cheers-start').onclick = start;
    input.onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); start(); } };
    Modal.open('modal-cheers', '#cheers-input');
  }

  function openDrink({ current, onSelect }) {
    const grid = $('drink-grid'), mix = $('drink-mix'), slider = $('mix-ratio');
    let picked = W.drinkById(current && current.id) || W.drinkById(W.DEFAULT_DRINK);
    const syncMix = () => {
      mix.hidden = !picked.mix;
      if (!picked.mix) return;
      $('mix-a').textContent = `${picked.mix.aLabel} ${slider.value}%`;
      $('mix-b').textContent = `${picked.mix.bLabel} ${100 - Number(slider.value)}%`;
    };
    const renderTiles = () => {
      grid.replaceChildren();
      for (const drink of W.DRINKS) {
        const tile = el('button', 'drink-tile');
        tile.type = 'button';
        tile.dataset.drink = drink.id;
        tile.setAttribute('aria-pressed', String(drink.id === picked.id));
        const ratio = drink.mix ? (drink.id === picked.id ? Number(slider.value) : drink.mix.ratio) : null;
        tile.append(drinkIcon(drink, ratio), el('span', null, drink.label));
        tile.addEventListener('click', () => {
          picked = drink;
          if (drink.mix) slider.value = String(current && current.id === drink.id && current.ratio ? current.ratio : drink.mix.ratio);
          renderTiles();
          syncMix();
        });
        grid.append(tile);
      }
    };
    slider.value = String(picked.mix ? (current && current.id === picked.id && current.ratio) || picked.mix.ratio : 30);
    slider.oninput = () => { syncMix(); renderTiles(); };
    renderTiles();
    syncMix();
    $('drink-confirm').onclick = () => {
      Modal.close();
      onSelect({ id: picked.id, ratio: picked.mix ? Number(slider.value) : null });
    };
    Modal.open('modal-drink', '#drink-confirm');
  }

  function openDoor({ onLeave, onEnter }) {
    $('door-title').textContent = onEnter ? '랜선 투데이 투다리에 들어갈까요?' : '매장 밖으로 나갈까요?';
    $('door-confirm').textContent = onEnter ? '들어가기' : '나가기';
    $('door-confirm').onclick = () => { Modal.close(); (onEnter || onLeave)(); };
    Modal.open('modal-door', '#door-confirm');
  }

  function openStaff({ message, canReceive, onReceive }) {
    $('staff-message').textContent = message;
    $('staff-receive').hidden = !canReceive;
    $('staff-receive').disabled = false;
    $('staff-receive').onclick = () => {
      $('staff-receive').disabled = true;
      onReceive();
    };
    Modal.open('modal-staff');
  }

  // 매장 상호작용: 휴대폰/TV 화면을 게임 중앙에 크게 보여 준다.
  function openView(item) {
    const device = $('view-device'), message = $('view-message');
    const timers = [];
    device.replaceChildren();
    $('view-title').textContent = item.title;
    message.textContent = item.message;
    $('view-note').textContent = item.note || '';

    if (item.type === 'tv') {
      const phone = el('div', 'pxtv');
      const screen = el('div', 'screen');
      phone.append(screen);
      device.append(phone);
      const show = (node, caption) => { screen.replaceChildren(...[].concat(node)); if (caption) message.textContent = caption; };
      const [first, second, third] = item.sequence;
      show(el('div', 't1', first.text), first.text);
      timers.push(setTimeout(() => show(el('div', 't2', second.text), second.text), first.ms));
      timers.push(setTimeout(() => {
        const combo = el('div', 'combo');
        const head = el('div', 't2', second.text);
        show([head, combo], third.combo.join(' + '));
        third.combo.forEach((word, i) => {
          timers.push(setTimeout(() => {
            if (i > 0) combo.append(el('span', 'plus', '+'));
            const chip = el('span', null, word);
            chip.style.animationDelay = '0s';
            combo.append(chip);
          }, 260 + i * 420));
        });
      }, first.ms + second.ms));
    } else {
      const phone = el('div', 'pxphone');
      const screen = el('div', 'screen');
      if (item.screen && item.screen.kind === 'lock') {
        screen.style.setProperty('--screen', '#2b2150');
        screen.append(el('i', 'pxlock'), el('small', null, item.screen.label));
      } else {
        screen.style.setProperty('--screen', '#e6007e');
        screen.append(el('div', 'big', '55'), el('small', null, '5G 요금제'));
      }
      phone.append(screen);
      device.append(phone);
    }
    Modal.onClose = () => timers.forEach(clearTimeout);
    Modal.open('modal-view', '#view-close');
  }

  /* ---------- 채팅 (스마트폰) ---------- */
  function createChat({ selfId, avatarOf, onSend }) {
    const log = $('chat-log'), form = $('chat-form'), input = $('chat-input');
    const phone = $('phone'), toggle = $('chat-toggle'), badge = $('chat-badge');
    let unread = 0;

    const clock = () => {
      const d = new Date();
      $('phone-clock').textContent = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    };
    clock();
    setInterval(clock, 30000);

    const isOpen = () => phone.classList.contains('open');
    const trim = () => { while (log.children.length > 150) log.firstChild.remove(); };
    const bottom = () => { log.scrollTop = log.scrollHeight; };
    const hint = () => {
      if (isNarrow() && !isOpen()) { unread += 1; badge.textContent = String(unread); badge.hidden = false; }
    };

    function setOpen(open) {
      phone.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', String(open));
      if (open) {
        unread = 0;
        badge.hidden = true;
        setTimeout(bottom, 220);
      }
    }
    toggle.addEventListener('click', () => setOpen(!isOpen()));
    $('chat-close').addEventListener('click', () => setOpen(false));

    form.addEventListener('submit', e => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      onSend(text);
      input.blur();
    });
    input.addEventListener('keydown', e => { if (e.key === 'Escape') input.blur(); });

    return {
      add(m) {
        const mine = m.id === selfId();
        const li = el('li', `msg ${mine ? 'me' : 'other'}`);
        li.dataset.sender = m.id;
        const col = el('div', 'col');
        if (!mine) {
          li.append(faceCanvas(avatarOf(m.id) || W.DEFAULT_AVATAR, 34));
          col.append(el('span', 'name', m.name));
        }
        col.append(el('div', 'bubble', m.text));
        const d = new Date(m.at || Date.now());
        li.append(col, el('time', null, `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`));
        log.append(li);
        trim();
        bottom();
        if (!mine) hint();
      },
      system(text) {
        log.append(el('li', 'sys', text));
        trim();
        bottom();
      },
      clear() { log.replaceChildren(); unread = 0; badge.hidden = true; },
      setOnline(n) { $('phone-online').textContent = `${n}명`; },
      setOpen,
      focus() { input.focus(); }
    };
  }

  /* ---------- 로비 ---------- */
  const GROUPS = [['base', '아바타'], ['hairStyle', '헤어'], ['eyes', '눈'], ['hairColor', '머리색'], ['outfit', '유니폼'], ['accessory', '액세서리']];
  const TURN = ['down', 'right', 'up', 'left'];

  function createLobby({ profile, onEnter, onProfileChange }) {
    const root = $('lobby'), canvas = $('avatar-preview'), ctx = canvas.getContext('2d');
    const nameInput = $('nickname'), roomList = $('room-list'), enter = $('btn-enter'), edit = $('btn-edit');
    let mode = 'editor', kind = 'fresh', room = 'MP1', channels = [], busy = false, turn = 0, raf = 0, lastDraw = 0;

    const changed = () => { saveProfile(profile); onProfileChange(profile); };

    function renderOptions() {
      const box = $('avatar-options');
      box.replaceChildren();
      for (const [key, label] of GROUPS) {
        const row = el('div', 'option-group');
        if (key === 'hairStyle') row.classList.add('hair-options');
        if (key === 'eyes') row.classList.add('eye-options');
        if (key === 'accessory') row.classList.add('accessory-options');
        row.append(el('span', 'field-label', label));
        if (key === 'hairColor') {
          const swatches = el('div', 'swatches');
          for (const color of W.AVATAR.hairColors) {
            const b = el('button', 'swatch');
            b.type = 'button';
            b.style.setProperty('--c', color);
            b.setAttribute('aria-label', `머리색 ${color}`);
            b.setAttribute('aria-pressed', String(profile.avatar.hairColor === color));
            b.addEventListener('click', () => { profile.avatar.hairColor = color; changed(); renderOptions(); });
            swatches.append(b);
          }
          const custom = el('label', 'swatch-custom');
          const picker = document.createElement('input');
          picker.type = 'color';
          picker.value = profile.avatar.hairColor;
          picker.setAttribute('aria-label', '머리색 직접 고르기');
          picker.addEventListener('input', () => { profile.avatar.hairColor = picker.value.toLowerCase(); changed(); });
          picker.addEventListener('change', renderOptions);
          custom.append(picker);
          swatches.append(custom);
          row.append(swatches);
        } else {
          const options = key === 'outfit' ? W.AVATAR.outfit.filter(([id]) => id !== 'basic') : W.AVATAR[key];
          for (const [value, text] of options) {
            const b = el('button', `px-btn small${key === 'hairStyle' ? ' hair-tile' : key === 'eyes' ? ' eye-tile' : key === 'accessory' ? ' accessory-tile' : ''}`);
            if (key === 'hairStyle' || key === 'accessory') {
              b.append(S.portrait({ ...profile.avatar, [key]: value }, 56, { full: true }), el('span', null, key === 'hairStyle' ? `${value} ${text}` : text));
            } else if (key === 'eyes') {
              b.append(S.eyeThumbnail({ ...profile.avatar, eyes: value }), el('span', null, text));
            } else b.textContent = text;
            b.type = 'button';
            b.dataset.key = key;
            b.dataset.value = value;
            const selected = profile.avatar[key] === value || (key === 'outfit' && value === 'casual' && profile.avatar.outfit === 'basic');
            b.setAttribute('aria-pressed', String(selected));
            b.addEventListener('click', () => { profile.avatar[key] = value; changed(); renderOptions(); });
            row.append(b);
          }
        }
        box.append(row);
      }
    }

    function renderRooms() {
      roomList.replaceChildren();
      if (!channels.length) {
        roomList.append(el('p', 'loading', '방 정보를 불러오는 중입니다.'));
        return;
      }
      if (!channels.some(c => c.id === room && !c.full)) room = (channels.find(c => !c.full) || channels[0]).id;
      for (const ch of channels) {
        const b = el('button', 'px-btn room-btn');
        b.type = 'button';
        b.dataset.room = ch.id;
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(ch.id === room));
        b.disabled = ch.full;
        const meta = el('span', 'room-meta');
        meta.append(el('i', `dot${ch.full ? ' full' : ''}`), document.createTextNode(ch.full ? '정원 마감' : `${ch.count} / ${ch.capacity}명`));
        b.append(el('span', 'room-id', ch.id), meta);
        b.addEventListener('click', () => { room = ch.id; renderRooms(); });
        roomList.append(b);
      }
    }

    function applyMode() {
      const summary = mode === 'summary';
      $('editor-box').hidden = summary;
      $('resume-box').hidden = !summary;
      edit.hidden = !summary;
      enter.textContent = '선택 완료 · 문 앞으로';
      $('resume-title').textContent = profile.name || '친구';
      $('resume-sub').textContent = kind === 'returned' ? '방금 쓰던 캐릭터' : '저장된 캐릭터';
      $('preview-name').textContent = profile.name;
    }

    function draw(now) {
      raf = requestAnimationFrame(draw);
      if (!S || now - lastDraw < 90) return;
      lastDraw = now;
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = 'rgb(35 26 46 / 22%)';
      for (let i = 0; i < 4; i++) ctx.fillRect(w / 2 - 44 + i * 4, h - 52 + i * 4, 88 - i * 8, 4);
      S.draw(ctx, profile.avatar, { dir: TURN[turn], action: 'idle', t: now, drunkLevel: 0 }, w / 2, h - 58, 4);
    }

    nameInput.value = profile.name;
    nameInput.addEventListener('input', () => {
      profile.name = nameInput.value.replace(/[<>]/g, '').slice(0, W.LIMITS.nameMax);
      $('preview-name').textContent = profile.name;
      changed();
    });
    $('preview-left').addEventListener('click', () => { turn = (turn + TURN.length - 1) % TURN.length; });
    $('preview-right').addEventListener('click', () => { turn = (turn + 1) % TURN.length; });
    enter.addEventListener('click', () => { if (!busy) onEnter(room); });
    edit.addEventListener('click', () => { mode = 'editor'; applyMode(); nameInput.focus(); });
    renderOptions();
    renderRooms();
    applyMode();

    return {
      show(nextKind) {
        kind = nextKind;
        mode = kind === 'fresh' ? 'editor' : 'summary';
        nameInput.value = profile.name;
        renderOptions();
        applyMode();
        root.hidden = false;
        turn = 0;
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(draw);
      },
      hide() { root.hidden = true; cancelAnimationFrame(raf); },
      setChannels(list) { channels = list; renderRooms(); },
      selectRoom(id) { if (channels.some(c => c.id === id) || !channels.length) { room = id; renderRooms(); } },
      room: () => room,
      setBusy(value) { busy = value; enter.disabled = value; edit.disabled = value; },
      notice(text, isError) { const n = $('notice'); n.textContent = text; n.dataset.error = String(Boolean(isError)); }
    };
  }

  window.TudariUI = {
    loadProfile, saveProfile, toast, Modal, drinkIcon, faceCanvas,
    createLobby, createChat, openPour, openCheers, openDrink, openDoor, openStaff, openView
  };
})();
