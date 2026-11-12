'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const World = require('../public/shared/world.js');

class PixelCanvas {
  getContext() {
    return {
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: image => { this.pixels = image.data; }
    };
  }
}
const window = { TudariWorld: World };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/sprites.js'), 'utf8'), {
  window, document: { createElement: () => new PixelCanvas() }
});
const S = window.TudariSprites;
const avatar = { ...World.DEFAULT_AVATAR, hairStyle: 'A01' };
const render = (a, pose = {}) => S.frame(a, { action: 'idle', dir: 'down', frame: 0, ...pose });
const region = (cv, x0, y0, w, h, alphaOnly = false) => {
  const out = [];
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const i = (y * cv.width + x) * 4;
    if (alphaOnly) out.push(cv.pixels[i + 3] ? 1 : 0);
    else out.push(...cv.pixels.slice(i, i + 4));
  }
  return out;
};
const countColor = (cv, hex) => {
  const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  let count = 0;
  for (let i = 0; i < cv.pixels.length; i += 4) {
    if (cv.pixels[i + 3] && rgb.every((v, j) => cv.pixels[i + j] === v)) count++;
  }
  return count;
};
const hasColor = (cv, hex) => countColor(cv, hex) > 0;

test('감정표현은 서로 다른 도트 이미지이며 웃음·눈물·분노는 두 프레임으로 움직인다', () => {
  const images = [];
  for (const kind of Object.keys(World.EMOTES)) {
    const first = S.item('emote', { kind, frame: 0 });
    const second = S.item('emote', { kind, frame: 1 });
    assert.ok(first.pixels.some(value => value !== 0), kind);
    images.push(JSON.stringify([...first.pixels]));
    if (kind !== 'heart') assert.notDeepEqual(first.pixels, second.pixels, kind);
  }
  assert.equal(new Set(images).size, Object.keys(World.EMOTES).length);
});

test('눈 8종: 형태가 다르고 얼굴·몸·발 위치를 바꾸지 않는다', () => {
  const eyes = World.AVATAR.eyes.map(([id]) => id);
  assert.equal(eyes.length, 8);
  const frames = eyes.map(id => render({ ...avatar, eyes: id }));
  assert.equal(new Set(frames.map(cv => JSON.stringify(region(cv, 14, 24, 20, 7)))).size, 8);
  for (const cv of frames) {
    assert.deepEqual(region(cv, 0, 0, 48, 24), region(frames[0], 0, 0, 48, 24));
    assert.deepEqual(region(cv, 0, 31, 48, 29), region(frames[0], 0, 31, 48, 29));
  }
  for (const id of ['round', 'smile', 'sleepy']) assert.equal(World.normalizeAvatar({ eyes: id }).eyes, id);
});

test('새 눈은 세로보다 넓으며 열린 눈마다 큰 눈동자와 흰색 한 픽셀 하이라이트를 유지한다', () => {
  const eyeColors = new Set([0x2a1c33, 0x6f5a94, 0xb198c5, 0xfff4e8, 0xffffff]);
  for (const [eyes] of World.AVATAR.eyes) {
    const eye = { pixels: region(render({ ...avatar, eyes }), 14, 25, 8, 5) };
    const xs = [], ys = [];
    for (let i = 0; i < eye.pixels.length; i += 4) {
      const color = (eye.pixels[i] << 16) | (eye.pixels[i + 1] << 8) | eye.pixels[i + 2];
      if (eye.pixels[i + 3] && eyeColors.has(color)) { xs.push((i / 4) % 8); ys.push(Math.floor(i / 32)); }
    }
    const width = Math.max(...xs) - Math.min(...xs) + 1, height = Math.max(...ys) - Math.min(...ys) + 1;
    assert.equal(width, 8, eyes);
    assert.ok(width / height >= 1.6, `${eyes}: ${width}x${height}`);
    assert.equal(countColor(eye, '#ffffff'), eyes === 'smile' ? 0 : 1, eyes);
    if (eyes !== 'smile') assert.ok(countColor(eye, '#6f5a94') + countColor(eye, '#b198c5') >= 5, eyes);
  }
});

test('선택 눈은 취기 렌더링과 분리되고 B타입의 작은 빨간 입술은 모든 단계에서 유지된다', () => {
  for (const [eyes] of World.AVATAR.eyes) {
    const a = { ...avatar, hairStyle: 'B03', eyes, outfit: 'ragged' };
    const saved = { ...a }, normal = [...render(a).pixels];
    for (let drunkLevel = 0; drunkLevel <= 3; drunkLevel++) {
      for (const action of Object.keys(S.ACTIONS)) {
        const cv = render(a, { action, drunkLevel });
        assert.ok(hasColor(cv, '#c54860'), `${eyes}/${action}/${drunkLevel}: 빨간 입술`);
      }
    }
    assert.deepEqual(a, saved);
    assert.deepEqual([...render(a, { drunkLevel: 0 }).pixels], normal);
    assert.equal(S.normalize(a).eyes, eyes);
  }
});

