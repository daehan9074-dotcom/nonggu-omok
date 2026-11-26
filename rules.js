/* 농구오목 — 규칙. 화면과 무관한 순수 계산만 둔다(온라인 대전 때 서버에서도 같은 파일을 쓴다). */
const Rules = (() => {
  'use strict';

  // ───────── 코트 (단위 m, 골대 쪽 엔드라인이 y=0) ─────────
  const COURT_W = 15, COURT_H = 14;
  const RIM = { x: 7.5, y: 1.575 };

  // ───────── 육각 격자 (꼭짓점이 위를 향하는 정육각형) ─────────
  const HEX_W = COURT_W / 13;
  const HEX_S = HEX_W / Math.sqrt(3);
  const ROWS = 14;
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];

  const key = (q, r) => q + ',' + r;
  // 화면에 보이는 (열, 줄) → 축 좌표 q. 홀수 줄이 13칸, 짝수 줄이 12칸.
  const colToQ = (col, r) => col - (r + (r & 1)) / 2;
  const center = (q, r) => ({ x: HEX_W * (q + r / 2 + 1), y: HEX_S * (1 + 1.5 * r) });
  const hexDist = (a, b) => (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
  const rimDist = p => { const c = center(p.q, p.r); return Math.hypot(c.x - RIM.x, c.y - RIM.y); };

  const cells = new Map();
  for (let r = 0; r < ROWS; r++) {
    const n = (r & 1) ? 13 : 12;
    for (let c = 0; c < n; c++) {
      const q = colToQ(c, r);
      cells.set(key(q, r), { q, r, ...center(q, r) });
    }
  }

  // ───────── 선수 능력치 (모두 0~100) ─────────
  //  inside 골밑슛 · mid 미들슛 · three 3점슛 · dribble 드리블 · pass 패스
  //  box 박스아웃 · contest 슛견제 · steal 스틸 · height 높이 · speed 스피드
  const POS = { 1: 'PG 포인트가드', 2: 'SG 슈팅가드', 3: 'SF 스몰포워드', 4: 'PF 파워포워드', 5: 'C 센터' };
  const STATS = {
    1: { inside: 62, mid: 74, three: 76, dribble: 86, pass: 86, box: 45, contest: 66, steal: 80, height: 50, speed: 86 },
    2: { inside: 66, mid: 80, three: 84, dribble: 76, pass: 72, box: 52, contest: 70, steal: 72, height: 58, speed: 80 },
    3: { inside: 72, mid: 76, three: 74, dribble: 72, pass: 70, box: 64, contest: 76, steal: 68, height: 68, speed: 72 },
    4: { inside: 80, mid: 70, three: 58, dribble: 58, pass: 62, box: 80, contest: 80, steal: 55, height: 80, speed: 60 },
    5: { inside: 86, mid: 60, three: 44, dribble: 46, pass: 58, box: 88, contest: 86, steal: 45, height: 90, speed: 48 },
  };

  // 이동력은 스피드로 정해진다: 78 이상 4칸, 45 이상 3칸, 그 아래 2칸
  const moveOf = speed => (speed >= 78 ? 4 : speed >= 45 ? 3 : 2);
  const MOVE = {};
  for (const n of Object.keys(STATS)) MOVE[n] = moveOf(STATS[n].speed);

  // ───────── 능력치 조정 (밸런스 유지) ─────────
  // 기본값에서 항목마다 ±10 까지만, 그리고 올린 만큼 다른 곳을 내려야 한다(합계 0 이하).
  const TUNE = {};
  for (const k of Object.keys(STATS[1])) TUNE[k] = { cap: 10, cost: 1, step: 1 };

  const buildCost = d => Object.keys(TUNE).reduce((sum, k) => sum + (d[k] || 0) * TUNE[k].cost, 0);

  function validBuild(d) {
    if (!d || typeof d !== 'object') return false;
    for (const k of Object.keys(d)) {
      const t = TUNE[k], v = d[k];
      if (!t || !Number.isInteger(v) || Math.abs(v) > t.cap || v % t.step !== 0) return false;
    }
    return buildCost(d) <= 0;
  }

  function applyBuild(num, d) {
    const st = { ...STATS[num] };
    for (const k of Object.keys(TUNE)) st[k] += d[k] || 0;
    return st;
  }

  const moveFor = (num, d) => moveOf(STATS[num].speed + (d.speed || 0));

  // 공격: 탑에 볼 가진 1번, 양쪽 45도에 2·3번, 하이포스트 4번, 로우포스트 5번  [번호, 열, 줄]
  const START_O = [[1, 6, 11], [2, 10, 7], [3, 2, 7], [4, 8, 5], [5, 4, 3]];
  const FORMATIONS = {
    z23: { name: '2-3 존', desc: '앞선 2명, 골밑 3명. 골밑이 단단하고 외곽 45도·하이포스트가 빈다',
      at: [[1, 4, 6], [2, 7, 6], [3, 3, 3], [4, 9, 3], [5, 6, 3]] },
    z32: { name: '3-2 존', desc: '앞선 3명, 골밑 2명. 외곽 슛을 막고 코너·골밑 가운데가 빈다',
      at: [[1, 6, 7], [2, 8, 6], [3, 3, 6], [4, 7, 2], [5, 4, 2]] },
    match: { name: '매치업 존', desc: '외곽 3명은 맨투맨, 4·5번은 골밑 지역을 지킨다',
      at: [[1, 6, 9], [2, 9, 6], [3, 2, 6], [4, 7, 2], [5, 4, 2]] },
    man: { name: '맨투맨', desc: '5명 모두 자기 번호 공격수를 따라붙는다',
      at: [[1, 6, 9], [2, 9, 6], [3, 2, 6], [4, 7, 4], [5, 4, 2]] },
  };

  const MAX_MOVES = 3;        // 한 턴에 움직일 수 있는 선수 수
  const SHOT_CLOCK = 6;       // 한 번의 공격에 주어지는 턴
  const HOLD_STEAL = 0.08;    // 볼을 보유할 때 붙은 수비 한 명이 스틸을 시도해 성공할 기본 확률
  const HOLD_TRAP = 2.2;      // 수비 둘 이상에게 둘러싸인 채 보유하면 스틸 확률이 이만큼 곱해진다
  const HOLD_MAX = 0.6, HOLD_MAX_SOLO = 0.4;   // 보유 스틸 확률의 상한 (둘러싸였을 때 / 한 명일 때)
  const DOUBLE_TEAM = 0.30;   // 더블팀당한 선수의 패스에 더해지는 스틸 확률
  const DRIVE_EDGE = 12;      // 드리블이 수비의 '따라가는 힘'보다 이만큼 높으면 제친다
  const PERIMETER = 4;        // 골대에서 이 거리(m) 밖이 외곽
  const SCREEN_EDGE = 25;     // 스크리너의 박스아웃이 수비보다 이만큼 높으면 스크린이 더 단단하다
  const MARK_RANGE = 2;       // 이 칸 수 안의 가장 가까운 수비가 '막고 있는 수비'
  const FAST_LINE = 6.3;      // 엔드라인에서 이 거리(m)보다 하프라인 쪽에 있는 선수가 속공에 참여한다
  const FAST_EDGE = 2;        // 볼을 뺏은 팀이 이만큼 수가 많으면 속공 득점
  const CLOSE_FAR = 4;        // 이 칸 수 이상 떨어져 있다가 달려드는 수비가 클로즈아웃
  const DRIVE_MOVE = 2;       // 제친 뒤 추가 드리블 이동 칸
  const DRIVE_SHOT = 0.07;    // 추가 드리블 직후 슛 성공률 감소
  const INSIDE_FRONT = 0.30;  // 골밑슛을 앞에서 붙어 막을 때의 기본 방해(외곽은 0.18)
  const ENTRY_RANGE = 3.5;    // 받는 선수가 골대에서 이 거리(m) 안이면 '안으로 넣는 패스'
  const PAINT_LIMIT = 3;      // 페인트존에서 연속으로 마칠 수 있는 공격 턴 수(3초 룰)
  const REB_REACH = 3;        // 볼이 떨어진 자리에서 이 거리(m) 안의 선수만 리바운드를 다툰다
  const SHORT_MID = 4.5;      // 골대에서 이 거리(m)까지가 짧은 미들
  // 슛 기본 확률(능력치 70·수비 없음 기준). 구역 안에서도 가까울수록 잘 들어간다
  const INSIDE_TOP = 0.66, INSIDE_DROP = 0.06;   // 골밑슛: 골대 바로 밑 0.66, 1m 멀어질 때마다 -0.06
  const MID_TOP = 0.47, MID_LONG = 0.34;         // 미들슛: 골밑 경계(3m) 0.47 → 3점 라인 바로 안(롱투) 0.34
  const THREE_TOP = 0.35;                        // 3점슛: 3점 라인 바로 밖 0.35
  const CUT_BONUS = 0.12;     // 컷인 슛 성공률 보정
  const CUT_RANGE = 3.5;      // 골대에서 이 거리(m) 안으로 파고들어야 컷인
  const REBOUND_CLOCK = 3;    // 공격 리바운드 뒤 다시 주어지는 턴
  const WIN_SCORE = 10;       // 이 점수를 먼저 내는 팀이 이긴다

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const other = t => (t === 'A' ? 'B' : 'A');

  // 씨앗이 같으면 같은 결과가 나오는 난수(양쪽 기기·서버가 같은 판정을 내도록)
  function rand(s) {
    let t = (s.rng = (s.rng + 0x6D2B79F5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // ───────── 상태 ─────────
  // builds: { A: { 1: {shoot:+3, ...}, ... }, B: {...} } — 규칙에 어긋난 조정은 기본값으로 되돌린다
  function newGame(formations, seed, builds) {
    const s = {
      players: [], ball: null,
      offense: 'A', turnRole: 'O', phase: 'move',
      clock: SHOT_CLOCK, movesLeft: MAX_MOVES, history: [],
      score: { A: 0, B: 0 }, poss: { A: 0, B: 0 },
      formation: { A: formations.A, B: formations.B },
      result: null, react: null, cut: null, drive: null, closeout: null, fresh: null, offs: {}, offMover: null, rng: seed | 0,
    };
    for (const team of ['A', 'B']) {
      for (let num = 1; num <= 5; num++) {
        let d = builds && builds[team] && builds[team][num];
        if (!validBuild(d)) d = {};
        s.players.push({ id: team + num, team, num, q: 0, r: 0, moved: false,
          stats: applyBuild(num, d), move: moveFor(num, d) });
      }
    }
    startPossession(s, 'A');
    return s;
  }

  function startPossession(s, team) {
    s.offense = team;
    const place = (t, list) => {
      for (const [num, col, r] of list) {
        const p = byId(s, t + num);
        p.q = colToQ(col, r); p.r = r; p.moved = false; p.paint = 0;
      }
    };
    place(team, START_O);
    place(other(team), FORMATIONS[s.formation[other(team)]].at);
    s.ball = team + '1';
    s.clock = SHOT_CLOCK;
    s.turnRole = 'O';
    s.phase = 'move';
    s.movesLeft = MAX_MOVES;
    s.history = [];
    s.result = null;
    s.react = null;
    s.cut = null;
    s.drive = null;
    s.closeout = null; s.fresh = null;
    s.mustOut = [];
    s.offs = {}; s.offMover = null;
    s.poss[team]++;
  }

  const byId = (s, id) => s.players.find(p => p.id === id);
  const playerAt = (s, q, r) => s.players.find(p => p.q === q && p.r === r);
  const movingTeam = s => (s.turnRole === 'O' ? s.offense : other(s.offense));
  const defenders = s => s.players.filter(p => p.team !== s.offense);

  // ───────── 이동 ─────────
  function moveRange(s, p) {
    let n = p.move;
    if (s.ball === p.id) n -= 1;         // 드리블 중에는 1칸 덜 간다
    if (s.phase === 'drive' && s.ball === p.id) n = DRIVE_MOVE;   // 드리블 돌파: 추가 이동
    if (s.phase === 'offmove' && s.offMover === p.id) n = DRIVE_MOVE;   // 오프볼 스크린: 추가 이동
    return n;
  }

  // 수비를 제쳤는가: 볼 가진 선수가 골대 쪽으로 움직여 수비 옆(같은 높이거나 더 안쪽)에 섰고,
  // 드리블이 그 수비의 '따라가는 수비력'보다 DRIVE_EDGE 이상 높다.
  // 따라가는 수비력 = 수비력 − (외곽에서는 무거운 만큼 감점) → 느린 빅맨이 가드를 외곽에서 막으면 뚫린다
  function chaseDef(d) {
    // 외곽에서는 스피드로만 따라간다. 골밑 근처에서는 슛견제가 좋은 수비도 길을 막는다
    return rimDist(d) > PERIMETER ? d.stats.speed : Math.max(d.stats.speed, d.stats.contest);
  }

  // 막고 있던 수비(매치업): 출발 자리에서 가장 가까운 수비. 2칸 안에 아무도 없으면 없음.
  function markers(s, from) {
    let min = Infinity;
    for (const d of defenders(s)) min = Math.min(min, hexDist(d, from));
    return min > MARK_RANGE ? [] : defenders(s).filter(d => hexDist(d, from) === min);
  }

  // 제치는 상대는 자기를 막고 있던 수비여야 한다. 다른 수비 옆으로 갔다고 돌파가 생기지 않는다.
  function beats(s, p, from) {
    const rd = rimDist(p);
    if (rd >= rimDist(from)) return false;
    return markers(s, from).some(d => hexDist(d, p) === 1 &&
      p.stats.dribble - chaseDef(d) >= DRIVE_EDGE && rd <= rimDist(d) + 0.6);
  }

  // 스크린을 타고 수비를 떼어냈는가: 출발할 때 붙어 있던 수비가 동료(스크리너)에게 걸려 있고,
  // 볼 가진 선수는 그 스크리너 옆으로 돌아 나와 그 수비와 떨어졌다
  // 수비와 떨어지지 않았더라도(백스크린처럼 스크리너가 수비 뒤에 선 경우) 뒤로 물러나지 않고
  // 스크리너 옆으로 붙어 지나가면 스크린을 탄 것으로 본다.
  function usesScreen(s, p, from) {
    if (p.q === from.q && p.r === from.r) return false;
    const forward = rimDist(p) <= rimDist(from) + 0.6;
    // 스크린에 걸린 수비는 출발 자리에서 2칸 안에 있으면 된다(붙어 있던 수비가 아니라, 가는 길을 막던 수비여도 된다)
    const caught = defenders(s).filter(d => hexDist(d, from) <= MARK_RANGE && (hexDist(d, p) > 1 || forward) &&
      s.players.some(t => t.team === p.team && t.id !== p.id && hexDist(t, d) === 1 && hexDist(t, p) === 1));
    if (!caught.length) return false;
    // 스크린으로 한 명을 떼어냈어도, 도착한 자리 바로 앞(골대 쪽 옆 칸)을 다른 수비가 막고 있으면 더 나아가지 못한다
    return !blockedAhead(s, p, caught);
  }

  // 도착한 자리의 골대 쪽 옆 칸에 (skip 에 없는) 수비가 서 있는가
  function blockedAhead(s, p, skip) {
    const c = center(p.q, p.r), rx = RIM.x - c.x, ry = RIM.y - c.y, rl = Math.hypot(rx, ry) || 1;
    return defenders(s).some(d => {
      if (skip.includes(d) || hexDist(d, p) !== 1) return false;
      const dc = center(d.q, d.r), dx = dc.x - c.x, dy = dc.y - c.y;
      return (dx * rx + dy * ry) / (Math.hypot(dx, dy) * rl) >= 0.6;
    });
  }

  // 볼 가진 선수가 (q,r) 로 가면 한 번 더 움직이게 되는가: 'drive'(제침) / 'screen'(스크린) / null
  // ───────── 클로즈아웃: 패스를 받은 선수에게 멀리서 달려드는 수비 ─────────
  // 방금 패스를 받은 선수에게서 CLOSE_FAR(3칸) 이상 떨어져 있던 수비가 그 선수 쪽으로 갈 때
  //  · 1칸 거리(옆 칸)까지 붙으면 '슛견제': 슛은 제대로 막지만 달려든 탓에 옆으로 뚫린다
  //  · 2칸 거리에서 멈추면 '돌파견제': 돌파는 막지만 슛은 덜 막는다
  // 돌려주는 값: 'shot' / 'drive' / null
  // 클로즈아웃 대상인가: 방금 패스를 받은 선수에게서 CLOSE_FAR 이상 떨어져 있는 수비
  function closing(s, p) {
    if (s.phase !== 'move' || p.team === s.offense || !s.fresh || s.fresh !== s.ball) return false;
    return hexDist(p, byId(s, s.ball)) >= CLOSE_FAR;
  }

  // 볼 가진 선수의 뒤쪽(하프라인 쪽 줄)인가. 달려드는 수비는 뒤로 돌아 들어갈 수 없다.
  function behindBall(s, q, r) {
    const h = byId(s, s.ball);
    return hexDist({ q, r }, h) <= 2 && center(q, r).y > center(h.q, h.r).y + 0.3;
  }

  function closeKind(s, p, q, r) {
    if (!closing(s, p) || behindBall(s, q, r)) return null;
    const d = hexDist({ q, r }, byId(s, s.ball));
    return d === 1 ? 'shot' : d === 2 ? 'drive' : null;
  }

  // 달려든 수비를 옆으로 따돌렸는가: 수비 능력과 상관없이, 뒤로 물러나지만 않으면 된다
  function shakes(s, p, from) {
    if (!s.closeout || s.closeout.on !== p.id) return false;
    const d = byId(s, s.closeout.def);
    return hexDist(d, from) === 1 && rimDist(p) <= rimDist(from) + 0.6;
  }

  function driveKind(s, p, from) {
    if (beats(s, p, from)) return 'drive';
    if (shakes(s, p, from)) return 'closeout';
    if (usesScreen(s, p, from)) return 'screen';
    return null;
  }

  // 화면 표시용
  function driveAt(s, p, q, r) {
    if (p.team !== s.offense || s.phase !== 'move') return null;
    const ball = s.ball === p.id;
    if (ball && s.drive) return null;
    const from = { q: p.q, r: p.r };
    p.q = q; p.r = r;
    // 볼 없는 선수는 스크린을 타는 경우만 해당
    const kind = ball ? driveKind(s, p, from) : (usesScreen(s, p, from) ? 'screen' : null);
    p.q = from.q; p.r = from.r;
    return kind;
  }

  // 돌파: 드리블이 좋고 수비가 무거울수록(느릴수록) 붙은 수비를 그냥 지나친다
  // (제치기와 같은 기준: 드리블 − 따라가는 수비력 ≥ DRIVE_EDGE)
  const blowBy = (h, d) => h.stats.dribble - chaseDef(d) >= DRIVE_EDGE;

  // (q,r) 에서 옆 칸 (nq,nr) 로 한 걸음 가는 데 드는 이동력. 기본 1.
  //  · 수비: 공격수 2명 이상과 붙은 칸(막는 상대 + 스크리너)에 있으면 스크린에 걸린 것.
  //          스크리너 쪽(스크리너와 맞닿은 칸)으로 가려면 2, 스크리너가 15kg 이상 무거우면 3.
  //          스크리너 반대쪽으로는 그대로 1 → 스크린이 선 방향이 수비가 따라갈 길을 정한다
  //  · 볼 가진 선수: 수비가 붙어 있으면 어느 쪽이든 2 (돌파가 되는 상대면 1)
  function stepCost(s, p, q, r, nq, nr) {
    const defending = p.team !== s.offense;
    const handler = s.ball === p.id;
    if (!defending && !handler) return 1;
    const near = [];
    for (const [dq, dr] of DIRS) {
      const o = playerAt(s, q + dq, r + dr);
      if (o && o.team !== p.team) near.push(o);
    }
    // 볼 가진 선수: 붙은 수비가 압박한다. 단, 제칠 수 있는 상대거나 동료의 스크린에 걸린 수비는 압박하지 못한다
    if (!defending) {
      const caught = o => s.players.some(t => t.team === p.team && t.id !== p.id && hexDist(t, o) === 1);
      return near.some(o => !blowBy(p, o) && !caught(o)) ? 2 : 1;
    }
    if (near.length < 2) return 1;
    let extra = 0;
    const to = { q: nq, r: nr };
    for (const o of near) {
      if (o.id === s.ball || hexDist(o, to) !== 1) continue;
      extra = Math.max(extra, o.stats.box - p.stats.box >= SCREEN_EDGE ? 2 : 1);
    }
    return 1 + extra;
  }

  // 지금 자리에서 발이 묶였는가 (수비: 스크린에 걸림 / 볼 가진 선수: 압박당하는 중)
  function slowed(s, p) {
    if (p.team === s.offense) return s.ball === p.id && stepCost(s, p, p.q, p.r, p.q, p.r) > 1;
    return screens(s).some(([, d]) => d.id === p.id);
  }

  // 스크린 때문에 이동력이 더 드는 옆 칸: 칸 → 드는 이동력 (화면 표시용)
  function screenCells(s, p) {
    const out = new Map();
    if (p.team === s.offense) return out;
    for (const [dq, dr] of DIRS) {
      const nq = p.q + dq, nr = p.r + dr, k = key(nq, nr);
      if (!cells.has(k) || playerAt(s, nq, nr)) continue;
      const c = stepCost(s, p, p.q, p.r, nq, nr);
      if (c > 1) out.set(k, { ...cells.get(k), cost: c });
    }
    return out;
  }

  // 갈 수 있는 칸: 상대는 못 지나가고, 같은 편은 지나가되 멈출 수는 없다
  // 뒤처진 수비: 볼 가진 선수가 자기보다 안쪽(골대 쪽)에 있고 3칸 안에 있는 수비는, 수비 턴에
  // 그 선수를 뛰어넘어 앞으로 돌아 들어가지 못한다. 옆까지만 따라붙을 수 있다.
  // '앞'은 상대적이다: 수비 자리에서 볼 가진 선수를 바라본 방향으로, 그 선수 너머의 부채꼴 공간.
  // 돌려주는 값: inShadow 에 넘길 정보. 해당 없으면 null.
  const TRAIL_RANGE = 3, TRAIL_SLACK = 0.3;
  function trailLimit(s, p) {
    if (s.phase !== 'move' || p.team === s.offense) return null;
    const h = byId(s, s.ball);
    if (rimDist(p) <= rimDist(h) + TRAIL_SLACK || hexDist(p, h) > TRAIL_RANGE) return null;
    const a = center(p.q, p.r), c = center(h.q, h.r);
    const dist = Math.hypot(c.x - a.x, c.y - a.y);
    // 볼 가진 선수와 골대 사이의 길: 뒤처진 수비는 한 번에 이 길을 막아서지 못한다(옆 칸까지만)
    const lx = RIM.x - c.x, ly = RIM.y - c.y, ll = Math.hypot(lx, ly);
    const lane = ll < 0.3 ? null : { x: c.x, y: c.y, ux: lx / ll, uy: ly / ll, len: ll };
    return { x: a.x, y: a.y, list: [{ ux: (c.x - a.x) / dist, uy: (c.y - a.y) / dist, dist }], lane };
  }
  const trailing = (s, p) => trailLimit(s, p) !== null;

  function inLane(lane, cell) {
    if (!lane) return false;
    const vx = cell.x - lane.x, vy = cell.y - lane.y;
    const t = vx * lane.ux + vy * lane.uy;
    return t > 0.3 && t <= lane.len + 0.6 && Math.abs(vx * lane.uy - vy * lane.ux) <= 1.0;
  }

  // 스크린 벽: 옆 칸으로 한 걸음 갈 때, 그 두 칸에 모두 맞닿은 양옆 칸을 공격수 둘이 차지하고 있으면
  // 둘 사이의 틈을 비집고 지나가는 것이라 막힌다.
  function wallBetween(s, q, r, nq, nr) {
    let n = 0;
    for (const [dq, dr] of DIRS) {
      const cq = q + dq, cr = r + dr;
      if (hexDist({ q: cq, r: cr }, { q: nq, r: nr }) !== 1) continue;
      const o = playerAt(s, cq, cr);
      if (o && o.team === s.offense) n++;
    }
    return n >= 2;
  }

  // 몸으로 막힌 수비: 옆 칸에 붙은 공격수의 뒤쪽 공간으로는 한 번에 못 넘어간다(선수를 뚫고 지나갈 수 없다)
  function sealLimit(s, p) {
    if (s.phase !== 'move' || p.team === s.offense) return null;
    const a = center(p.q, p.r);
    const list = [];
    for (const o of s.players) {
      if (o.team !== s.offense || hexDist(o, p) !== 1) continue;
      const c = center(o.q, o.r);
      const dist = Math.hypot(c.x - a.x, c.y - a.y);
      list.push({ ux: (c.x - a.x) / dist, uy: (c.y - a.y) / dist, dist });
    }
    return list.length ? { x: a.x, y: a.y, list } : null;
  }
  const sealed = (s, p) => sealLimit(s, p) !== null;

  // 수비 뒷공간(볼이 있든 없든 공격수에게 적용): 2칸 안에 수비가 있으면, 이동 단계에서는
  // 그 수비의 '뒤쪽'으로 한 번에 들어가지 못한다. 뒤쪽은 골대 방향이 아니라 상대적인 방향이다.
  // 내 자리에서 그 수비를 바라본 방향으로, 수비 너머에 부채꼴(좌우 45도)로 펼쳐진 공간이다.
  // 수비가 없는 방향(골대 쪽 포함)으로는 자유롭게 간다. 수비 너머로 가려면 드리블 돌파·스크린
  // 추가 이동을 쓰거나 다음 턴에 간다.
  const SHADOW_COS = Math.cos(Math.PI / 4);
  function guardLimit(s, p) {
    if (s.phase !== 'move' || p.team !== s.offense) return null;
    const a = center(p.q, p.r);
    const list = [];
    for (const d of defenders(s)) {
      if (hexDist(d, p) > MARK_RANGE) continue;
      const c = center(d.q, d.r);
      const dist = Math.hypot(c.x - a.x, c.y - a.y);
      // 이 수비에게 스크린을 건 동료들. 스크리너 옆 칸은 스크린이 열어 준 길이라 뒷공간이어도 갈 수 있다
      const scr = s.players.filter(t => t.team === p.team && t.id !== p.id && hexDist(t, d) === 1);
      list.push({ ux: (c.x - a.x) / dist, uy: (c.y - a.y) / dist, dist, scr });
    }
    // 같은 편이라도 옆 칸에 붙어 있는 동료의 뒤쪽으로는 한 번에 못 넘어간다(선수를 뚫고 지나갈 수 없다)
    for (const t of s.players) {
      if (t.team !== p.team || t.id === p.id || hexDist(t, p) !== 1) continue;
      const c = center(t.q, t.r);
      const dist = Math.hypot(c.x - a.x, c.y - a.y);
      list.push({ ux: (c.x - a.x) / dist, uy: (c.y - a.y) / dist, dist, mate: true });
    }
    return list.length ? { x: a.x, y: a.y, list } : null;
  }

  // 그 칸이 어느 수비의 뒷공간인가
  function inShadow(guard, cell) {
    const vx = cell.x - guard.x, vy = cell.y - guard.y, len = Math.hypot(vx, vy);
    return guard.list.some(g => len > g.dist + 0.3 && (vx * g.ux + vy * g.uy) / len >= SHADOW_COS &&
      !(g.scr && g.scr.some(t => hexDist(t, cell) === 1)));
  }

  const guarded = (s, p) => guardLimit(s, p) !== null;

  function reachable(s, p) {
    const max = moveRange(s, p);
    const best = new Map([[key(p.q, p.r), 0]]);
    const open = [[p.q, p.r, 0]];
    const out = new Map();
    const trail = trailLimit(s, p), guard = guardLimit(s, p), rush = closing(s, p), seal = sealLimit(s, p);
    const defending = p.team !== s.offense && s.phase === 'move';

    while (open.length) {
      open.sort((a, b) => a[2] - b[2]);
      const [q, r, d] = open.shift();
      if (d > best.get(key(q, r))) continue;
      for (const [dq, dr] of DIRS) {
        const nq = q + dq, nr = r + dr, k = key(nq, nr);
        if (!cells.has(k)) continue;
        // 뒤처진 수비는 볼 가진 선수 앞으로, 공격수는 앞을 막은 수비의 뒷공간으로 들어가지 못한다
        if (trail && (inShadow(trail, cells.get(k)) || inLane(trail.lane, cells.get(k)))) continue;
        if (seal && inShadow(seal, cells.get(k))) continue;
        if (defending && wallBetween(s, q, r, nq, nr)) continue;   // 붙어 선 공격수 둘 사이는 못 지나간다
        if (rush && behindBall(s, nq, nr)) continue;       // 멀리서 달려드는 수비는 볼 뒤로 못 돌아간다
        if (guard && inShadow(guard, cells.get(k))) continue;
        const nd = d + stepCost(s, p, q, r, nq, nr);
        if (nd > max) continue;
        if (best.has(k) && best.get(k) <= nd) continue;
        const occ = playerAt(s, nq, nr);
        if (occ && occ.team !== p.team) continue;
        best.set(k, nd);
        open.push([nq, nr, nd]);
        if (!occ) out.set(k, cells.get(k));
      }
    }
    return out;
  }

  // 지금 걸려 있는 스크린 목록: [스크리너, 걸린 수비]
  function screens(s) {
    const out = [];
    for (const d of defenders(s)) {
      const near = s.players.filter(o => o.team === s.offense && hexDist(o, d) === 1);
      if (near.length < 2) continue;
      for (const o of near) if (o.id !== s.ball) out.push([o, d]);
    }
    return out;
  }

  function canMove(s, p) {
    if (s.phase === 'drive') return p.id === s.ball;      // 드리블 돌파 중에는 볼 가진 선수만
    if (s.phase === 'offmove') return p.id === s.offMover; // 오프볼 추가 이동 중에는 그 선수만
    return s.phase === 'move' && p.team === movingTeam(s) && !p.moved && s.movesLeft > 0;
  }

  function move(s, id, q, r) {
    const p = byId(s, id);
    if (!canMove(s, p) || !reachable(s, p).has(key(q, r))) return false;
    if (s.phase === 'drive') {
      // 드리블 돌파의 추가 이동 → 다시 볼 처리 선택으로. 직후 슛은 성공률 감소
      p.q = q; p.r = r;
      s.drive = { ...s.drive, stage: 2 };
      s.phase = 'action';
      return true;
    }
    if (s.phase === 'offmove') {
      // 오프볼 스크린의 추가 이동 → 다시 볼 처리 선택으로
      p.q = q; p.r = r;
      s.offs = { ...s.offs, [id]: 2 };
      s.offMover = null;
      s.phase = 'action';
      return true;
    }
    s.history.push({ id, q: p.q, r: p.r, movesLeft: s.movesLeft, drive: s.drive, offs: s.offs, closeout: s.closeout });
    const from = { q: p.q, r: p.r };
    // 멀리서 달려와 옆 칸까지 붙은 수비 → 다음 공격 턴에 옆으로 뚫린다
    if (closeKind(s, p, q, r) === 'shot') s.closeout = { def: id, on: s.ball };
    p.q = q; p.r = r; p.moved = true;
    s.movesLeft--;
    if (p.team === s.offense && s.ball !== id && usesScreen(s, p, from)) {
      // 볼 없는 선수가 스크린을 타고 수비를 떼어냈다 → 볼 처리 때 추가 이동을 고를 수 있다
      s.offs = { ...s.offs, [id]: 1 };
    }
    if (s.ball === id) {
      // 수비를 제쳤거나 스크린을 탔으면 볼 처리 때 '드리블 돌파'를 고를 수 있다
      const via = driveKind(s, p, from);
      s.drive = via ? { id, stage: 1, via } : null;
    }
    return true;
  }

  function undo(s) {
    if (s.phase !== 'move') return false;
    const h = s.history.pop();
    if (!h) return false;
    const p = byId(s, h.id);
    p.q = h.q; p.r = h.r; p.moved = false;
    s.movesLeft = h.movesLeft;
    s.drive = h.drive;
    s.offs = h.offs;
    s.closeout = h.closeout;
    return true;
  }

  function resetMoves(s) {
    s.movesLeft = MAX_MOVES;
    s.history = [];
    for (const p of s.players) p.moved = false;
  }

  // 이동을 마친다: 공격이면 볼 처리 선택으로, 수비면 다시 공격 턴으로
  // 이동을 끝낼 수 있는가: 이번 턴에 한 명은 움직여야 한다 (움직일 수 있는 선수가 아예 없으면 예외)
  // ───────── 3초 룰 ─────────
  // 공격수가 페인트존에서 공격 턴을 PAINT_LIMIT(3)번 연속으로 마치면, 다음 공격 턴에는 반드시 밖으로 나가야 한다.
  const inPaint = p => { const c = center(p.q, p.r); return c.x >= 5.05 && c.x <= 9.95 && c.y <= 5.8; };

  // 이번 턴에 페인트존에서 나가야 하는데 아직 안에 있는 공격수들
  // 공격 턴이 시작될 때 부른다: 3초를 채웠고 나갈 길이 있는 선수를 '나가야 하는 선수'로 정해 둔다
  function markThreeSec(s) {
    s.mustOut = s.players
      .filter(p => p.team === s.offense && (p.paint || 0) >= PAINT_LIMIT && inPaint(p) &&
        [...reachable(s, p).values()].some(c => !inPaint(c)))            // 나갈 길이 아예 없으면 예외
      .map(p => p.id);
  }

  function mustLeave(s) {
    if (s.phase !== 'move' || s.turnRole !== 'O') return [];
    // 아직 안 움직였는데 지금은 나갈 길이 막혀 있으면(동료가 길을 막은 경우 등) 이번 턴은 봐준다
    return (s.mustOut || []).map(id => byId(s, id)).filter(p => inPaint(p) &&
      (p.moved || [...reachable(s, p).values()].some(c => !inPaint(c))));
  }

  function canEnd(s) {
    if (s.phase !== 'move') return false;
    if (mustLeave(s).length) return false;
    if (s.history.length > 0) return true;
    return !s.players.some(p => canMove(s, p) && reachable(s, p).size > 0);
  }

  function endMoves(s) {
    if (!canEnd(s)) return;
    if (s.turnRole === 'O') { s.phase = 'action'; return; }
    s.fresh = null;
    s.turnRole = 'O';
    resetMoves(s);
    markThreeSec(s);
  }

  // 볼 처리 선택에서 이동으로 되돌아간다(아직 판정 전)
  function backToMoves(s) {
    if (s.phase === 'action' && !usedExtra(s)) s.phase = 'move';
  }

  // ───────── 슛 ─────────
  function shotInfo(s, sh) {
    const c = center(sh.q, sh.r);
    const d = Math.hypot(c.x - RIM.x, c.y - RIM.y);
    const three = d > 6.75 || (Math.abs(c.x - RIM.x) > 6.6 && c.y < 2.99);
    const inside = d <= 3;
    const st = sh.stats;

    // 기본 확률: 구역마다 기준에서 멀어질수록 조금씩 떨어진다
    //  골밑슛 = 골대에서 · 미들슛 = 골밑 경계(3m)에서 · 3점슛 = 3점 라인에서
    let base;
    if (inside) base = INSIDE_TOP - d * INSIDE_DROP;                                 // 골대 0m 0.66 → 3m 0.48
    else if (!three) base = MID_TOP - (d - 3) * (MID_TOP - MID_LONG) / 3.75;         // 3m 0.47 → 라인 바로 안(롱투) 0.34
    else {
      // 3점 라인 밖으로 나간 거리(코너는 옆줄 쪽 직선 라인 기준)
      const corner = c.y < 2.99 && Math.abs(c.x - RIM.x) > 6.6;
      const beyond = Math.max(0, corner ? Math.abs(c.x - RIM.x) - 6.6 : d - 6.75);
      base = THREE_TOP - Math.min(beyond, 0.65) * 0.05 - Math.max(0, beyond - 0.65) * 0.08;  // 라인 0.35, 딥쓰리는 빠르게 떨어진다
    }

    // 거리별로 쓰는 능력치가 다르다: 골밑슛 · 미들슛 · 3점슛
    const zone = inside ? 'inside' : three ? 'three' : 'mid';
    // 짧은 미들은 골밑슛과 미들슛의 중간으로 본다
    const rating = zone === 'mid' && d <= SHORT_MID ? (st.inside + st.mid) / 2 : st[zone];
    const skill = (rating - 70) * 0.004;

    // 수비 방해: 붙어 있을수록, 수비력·신장·점프가 좋을수록 크다
    const list = [];
    for (const df of defenders(s)) {
      const hd = hexDist(sh, df);
      let c0 = hd === 1 ? 0.18 : hd === 2 ? 0.07 : 0;
      // 슛 순간 슈터 쪽으로 달려든 수비(클로즈아웃)는 3칸 거리에서도 조금 방해한다
      if (hd === 3 && s.react && s.react.kind === 'shot' && s.react.moved === df.id && hexDist(sh, { q: s.react.q, r: s.react.r }) > 3) c0 = 0.03;
      if (inside && c0 < 0.07 && rimDist(df) <= 1.7) c0 = 0.07;   // 골밑을 지키는 수비
      if (!c0) continue;
      const ds = df.stats;
      let f = 1 + (ds.contest - 70) / 100 + (ds.height - st.height) / 100;
      // 골밑 미스매치: 골밑 슛은 키와 몸무게 차이가 훨씬 크게 작용한다.
      // 작은 수비가 큰 선수를 막으면 방해가 거의 안 되고, 큰 수비가 작은 선수를 막으면 크게 방해한다
      if (inside) f += (ds.height - st.height) / 60;
      // 수비가 선 자리: 앞(골대 쪽)이면 그대로, 옆이면 60%, 뒤(골대 반대쪽)면 25%만 방해한다
      // 골대 바로 밑(1.6m 안)에서는 앞뒤가 따로 없다: 붙어 있는 수비는 모두 앞을 막은 것으로 본다
      const rdf = rimDist(df);
      const front = rdf <= d - 0.3 || (d <= 1.6 && hd === 1);
      if (!front) f *= rdf > d + 0.3 ? 0.25 : 0.6;
      // 골밑슛은 앞을 막은 수비가 붙어 있으면 훨씬 어렵다 / 골밑을 지키는 수비도 더 방해한다
      if (inside && front && hd === 1) c0 = INSIDE_FRONT;
      else if (inside && front && hd === 2) c0 = Math.max(c0, 0.11);
      list.push(c0 * Math.max(inside ? 0.15 : 0.3, f));
    }
    list.sort((a, b) => b - a);
    const contest = list.length ? Math.min(inside ? 0.52 : 0.38, list[0] + 0.4 * list.slice(1).reduce((a, b) => a + b, 0)) : 0;
    const open = list.length === 0;

    // 컷인: 이번 턴에 골밑으로 파고들어 패스를 받아 바로 올리는 슛
    const cut = s.cut === sh.id;
    // 수비를 제치고 추가 드리블까지 한 직후의 슛은 자세가 흐트러진다
    const drive = !!(s.drive && s.drive.id === sh.id && s.drive.stage === 2);
    const p = clamp(base + skill - contest + (open ? 0.05 : 0) + (cut ? CUT_BONUS : 0) - (drive ? DRIVE_SHOT : 0), 0.03, 0.92);
    return { p, pts: three ? 3 : 2, dist: d, open, cut, drive, zone };
  }

  // ───────── 패스 ─────────
  function passInfo(s, from, to) {
    const a = center(from.q, from.r), b = center(to.q, to.r);
    const vx = b.x - a.x, vy = b.y - a.y, len = Math.hypot(vx, vy);
    let keep = 1, threat = null, worst = 0, pressed = 0, presser = null, nearest = null, nearD = Infinity;
    for (const df of defenders(s)) {
      const c = center(df.q, df.r);
      const t = ((c.x - a.x) * vx + (c.y - a.y) * vy) / (len * len);
      // 압박: 패스하는 선수에게 붙어 있되, 패스 방향의 앞이나 옆에 선 수비만 방해한다(뒤에 선 수비는 못 한다)
      if (hexDist(from, df) === 1) {
        const cos = ((c.x - a.x) * vx + (c.y - a.y) * vy) / (len * Math.hypot(c.x - a.x, c.y - a.y));
        if (cos >= -0.1) { pressed++; if (!presser) presser = df.id; }
      }
      // 패스 길에 가장 가까운 수비(끊은 선수를 정할 때 쓴다). 패스하는 선수 뒤쪽은 제외
      if (t >= 0) {
        const tt = Math.min(1, t);
        const dd = Math.hypot(c.x - (a.x + vx * tt), c.y - (a.y + vy * tt));
        if (dd < nearD) { nearD = dd; nearest = df.id; }
      }
      if (t < 0.05 || t > 1.02) continue;
      const pd = Math.abs((c.x - a.x) * vy - (c.y - a.y) * vx) / len;   // 패스 길에서 떨어진 거리
      // 패스가 나가는 순간 한 칸 뛰어든 수비는 끊을 확률이 더 높다
      const jump = s.react && s.react.kind === 'pass' && s.react.moved === df.id;
      // 밖에서 골밑으로 바로 찔러 넣는 패스(받는 선수가 골대 3.5m 안, 패스 길이 3m 이상)는 뛰어든 수비에게 훨씬 잘 끊긴다
      const entry = rimDist(to) <= ENTRY_RANGE && len >= 3;
      let r = jump
        ? (entry ? (pd < 0.7 ? 0.72 : pd < 1.3 ? 0.42 : pd < 1.9 ? 0.16 : 0)
                 : (pd < 0.7 ? 0.45 : pd < 1.3 ? 0.25 : pd < 1.9 ? 0.10 : 0))
        : (pd < 0.7 ? 0.30 : pd < 1.3 ? 0.14 : pd < 1.9 ? 0.05 : 0);
      if (!r) continue;
      r *= clamp(1 + (df.stats.steal - 65) / 100, 0.5, 1.5);
      keep *= 1 - r;
      if (r > worst) { worst = r; threat = df.id; }
    }
    let p = (1 - keep) * clamp(1 - (from.stats.pass - 70) / 100, 0.6, 1.3);
    p += Math.max(0, len - 6) * 0.012;      // 긴 패스
    if (pressed === 1) p += 0.03;           // 붙어서 압박당하는 중
    const doubled = pressed >= 2;
    if (doubled) p += DOUBLE_TEAM;          // 더블팀: 둘 이상이 에워싸면 패스가 크게 흔들린다

    // 하이로우: 자유투 라인 부근(하이포스트)에서 골밑으로 넣는 패스는 각이 좋아 절반만 끊긴다
    const fd = rimDist(from);
    const highLow = fd >= 3.2 && fd <= 5.4 && Math.abs(a.x - RIM.x) <= 2.7 && rimDist(to) <= 2.7;
    if (highLow) p *= 0.5;

    // 끊는 선수: 패스 길을 가장 크게 막은 수비 → 앞·옆에서 압박한 수비 → 패스 길에 가장 가까운 수비
    if (!threat) threat = presser || nearest || defenders(s).slice().sort((x, y) => hexDist(x, to) - hexDist(y, to))[0].id;
    return { p: clamp(p, 0.01, 0.9), threat, tag: doubled ? '더블팀' : highLow ? '하이로우' : null, doubled };
  }

  // 패스 길 근처의 수비인가: 패스 선에서 2칸(2.4m) 안, 패스 구간 옆에 있다
  function nearPass(s, from, to, df) {
    const a = center(from.q, from.r), b = center(to.q, to.r), c = center(df.q, df.r);
    const vx = b.x - a.x, vy = b.y - a.y, len = Math.hypot(vx, vy);
    const t = ((c.x - a.x) * vx + (c.y - a.y) * vy) / (len * len);
    if (t < 0 || t > 1.1) return false;
    return Math.abs((c.x - a.x) * vy - (c.y - a.y) * vx) / len <= 2.4;
  }

  // 골대까지 길이 비었는가: p 와 골대를 잇는 선 가까이(0.8m 안)에 수비가 없다
  function laneClear(s, p) {
    const a = center(p.q, p.r);
    const vx = RIM.x - a.x, vy = RIM.y - a.y, len = Math.hypot(vx, vy);
    if (len < 0.01) return true;
    for (const df of defenders(s)) {
      const c = center(df.q, df.r);
      const t = ((c.x - a.x) * vx + (c.y - a.y) * vy) / (len * len);
      if (t <= 0 || t > 1.08) continue;
      if (Math.abs((c.x - a.x) * vy - (c.y - a.y) * vx) / len < 0.8) return false;
    }
    return true;
  }

  // 컷인인가: 이번 턴에 움직여서 골밑 근처에 들어와 있다
  const isCut = p => p.moved && rimDist(p) <= CUT_RANGE;

  // 패스를 받자마자 쏠 수 있는가: 골대까지 길이 비었고, 옆 칸에 붙은 수비가 없다 (공격 첫 턴은 제외)
  const canCatchShoot = (s, p) =>
    !noShot(s) && laneClear(s, p) && !defenders(s).some(d => hexDist(d, p) === 1);

  // ───────── 보유: 붙어 있는 수비 수만큼 볼을 뺏길 위험(트랩) ─────────
  function holdInfo(s) {
    const h = byId(s, s.ball);
    let p = 0, threat = null, worst = 0, n = 0;
    for (const df of defenders(s)) {
      if (hexDist(h, df) !== 1) continue;
      const r = HOLD_STEAL * clamp(1 + (df.stats.steal - 65) / 100, 0.5, 1.5);
      p += r; n++;
      if (r > worst) { worst = r; threat = df.id; }
    }
    p *= clamp(1 - (h.stats.dribble - 70) / 100, 0.6, 1.4);
    // 둘 이상에게 둘러싸이면 볼을 지키기 어렵다
    const trapped = n >= 2;
    if (trapped) p *= HOLD_TRAP;
    return { p: clamp(p, 0, trapped ? HOLD_MAX : HOLD_MAX_SOLO), threat, trapped };
  }

  // 돌파(추가 드리블)를 시작할 때의 스틸 확률: 둘러싸였을 때만, 아직 판정하지 않았을 때만
  function driveRisk(s) {
    if (s.drive && s.drive.trapTried) return 0;
    const info = holdInfo(s);
    return info.trapped ? info.p : 0;
  }

  // ───────── 리바운드 ─────────
  // p 가 박스아웃 중인가: 골밑 근처에서 옆 칸의 상대보다 골대 쪽에 서 있다
  function boxingOut(s, p) {
    const rd = rimDist(p);
    if (rd > 4.5) return false;
    return s.players.some(o => o.team !== p.team && hexDist(o, p) === 1 && rimDist(o) > rd);
  }

  // 리바운드: 볼이 떨어지는 자리를 먼저 정하고, 그 자리에 가까운 선수들끼리 다툰다.
  //  · 가까이서 쏜 슛은 골대 바로 근처에, 멀리서 쏜 슛은 더 멀리 튄다 (슛 거리의 15~50%, 최대 4m)
  //  · 떨어지는 방향은 대체로 슈터의 반대편
  //  · 떨어진 자리에서 REB_REACH(3m) 넘게 떨어진 선수는 못 잡는다 (아무도 없으면 가장 가까운 선수)
  function rebound(s) {
    const reactor = s.react && s.react.moved;
    const shooter = byId(s, s.ball), sc = center(shooter.q, shooter.r);
    const shotDist = Math.hypot(sc.x - RIM.x, sc.y - RIM.y);
    const far = clamp(shotDist * (0.15 + 0.35 * rand(s)), 0.4, 4);
    const away = Math.atan2(RIM.y - sc.y, RIM.x - sc.x);              // 슈터 → 골대 방향(반대편으로 넘어가는 쪽)
    const ang = (rand(s) < 0.7 ? away : away + Math.PI) + (rand(s) - 0.5) * Math.PI * 0.9;
    const land = {
      x: clamp(RIM.x + Math.cos(ang) * far, 0.3, COURT_W - 0.3),
      y: clamp(RIM.y + Math.sin(ang) * far, 0.3, COURT_H - 0.3),
    };
    const toLand = p => { const c = center(p.q, p.r); return Math.hypot(c.x - land.x, c.y - land.y); };
    const nearest = Math.min(...s.players.map(toLand));
    const w = s.players.map(p => {
      const st = p.stats;
      const skill = st.box * 0.55 + st.height * 0.45;
      const rd = rimDist(p);
      const ld = toLand(p);
      if (ld > REB_REACH && ld > nearest + 0.01) return 0;
      const pos = 1 / Math.pow(ld + 0.7, 3);
      // 박스아웃: 상대가 나보다 골대 쪽 옆 칸을 차지하고 있으면 힘이 크게 줄어든다
      let box = 1;
      for (const o of s.players) {
        if (o.team === p.team || hexDist(o, p) !== 1 || rimDist(o) >= rd) continue;
        let f = clamp(0.45 + (st.box - o.stats.box) / 100, 0.25, 0.8);
        if (o.id === reactor) f *= 0.2;            // 슛 순간 몸으로 막아선 박스아웃은 훨씬 강하다
        box = Math.min(box, f);
      }
      const bonus = p.id === reactor && boxingOut(s, p) ? 3.5 : 1;
      return skill * pos * box * bonus * (p.team === s.offense ? 1 : 1.25);
    });
    let x = rand(s) * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < w.length; i++) { x -= w[i]; if (x <= 0) return s.players[i]; }
    return s.players[s.players.length - 1];
  }

  // ───────── 볼 처리: 보유 / 패스 / 슛 ─────────
  function toDefense(s) {
    // 3초 룰: 공격 턴을 페인트존 안에서 마친 횟수를 센다(밖에서 마치면 0으로)
    for (const p of s.players) if (p.team === s.offense) p.paint = inPaint(p) ? (p.paint || 0) + 1 : 0;
    s.mustOut = [];
    s.closeout = null;
    s.fresh = null;
    s.cut = null;
    s.drive = null;
    s.offs = {}; s.offMover = null;
    s.clock--;
    s.turnRole = 'D';
    s.phase = 'move';
    resetMoves(s);
  }

  const mustShoot = s => s.clock <= 1;
  const canDrive = s => !!(s.drive && s.drive.stage === 1 && s.drive.id === s.ball);
  // 스크린을 타서 추가 이동을 고를 수 있는 볼 없는 선수들
  const offMovers = s => Object.keys(s.offs).filter(id => s.offs[id] === 1 && id !== s.ball);
  // 추가 이동(드리블 돌파·오프볼)을 이미 썼는가 → 쓴 뒤에는 이동 단계로 못 돌아간다
  const usedExtra = s => !!(s.drive && s.drive.stage === 2) || Object.values(s.offs).includes(2);
  const noShot = s => s.clock === SHOT_CLOCK;     // 공격 첫 턴에는 슛을 쏠 수 없다

  function act(s, a) {
    const h = byId(s, s.ball);

    // 패스를 받은 직후: 바로 슛하거나 그대로 수비 턴으로 넘긴다
    // 드리블 돌파: 이동 때 수비를 제쳤거나 스크린을 탔으면 볼 처리에서 한 번 더 움직일 수 있다
    if (a.type === 'drive') {
      if (s.phase !== 'action' || !canDrive(s)) return null;
      // 수비 둘 이상에게 둘러싸인 자리에서 돌파하려면 먼저 스틸 판정을 넘겨야 한다 (한 번만 판정)
      const risk = driveRisk(s);
      if (risk > 0) {
        const info = holdInfo(s);
        if (s.drive) s.drive.trapTried = true;
        if (rand(s) < risk) {
          s.phase = 'result';
          s.result = { kind: 'steal', how: 'trap', by: info.threat, from: h.id, p: risk, next: 'change', fast: fastBreak(s) };
          return s.result;
        }
      }
      s.phase = 'drive';
      return { kind: 'drive', tried: risk > 0 ? holdInfo(s).threat : null, p: risk };
    }
    // 오프볼 스크린 추가 이동
    if (a.type === 'offMove') {
      if (s.phase !== 'action' || s.offs[a.id] !== 1) return null;
      s.phase = 'offmove';
      s.offMover = a.id;
      return { kind: 'offMove' };
    }
    if (a.type === 'driveCancel') {
      if (s.phase !== 'drive' && s.phase !== 'offmove') return null;
      s.offMover = null;
      s.phase = 'action';
      return { kind: 'driveCancel' };
    }

    if (s.phase === 'catch') {
      if (a.type === 'hold') { toDefense(s); s.fresh = s.ball; return { kind: 'hold' }; }
      if (a.type !== 'shoot') return null;
    } else if (s.phase !== 'action') return null;

    if (a.type === 'hold') {
      if (mustShoot(s)) return null;
      const info = holdInfo(s);
      if (info.p > 0 && rand(s) < info.p) {
        s.phase = 'result';
        s.result = { kind: 'steal', how: 'hold', by: info.threat, from: h.id, next: 'change', fast: fastBreak(s) };
        return s.result;
      }
      toDefense(s);
      // tried: 스틸을 시도했다가 실패한 수비 (붙은 수비가 없으면 null)
      return { kind: 'hold', tried: info.threat, p: info.p };
    }

    if (a.type === 'pass') {
      const to = byId(s, a.to);
      if (mustShoot(s) || !to || to.team !== s.offense || to.id === h.id) return null;
      // 패스가 나가는 순간 패스 길 근처의 수비 한 명이 한 칸 움직여 끊으러 갈 수 있다
      s.react = { kind: 'pass', to: to.id, moved: null, q: 0, r: 0 };
      if (!defenders(s).some(d => nearPass(s, h, to, d))) return resolvePass(s);
      s.phase = 'react';
      s.turnRole = 'D';
      return { kind: 'react' };
    }

    if (a.type === 'shoot') {
      if (noShot(s)) return null;
      // 슛을 올리는 순간 수비 한 명이 한 칸 대응한다. 판정은 resolveShot 에서.
      s.phase = 'react';
      s.turnRole = 'D';
      s.react = { kind: 'shot', moved: null, q: 0, r: 0 };
      return { kind: 'react' };
    }
    return null;
  }

  function resolvePass(s) {
    const h = byId(s, s.ball), to = byId(s, s.react.to);
    const info = passInfo(s, h, to);
    const reactor = s.react.moved;
    s.react = null;
    s.turnRole = 'O';
    if (rand(s) < info.p) {
      const thief = info.threat;
      s.phase = 'result';
      s.result = { kind: 'steal', by: thief, from: h.id, to: to.id, p: info.p, next: 'change', fast: fastBreak(s) };
      return s.result;
    }
    s.ball = to.id;
    // 받은 선수와 골대 사이에 수비가 없으면 이어서 슛까지 고를 수 있다
    if (canCatchShoot(s, to)) {
      s.phase = 'catch';
      s.cut = isCut(to) ? to.id : null;
      return { kind: 'pass', from: h.id, to: to.id, catchShoot: true };
    }
    toDefense(s);
    s.fresh = to.id;                 // 방금 패스를 받았다 → 수비 턴의 클로즈아웃 판정에 쓴다
    return { kind: 'pass', from: h.id, to: to.id };
  }

  const resolveReact = s => (s.phase !== 'react' ? null : s.react.kind === 'pass' ? resolvePass(s) : resolveShot(s));

  // ───────── 대응: 슛·패스가 나가는 순간 수비 한 명이 한 칸 ─────────
  function reactCells(s, p) {
    const out = new Map();
    if (s.phase !== 'react' || s.react.moved || p.team === s.offense) return out;
    if (s.react.kind === 'pass' && !nearPass(s, byId(s, s.ball), byId(s, s.react.to), p)) return out;
    for (const [dq, dr] of DIRS) {
      const k = key(p.q + dq, p.r + dr);
      if (cells.has(k) && !playerAt(s, p.q + dq, p.r + dr)) out.set(k, cells.get(k));
    }
    return out;
  }

  // 그 칸으로 대응하면 슛 성공률이 얼마가 되는지, 박스아웃이 되는지 (화면 표시용)
  function reactPreview(s, p, q, r) {
    const oq = p.q, or = p.r;
    p.q = q; p.r = r;
    const keep = s.react;
    s.react = { ...keep, moved: p.id, q: oq, r: or };
    const out = keep.kind === 'pass'
      ? { p: passInfo(s, byId(s, s.ball), byId(s, keep.to)).p, box: false }
      : { p: shotInfo(s, byId(s, s.ball)).p, box: boxingOut(s, p) };
    s.react = keep;
    p.q = oq; p.r = or;
    return out;
  }

  function reactMove(s, id, q, r) {
    const p = byId(s, id);
    if (!p || !reactCells(s, p).has(key(q, r))) return false;
    s.react = { ...s.react, moved: id, q: p.q, r: p.r };
    p.q = q; p.r = r;
    return true;
  }

  function reactUndo(s) {
    if (s.phase !== 'react' || !s.react.moved) return false;
    const p = byId(s, s.react.moved);
    p.q = s.react.q; p.r = s.react.r;
    s.react = { ...s.react, moved: null };
    return true;
  }

  function resolveShot(s) {
    if (s.phase !== 'react') return null;
    for (const p of s.players) p.paint = 0;                   // 슛이 올라가면 3초는 다시 센다
    s.mustOut = [];
    const h = byId(s, s.ball);
    const info = shotInfo(s, h);
    const reactor = s.react.moved && byId(s, s.react.moved);
    s.phase = 'result';
    if (rand(s) < info.p) {
      s.score[s.offense] += info.pts;
      s.result = { kind: 'made', by: h.id, pts: info.pts, p: info.p, cut: info.cut, next: 'change' };
    } else {
      const rb = rebound(s);
      const off = rb.team === s.offense;
      s.ball = rb.id;
      if (off) s.clock = REBOUND_CLOCK;
      s.result = { kind: 'miss', by: h.id, p: info.p, reb: rb.id, offReb: off, next: off ? 'defense' : 'change',
        boxOut: !!(reactor && boxingOut(s, reactor)) };
    }
    return s.result;
  }

  // 결과 확인 뒤 다음으로: 공수 교대 또는 수비 턴
  // 속공: 스틸이 났을 때 하프라인 쪽(FAST_LINE 바깥)에 있는 선수를 센다.
  // 뺏은 팀이 FAST_EDGE(2명) 이상 많으면(3:1, 2:0 …) 속공 득점. 해당 없으면 null.
  function fastBreak(s) {
    const up = p => center(p.q, p.r).y >= FAST_LINE;
    const run = s.players.filter(p => p.team !== s.offense && up(p));
    const back = s.players.filter(p => p.team === s.offense && up(p));
    if (run.length - back.length < FAST_EDGE) return null;
    return { run: run.map(p => p.id), back: back.map(p => p.id) };
  }

  // 속공 득점 장면: 달린 선수들을 하프라인 앞에 세우고 2점. 그 뒤 볼을 뺏겼던 팀이 다시 공격한다.
  function runFastBreak(s, fast, thief) {
    const team = other(s.offense);
    const spots = [[6, 13], [5, 13], [7, 13], [4, 13], [8, 13]];
    fast.run.forEach((id, i) => {
      const p = byId(s, id), q = colToQ(spots[i][0], spots[i][1]), r = spots[i][1];
      const occ = playerAt(s, q, r);
      if (occ && occ.id !== id) { occ.q = p.q; occ.r = p.r; }     // 그 자리에 있던 선수와 자리를 바꾼다
      p.q = q; p.r = r;
    });
    s.offense = team;
    s.turnRole = 'O';
    s.ball = fast.run.includes(thief) ? thief : fast.run[0];
    s.poss[team]++;
    s.score[team] += 2;
    s.result = { kind: 'fast', team, run: fast.run, back: fast.back, pts: 2, next: 'change' };
  }

  const winner = s => (s.score.A >= WIN_SCORE ? 'A' : s.score.B >= WIN_SCORE ? 'B' : null);

  function proceed(s) {
    if (s.phase !== 'result') return;
    if (s.result.kind === 'steal' && s.result.fast) {
      const { fast, by } = s.result;
      s.react = null; s.cut = null; s.drive = null; s.offs = {}; s.offMover = null;
      runFastBreak(s, fast, by);
      return;
    }
    const next = s.result.next;
    s.result = null;
    s.react = null;
    s.cut = null;
    s.drive = null;
    s.offs = {}; s.offMover = null;
    if (next === 'defense') {
      s.turnRole = 'D';
      s.phase = 'move';
      resetMoves(s);
      return;
    }
    const team = other(s.offense);
    if (winner(s)) { s.phase = 'over'; return; }
    startPossession(s, team);
  }

  return {
    COURT_W, COURT_H, RIM, HEX_W, HEX_S, MAX_MOVES, SHOT_CLOCK, WIN_SCORE, winner,
    POS, STATS, FORMATIONS, cells, key, center, hexDist, other,
    newGame, byId, playerAt, movingTeam, moveRange, reachable, canMove,
    move, undo, endMoves, backToMoves, shotInfo, passInfo, holdInfo, driveRisk, mustShoot, noShot, laneClear, canCatchShoot, isCut, driveAt, canDrive, offMovers, usedExtra, chaseDef, DRIVE_EDGE, DRIVE_MOVE, act, proceed,
    slowed, screens, screenCells, closeKind, trailing, sealed, inPaint, mustLeave, PAINT_LIMIT, guarded, canEnd, fastBreak, reactCells, reactPreview, reactMove, reactUndo, resolveShot, resolveReact, nearPass,
    MOVE, TUNE, buildCost, validBuild, moveFor, applyBuild,
  };
})();

if (typeof module !== 'undefined') module.exports = Rules;
