/*
 * 서버와 클라이언트가 함께 쓰는 월드 데이터.
 * 좌표는 모두 배경 이미지(uplus-tudari-space.png, 1536x1024) 기준 "월드 픽셀"이며,
 * Socket.IO로 오가는 x,y 값은 기존 프로토콜과 같은 정규화 좌표(0~1)입니다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TudariWorld = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const WORLD = { w: 1536, h: 1024 };
  const SPEED = 250;          // 월드 px/초 (가로)
  const SPEED_Y = 0.75;       // 쿼터뷰라 세로 이동은 가로보다 느리게
  const ROOM_CAPACITY = 6;
  const CHANNELS = ['MP1', 'MP2', 'MP3'];
  const PROFILE_KEY = 'tudariPlayerProfile';

  /* ---------- 기하 도구 ---------- */
  const toWorld = (nx, ny) => ({ x: nx * WORLD.w, y: ny * WORLD.h });
  const toNorm = (x, y) => ({ x: x / WORLD.w, y: y / WORLD.h });
  // 쿼터뷰라 세로 거리는 가로보다 멀게 센다.
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, (ay - by) * 1.45);

  function inPoly(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  const inEllipse = (x, y, e) => ((x - e.x) / e.rx) ** 2 + ((y - e.y) / e.ry) ** 2 < 1;

  /* ---------- 걸을 수 있는 영역(바닥)과 장애물 ---------- */
  const WALK = [
    [135, 1016], [135, 952], [236, 872], [280, 834], [486, 908], [546, 914], [546, 668], [548, 668], [548, 578],
    [400, 538], [345, 520], [340, 452], [428, 448], [436, 394], [522, 347], [545, 342], [592, 337], [600, 314],
    [830, 358], [838, 386], [996, 432], [1000, 446], [1092, 446], [1100, 480], [1112, 536], [1128, 652],
    [1236, 692], [1236, 778], [1190, 788], [1186, 1016]
  ];

  /* ---------- 중앙 술자리 ---------- */
  const TABLE = {
    top: { x: 785, y: 548, rx: 175, ry: 105 },     // 화면에 보이는 상판
    height: 90,
    ground: { x: 785, y: 638, rx: 175, ry: 105 }   // 바닥에 닿는 발자국
  };
  // 좌석 6개: 시계 방향, 0번이 뒤쪽 왼쪽. x,y는 의자가 바닥에 닿는 점.
  const SEATS = [
    { x: 683, y: 518, dir: 'down', stand: { x: 648, y: 478 }, place: { x: 735, y: 490 } },
    { x: 888, y: 518, dir: 'down', stand: { x: 925, y: 478 }, place: { x: 835, y: 490 } },
    { x: 990, y: 638, dir: 'left', stand: { x: 1052, y: 640 }, place: { x: 905, y: 552 } },
    { x: 888, y: 758, dir: 'up', stand: { x: 918, y: 792 }, place: { x: 812, y: 612 } },
    { x: 683, y: 758, dir: 'up', stand: { x: 646, y: 800 }, place: { x: 758, y: 612 } },
    { x: 580, y: 638, dir: 'right', stand: { x: 592, y: 706 }, place: { x: 665, y: 552 } }
  ];
  const SEAT_RANGE = 125;

  const BLOCKERS = [
    { id: 'table', ellipse: { x: TABLE.ground.x, y: TABLE.ground.y, rx: TABLE.ground.rx + 8, ry: TABLE.ground.ry + 8 } },
    ...SEATS.map((s, i) => ({ id: `stool${i}`, ellipse: { x: s.x, y: s.y, rx: 22, ry: 12 } })),
    { id: 'plantR', ellipse: { x: 556, y: 933, rx: 40, ry: 17 } },
    { id: 'bottomCounters', poly: [
      [700, 1020], [700, 972], [775, 935], [826, 885], [826, 806], [945, 806], [945, 862], [964, 866], [964, 778],
      [1010, 764], [1100, 758], [1172, 790], [1172, 1020]
    ] }
  ];

  function blockedAt(x, y) {
    for (const b of BLOCKERS) {
      if (b.ellipse ? inEllipse(x, y, b.ellipse) : inPoly(x, y, b.poly)) return b;
    }
    return null;
  }
  const canStand = (x, y) => inPoly(x, y, WALK) && !blockedAt(x, y);

  // 목적지가 막히면 한 축씩 시도해서 벽을 따라 미끄러지게 한다.
  function resolveMove(x, y, nx, ny, allowed = canStand) {
    if (allowed(nx, ny)) return { x: nx, y: ny };
    if (allowed(nx, y)) return { x: nx, y };
    if (allowed(x, ny)) return { x, y: ny };
    return { x, y };
  }

  /* ---------- 출입문과 시작 위치 ---------- */
  const DOOR = {
    x: 385, y: 886, r: 92, label: '나가기',
    inside: { x: 570, y: 885, r: 100 },
    bounds: { left: 280, right: 520 },
    outsideSpawn: { x: 385, y: 1000 },
    outsideArea: [[135, 1016], [135, 952], [236, 872], [280, 900], [472, 968], [500, 1016]]
  };
  const canWalkOutside = (x, y) => canStand(x, y) && inPoly(x, y, DOOR.outsideArea);
  const SPAWNS = [
    { x: 620, y: 990 }, { x: 680, y: 990 }, { x: 650, y: 980 },
    { x: 670, y: 950 }, { x: 620, y: 820 }, { x: 680, y: 850 }
  ];

  /* ---------- 매장 상호작용 (데이터만 추가하면 새 직원 밈을 만들 수 있다) ---------- */
  const STORE_INTERACTIONS = [
    {
      id: 'phone_security', type: 'phone', x: 470, y: 428, r: 112,
      button: '살펴보기', title: '퇴근 전 체크',
      message: '퇴근 전 단말기 시건장치에 넣기!',
      screen: { kind: 'lock', label: '시건장치' }
    },
    {
      id: 'phone_55', type: 'phone', x: 1080, y: 586, r: 112,
      button: '살펴보기', title: '55요금제',
      message: '고객님,\n55요금제 쓰면 단말기가 공.짜!예요~',
      note: '(쉿! 공짜아님,\n할부원금 554,400원,\n슈퍼세이브 할인 -23,100원 녹인 것임)',
      screen: { kind: 'plan', label: '5G 55' }
    },
    {
      id: 'tv_hsd', type: 'tv', x: 1170, y: 745, r: 165,
      button: 'TV 보기', title: 'HSD',
      message: 'HSD 인증 필수!',
      sequence: [
        { text: 'HSD 인증 필수!', ms: 1500 },
        { text: '3단 콤보!', ms: 1500 },
        { combo: ['모바일', '홈', '제휴카드'], ms: 2400 }
      ],
      screen: { kind: 'tv', label: 'HSD' }
    }
  ];
  const interactionById = id => STORE_INTERACTIONS.find(s => s.id === id) || null;

  /* ---------- 가까운 좌석/구역 찾기 ---------- */
  function seatNear(x, y, occupied, selfIndex) {
    let best = -1, bestD = SEAT_RANGE;
    SEATS.forEach((s, i) => {
      if (occupied && occupied[i] && i !== selfIndex) return;
      const d = dist(x, y, s.x, s.y);
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }
  function interactionNear(x, y) {
    let best = null, bestD = Infinity;
    for (const it of STORE_INTERACTIONS) {
      const d = dist(x, y, it.x, it.y);
      if (d <= it.r && d < bestD) { bestD = d; best = it; }
    }
    return best;
  }
  const nearDoor = (x, y) => dist(x, y, DOOR.x, DOOR.y) <= DOOR.r
    || dist(x, y, DOOR.inside.x, DOOR.inside.y) <= DOOR.inside.r;
  // 배경 PNG 속 카운터 직원의 실제 노출 영역. 카운터에 가려진 하체는 크기에 포함하지 않는다.
  const STAFF = { bounds: { x: 719, y: 157, w: 62, h: 88 }, x: 750, y: 365, r: 120 };
  const nearStaff = (x, y) => dist(x, y, STAFF.x, STAFF.y) <= STAFF.r;
  const HAIR_STYLES = [
    ['A01', '내추럴 숏컷', 'short'], ['A02', '삐죽머리', 'spiky'],
    ['A03', '슬릭컷', 'slick'], ['A04', '볼륨 가르마', 'parted'],
    ['B01', '볼륨 보브', 'bob'], ['B02', '긴 생머리', 'long'],
    ['B03', '포니테일', 'ponytail'], ['B04', '웨이브 롱헤어', 'wavy']
  ];
  const EMOTES = { smile: 'ㅎㅎ', laugh: 'ㅋㅋㅋ', cry: 'ㅠㅠ', angry: '!!', heart: 'heart' };

  /* ---------- 아바타 옵션 (서버 검증과 로비 UI가 같은 목록을 쓴다) ---------- */
  const AVATAR = {
    base: [['male', '남자'], ['female', '여자']],
    hair: HAIR_STYLES.map(([, label, hair]) => [hair, label]),
    hairStyle: HAIR_STYLES.map(([id, label]) => [id, label]),
    eyes: [
      ['round', 'E01 기본 큰 눈'], ['circle', 'E02 동그란 눈'], ['soft', 'E03 부드러운 눈'], ['clear', 'E04 또렷한 눈'],
      ['droop', 'E05 살짝 내려간 눈'], ['upturned', 'E06 살짝 올라간 눈'], ['smile', 'E07 반달형 눈'], ['sleepy', 'E08 반쯤 감은 눈']
    ],
    outfit: [
      ['uplus', 'LG U+ 유니폼'], ['kia', '기아 타이거즈'], ['doosan', '두산 베어스'], ['samsung', '삼성 라이온즈'],
      ['lg', '엘지 트윈스'], ['hanwha', '한화 이글스'], ['casual', '캐주얼 의상'], ['ragged', '빈털털이'],
      ['basic', '캐주얼 의상 (흰 티)']
    ],
    accessory: [
      ['none', '없음'], ['glasses', '안경'], ['cap', '야구모자'], ['ribbon', '리본'], ['headset', '헤드셋'],
      ['catEars', '고양이 귀'], ['bunnyEars', '토끼 귀'], ['crown', '미니 왕관'], ['starClip', '별 머리핀']
    ],
    hairColors: ['#201a25', '#4a3426', '#7a4b2a', '#b5793c', '#e0c068', '#c0392b', '#e6007e', '#6e35d4', '#2e8bc0', '#e8e8ee']
  };
  const DEFAULT_AVATAR = { base: 'male', eyes: 'round', hair: 'short', hairColor: '#201a25', outfit: 'basic', accessory: 'none' };
  const optionValues = key => AVATAR[key].map(o => o[0]);

  // 어떤 입력이 와도 허용된 값만 남긴다. 예전 클라이언트의 gender 값도 base로 받아 준다.
  function normalizeAvatar(raw) {
    const a = raw && typeof raw === 'object' ? raw : {};
    const pick = (key, value) => (optionValues(key).includes(value) ? value : DEFAULT_AVATAR[key]);
    const base = pick('base', a.base ?? a.gender);
    const style = HAIR_STYLES.find(([id]) => id === a.hairStyle)
      || HAIR_STYLES.find(([, , hair]) => hair === a.hair) || HAIR_STYLES[0];
    return {
      base,
      gender: base,
      eyes: pick('eyes', a.eyes),
      hair: style[2],
      hairStyle: style[0],
      hairColor: /^#[0-9a-f]{6}$/i.test(a.hairColor || '') ? a.hairColor.toLowerCase() : DEFAULT_AVATAR.hairColor,
      outfit: pick('outfit', a.outfit),
      accessory: pick('accessory', a.accessory)
    };
  }

  /* ---------- 술 ---------- */
  const DRINKS = [
    { id: 'soju', label: '소주', glass: 'shot', bottle: 'soju', color: '#dff3ee', foam: false },
    { id: 'beer', label: '맥주', glass: 'mug', bottle: 'beer', color: '#f2b632', foam: true },
    { id: 'somaek', label: '소맥', glass: 'mug', bottle: 'soju', color: '#efc65a', foam: true,
      mix: { a: 'soju', b: 'beer', aLabel: '소주', bLabel: '맥주', ratio: 30 } },
    { id: 'yeonmaek', label: '연맥', glass: 'mug', bottle: 'yeontae', color: '#e9bd4f', foam: true,
      mix: { a: 'yeontae', b: 'beer', aLabel: '연태고량주', bLabel: '맥주', ratio: 30 } },
    { id: 'highball', label: '하이볼', glass: 'highball', bottle: 'whisky', color: '#e8b04a', foam: false },
    { id: 'wine', label: '와인', glass: 'wine', bottle: 'wine', color: '#8e1f45', foam: false },
    { id: 'cocktail', label: '칵테일', glass: 'cocktail', bottle: 'shaker', color: '#ff7aa8', foam: false },
    { id: 'nonalc', label: '논알코올', glass: 'highball', bottle: 'soda', color: '#9ad7f2', foam: false }
  ];
  const drinkById = id => DRINKS.find(d => d.id === id) || null;
  const DEFAULT_DRINK = 'soju';
  const clampRatio = v => {
    const n = Math.round(Number(v) / 5) * 5;
    return Number.isFinite(n) ? Math.max(10, Math.min(90, n)) : 30;
  };

  // 소맥/연맥은 비율에 따라 잔 색을 섞는다. 소주(맑은 술) 비율이 높을수록 연해진다.
  function drinkColor(id, ratio) {
    const d = drinkById(id);
    if (!d) return '#f2b632';
    if (!d.mix) return d.color;
    const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    const clear = d.mix.a === 'soju' ? hex('#e6f4ef') : hex('#efe7b8');
    const beer = hex('#e2a62a');
    const k = clampRatio(ratio ?? d.mix.ratio) / 100;
    return `#${clear.map((c, i) => Math.round(c * k + beer[i] * (1 - k)).toString(16).padStart(2, '0')).join('')}`;
  }

  /* ---------- 취기: 마신 횟수 -> 단계 ---------- */
  const SIP_AMOUNT = 25;
  function drunkLevelFor(count) {
    if (count >= 15) return 3;
    if (count >= 10) return 2;
    if (count >= 5) return 1;
    return 0;
  }

  /* ---------- 건배 ---------- */
  const CHEERS = {
    defaultMessage: '오늘의 우리를',
    opening: ['제가 건배제의 하겠습니다.', '모두 잔을 들어주세요.'],
    ready: ['제가 건배제의 후 위하여 하면', '여러분들도 위하여~ 하며 마셔주세요.'],
    // 건배제의자가 말하는 "위하여"는 정확히 3번이다.
    shouts: message => [`${message} 위하여!`, '위하여.', '위.하.여!'],
    timing: { gatherMs: 25000, readyMs: 3200, shoutMs: 1500, respondMs: 10000, afterMs: 1800 },
    // 사용자가 쓴 글에 "위하여"가 섞여 있으면 총 횟수가 틀어지므로 지운다.
    sanitize(raw) {
      const text = String(raw ?? '')
        .replace(/[<>]/g, '')
        .replace(/위\s*[.·]?\s*하\s*[.·]?\s*여\s*[!~.]*/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 60)
        .trim();
      return text || CHEERS.defaultMessage;
    }
  };

  const LIMITS = { nameMax: 10, chatMax: 120, bubbleMs: 3000, heartMs: 5000, actionMs: 1200 };

  return {
    WORLD, SPEED, SPEED_Y, ROOM_CAPACITY, CHANNELS, PROFILE_KEY, LIMITS,
    toWorld, toNorm, dist, inPoly, inEllipse,
    WALK, BLOCKERS, TABLE, SEATS, SEAT_RANGE, DOOR, SPAWNS, STORE_INTERACTIONS, STAFF, nearStaff, EMOTES, HAIR_STYLES,
    canStand, canWalkOutside, blockedAt, resolveMove, seatNear, interactionNear, interactionById, nearDoor,
    AVATAR, DEFAULT_AVATAR, normalizeAvatar,
    DRINKS, DEFAULT_DRINK, drinkById, clampRatio, drinkColor, SIP_AMOUNT, drunkLevelFor,
    CHEERS
  };
});
