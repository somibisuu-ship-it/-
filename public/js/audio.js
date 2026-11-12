(function () {
  'use strict';
  const keys = { bgm: 'tudariBgmEnabled', sfx: 'tudariSfxEnabled' };
  const enabled = { bgm: true, sfx: true };
  for (const kind of Object.keys(keys)) {
    try { enabled[kind] = localStorage.getItem(keys[kind]) !== 'false'; }
    catch (err) { console.warn('오디오 설정을 읽지 못했습니다.', err); }
  }
  let context, music, sounds, nextBeat = 0, beat = 0, timer = null, unlocking = false;
  const last = new Map();
  const melody = [64, 67, 69, 67, 64, 62, 60, null, 62, 64, 67, 64, 62, 60, 59, null,
    60, 64, 67, 69, 67, 64, 62, null, 60, 62, 64, 62, 59, 57, 55, null];
  const chords = [[48, 52, 55], [45, 48, 52], [53, 57, 60], [43, 47, 50]];
  const hz = note => 440 * 2 ** ((note - 69) / 12);

  function tone(bus, frequency, start, duration, volume, type = 'triangle') {
    const oscillator = context.createOscillator(), envelope = context.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(volume, start + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.001, start + duration);
    oscillator.connect(envelope);
    envelope.connect(bus);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
    oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
  }

  function schedule() {
    if (!context || context.state !== 'running' || !enabled.bgm || document.hidden) return;
    if (nextBeat < context.currentTime) nextBeat = context.currentTime + 0.04;
    while (nextBeat < context.currentTime + 0.3) {
      const note = melody[beat % melody.length];
      if (note !== null) tone(music, hz(note), nextBeat, 0.65, 0.45);
      if (beat % 8 === 0) {
        chords[Math.floor(beat / 8) % chords.length].forEach((n, i) => tone(music, hz(n), nextBeat + i * 0.04, 2.8, 0.22));
      }
      beat++;
      nextBeat += 0.4;
    }
  }

  function syncControls() {
    for (const button of document.querySelectorAll('[data-audio]')) {
      const kind = button.dataset.audio, on = enabled[kind];
      button.setAttribute('aria-pressed', String(on));
      button.setAttribute('aria-label', `${kind === 'bgm' ? '배경음' : '효과음'} ${on ? 'ON' : 'OFF'}`);
      button.querySelector('span').textContent = `${kind === 'bgm' ? '배경음' : '효과음'} ${on ? 'ON' : 'OFF'}`;
    }
  }

  async function unlock() {
    if (unlocking || (context && context.state === 'running')) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) {
      window.TudariUI.toast('이 브라우저는 오디오를 지원하지 않습니다.');
      return;
    }
    unlocking = true;
    try {
      if (!context) {
        context = new AudioContext();
        music = context.createGain();
        sounds = context.createGain();
        music.gain.value = enabled.bgm ? 0.045 : 0;
        sounds.gain.value = enabled.sfx ? 0.12 : 0;
        music.connect(context.destination);
        sounds.connect(context.destination);
      }
      await context.resume();
      nextBeat = context.currentTime + 0.04;
      if (!timer) timer = setInterval(schedule, 100);
      schedule();
    } catch (err) {
      console.error('오디오를 시작하지 못했습니다.', err);
      window.TudariUI.toast('소리를 시작하지 못했습니다. 오디오 버튼으로 다시 시도해 주세요.');
    } finally { unlocking = false; }
  }

  const effects = {
    walk: [38, 42], sit: [52, 45], stand: [45, 57], enter: [60, 64, 67], exit: [67, 64, 60],
    pour: [72, 76, 79, 84], raise: [79, 84], drink: [57, 50], cheers: [84, 91, 96],
    chat: [76, 81], emote: [72, 79, 84], npc: [60, 67], remedy: [72, 76, 79, 84],
    phone: [84, 79, 84], tv: [48, 60, 67]
  };
  function play(kind) {
    if (!enabled.sfx || !context || context.state !== 'running' || document.hidden) return;
    const notes = effects[kind];
    if (!notes) return;
    const now = context.currentTime, gap = kind === 'walk' ? 0.32 : 0.08;
    if (now - (last.get(kind) ?? -Infinity) < gap) return;
    last.set(kind, now);
    notes.forEach((note, i) => tone(sounds, hz(note), now + i * 0.055, kind === 'walk' ? 0.045 : 0.16,
      kind === 'walk' ? 0.25 : 0.5, kind === 'cheers' ? 'sine' : 'triangle'));
  }

  for (const button of document.querySelectorAll('[data-audio]')) {
    button.addEventListener('click', () => {
      const kind = button.dataset.audio;
      enabled[kind] = !enabled[kind];
      try { localStorage.setItem(keys[kind], String(enabled[kind])); }
      catch (err) { console.warn('오디오 설정을 저장하지 못했습니다.', err); window.TudariUI.toast('오디오 설정을 저장하지 못했습니다.'); }
      if (context) (kind === 'bgm' ? music : sounds).gain.setTargetAtTime(enabled[kind] ? (kind === 'bgm' ? 0.045 : 0.12) : 0, context.currentTime, 0.03);
      syncControls();
      unlock();
    });
  }
  document.addEventListener('pointerdown', unlock);
  document.addEventListener('keydown', e => { if (!e.repeat) unlock(); });
  syncControls();
  window.TudariAudio = { play, unlock, get enabled() { return { ...enabled }; }, get state() { return context?.state || 'locked'; } };
})();