test('좌우 옆모습은 선택 눈과 취기 단계에 관계없이 눈 하나만 그린다', () => {
  for (const [eyes] of World.AVATAR.eyes) {
    for (let drunkLevel = 0; drunkLevel <= 3; drunkLevel++) {
      for (const dir of ['left', 'right']) {
        const cv = render({ ...avatar, eyes }, { dir, drunkLevel });
        const far = { pixels: region(cv, 22, 24, 4, 7) };
        const near = { pixels: region(cv, dir === 'right' ? 28 : 14, 24, 6, 7) };
        assert.equal(hasColor(far, '#2a1c33'), false, `${eyes}/${dir}/${drunkLevel}: 반대편 눈 없음`);
        assert.ok(hasColor(near, '#2a1c33'), `${eyes}/${dir}/${drunkLevel}: 보이는 눈 유지`);
      }
    }
  }
});

test('여자 선택 시에도 모든 의상과 포즈에서 남자와 같은 몸통·하의·발을 사용한다', () => {
  for (const [outfit] of World.AVATAR.outfit) {
    for (const hairStyle of ['A01', 'B01']) {
      for (const dir of S.DIRS) {
        for (const action of Object.keys(S.ACTIONS)) {
          const a = { ...avatar, hairStyle, outfit }, pose = { dir, action };
          const male = render({ ...a, base: 'male' }, pose);
          const female = render({ ...a, base: 'female' }, pose);
          const top = action === 'idle' || action === 'walk' ? 37 : 29;
          assert.deepEqual(region(female, 0, top, 48, 60 - top), region(male, 0, top, 48, 60 - top), `${outfit}/${hairStyle}/${dir}/${action}`);
        }
      }
    }
  }
});

test('헤어 8종: 실루엣·기존 색상 조합을 유지하며 NPC 기준 높이 안에 들어온다', () => {
  const silhouettes = [];
  for (const [hairStyle] of World.HAIR_STYLES) {
    const cv = render({ ...avatar, hairStyle });
    silhouettes.push(JSON.stringify(region(cv, 0, 0, 48, 44, true)));
    const ys = [];
    for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
      if (cv.pixels[(y * cv.width + x) * 4 + 3]) ys.push(y);
    }
    const height = (Math.max(...ys) - Math.min(...ys) + 1) * S.SCALE;
    assert.ok(Math.abs(height - World.STAFF.bounds.h) <= 8, `${hairStyle}: ${height}px`);
    for (const hairColor of World.AVATAR.hairColors) {
      const a = { ...avatar, hairStyle, hairColor };
      assert.equal(S.normalize(a).hairColor, hairColor);
      assert.ok(hasColor(render(a), hairColor), `${hairStyle}/${hairColor}`);
    }
  }
  assert.equal(new Set(silhouettes).size, 8);
});

test('빈털털이: A/B 하의에 헤진 가장자리를 넣되 기존 발 앵커와 모든 포즈의 배율은 유지한다', () => {
  for (const hairStyle of ['A01', 'B01']) {
    const normal = render({ ...avatar, hairStyle });
    const ragged = render({ ...avatar, hairStyle, outfit: 'ragged' });
    assert.notDeepEqual(region(normal, 16, 44, 16, 5), region(ragged, 16, 44, 16, 5));
    assert.deepEqual(region(normal, 16, 51, 16, 4, true), region(ragged, 16, 51, 16, 4, true));
    assert.ok(hasColor(ragged, '#c4ae85'), '작은 패치가 보여야 한다');
    const destinations = [];
    const ctx = { imageSmoothingEnabled: false, drawImage: (_cv, ...args) => destinations.push(args) };
    for (const action of Object.keys(S.ACTIONS)) S.draw(ctx, { ...avatar, hairStyle, outfit: 'ragged' }, { action, frame: 0 }, 100, 200);
    for (const rect of destinations) assert.deepEqual(rect, destinations[0]);
  }
  for (const outfit of ['basic', 'uplus', 'kia', 'doosan', 'samsung', 'lg', 'hanwha', 'casual', 'ragged']) {
    assert.equal(World.normalizeAvatar({ outfit }).outfit, outfit);
  }
});

test('신규 장식 4종은 모든 방향·자세·취기에서 잘리지 않으며 몸·발과 공통 앵커는 바꾸지 않는다', () => {
  const colors = { catEars: '#484052', bunnyEars: '#f4dedb', crown: '#edbf51', starClip: '#f6cb59' };
  for (const hairStyle of ['A02', 'B03']) {
    for (const dir of S.DIRS) {
      for (const [accessory, color] of Object.entries(colors)) {
        const a = { ...avatar, hairStyle, accessory }, before = { ...a };
        const count = countColor(render(a, { dir }), color);
        assert.ok(count > 0, `${accessory}/${dir}: 장식 식별 색`);
        for (const [action, frames] of Object.entries(S.ACTIONS)) {
          for (let frame = 0; frame < frames; frame++) {
            for (const [drunkLevel, t] of [[0, 0], [3, 0], [3, 450]]) {
              const pose = { dir, action, frame, drunkLevel, t };
              const cv = render(a, pose), plain = render({ ...a, accessory: 'none' }, pose);
              assert.equal(countColor(cv, color), count, `${accessory}/${hairStyle}/${dir}/${action}/${frame}/${drunkLevel}/${t}: 장식 잘림`);
              const y = action === 'idle' || action === 'walk' ? 37 : 29;
              assert.deepEqual(region(cv, 0, y, 48, 60 - y), region(plain, 0, y, 48, 60 - y));
              assert.deepEqual(S.anchors(a, pose), S.anchors({ ...a, accessory: 'none' }, pose));
            }
          }
        }
        assert.deepEqual(a, before);
      }
    }
  }
});
