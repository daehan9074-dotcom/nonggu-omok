/* 농구오목 — 선수 도트 그림.
   관절(뼈대) 위치로 자세를 정하고, 둥근 팔다리·몸통·머리를 입체로 계산해 40×66 점 그림으로 찍는다.
   한 자세를 정하면 여덟 방향이 저절로 나온다. 화면(game.js)은 Sprites.get 으로 받아 그대로 키워 그린다. */
const Sprites = (() => {
  'use strict';
  const W = 40, CH = 66, FOOT = 62, H = 50;      // 그림 가로·세로, 발바닥 줄, 키(점)

  // 포지션별 체형: 몸통 반폭 · 팔 굵기 · 다리 굵기 (가드는 날씬하게, 센터는 어깨가 넓고 굵게)
  const BUILD = {
    1: { hw: 7, arm: 2, leg: 4 }, 2: { hw: 7, arm: 3, leg: 4 }, 3: { hw: 8, arm: 3, leg: 5 },
    4: { hw: 9, arm: 3, leg: 5 }, 5: { hw: 9, arm: 4, leg: 6 },
  };
  const TEAM = {
    A: { jersey: ['#ff9a66', '#ee6a36', '#b9431a'], shorts: ['#d9552a', '#b9431a', '#8a2f10'], trim: '#fff3e6' },
    B: { jersey: ['#6f9fe6', '#3f6fb8', '#264c88'], shorts: ['#3a66ab', '#274d88', '#19345f'], trim: '#e9f1ff' },
  };
  // 번호마다 피부색과 머리 모양을 다르게 해서 누가 누구인지 구분되게 한다
  const LOOK = {
    1: { skin: ['#ffd9b5', '#f2bb8e', '#c98f62'], hair: ['#4a3324', '#2a1c12'], style: 'short' },
    2: { skin: ['#e9b98a', '#d39a68', '#a87245'], hair: ['#2b2320', '#15100e'], style: 'band' },
    3: { skin: ['#c98d5e', '#a86e42', '#7e4f2c'], hair: ['#241a16', '#120c0a'], style: 'flat' },
    4: { skin: ['#f3c9a0', '#dca777', '#b07d50'], hair: ['#7a4a22', '#4f2e12'], style: 'afro' },
    5: { skin: ['#9a6238', '#7e4c28', '#5a3418'], hair: ['#1c1512', '#0c0807'], style: 'beard' },
  };
  const DIGIT = {
    1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
    2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
    3: ['.###.', '#...#', '....#', '..##.', '....#', '#...#', '.###.'],
    4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
    5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  };

  const nrm = v => { const l = Math.hypot(...v); return v.map(x => x / l); };
  const LIGHT = nrm([-0.5, 0.55, 0.67]);                 // 빛: 왼쪽 위 앞에서
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, t) => '#' + hex(a).map((x, i) => Math.round(x + (hex(b)[i] - x) * t).toString(16).padStart(2, '0')).join('');
  const lerp3 = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
  const add = (a, b) => a.map((x, i) => x + b[i]);
  // 보는 방향: 'f' 정면에서 시계 반대로 45도씩. 'r' 은 화면 오른쪽을 본다
  const VIEW = { f: 0, fr: 45, r: 90, br: 135, b: 180, bl: -135, l: -90, fl: -45 };

  function ramps(team, num) {
    const t = TEAM[team], lk = LOOK[num];
    const r = (lt, base, dk) => [mix(dk, '#000000', 0.32), dk, base, lt];
    return {
      skin: r(lk.skin[0], lk.skin[1], lk.skin[2]),
      jersey: r(t.jersey[0], t.jersey[1], t.jersey[2]),
      shorts: r(t.shorts[0], t.shorts[1], t.shorts[2]),
      hair: [mix(lk.hair[1], '#000000', 0.45), lk.hair[1], lk.hair[0], mix(lk.hair[0], '#ffffff', 0.2)],
      white: ['#8d96a3', '#c3c9d1', '#eef0f3', '#ffffff'],
      trim: [mix(t.trim, '#000000', 0.45), mix(t.trim, '#000000', 0.22), t.trim, '#ffffff'],
      sole: ['#202328', '#2b2f36', '#3a3f48', '#4a505a'],
      accent: [mix(t.jersey[2], '#000000', 0.3), t.jersey[2], t.jersey[1], t.jersey[0]],
    };
  }

  // ───── 자세: 관절 위치 (x 선수의 오른쪽, y 위, z 앞 / 키 = 1). 왼쪽(L)을 안 적으면 오른쪽을 좌우로 뒤집어 쓴다 ─────
  // stand 서기 · breath 숨 내쉼 · ball 볼 들기 · up 바짝 붙은 수비(팔 들기) · guard 수비 · screen 스크린
  // 슛: sh0 웅크림 → sh1 도약 → shoot 릴리스 → sh3 팔로스루 → land 착지 · reb 리바운드
  // 달리기: runC 오른발 디딤 → run2 왼무릎 들기 → runD 왼발 디딤 → run1 오른무릎 들기
  // 패스: pass0 가슴에 모으기 → pass 두 손 뻗기 → pass2 거두기
  const LEGS = {
    stand: { hipR: [.064, .49, 0], knR: [.068, .27, .014], anR: [.072, .05, 0], toeR: [.076, .025, .085] },
    bent: { hipR: [.066, .47, -.01], knR: [.08, .26, .055], anR: [.085, .05, 0], toeR: [.09, .025, .085] },
    crouch: { hipR: [.068, .44, -.03], knR: [.088, .24, .08], anR: [.09, .05, 0], toeR: [.095, .025, .085] },
    wide: { hipR: [.07, .42, -.025], knR: [.15, .225, .065], anR: [.17, .05, 0], toeR: [.18, .025, .085] },
    ready: { hipR: [.068, .455, -.02], knR: [.1, .255, .06], anR: [.11, .05, 0], toeR: [.115, .025, .085] },
  };
  const POSE = {
    stand: { pelvis: [0, .45, 0], neck: [0, .82, 0], head: [0, .905, .008],
      shR: [0, .79, 0], elR: [.022, .625, -.018], haR: [.028, .48, .018], legs: 'stand' },
    ball: { pelvis: [0, .43, -.01], neck: [0, .8, .035], head: [0, .884, .05],
      shR: [0, .77, .03], elR: [.03, .62, 0], haR: [-.005, .55, .12],
      shL: [0, .77, .03], elL: [-.015, .63, .05], haL: [.02, .6, .16], legs: 'bent', abs: { haL: 1 } },
    up: { pelvis: [0, .43, -.01], neck: [0, .8, .03], head: [0, .89, .04],
      shR: [0, .78, .02], elR: [.03, .94, .06], haR: [0, 1.07, .08], legs: 'bent' },
    guard: { pelvis: [0, .38, -.025], neck: [0, .74, .07], head: [0, .824, .1],
      shR: [0, .72, .05], elR: [.095, .6, .1], haR: [.17, .62, .15], legs: 'wide' },
    screen: { pelvis: [0, .4, -.02], neck: [0, .77, .02], head: [0, .862, .03],
      shR: [0, .75, .03], elR: [.012, .6, .07], haR: [-.13, .6, .11],
      shL: [0, .75, .03], elL: [-.012, .61, .08], haL: [.12, .62, .12], legs: 'wide', abs: { haR: 1, haL: 1 } },
    sh0: { pelvis: [0, .4, -.03], neck: [0, .76, .04], head: [0, .85, .06],
      shR: [0, .74, .04], elR: [.012, .6, .06], haR: [.05, .6, .15], legs: 'crouch', abs: { haR: 1, haL: 1 } },
    sh1: { pelvis: [0, .46, 0], neck: [0, .83, .01], head: [0, .915, 0],
      shR: [0, .8, 0], elR: [.12, .93, .07], haR: [.05, .97, .1], legs: 'stand', abs: { elR: 1, haR: 1, elL: 1, haL: 1 },
      toe: -.03 },
    shoot: { pelvis: [0, .46, 0], neck: [0, .83, 0], head: [0, .915, -.004],
      shR: [0, .8, 0], elR: [.11, .965, .055], haR: [.055, 1.11, .07],
      shL: [0, .8, 0], elL: [-.125, .945, .05], haL: [-.035, 1.075, .085], legs: 'stand', abs: { elR: 1, haR: 1, elL: 1, haL: 1 },
      toe: -.05 },
    sh3: { pelvis: [0, .46, 0], neck: [0, .83, .005], head: [0, .915, 0],
      shR: [0, .8, 0], elR: [.11, .965, .06], haR: [.06, 1.06, .13],
      shL: [0, .8, 0], elL: [-.13, .88, .05], haL: [-.08, .93, .12], legs: 'stand', abs: { elR: 1, haR: 1, elL: 1, haL: 1 },
      toe: -.04 },
    land: { pelvis: [0, .41, -.02], neck: [0, .77, .03], head: [0, .86, .05],
      shR: [0, .75, .03], elR: [.04, .6, .02], haR: [.07, .47, .06], legs: 'crouch' },
    reb: { pelvis: [0, .46, 0], neck: [0, .83, 0], head: [0, .915, 0],
      shR: [0, .8, 0], elR: [.13, .98, .03], haR: [.08, 1.14, .04], abs: { elR: 1, haR: 1, elL: 1, haL: 1 },
      legs: { hipR: [.06, .5, 0], knR: [.07, .3, .07], anR: [.065, .1, -.02], toeR: [.065, .06, .05] } },
    run1: { pelvis: [0, .46, 0], neck: [0, .815, .075], head: [0, .896, .105],
      shR: [0, .785, .06], elR: [.01, .645, -.075], haR: [-.01, .57, .02],
      shL: [0, .785, .06], elL: [-.005, .65, .1], haL: [.03, .74, .16],
      legs: { hipR: [.06, .49, 0], knR: [.062, .355, .17], anR: [.062, .17, .1], toeR: [.062, .145, .18],
        hipL: [-.06, .49, 0], knL: [-.062, .265, -.045], anL: [-.062, .075, -.165], toeL: [-.062, .02, -.115] } },
    runC: { pelvis: [0, .44, 0], neck: [0, .8, .07], head: [0, .886, .1],
      shR: [0, .77, .06], elR: [.01, .635, -.07], haR: [-.01, .56, 0],
      shL: [0, .77, .06], elL: [0, .64, .08], haL: [.03, .71, .14],
      legs: { hipR: [.06, .48, 0], knR: [.062, .27, .08], anR: [.062, .05, .12], toeR: [.062, .025, .2],
        hipL: [-.06, .48, 0], knL: [-.062, .27, -.05], anL: [-.062, .08, -.14], toeL: [-.062, .03, -.1] } },
    pass0: { pelvis: [0, .44, -.01], neck: [0, .8, .03], head: [0, .89, .04],
      shR: [0, .78, .03], elR: [.02, .63, 0], haR: [.05, .64, .13], legs: 'bent', abs: { haR: 1, haL: 1 } },
    pass: { pelvis: [0, .45, .01], neck: [0, .81, .06], head: [0, .9, .08],
      shR: [0, .79, .05], elR: [.1, .71, .15], haR: [.06, .7, .27], abs: { elR: 1, haR: 1, elL: 1, haL: 1 },
      legs: { hipR: [.064, .49, 0], knR: [.066, .28, .06], anR: [.07, .05, .08], toeR: [.07, .025, .16],
        hipL: [-.064, .49, 0], knL: [-.066, .27, -.02], anL: [-.07, .06, -.08], toeL: [-.07, .02, 0] } },
    pass2: { pelvis: [0, .45, .01], neck: [0, .81, .05], head: [0, .9, .07],
      shR: [0, .79, .04], elR: [.02, .66, .07], haR: [.08, .62, .15], abs: { haR: 1, haL: 1 },
      legs: { hipR: [.064, .49, 0], knR: [.066, .28, .06], anR: [.07, .05, .08], toeR: [.07, .025, .16],
        hipL: [-.064, .49, 0], knL: [-.066, .27, -.02], anL: [-.07, .06, -.08], toeL: [-.07, .02, 0] } },
  };
  // 볼 없는 공격수: 무릎을 굽히고 두 손을 가슴 앞에 내민 준비 자세. 좌우로 체중을 옮기고(readyL·readyR), 가끔 한 손을 들어 볼을 부른다(call)
  POSE.ready = { pelvis: [0, .425, -.02], neck: [0, .785, .05], head: [0, .872, .07],
    shR: [0, .765, .04], elR: [.03, .645, .1], haR: [.015, .72, .17], legs: 'ready' };
  POSE.readyL = { ...POSE.ready, shift: 0.022 };
  POSE.readyR = { ...POSE.ready, shift: -0.022 };
  POSE.call = { ...POSE.ready, elR: [.03, .93, .04], haR: [-.005, 1.06, .06], elL: [-.03, .645, .1], haL: [-.015, .72, .17] };
  const MIRROR = { run2: 'run1', runD: 'runC' };

  // 자세 → 관절. 왼쪽(L)이 없으면 오른쪽을 좌우로 뒤집어 만든다.
  // 어깨·팔꿈치·손의 x 는 어깨 끝에서 잰 값이라 어깨 너비 sw 만큼 바깥으로 민다 (abs 에 적힌 관절은 몸 가운데에서 잰 값)
  // 이름 끝에 '+d' 가 붙으면 드리블: 오른손을 허리 앞 아래로 내려 볼을 친다 (달리기 자세에 붙여 쓴다)
  function joints(name, sw) {
    const dribble = name.endsWith('+d');
    if (dribble) name = name.slice(0, -2);
    const base = POSE[MIRROR[name] || name] || POSE.stand, abs = base.abs || {};
    const legs = typeof base.legs === 'string' ? LEGS[base.legs] : base.legs || LEGS.stand;
    const src = { ...legs, ...base }, j = {};
    for (const [key, v] of Object.entries(src)) if (Array.isArray(v)) j[key] = v.slice();
    for (const part of ['sh', 'el', 'ha', 'hip', 'kn', 'an', 'toe']) {
      const r = j[part + 'R'];
      if (!j[part + 'L']) j[part + 'L'] = [-r[0], r[1], r[2]];
    }
    for (const [S, sx] of [['R', 1], ['L', -1]]) for (const part of ['sh', 'el', 'ha']) if (!abs[part + S]) j[part + S][0] += sx * sw;
    if (base.toe) for (const S of ['R', 'L']) j['toe' + S][1] += base.toe;    // 뛰어오르면 발끝이 아래로
    // 목이 보이게: 몸통 윗선을 내리고, 팔 전체를 같이 내리고, 머리는 살짝 올린다
    j.neck = add(j.neck, [0, -0.04, 0]);
    for (const key of ['shR', 'shL', 'elR', 'elL', 'haR', 'haL']) j[key] = add(j[key], [0, -0.045, 0]);
    j.head = add(j.head, [0, 0.014, 0]);
    if (base.shift) for (const key of ['pelvis', 'neck', 'head', 'shR', 'shL', 'elR', 'elL', 'haR', 'haL']) j[key] = add(j[key], [base.shift, 0, 0]);   // 체중 옮기기
    if (MIRROR[name]) {
      const m = {};
      for (const [key, v] of Object.entries(j)) {
        const kk = key.endsWith('R') ? key.slice(0, -1) + 'L' : key.endsWith('L') ? key.slice(0, -1) + 'R' : key;
        m[kk] = [-v[0], v[1], v[2]];
      }
      if (dribble) dribbleArm(m, sw);
      return m;
    }
    if (dribble) dribbleArm(j, sw);
    return j;
  }
  function dribbleArm(j, sw) { j.elR = [sw + .035, .575, .05]; j.haR = [sw + .02, .455, .15]; }

  // 볼이 그림의 어디에 오는가 (자세마다)
  function ballPoint(J, pose) {
    const mid = lerp3(J.haR, J.haL, 0.5);
    if (pose.endsWith('+d')) return add(J.haR, [0, -0.085, 0.02]);   // 드리블: 볼 윗면이 손바닥에 닿는다
    switch (pose) {
      case 'ball': return add(mid, [0, -0.005, 0.03]);                // 두 손 사이에 끼워 든다
      case 'sh0': case 'pass0': return add(mid, [0, 0, 0.07]);
      case 'sh1': return add(mid, [0, 0.05, 0.03]);
      case 'shoot': return add(J.haR, [-0.01, 0.075, 0.02]);
      case 'pass': return add(mid, [0, 0, 0.07]);
      case 'reb': return add(mid, [0, 0.07, 0]);
      default: return add(J.haR, [0.01, 0.01, 0.06]);
    }
  }

  function make(team, num, pose, face) {
    const b0 = BUILD[num];
    const sw = 0.13 + (b0.hw - 7) * 0.012, k = sw / 0.125;
    const armK = { 2: 1.0, 3: 1.12, 4: 1.25 }[b0.arm], legK = { 4: 1.02, 5: 1.1, 6: 1.2 }[b0.leg];
    const J = joints(pose, sw), R = ramps(team, num), look = LOOK[num];
    const phi = (VIEW[face] || 0) * Math.PI / 180, cs = Math.cos(phi), sn = Math.sin(phi);
    const proj = ([x, y, z]) => ({ X: W / 2 + (-x * cs + z * sn) * H, Y: FOOT - y * H, D: x * sn + z * cs });
    const scrN = ([nx, ny, nz]) => [-nx * cs + nz * sn, ny, nx * sn + nz * cs];
    const N = W * CH, dep = new Float32Array(N).fill(-1e9), part = new Int16Array(N).fill(-1);
    const mat = new Array(N), tone = new Int8Array(N), over = new Array(N);
    const toneOf = n => { const b = n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]; return b < 0.02 ? 0 : b < 0.4 ? 1 : b < 0.8 ? 2 : 3; };
    const put = (x, y, d, m, t, id) => {
      if (x < 0 || y < 0 || x >= W || y >= CH) return;
      const i = y * W + x; if (d <= dep[i]) return;
      dep[i] = d; mat[i] = m; tone[i] = t; part[i] = id; over[i] = null;
    };
    let pid = 0;

    // 둥근 막대(팔다리): a→b, 반지름 ra→rb. mf(t) 는 길이 방향 위치에 따른 재질
    function capsule(a, b, ra, rb, mf, maxTone = 3) {
      const A = proj(a), B = proj(b), id = pid++;
      ra *= H; rb *= H;
      const dx = B.X - A.X, dy = B.Y - A.Y, L2 = dx * dx + dy * dy || 1e-9, m = Math.max(ra, rb) + 1;
      for (let y = Math.floor(Math.min(A.Y, B.Y) - m); y <= Math.ceil(Math.max(A.Y, B.Y) + m); y++)
        for (let x = Math.floor(Math.min(A.X, B.X) - m); x <= Math.ceil(Math.max(A.X, B.X) + m); x++) {
          const px = x + 0.5, py = y + 0.5;
          const t = Math.max(0, Math.min(1, ((px - A.X) * dx + (py - A.Y) * dy) / L2)), r = ra + (rb - ra) * t;
          const ux = (px - A.X - dx * t) / r, uy = (py - A.Y - dy * t) / r, d2 = ux * ux + uy * uy;
          if (d2 > 1) continue;
          const nz = Math.sqrt(1 - d2);
          put(x, y, A.D + (B.D - A.D) * t + nz * r / H, mf(t), Math.min(maxTone, toneOf([ux, -uy, nz])), id);
        }
      return id;
    }
    // 타원체(머리·머리카락): 몸 기준 축 반지름 ra(옆) rb(위) rc(앞). mf(xn,yn,zn) 가 null 이면 그 점은 비운다
    function ellipsoid(cen, ra, rb, rc, mf) {
      const C = proj(cen), id = pid++, m = Math.max(ra, rb, rc) * H + 1;
      const qa = (sn / ra) ** 2 + (cs / rc) ** 2;
      for (let y = Math.floor(C.Y - m); y <= Math.ceil(C.Y + m); y++)
        for (let x = Math.floor(C.X - m); x <= Math.ceil(C.X + m); x++) {
          const X = (x + 0.5 - C.X) / H, Y = (C.Y - y - 0.5) / H;
          const qb = 2 * X * cs * sn * (1 / rc ** 2 - 1 / ra ** 2), qc = (X * cs / ra) ** 2 + (X * sn / rc) ** 2 + (Y / rb) ** 2 - 1;
          const disc = qb * qb - 4 * qa * qc; if (disc < 0) continue;
          const D = (-qb + Math.sqrt(disc)) / (2 * qa);
          const lx = -X * cs + D * sn, lz = X * sn + D * cs;
          const mm = mf(lx / ra, Y / rb, lz / rc); if (!mm) continue;
          put(x, y, C.D + D, mm, toneOf(scrN(nrm([lx / ra ** 2, Y / rb ** 2, lz / rc ** 2]))), id);
        }
      return id;
    }
    // 몸통: 골반에서 목까지 가로로 자른 타원을 쌓는다. prof(s) → {wx, wz}, mf(옆 위치, 앞뒤 위치, 높이 s)
    function torso(p0, p1, prof, mf) {
      const id = pid++, steps = Math.ceil((p1[1] - p0[1]) * H * 3) + 2;
      for (let q = 0; q <= steps; q++) {
        const s = q / steps, C = proj(lerp3(p0, p1, s)), { wx, wz } = prof(s), y = Math.floor(C.Y);
        const best = new Map();
        for (let j = 0; j < 96; j++) {
          const al = j / 96 * Math.PI * 2, xl = wx * Math.cos(al), zl = wz * Math.sin(al);
          const xi = Math.floor(C.X + (-xl * cs + zl * sn) * H), D = C.D + xl * sn + zl * cs;
          const e = best.get(xi); if (!e || D > e.D) best.set(xi, { D, xl, zl });
        }
        for (const [xi, e] of best) put(xi, y, e.D, mf(e.xl / wx, e.zl / wz, s), toneOf(scrN(nrm([e.xl / wx ** 2, (s - 0.55) * 6, e.zl / wz ** 2]))), id);
      }
      return id;
    }
    const pw = (pts, s) => { for (let i = 1; i < pts.length; i++) if (s <= pts[i][0]) { const [s0, v0] = pts[i - 1], [s1, v1] = pts[i]; return v0 + (v1 - v0) * (s - s0) / (s1 - s0); } return pts[pts.length - 1][1]; };

    // ── 다리 · 신발
    const shoes = new Set();
    for (const S of ['R', 'L']) {
      capsule(lerp3(J['hip' + S], J['kn' + S], 0.55), J['kn' + S], 0.046 * legK, 0.04 * legK, () => 'skin');
      capsule(J['hip' + S], lerp3(J['hip' + S], J['kn' + S], 0.72), 0.06 * legK, 0.058 * legK, () => 'shorts');   // 무릎 가까이 오는 넉넉한 반바지
      capsule(J['kn' + S], J['an' + S], 0.038 * legK, 0.026 * legK, t => t > 0.72 ? 'white' : 'skin');
      const heel = add(J['an' + S], [0, -0.012, -0.022]);
      shoes.add(capsule(heel, J['toe' + S], 0.03 * legK, 0.028 * legK, t => t > 0.3 && t < 0.55 ? 'accent' : 'white'));
    }
    // ── 몸통 (반바지 → 허리띠 → 민소매 상의)
    const tor = torso(J.pelvis, J.neck,
      s => ({ wx: pw([[0, .098], [.25, .096], [.4, .088], [.7, .11], [.82, .108], [.92, .086], [1, .056]], s) * k,
              wz: pw([[0, .068], [.4, .06], [.75, .074], [.94, .062], [1, .045]], s) * Math.sqrt(k) }),
      (u, v, s) => {
        if (s < 0.33) return 'shorts';
        if (s < 0.37) return 'trim';
        if (v > 0 && s > 0.9 && Math.abs(u) < (s - 0.9) * 2.4) return 'skin';                   // 앞 V넥
        if (v > 0 && s > 0.89 && Math.abs(u) < (s - 0.89) * 2.4 + 0.07) return 'trim';
        if (v < 0 && s > 0.95 && Math.abs(u) < 0.3) return 'trim';                               // 뒷목 둘레
        if (s > 0.86 && Math.abs(u) > 0.92) return 'trim';                                        // 소매 둘레
        return 'jersey';
      });
    // ── 팔 (승모근 · 어깨 · 위팔 · 아래팔 · 손)
    for (const S of ['R', 'L']) {
      const sx = S === 'R' ? 1 : -1;
      // 승모근: 목 옆에서 어깨 끝으로 비스듬히 내려온다. 목 쪽은 살, 바깥쪽은 민소매 끈
      capsule(add(J.neck, [sx * 0.022, 0.012, -0.01]), add(J['sh' + S], [-sx * 0.04, 0.012, -0.005]), 0.022 * Math.sqrt(k), 0.026 * Math.sqrt(k), t => t < 0.42 ? 'skin' : 'jersey');
      capsule(J['sh' + S], J['sh' + S], 0.037 * armK, 0.037 * armK, () => 'skin');
      capsule(J['sh' + S], J['el' + S], 0.036 * armK, 0.029 * armK, () => 'skin');
      capsule(J['el' + S], J['ha' + S], 0.029 * armK, 0.023 * armK, () => 'skin');
      capsule(J['ha' + S], J['ha' + S], 0.03 * armK, 0.03 * armK, () => 'skin');
    }
    // ── 목 · 머리 · 머리카락
    capsule(J.neck, add(J.head, [0, -0.045, -0.01]), 0.038 * Math.sqrt(k), 0.035, () => 'skin', 1);
    const ha = 0.062, hb = 0.082, hc = 0.07, st = look.style;    // 머리: 키의 약 1/6
    const hairline = (zn, lift = 0) => (zn > 0 ? 0.05 + 0.4 * zn : 0.05 + 0.6 * zn) + lift;
    const head = ellipsoid(J.head, ha, hb, hc, (xn, yn, zn) => {
      if (st === 'band' && yn > 0.26 && yn < 0.5) return 'white';
      if (st === 'beard' && ((yn < -0.3 && zn > -0.3) || (Math.abs(xn) > 0.72 && yn < 0.25 && zn > -0.35 && zn < 0.5))) return 'hair';
      return yn > hairline(zn, st === 'beard' ? 0.12 : 0) ? 'hair' : 'skin';
    });
    const hc3 = (dy, dz) => add(J.head, [0, dy, dz]);
    if (st === 'afro') ellipsoid(hc3(0.024, -0.014), ha * 1.42, hb * 1.1, hc * 1.32, (xn, yn, zn) => (yn > -0.3 || zn < -0.25) ? 'hair' : null);
    else if (st === 'flat') {
      const top = J.head[1] + hb + 0.028;
      ellipsoid(hc3(0.045, -0.004), ha * 0.97, hb * 0.98, hc * 0.97, (xn, yn) => (yn > 0.15 && hc3(0.045, 0)[1] + yn * hb * 0.98 < top) ? 'hair' : null);
    } else if (st !== 'beard') ellipsoid(hc3(0.012, -0.006), ha * 1.07, hb * 0.98, hc * 1.08, (xn, yn, zn) => (yn > hairline(zn, 0.08) && !(st === 'band' && yn < 0.62)) ? 'hair' : null);

    // ── 그 위에 찍는 점들: 눈 · 코 · 입 · 귀 · 등번호 · 신발 밑창
    const hpt = (xn, yn, zn) => add(J.head, [xn * ha, yn * hb, zn * hc]);
    const facing = (xn, yn, zn) => scrN(nrm([xn / ha, yn / hb, zn / hc]))[2];
    const stamp = (p, color, onlyPart, w = 1, h = 1) => {
      const P = proj(p), x0 = Math.floor(P.X - (w - 1) / 2), y0 = Math.floor(P.Y);
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
        if (x < 0 || y < 0 || x >= W || y >= CH) continue;
        const i = y * W + x;
        if (onlyPart != null && part[i] !== onlyPart) continue;
        if (part[i] < 0) { part[i] = head; dep[i] = P.D; mat[i] = 'skin'; tone[i] = 2; }
        over[i] = color;
      }
    };
    for (const sx of [1, -1]) {
      if (facing(sx * 0.42, 0, 0.9) > 0.25) stamp(hpt(sx * 0.42, 0.02, 0.9), '#1b1410', head);
      if (facing(sx, 0, 0) > 0.35 && st !== 'afro') stamp(hpt(sx * 1.0, -0.05, -0.05), R.skin[1], null);
    }
    if (Math.abs(sn) > 0.6 && facing(0, -0.2, 1) > -0.2) stamp(hpt(0, -0.2, 1.22), R.skin[2], null);        // 옆모습 코
    else if (cs > 0.3) stamp(hpt(0.2, -0.22, 0.98), R.skin[1], head);                                       // 앞모습 코 그늘
    if (facing(0, -0.5, 0.86) > 0.2) stamp(hpt(0, -0.5, 0.86), st === 'beard' ? '#e9b9a0' : R.skin[0], head);
    // 등번호: 가슴(앞을 볼 때) 또는 등(뒤를 볼 때). 경기에서 꼭 읽혀야 해서 5×7 글꼴
    const s69 = (0.675 - J.pelvis[1]) / (J.neck[1] - J.pelvis[1]), font = DIGIT[num];
    for (const side of [1, -1]) {
      if (cs * side < 0.45) continue;
      const c3 = lerp3(J.pelvis, J.neck, s69), wz = 0.074 * Math.sqrt(k);
      const P = proj(add(c3, [0, 0, side * wz])), x0 = Math.round(P.X - font[0].length / 2), y0 = Math.round(P.Y - font.length / 2);
      font.forEach((row, j) => [...row].forEach((ch, i) => {
        const x = x0 + i, y = y0 + j, q = y * W + x;
        if (ch === '#' && x >= 0 && x < W && y >= 0 && y < CH && part[q] === tor) over[q] = '#ffffff';
      }));
    }
    for (let i = 0; i < N; i++) if (shoes.has(part[i])) { const below = i + W; if (below >= N || !shoes.has(part[below])) mat[i] = 'sole'; }

    // ── 색 입히기 · 안쪽 선 · 바깥선 (바깥선은 이웃한 부위 색을 어둡게)
    const cv = document.createElement('canvas'); cv.width = W; cv.height = CH;
    const c = cv.getContext('2d'), img = c.createImageData(W, CH), d = img.data;
    const edge = new Uint8Array(N), around = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (let y = 0; y < CH; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (part[i] < 0) continue;
      for (const [ox, oy] of around) {
        const nx = x + ox, ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= CH) continue;
        const j = ny * W + nx;
        if (part[j] >= 0 && part[j] !== part[i] && dep[i] - dep[j] > 0.045 && mat[i] !== mat[j]) edge[i] = 1;
      }
    }
    const set = (i, h) => { const [r, g, b] = hex(h); d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255; };
    for (let i = 0; i < N; i++) if (part[i] >= 0) set(i, edge[i] && !over[i] ? R[mat[i]][0] : over[i] || R[mat[i]][tone[i]]);
    for (let y = 0; y < CH; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (part[i] >= 0) continue;
      let best = -1, bd = -1e9;
      for (const [ox, oy] of around) {
        const nx = x + ox, ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= CH) continue;
        const j = ny * W + nx; if (part[j] >= 0 && dep[j] > bd) { bd = dep[j]; best = j; }
      }
      if (best >= 0) set(i, mix(R[mat[best]][0], '#000000', 0.5));
    }
    c.putImageData(img, 0, 0);
    const bp = proj(ballPoint(J, pose)), body = proj(lerp3(J.pelvis, J.neck, 0.6));
    cv.ball = { x: bp.X, y: bp.Y };                // 볼이 놓일 자리 (그림 좌표)
    cv.ballBehind = bp.D < body.D - 0.01;          // 볼이 몸 뒤에 있다 (등을 보이면 볼이 몸에 가려진다)
    return cv;
  }

  const cache = new Map();
  function get(team, num, pose, face) {
    const key = team + num + pose + '/' + face;
    let cv = cache.get(key);
    if (!cv) { cv = make(team, num, pose, face); cache.set(key, cv); }
    return cv;
  }
  // 미리 만들어 두기: 그림 한 장은 PC 에서 약 2ms, 폰에서는 몇 배라 처음 나오는 자세에서 끊길 수 있다.
  // 경기를 시작하면 자주 쓰는 자세부터 화면이 한가할 때 조금씩 만들어 둔다
  const POSES = Object.keys(POSE).concat(Object.keys(MIRROR)), FACES = Object.keys(VIEW);
  const ORDER = ['ready', 'readyL', 'readyR', 'guard', 'ball', 'up', 'runC', 'run1', 'runD', 'run2', 'screen', 'call',
    'runC+d', 'run1+d', 'runD+d', 'run2+d', 'stand', 'breath',
    'sh0', 'sh1', 'shoot', 'sh3', 'land', 'pass0', 'pass', 'pass2', 'reb'];
  let warmJob = null;
  function warm(teams = ['A', 'B']) {
    const todo = [];
    for (const pose of ORDER) for (const face of FACES) for (const team of teams) for (let num = 1; num <= 5; num++) todo.push([team, num, pose, face]);
    const job = warmJob = { todo };
    const idle = window.requestIdleCallback || (fn => setTimeout(() => fn({ timeRemaining: () => 8 }), 50));
    const step = dl => {
      if (warmJob !== job) return;
      while (job.todo.length && dl.timeRemaining() > 2) get(...job.todo.shift());
      if (job.todo.length) idle(step);
    };
    idle(step);
  }
  return { get, warm, W, CH, FOOT, H, POSES, FACES };
})();
