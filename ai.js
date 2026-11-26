/* 농구오목 — AI. 규칙(rules.js)만 써서 다음 한 수를 고른다. 화면과 무관하다. */
const AI = (() => {
  'use strict';
  const R = typeof Rules !== 'undefined' ? Rules : require('./rules.js');

  const TURNOVER = 1.0;      // 볼을 뺏길 때의 손해(점)
  const KEEP = 0.7;          // 볼을 지킨 채 다음 턴으로 넘어갔을 때의 기대 점수

  const rimDist = p => { const c = R.center(p.q, p.r); return Math.hypot(c.x - R.RIM.x, c.y - R.RIM.y); };
  // 슛의 기대 점수. 3점 라인에서 한참 떨어진 딥쓰리는 실제 확률보다 더 낮게 쳐서 고르지 않게 한다
  const DEEP = 7.5;
  const shotEV = (s, p) => {
    const i = R.shotInfo(s, p);
    return i.p * i.pts * Math.max(0.2, 1 - 0.45 * Math.max(0, i.dist - DEEP));
  };
  const mates = s => s.players.filter(p => p.team === s.offense && p.id !== s.ball);

  // ───────── 작전: 공격할 때마다 하나를 골라 그 방향으로 움직인다 ─────────
  //  zone    거리별 슛을 얼마나 좋게 볼지 (골밑·미들·3점)
  //  focus   주로 해결할 선수 번호 (그 선수의 슛과 그 선수에게 가는 패스를 더 좋게 본다)
  //  screen  screeners 가 볼 가진 선수의 수비에게 스크린을 걸러 가는 정도
  //  drive   볼 가진 선수가 수비를 제치는 자리를 노리는 정도
  //  cut     cutters 가 골대 쪽으로 파고드는 정도
  //  spots   선수별로 자리 잡을 곳 [열, 줄]
  //  clear   해결할 선수 주변을 비워 주는 정도
  //  bar     슛을 고르는 기준을 올리거나(+) 내림(-)
  const PLAYS = [
    { key: 'pnr', name: '픽앤롤', zone: { inside: 1.2, mid: 1, three: 1 }, focus: [1], screen: 0.45, screeners: [4, 5], drive: 0.25,
      spots: { 2: [11, 5], 3: [1, 5] }, bar: 0 },
    { key: 'highlow', name: '하이로우', zone: { inside: 1.45, mid: 1, three: 0.75 }, focus: [5, 4],
      spots: { 4: [6, 5], 5: [4, 3], 2: [10, 7], 3: [2, 7] }, bar: 0.05 },
    { key: 'three', name: '외곽 슛', zone: { inside: 0.85, mid: 0.9, three: 1.3 }, focus: [2, 3], screen: 0.25, screeners: [4],
      spots: { 5: [8, 3], 2: [10, 7], 3: [2, 7] }, bar: -0.1 },
    { key: 'cut', name: '컷인', zone: { inside: 1.35, mid: 1, three: 0.85 }, focus: [2, 3], cut: 0.35, cutters: [2, 3],
      spots: { 4: [6, 6], 5: [10, 4] }, bar: 0 },
    { key: 'iso', name: '1대1 돌파', zone: { inside: 1.25, mid: 1.1, three: 0.9 }, focus: [1], drive: 0.4, clear: 0.05, bar: 0 },
    { key: 'iso2', name: '윙 1대1', zone: { inside: 1.2, mid: 1.15, three: 0.95 }, focus: [2], drive: 0.4, clear: 0.05,
      spots: { 5: [4, 3], 4: [3, 6] }, bar: 0 },
    { key: 'post', name: '포스트업', zone: { inside: 1.5, mid: 0.9, three: 0.75 }, focus: [5],
      spots: { 5: [5, 2], 4: [9, 5], 2: [11, 5], 3: [2, 7] }, bar: 0.05 },
  ];
  let plan = { k: null, play: PLAYS[0] };

  // 이번 공격의 작전. 공격이 바뀔 때마다 직전과 다른 것을 무작위로 고른다.
  function planFor(s) {
    const k = s.offense + ':' + s.poss[s.offense];
    if (plan.k !== k) {
      const pool = PLAYS.filter(p => p !== plan.play);
      plan = { k, play: pool[Math.floor(Math.random() * pool.length)] };
    }
    return plan.play;
  }
  const playName = s => planFor(s).name;

  const colToQ = (col, r) => col - (r + (r & 1)) / 2;
  const spotOf = (pl, p) => { const sp = pl.spots && pl.spots[p.num]; return sp ? { q: colToQ(sp[0], sp[1]), r: sp[1] } : null; };
  const isFocus = (pl, p) => !!(pl && pl.focus && pl.focus.includes(p.num));

  // 작전을 반영한 슛의 가치
  const playEV = (s, p, pl) => {
    const i = R.shotInfo(s, p);
    let v = i.p * i.pts * Math.max(0.2, 1 - 0.45 * Math.max(0, i.dist - DEEP));
    if (pl) v *= pl.zone[i.zone] * (isFocus(pl, p) ? 1.2 : 1);
    return v;
  };

  // 선수를 잠깐 다른 칸에 놓고 계산한 뒤 되돌린다
  function at(p, q, r, fn) {
    const oq = p.q, or = p.r;
    p.q = q; p.r = r;
    const v = fn();
    p.q = oq; p.r = or;
    return v;
  }

  // 패스가 끊길 확률을 수비의 대응까지 넣어 본다: 패스 길 근처의 수비가 가장 좋은 칸으로 한 칸 뛰어들었을 때의 값
  const NEAR = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];
  function passRisk(s, h, m) {
    let worst = R.passInfo(s, h, m).p;
    const keep = s.react;
    for (const d of s.players) {
      if (d.team === s.offense || !R.nearPass(s, h, m, d)) continue;
      const oq = d.q, or = d.r;
      for (const [dq, dr] of NEAR) {
        const q = oq + dq, r = or + dr;
        if (!R.cells.has(R.key(q, r)) || R.playerAt(s, q, r)) continue;
        d.q = q; d.r = r;
        s.react = { kind: 'pass', to: m.id, moved: d.id, q: oq, r: or };
        worst = Math.max(worst, R.passInfo(s, h, m).p);
      }
      d.q = oq; d.r = or;
    }
    s.react = keep;
    // 수비가 늘 가장 좋은 칸으로 뛰어드는 것은 아니므로 지금 값과 최악의 값을 섞는다
    return 0.4 * R.passInfo(s, h, m).p + 0.6 * worst;
  }

  // 이동을 따질 때 쓰는 빠른 어림: 골밑으로 넣는 패스는 길 근처에 수비가 있으면 끊길 위험을 크게 본다
  function quickRisk(s, h, m) {
    const p = R.passInfo(s, h, m).p;
    if (rimDist(m) > 3.5) return Math.min(0.9, p + 0.08);
    return s.players.some(d => d.team !== s.offense && R.nearPass(s, h, m, d)) ? Math.max(p, 0.35) : p;
  }

  // 공격이 지금 배치에서 낼 수 있는 기대 점수. 공격은 키우려 하고 수비는 줄이려 한다.
  function threat(s, pl) {
    const h = R.byId(s, s.ball);
    const evH = playEV(s, h, pl);
    const recv = mates(s)
      .map(m => (1 - quickRisk(s, h, m)) * playEV(s, m, pl) * (R.laneClear(s, m) ? 1 : 0.75))
      .sort((a, b) => b - a);
    let v = Math.max(evH, 0.9 * recv[0]) + 0.25 * recv[1] + 0.1 * Math.min(evH, recv[0]);
    // 볼 가진 선수 앞이 비어 있으면 골대에 가까울수록 위험하다
    if (R.laneClear(s, h)) v += 0.25 * Math.max(0, 1 - rimDist(h) / 8);
    return v;
  }

  // ───────── 이동 단계: 가장 이득인 한 걸음 (없으면 null → 이동 끝) ─────────
  function nextMove(s) {
    const offense = R.movingTeam(s) === s.offense;
    const sign = offense ? 1 : -1;
    const pl = offense ? planFor(s) : null;
    const h0 = R.byId(s, s.ball);
    // 3초 룰: 페인트존에서 나가야 하는 선수부터 밖으로 뺀다
    if (offense) {
      const out = R.mustLeave(s).find(p => R.canMove(s, p));
      if (out) {
        let pick = null;
        for (const c of R.reachable(s, out).values()) {
          if (R.inPaint(c)) continue;
          const v = at(out, c.q, c.r, () => threat(s, pl));
          if (!pick || v > pick.v) pick = { id: out.id, q: c.q, r: c.r, v };
        }
        if (pick) return pick;
      }
    }
    const base = threat(s, pl) * sign;
    let best = null;
    for (const p of s.players) {
      if (!R.canMove(s, p)) continue;
      const mustOut = offense && (s.mustOut || []).includes(p.id);       // 3초 룰로 나가야 하는 선수
      for (const c of R.reachable(s, p).values()) {
        if (mustOut && R.inPaint(c)) continue;                            // 페인트존 안에서 맴돌지 않는다
        let v = at(p, c.q, c.r, () => threat(s, pl)) * sign;
        if (offense) {
          if (R.driveAt(s, p, c.q, c.r)) v += 0.15 + (p.id === s.ball ? (pl.drive || 0) : 0);   // 추가 이동이 생기는 자리
          if (p.id !== s.ball) {
            // 스크린: 볼 가진 선수 근처의 수비 옆에 가서 선다
            if (pl.screen && pl.screeners.includes(p.num)) {
              const on = x => s.players.some(d => d.team !== s.offense && R.hexDist(d, h0) <= 2 && R.hexDist(d, x) === 1);
              if (on(c) && !on(p)) v += pl.screen;
              else if (on(p) && !on(c)) v -= pl.screen;                   // 걸어 둔 스크린은 풀지 않는다
            }
            // 컷인: 골대 쪽으로 파고든다
            if (pl.cut && pl.cutters.includes(p.num)) v += pl.cut * (rimDist(p) - rimDist(c)) / 3;
            // 자리 잡기
            const spot = spotOf(pl, p);
            if (spot) v += 0.06 * (R.hexDist(p, spot) - R.hexDist(c, spot));
            // 해결할 선수 주변 비워 주기
            if (pl.clear && isFocus(pl, h0)) v += pl.clear * (Math.min(4, R.hexDist(c, h0)) - Math.min(4, R.hexDist(p, h0)));
          }
          v += (Math.random() - 0.5) * 0.05;                              // 같은 값이면 매번 다르게
          if (mates(s).some(m => m.id !== p.id && R.hexDist(m, c) === 1)) v -= 0.04;   // 뭉치지 않기
          if (p.id === s.ball) v -= 0.3 * at(p, c.q, c.r, () => R.holdInfo(s).p);       // 수비 틈으로 들어가지 않기
        }
        if (!offense) {
          // 멀리서 달려들 때: 옆 칸까지 붙으면 옆으로 뚫리므로 조금 꺼리고, 2칸 거리는 조금 선호한다
          const kd = R.closeKind(s, p, c.q, c.r);
          if (kd === 'shot') v -= 0.12; else if (kd === 'drive') v += 0.04;
        }
        if (!best || v > best.v) best = { id: p.id, q: c.q, r: c.r, v };
      }
    }
    if (!best) return null;
    // 턴마다 한 명은 움직여야 한다. 그 뒤로는 나아질 때만 더 움직인다.
    if (s.history.length === 0 || best.v > base + 0.02) return best;
    return null;
  }

  // 추가 이동(드리블 돌파 / 오프볼 스크린)으로 갈 가장 좋은 칸
  function extraBest(s, id, phase) {
    const keepPhase = s.phase, keepMover = s.offMover;
    s.phase = phase; s.offMover = phase === 'offmove' ? id : null;
    const p = R.byId(s, id), h = R.byId(s, s.ball);
    let best = null;
    for (const c of R.reachable(s, p).values()) {
      const v = at(p, c.q, c.r, () => (id === s.ball
        ? shotEV(s, p) - 0.07 * 2
        : (1 - R.passInfo(s, h, p).p) * shotEV(s, p) * (R.laneClear(s, p) ? 1.15 : 0.8)));
      if (!best || v > best.v) best = { q: c.q, r: c.r, v };
    }
    s.phase = keepPhase; s.offMover = keepMover;
    return best;
  }

  // 추가 이동 중: 갈 칸
  function extraCell(s) {
    return s.phase === 'drive' ? extraBest(s, s.ball, 'drive') : extraBest(s, s.offMover, 'offmove');
  }

  // 남은 턴이 많을수록 더 좋은 슛을 기다린다
  const shotBar = s => 0.55 + 0.1 * (s.clock - 1) + (planFor(s).bar || 0);

  // ───────── 볼 처리: 보유 / 패스 / 슛 / 추가 이동 ─────────
  function decide(s) {
    const h = R.byId(s, s.ball);
    const evS = R.noShot(s) ? -1 : shotEV(s, h) + 0.15 * (1 - R.shotInfo(s, h).p);

    if (s.phase === 'catch') return { type: evS >= shotBar(s) - 0.15 ? 'shoot' : 'hold' };
    if (R.mustShoot(s)) return { type: 'shoot' };

    // 추가 이동을 쓸 수 있으면 먼저 쓴다
    if (R.canDrive(s)) {
      const b = extraBest(s, s.ball, 'drive');
      if (b && b.v > shotEV(s, h) + 0.05 && R.driveRisk(s) < 0.3) return { type: 'drive' };   // 둘러싸여 뺏길 위험이 크면 돌파하지 않는다
    }
    for (const id of R.offMovers(s)) {
      const p = R.byId(s, id);
      const now = (1 - R.passInfo(s, h, p).p) * shotEV(s, p);
      const b = extraBest(s, id, 'offmove');
      if (b && b.v > now + 0.05) return { type: 'offMove', id };
    }

    if (evS >= shotBar(s)) return { type: 'shoot' };

    const hold = R.holdInfo(s).p;
    const pl = planFor(s);
    // 해결할 선수가 볼을 갖고 있으면 조금 더 끌고 간다
    let best = { type: 'hold', v: (1 - hold) * KEEP * (isFocus(pl, h) ? 1.1 : 1) - hold * TURNOVER };
    for (const m of mates(s)) {
      const risk = passRisk(s, h, m);
      const evM = shotEV(s, m);
      let gain = R.canCatchShoot(s, m) ? Math.max(evM, KEEP) : KEEP + 0.3 * (evM - shotEV(s, h));
      if (isFocus(pl, m)) gain *= 1.2;                                    // 해결할 선수에게 볼을 준다
      const v = (1 - risk) * gain - risk * TURNOVER + (Math.random() - 0.5) * 0.04;
      if (v > best.v) best = { type: 'pass', to: m.id, v };
    }
    // 보유도 패스도 위험하면 그냥 쏜다
    if (!R.noShot(s) && evS > best.v) return { type: 'shoot' };
    return best.type === 'pass' ? { type: 'pass', to: best.to } : { type: 'hold' };
  }

  // ───────── 대응(수비): 슛·패스가 나가는 순간 한 명을 한 칸 (없으면 null → 그대로 판정) ─────────
  function react(s) {
    const h = R.byId(s, s.ball);
    const pass = s.react.kind === 'pass';
    const info = pass ? null : R.shotInfo(s, h);
    const value = pv => (pass ? pv.p : -pv.p * info.pts + (pv.box ? 0.3 * (1 - pv.p) : 0));
    const base = pass ? R.passInfo(s, h, R.byId(s, s.react.to)).p : -info.p * info.pts;
    let best = null;
    for (const p of s.players) {
      for (const c of R.reactCells(s, p).values()) {
        const v = value(R.reactPreview(s, p, c.q, c.r));
        if (!best || v > best.v) best = { id: p.id, q: c.q, r: c.r, v };
      }
    }
    return best && best.v > base + 0.005 ? best : null;
  }

  return { nextMove, decide, extraCell, react, threat, playName, PLAYS };
})();

if (typeof module !== 'undefined') module.exports = AI;
