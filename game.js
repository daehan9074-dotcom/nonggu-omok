/* 농구오목 — 화면. 규칙은 rules.js 가 맡고 여기서는 그리기와 입력만 한다. */
(() => {
  'use strict';
  const R = Rules;
  const { COURT_W, COURT_H, RIM, HEX_W, HEX_S } = R;
  const PAD = 0.5;
  const TEAM = {
    A: { name: '주황', color: '#e4572e' },
    B: { name: '파랑', color: '#22446f' },
  };

  let S = null;                         // 경기 상태
  const formation = { A: 'z23', B: 'z23' };
  const view = { selected: null, reach: null, passOpts: null, locked: false };
  let mode = 'pvp';                     // 'pvp' 둘이 번갈아 / 'ai' 파랑 팀을 AI가
  let aiTimer = null;
  const disp = {};                      // 선수별 화면 표시 위치(이동 애니메이션)
  const ballDisp = { x: 0, y: 0 };

  // ───────── 요소 ─────────
  const $ = id => document.getElementById(id);
  const canvas = $('court'), ctx = canvas.getContext('2d'), stage = $('stage');
  const elPhase = $('phase'), elPips = $('pips'), elClock = $('clock');
  const elScoreA = $('scoreA'), elScoreB = $('scoreB'), elPoss = $('poss');
  const elHint = $('hint'), elBar = $('bar');
  const elOverlay = $('overlay'), elOvTitle = $('ovTitle'), elOvSub = $('ovSub'), elOvBtn = $('ovBtn');

  let k = 30, cssW = 0, cssH = 0;
  let flipped = false;                  // 수비하는 쪽이 볼 때는 코트를 돌려 골대가 앞(아래)으로 온다

  // ───────── 시점: 하프라인 뒤 높은 곳에서 약 50도로 내려다본다 ─────────
  // 코트 좌표는 x 가로, y 엔드라인에서의 거리, z 높이 (단위 m)
  const CAM = { x: 7.5, y: 24.5, z: 23 }, LOOK = { x: 7.5, y: 6.7, z: 0 };
  // 기준 화면(가로 900)에서 코트가 차지하는 세로 범위: 백보드 윗변(약 36) ~ 가까운 쪽 라인(약 722).
  // 바깥 여백은 화면 밖으로 잘려도 되므로 이 범위만 딱 맞게 채운다.
  const VIEW_TOP = 30, VIEW_BOTTOM = 728, VIEW_H = VIEW_BOTTOM - VIEW_TOP, VIEW_W = 884;
  const v3 = {
    sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }),
    dot: (a, b) => a.x * b.x + a.y * b.y + a.z * b.z,
    cross: (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }),
    norm: a => { const l = Math.hypot(a.x, a.y, a.z); return { x: a.x / l, y: a.y / l, z: a.z / l }; },
  };
  const VFWD = v3.norm(v3.sub(LOOK, CAM)), VRIGHT = v3.norm(v3.cross({ x: 0, y: 0, z: 1 }, VFWD)), VUP = v3.cross(VFWD, VRIGHT);
  let VF = 1470, VCX = 450, VCY = 376;  // 초점 거리와 화면 중심(캔버스 크기에 맞춰 resize 에서 다시 잡는다)

  // 코트의 한 점 → 화면 위치와 그 자리의 배율(1m 가 몇 픽셀인가)
  function proj(x, y, z = 0) {
    if (flipped) { x = COURT_W - x; y = COURT_H - y; }     // 코트를 반 바퀴 돌려서 본다
    const d = v3.sub({ x, y, z }, CAM), zc = v3.dot(d, VFWD);
    return { x: VCX + VF * v3.dot(d, VRIGHT) / zc, y: VCY - VF * v3.dot(d, VUP) / zc, s: VF / zc };
  }
  const toScreen = (x, y) => { const p = proj(x, y, 0); return [p.x, p.y]; };
  // 화면의 한 점 → 바닥(z=0) 위의 코트 좌표
  const toCourt = (sx, sy) => {
    const a = (sx - VCX) / VF, b = (VCY - sy) / VF;
    const d = { x: VFWD.x + VRIGHT.x * a + VUP.x * b, y: VFWD.y + VRIGHT.y * a + VUP.y * b, z: VFWD.z + VRIGHT.z * a + VUP.z * b };
    const t = -CAM.z / d.z;
    const x = CAM.x + d.x * t, y = CAM.y + d.y * t;
    return flipped ? [COURT_W - x, COURT_H - y] : [x, y];
  };

  // 화면 방향: 가로면 가로 배치. 터치 폰을 세로로 들고 있으면 화면 전체를 90도 돌려 가로 배치로 보여 준다
  let rotated = false;
  function orient() {
    const w = window.innerWidth, h = window.innerHeight;
    const touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    rotated = h > w && touch;
    const root = document.documentElement;
    root.classList.toggle('rot', rotated);
    root.classList.toggle('land', w > h || rotated);
    root.style.setProperty('--scrW', w + 'px');
    root.style.setProperty('--scrH', h + 'px');
  }
  orient();
  // 화면에서 누른 자리 → 그 요소 안의 자리 (화면을 돌렸으면 되돌려서)
  function localPoint(e, el) {
    const r = el.getBoundingClientRect();
    return rotated ? [e.clientY - r.top, r.right - e.clientX] : [e.clientX - r.left, e.clientY - r.top];
  }

  function resize() {
    orient();
    cssW = Math.max(120, Math.floor(stage.clientWidth));
    cssH = Math.max(120, Math.floor(stage.clientHeight));
    const fit = Math.min(cssW / VIEW_W, cssH / VIEW_H);    // 가로·세로 중 빠듯한 쪽에 코트를 맞춘다
    VF = 1470 * fit; VCX = cssW / 2; VCY = cssH / 2 + (376 - (VIEW_TOP + VIEW_BOTTOM) / 2) * fit;
    k = proj(7.5, 8).s;                 // 코트 가운데쯤의 배율(글자 크기 등에 쓴다)
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (S) draw();
  }

  const label = p => `${TEAM[p.team].name} ${p.num}번`;
  const pct = v => Math.round(v * 100) + '%';

  // ───────── 상태 → 화면 ─────────
  function snap() {
    for (const p of S.players) disp[p.id] = R.center(p.q, p.r);
    const b = disp[S.ball];
    ballDisp.x = b.x; ballDisp.y = b.y;
  }

  // 상태가 바뀐 뒤 부른다. 코트 방향이 바뀌거나 배치가 새로 깔리면 잠깐 가렸다가 보여 준다.
  function refresh(forceSnap) {
    // 수비하는 쪽이 볼 때는 골대가 아래로. AI 대전에서는 사람(주황) 기준으로 공격 내내 고정한다
    const want = mode === 'ai' ? S.offense !== HUMAN : S.turnRole === 'D';
    if (want !== flipped || forceSnap) {
      view.locked = true;
      canvas.classList.add('fading');
      setTimeout(() => {
        flipped = want;
        snap();
        syncUi();
        draw();
        canvas.classList.remove('fading');
        view.locked = false;
      }, 170);
    } else {
      syncUi();
      requestDraw();
    }
  }

  function select(p) {
    view.selected = p ? p.id : null;
    const react = S.phase === 'react';
    view.reach = p ? (react ? R.reactCells(S, p) : R.reachable(S, p)) : null;
    view.costly = p && !react ? R.screenCells(S, p) : null;
    // 볼 가진 선수: 그리로 가면 수비를 제치고 한 번 더 움직이게 되는 칸
    view.driveCells = p && !react && S.phase === 'move' && p.team === S.offense
      ? new Set([...view.reach.values()].filter(c => R.driveAt(S, p, c.q, c.r)).map(c => R.key(c.q, c.r)))
      : null;
    // 클로즈아웃: 패스 받은 선수에게 멀리서 달려갈 때 옆 칸은 슛견제, 2칸 거리는 돌파견제
    view.closeCells = null;
    if (p && !react && S.phase === 'move' && p.team !== S.offense) {
      const m = new Map();
      for (const c of view.reach.values()) { const kd = R.closeKind(S, p, c.q, c.r); if (kd) m.set(R.key(c.q, c.r), kd); }
      if (m.size) view.closeCells = m;
    }
    // 슛 대응: 칸마다 그리로 가면 슛 성공률이 얼마가 되는지, 박스아웃이 되는지
    view.preview = p && react
      ? new Map([...view.reach.values()].map(c => [R.key(c.q, c.r), R.reactPreview(S, p, c.q, c.r)]))
      : null;
    syncHint();
    requestDraw();
  }

  // 패스 대응 중 끊으러 갈 수 있는 수비: id → 가장 좋은 칸으로 갔을 때의 스틸 확률
  function findReactors() {
    view.reactors = null;
    if (S.phase !== 'react' || S.react.kind !== 'pass' || S.react.moved) return;
    view.reactors = new Map();
    for (const p of S.players) {
      const cells = R.reactCells(S, p);
      if (!cells.size) continue;
      let best = 0;
      for (const c of cells.values()) best = Math.max(best, R.reactPreview(S, p, c.q, c.r).p);
      view.reactors.set(p.id, best);
    }
  }

  // ───────── 리플레이 ─────────
  // 한 번의 공격 동안 선수 위치와 볼이 바뀔 때마다 한 장면씩 남겨 두었다가, 득점하면 다시 돌려 볼 수 있다.
  const tape = { poss: -1, frames: [] };
  const REPLAY_STEP = 520, REPLAY_MAX = 40;

  function recordFrame() {
    if (view.replay || S.phase === 'result' || S.phase === 'over') return;
    const poss = S.poss.A + S.poss.B;
    if (tape.poss !== poss) { tape.poss = poss; tape.frames = []; }
    const p = {};
    for (const x of S.players) p[x.id] = { q: x.q, r: x.r };
    const key = S.ball + '|' + S.players.map(x => x.q + ',' + x.r).join(';');
    const last = tape.frames[tape.frames.length - 1];
    if (last && last.key === key) return;
    tape.frames.push({ key, p, ball: S.ball });
    if (tape.frames.length > REPLAY_MAX) tape.frames.shift();
  }

  function startReplay() {
    if (view.replay || !view.shot || tape.frames.length < 2) return;
    const from = view.shot.from, shooter = view.shot.by;
    view.shot = null;
    view.locked = true;
    view.replay = { i: 0, cur: tape.frames[0] };
    elOverlay.hidden = true;
    // 첫 장면은 바로 그 자리에 놓고 시작한다
    for (const x of S.players) disp[x.id] = R.center(view.replay.cur.p[x.id].q, view.replay.cur.p[x.id].r);
    const b = disp[view.replay.cur.ball]; ballDisp.x = b.x; ballDisp.y = b.y;
    elHint.textContent = '리플레이 중…';
    requestDraw();
    const timer = setInterval(() => {
      const rp = view.replay;
      if (!rp) { clearInterval(timer); return; }
      rp.i++;
      if (rp.i < tape.frames.length) { rp.cur = tape.frames[rp.i]; requestDraw(); return; }
      clearInterval(timer);
      view.replay = null;
      startShot(from, { kind: 'made', by: shooter });   // 마지막은 슛이 날아가 들어가는 장면
    }, REPLAY_STEP);
  }

  function syncUi() {
    recordFrame();
    findReactors();
    const team = R.movingTeam(S);
    const off = S.turnRole === 'O';
    elPhase.textContent = `${TEAM[team].name} ${S.phase === 'react' ? (S.react.kind === 'pass' ? '패스 대응' : '슛 대응') : off ? '공격' : '수비'}`;
    elPhase.className = team === 'A' ? 'teamA' : 'teamB';
    elScoreA.textContent = S.score.A;
    elScoreB.textContent = S.score.B;
    elPoss.textContent = `${R.WIN_SCORE}점 선승`;
    elClock.textContent = `남은 공격 ${S.clock}턴`;
    elClock.classList.toggle('last', R.mustShoot(S));

    elPips.innerHTML = '';
    const react = S.phase === 'react';
    const pipN = react ? 1 : R.MAX_MOVES, pipLeft = react ? (S.react.moved ? 0 : 1) : S.movesLeft;
    for (let i = 0; i < pipN; i++) {
      const pip = document.createElement('i');
      if (i >= pipLeft) pip.className = 'used';
      elPips.appendChild(pip);
    }
    syncBar();
    syncHint();
    syncOverlay();
    aiSchedule();
  }

  function syncBar() {
    const btn = (act, text, cls, disabled) =>
      `<button data-act="${act}" class="${cls}"${disabled ? ' disabled' : ''}>${text}</button>`;
    let html = '';
    if (S.phase === 'move') {
      html += btn('undo', '되돌리기', 'ghost', S.history.length === 0);
      html += btn('end', S.turnRole === 'O' ? '이동 끝 · 볼 처리' : '수비 턴 종료', 'primary', !R.canEnd(S));
    } else if (S.phase === 'action' && !view.passOpts) {
      const info = R.shotInfo(S, R.byId(S, S.ball));
      const last = R.mustShoot(S);
      // 추가 이동 버튼 줄: 드리블 돌파(볼 가진 선수) · 스크린 추가 이동(볼 없는 선수)
      let extras = '';
      if (R.canDrive(S)) {
        const risk = R.driveRisk(S);       // 둘러싸인 채 돌파하면 먼저 스틸 판정
        extras += btn('drive', risk > 0 ? `드리블 돌파<small>둘러싸임 · 스틸 ${pct(risk)}</small>` : '드리블 돌파', 'drive');
      }
      for (const id of R.offMovers(S)) {
        extras += `<button data-act="off" data-id="${id}" class="drive">${R.byId(S, id).num}번 스크린 추가 이동</button>`;
      }
      if (extras) html += `<div class="extras">${extras}</div>`;
      if (!R.usedExtra(S)) html += btn('back', '이동 다시', 'ghost small');   // 추가 이동을 쓴 뒤에는 못 돌아간다
      const hold = R.holdInfo(S);
      html += btn('hold', hold.p > 0 ? `보유<small>${hold.trapped ? '둘러싸임 · ' : ''}스틸 ${pct(hold.p)}</small>` : '보유', 'ghost', last);
      html += btn('pass', '패스', 'ghost', last);
      html += R.noShot(S)
        ? btn('shoot', '슛<small>첫 턴 불가</small>', 'shoot', true)
        : btn('shoot', `슛 ${pct(info.p)}<small>${info.pts}점</small>`, 'shoot');
    } else if (S.phase === 'action') {
      html += btn('passCancel', '패스 취소', 'ghost');
    } else if (S.phase === 'drive' || S.phase === 'offmove') {
      html += btn('driveCancel', S.phase === 'drive' ? '돌파 취소' : '추가 이동 취소', 'ghost');
    } else if (S.phase === 'catch') {
      const info = R.shotInfo(S, R.byId(S, S.ball));
      html += btn('hold', '슛 안 함<small>수비 턴으로</small>', 'ghost');
      html += btn('shoot', `${info.cut ? '컷인 슛' : '바로 슛'} ${pct(info.p)}<small>${info.pts}점</small>`, 'shoot');
    } else if (S.phase === 'react') {
      html += btn('reactUndo', '되돌리기', 'ghost', !S.react.moved);
      if (S.react.kind === 'pass') {
        const info = R.passInfo(S, R.byId(S, S.ball), R.byId(S, S.react.to));
        html += btn('resolve', `${S.react.moved ? '패스 판정' : '그대로 패스 판정'}<small>스틸 ${pct(info.p)}</small>`, 'primary');
      } else {
        const info = R.shotInfo(S, R.byId(S, S.ball));
        html += btn('resolve', `${S.react.moved ? '슛 판정' : '그대로 슛 판정'}<small>성공률 ${pct(info.p)}</small>`, 'primary');
      }
    }
    if (aiTurn()) html = '<button class="ghost" disabled>AI 차례</button>';
    elBar.className = S.offense === 'A' ? 'teamA' : 'teamB';     // 슛 버튼을 공격 팀 색으로
    elBar.innerHTML = html;
  }

  const DRIVE_MSG = { drive: '수비를 제쳤습니다', screen: '스크린으로 수비를 떼어냈습니다', closeout: '달려든 수비를 옆으로 따돌렸습니다' };

  function syncHint() {
    let t = '';
    if (aiTurn()) {
      // AI가 공격할 때는 이번에 쓰는 작전 이름을 보여 준다
      const play = S.offense === AI_TEAM ? `AI 작전: ${AI.playName(S)} · ` : '';
      elHint.textContent = play + (AI_HINT[S.phase] || 'AI가 생각하는 중…');
      return;
    }
    if (S.phase === 'move') {
      const sel = view.selected && R.byId(S, view.selected);
      if (sel) {
        t = `${label(sel)} · ${R.POS[sel.num]} · 이동력 ${R.moveRange(S, sel)}`;
        if (view.driveCells && view.driveCells.size) {
          t += sel.id === S.ball ? ' · 노란 칸으로 가면 볼 처리 때 드리블 돌파 가능' : ' · 노란 칸으로 가면 스크린을 타서 볼 처리 때 추가 이동 가능';
        }
        if (R.guarded(S, sel)) t += ' · 가까운 수비나 옆에 붙은 동료의 뒤쪽 공간으로는 한 번에 못 들어갑니다';
        if (view.closeCells) t += ' · 붉은 범위(슛견제): 슛을 막지만 옆으로 뚫림 / 초록 범위(돌파견제): 돌파를 막지만 슛은 덜 막음';
        if ((sel.paint || 0) >= R.PAINT_LIMIT && R.inPaint(sel)) t += ' · 3초 룰: 이번 턴에 페인트존 밖으로 나가야 합니다';
        if (sel.team !== S.offense && R.sealed(S, sel)) t += ' · 옆에 붙은 공격수 너머로는 한 번에 못 넘어갑니다';
        if (R.trailing(S, sel)) t += ' · 볼 가진 선수가 안쪽에 있어, 뛰어넘어 앞으로는 못 가고 옆까지만 붙을 수 있습니다';
        if (R.slowed(S, sel)) {
          t += sel.id === S.ball ? ' · 수비가 붙어 첫 걸음이 느립니다' : ' · 스크린에 걸림: 붉은 칸(스크린 쪽)은 이동력이 더 듭니다';
        }
      } else if (R.mustLeave(S).length) {
        t = `3초 룰: ${R.mustLeave(S).map(p => p.num + '번').join(' · ')}이 페인트존에 너무 오래 있었습니다 · 밖으로 내보내야 이동을 끝낼 수 있습니다`;
      } else if (S.turnRole === 'O' && S.drive && S.drive.stage === 1) {
        t = `${DRIVE_MSG[S.drive.via]} · 볼 처리에서 드리블 돌파를 고를 수 있습니다 · 남은 이동 ${S.movesLeft}명`;
      } else if (S.turnRole === 'O') {
        const h = R.byId(S, S.ball), info = R.shotInfo(S, h);
        t = R.noShot(S)
          ? `공격 첫 턴은 슛을 쏠 수 없습니다 · ${R.canEnd(S) ? `남은 이동 ${S.movesLeft}명` : '한 명 이상 움직여야 합니다'}`
          : `볼 ${h.num}번 · 지금 쏘면 ${pct(info.p)} (${info.pts}점${info.open ? ' · 오픈' : ''}${info.drive ? ' · 추가 드리블 직후 감소' : ''}) · 남은 이동 ${S.movesLeft}명`;
      } else {
        t = `${view.note || ''}슛과 패스 길을 막도록 수비를 움직이세요 · ${R.canEnd(S) ? `남은 이동 ${S.movesLeft}명` : '한 명 이상 움직여야 턴을 끝낼 수 있습니다'}`;
      }
    } else if (S.phase === 'action') {
      if (view.passOpts) t = '패스 받을 선수를 누르세요 · 숫자는 스틸당할 확률 · ★는 받아서 바로 슛 가능';
      else if (R.mustShoot(S)) t = '마지막 공격 턴입니다. 슛을 쏴야 합니다';
      else if (R.noShot(S)) t = `볼 ${R.byId(S, S.ball).num}번의 선택: 보유 · 패스 (첫 턴은 슛 불가)`;
      else if (R.canDrive(S)) t = `${DRIVE_MSG[S.drive.via]} · 드리블 돌파로 ${R.DRIVE_MOVE}칸 더 갈 수 있습니다 (직후 슛은 성공률 감소)`;
      else t = `볼 ${R.byId(S, S.ball).num}번의 선택: 보유 · 패스 · 슛`;
      if (!view.passOpts && R.offMovers(S).length) t += ' · 스크린을 탄 선수는 추가 이동 후 패스를 받을 수 있습니다';
    } else if (S.phase === 'drive') {
      t = `드리블 돌파: ${R.byId(S, S.ball).num}번이 갈 칸을 누르세요 (${R.DRIVE_MOVE}칸까지)`;
    } else if (S.phase === 'offmove') {
      t = `스크린 추가 이동: ${R.byId(S, S.offMover).num}번이 갈 칸을 누르세요 (${R.DRIVE_MOVE}칸까지)`;
    } else if (S.phase === 'catch') {
      t = S.cut
        ? `컷인 성공! ${R.byId(S, S.ball).num}번이 골밑에서 받았습니다 · 바로 슛하면 성공률 보정`
        : `패스 연결! ${R.byId(S, S.ball).num}번이 비었습니다 · 바로 슛할 수 있습니다`;
    } else if (S.phase === 'react') {
      if (S.react.kind === 'pass') {
        const to = R.byId(S, S.react.to);
        if (S.react.moved) t = '대응을 마쳤습니다. 패스 판정을 누르세요';
        else if (view.selected) t = '칸의 숫자는 그리로 갔을 때 스틸 확률';
        else {
          const who = view.reactors ? [...view.reactors.keys()].map(id => R.byId(S, id).num + '번').join(' · ') : '';
          t = `${R.byId(S, S.ball).num}번 → ${to.num}번 패스! 초록 테두리 수비(${who}) 중 한 명을 한 칸 움직여 끊으러 갈 수 있습니다 · 숫자는 최대 스틸 확률`;
        }
      }
      else if (S.react.moved) t = '대응을 마쳤습니다. 슛 판정을 누르세요';
      else if (view.selected) t = '칸의 숫자는 그리로 갔을 때 슛 성공률 · 초록 칸은 박스아웃';
      else t = `${R.byId(S, S.ball).num}번이 슛! 수비 한 명을 한 칸 움직일 수 있습니다 · 슈터에게 붙거나 박스아웃`;
    }
    elHint.textContent = t;
  }

  function syncOverlay() {
    if (view.replay || (view.shot && !view.shot.rest)) { elOverlay.hidden = true; return; }   // 리플레이·슛이 끝난 뒤에 결과창을 띄운다
    if (S.phase === 'result') {
      const r = S.result;
      let title = '', sub = '';
      if (r.kind === 'made') {
        title = r.cut ? '컷인 득점!' : `${r.pts}점 성공!`;
        sub = `${label(R.byId(S, r.by))} · 성공률 ${pct(r.p)}`;
      } else if (r.kind === 'miss') {
        title = '슛 실패';
        const rb = R.byId(S, r.reb);
        sub = r.offReb
          ? `공격 리바운드! ${label(rb)} · 공격 ${S.clock}턴 다시`
          : `${r.boxOut ? '박스아웃 성공 · ' : ''}수비 리바운드 · ${label(rb)}`;
        sub += ` · 성공률 ${pct(r.p)}`;
      } else if (r.kind === 'steal') {
        title = '스틸!';
        sub = r.how === 'trap'
          ? `돌파하려다 둘러싸여 ${label(R.byId(S, r.by))}에게 뺏겼습니다 · 스틸 확률 ${pct(r.p)}`
          : r.how === 'hold'
          ? `${label(R.byId(S, r.by))}이 볼을 빼앗았습니다`
          : `${label(R.byId(S, r.by))}이 패스를 끊었습니다 · 스틸 확률 ${pct(r.p)}`;
      }
      if (r.kind === 'fast') {
        title = '속공 성공!';
        sub = `${TEAM[r.team].name} 팀이 속공에 성공했습니다 · ${r.pts}점 (${r.run.length}:${r.back.length})`;
      }
      if (r.kind === 'steal' && r.fast) sub += ` · 속공 기회 ${r.fast.run.length}:${r.fast.back.length}`;
      showOverlay(title, sub, r.kind === 'steal' && r.fast ? '속공!' : r.next === 'change' ? '공수 교대' : '계속');
    } else if (S.phase === 'over') {
      const a = S.score.A, b = S.score.B;
      const verdict = `${TEAM[a > b ? 'A' : 'B'].name} 승리`;
      showOverlay('경기 종료', `주황 ${a} : ${b} 파랑 · ${verdict}`, '다시 하기');
    } else {
      elOverlay.hidden = true;
    }
  }

  function showOverlay(title, sub, btn) {
    elOverlay.classList.toggle('top', flipped);       // 골대가 아래일 때는 결과창을 위로 올려 골대를 가리지 않는다
    elOvTitle.textContent = title;
    elOvSub.textContent = sub;
    elOvBtn.textContent = btn;
    // 득점 장면은 다시 볼 수 있다
    $('ovReplay').hidden = !(S.phase === 'result' && S.result && S.result.kind === 'made' && view.shot && tape.frames.length > 1);
    elOverlay.hidden = false;
  }

  // ───────── 그리기 ─────────
  let drawQueued = false;
  function requestDraw() {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(() => { drawQueued = false; draw(); });
  }

  const pathOf = (pts, close) => { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); if (close) ctx.closePath(); };
  const arcPts = (cx, cy, rad, a0, a1, n = 56) => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + (a1 - a0) * i / n; return proj(cx + rad * Math.cos(a), cy + rad * Math.sin(a)); });
  const RIM_Z = 3.05;

  function drawCourt() {
    // 배경
    const bg = ctx.createLinearGradient(0, 0, 0, cssH);
    bg.addColorStop(0, '#0f141c'); bg.addColorStop(0.28, '#1b2433'); bg.addColorStop(1, '#12161c');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, cssW, cssH);
    // 바깥 여백과 나무 바닥
    pathOf([proj(-1.6, -1.6), proj(16.6, -1.6), proj(16.6, 14.9), proj(-1.6, 14.9)], true); ctx.fillStyle = '#8a6239'; ctx.fill();
    pathOf([proj(0, 0), proj(COURT_W, 0), proj(COURT_W, COURT_H), proj(0, COURT_H)], true);
    const wood = ctx.createLinearGradient(0, proj(0, 0).y, 0, proj(0, COURT_H).y);
    wood.addColorStop(0, '#cfa26b'); wood.addColorStop(1, '#ebcb9c');
    ctx.fillStyle = wood; ctx.fill();
    ctx.strokeStyle = 'rgba(120,80,40,.12)'; ctx.lineWidth = 1;
    for (let x = 0.6; x < COURT_W; x += 0.6) { pathOf([proj(x, 0), proj(x, COURT_H)]); ctx.stroke(); }
    pathOf([proj(5.05, 0), proj(9.95, 0), proj(9.95, 5.8), proj(5.05, 5.8)], true); ctx.fillStyle = 'rgba(200,110,66,.75)'; ctx.fill();

    // 코트 선
    ctx.strokeStyle = '#fbf6ec'; ctx.lineJoin = 'round';
    const line = (pts, close, w = 0.07) => { ctx.lineWidth = Math.max(1.5, w * k); pathOf(pts, close); ctx.stroke(); };
    line([proj(0, 0), proj(COURT_W, 0), proj(COURT_W, COURT_H), proj(0, COURT_H)], true);
    line([proj(5.05, 0), proj(9.95, 0), proj(9.95, 5.8), proj(5.05, 5.8)], true);
    line(arcPts(7.5, 5.8, 1.8, 0, Math.PI * 2), true);
    line(arcPts(7.5, COURT_H, 1.8, Math.PI, Math.PI * 2));
    const a = Math.atan2(2.99 - RIM.y, 6.6);
    line([proj(14.1, 0), proj(14.1, 2.99), ...arcPts(RIM.x, RIM.y, 6.75, a, Math.PI - a), proj(0.9, 0)]);
    line(arcPts(RIM.x, RIM.y, 1.25, 0, Math.PI), false, 0.055);
  }

  // 골대: 기둥·백보드·림·그물 (바닥 위에 서 있다).
  // 코트를 돌려 골대가 앞으로 오면 선수들을 가리므로 반투명하게 그린다.
  function drawHoop() {
    ctx.save();
    if (flipped) ctx.globalAlpha = 0.32;
    ctx.strokeStyle = '#2b3442'; ctx.lineWidth = Math.max(4, 0.17 * k); ctx.lineCap = 'round';
    pathOf([proj(7.5, -1.0, 0), proj(7.5, -1.0, 3.3), proj(7.5, 1.15, 3.55)]); ctx.stroke();
    pathOf([proj(6.6, 1.2, 2.9), proj(8.4, 1.2, 2.9), proj(8.4, 1.2, 3.95), proj(6.6, 1.2, 3.95)], true);
    ctx.fillStyle = 'rgba(235,242,250,.6)'; ctx.fill(); ctx.strokeStyle = '#f4f7fb'; ctx.lineWidth = Math.max(1.5, 0.06 * k); ctx.stroke();
    pathOf([proj(7.2, 1.2, 3.05), proj(7.8, 1.2, 3.05), proj(7.8, 1.2, 3.5), proj(7.2, 1.2, 3.5)], true);
    ctx.strokeStyle = '#d6401c'; ctx.lineWidth = Math.max(1.2, 0.05 * k); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 1;
    // 볼이 그물을 지나면 그물이 아래로 늘어났다가 좌우로 흔들리며 돌아온다
    const sk = view.swish ? (performance.now() - view.swish) / SWISH_MS : 1, e = sk >= 0 && sk < 1 ? 1 - sk : 0;
    const drop = 0.14 * e, sway = Math.sin(sk * Math.PI * 4) * 0.05 * e, nr = 0.12 - 0.04 * e;
    for (let i = 0; i < 12; i++) {
      const t = Math.PI * 2 * i / 12;
      pathOf([proj(RIM.x + 0.23 * Math.cos(t), RIM.y + 0.23 * Math.sin(t), RIM_Z), proj(RIM.x + nr * Math.cos(t + 0.4) + sway, RIM.y + nr * Math.sin(t + 0.4), RIM_Z - 0.42 - drop)]); ctx.stroke();
    }
    pathOf(Array.from({ length: 33 }, (_, i) => { const t = Math.PI * 2 * i / 32; return proj(RIM.x + 0.23 * Math.cos(t), RIM.y + 0.23 * Math.sin(t), RIM_Z); }), true);
    ctx.strokeStyle = '#e8501f'; ctx.lineWidth = Math.max(2, 0.075 * k); ctx.stroke();
    ctx.restore();
    ctx.lineCap = 'butt';
  }

  // 바닥에 눕힌 육각 칸. c 는 칸(코트 좌표 x,y), f 는 크기 비율
  function hexPath(c, f = 0.94) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const ang = Math.PI / 180 * (60 * i - 90);
      const [x, y] = toScreen(c.x + HEX_S * f * Math.cos(ang), c.y + HEX_S * f * Math.sin(ang));
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.closePath();
  }

  function drawReach() {
    if (!view.reach) return;
    const teamA = R.movingTeam(S) === 'A';
    ctx.lineWidth = 1.5;
    for (const c of view.reach.values()) {
      const [sx, sy] = toScreen(c.x, c.y);
      hexPath(c, 0.94);
      ctx.fillStyle = teamA ? 'rgba(255,255,255,.62)' : 'rgba(214,230,255,.66)';
      ctx.fill();
      ctx.strokeStyle = teamA ? 'rgba(196,62,24,.85)' : 'rgba(31,72,132,.85)';
      ctx.stroke();
    }
    // 클로즈아웃 범위: 슛견제(붉은색) / 돌파견제(초록색). 이름은 칸마다 쓰지 않고 범위 아래쪽에 한 번만 붙인다
    if (view.closeCells) {
      const zones = { shot: [], drive: [] };
      for (const [key, kd] of view.closeCells) {
        const c = view.reach.get(key);
        const [sx, sy] = toScreen(c.x, c.y);
        hexPath(c, 0.94);
        ctx.fillStyle = kd === 'shot' ? 'rgba(214,72,48,.8)' : 'rgba(40,150,96,.8)';
        ctx.fill();
        ctx.strokeStyle = kd === 'shot' ? '#8f2415' : '#17633a';
        ctx.stroke();
        zones[kd].push([sx, sy]);
      }
      ctx.lineWidth = 1.5;
      view.closeLabels = [];
      for (const kd of ['drive', 'shot']) {
        const pts = zones[kd];
        if (!pts.length) continue;
        const low = Math.max(...pts.map(p => p[1]));                       // 화면에서 가장 아랫줄
        const row = pts.filter(p => p[1] > low - 2);
        const x = row.reduce((a, p) => a + p[0], 0) / row.length;
        view.closeLabels.push({ kd, x, y: low });
      }
    } else view.closeLabels = null;
    // 돌파 칸: 노란 테두리
    if (view.driveCells) {
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = '#ffd400';
      for (const key of view.driveCells) {
        const c = view.reach.get(key);
        const [sx, sy] = toScreen(c.x, c.y);
        hexPath(c, 0.86);
        ctx.stroke();
      }
      ctx.lineWidth = 1.5;
    }
    // 슛 대응 미리보기: 칸마다 슛 성공률, 박스아웃이 되는 칸은 초록
    if (view.preview) {
      ctx.font = `700 ${Math.round(HEX_S * k * 0.62)}px "Malgun Gothic", system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const [key, pv] of view.preview) {
        const c = view.reach.get(key);
        const [sx, sy] = toScreen(c.x, c.y);
        if (pv.box) {
          hexPath(c, 0.94);
          ctx.fillStyle = 'rgba(46,160,96,.8)'; ctx.fill();
          ctx.strokeStyle = '#17633a'; ctx.stroke();
        }
        ctx.fillStyle = pv.box ? '#fff' : '#16345f';
        ctx.fillText(Math.round(pv.p * 100), sx, sy + 1);
      }
    }
    // 스크린 쪽 칸: 붉게 칠하고 드는 이동력을 적는다 (이동력이 모자라 못 가는 칸도 표시)
    if (!view.costly) return;
    ctx.font = `700 ${Math.round(HEX_S * k * 0.8)}px "Malgun Gothic", system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const [key, c] of view.costly) {
      const [sx, sy] = toScreen(c.x, c.y);
      const can = view.reach.has(key);
      hexPath(c, 0.94);
      ctx.fillStyle = can ? 'rgba(232,96,70,.6)' : 'rgba(120,40,30,.45)';
      ctx.fill();
      ctx.strokeStyle = '#a3261a';
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.fillText(can ? c.cost : '✕', sx, sy + 1);
    }
  }

  const riskColor = p => (p < 0.1 ? '#1d8a4e' : p < 0.25 ? '#c98a00' : '#c8321e');

  // 선수의 가슴 높이 / 머리 위 화면 위치
  const chestOf = id => proj(disp[id].x, disp[id].y, 1.25);
  const overHead = id => { const p = R.byId(S, id), g = proj(disp[id].x, disp[id].y, 0); return { x: g.x, y: g.y - figH(p, g) - 0.2 * g.s }; };
  const dashLine = (a, b, color, w) => { ctx.strokeStyle = color; ctx.lineWidth = w; ctx.setLineDash([7, 6]); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]); };

  function drawPassLines() {
    // 패스 대응 중: 나가려는 패스 한 줄
    if (S.phase === 'react' && S.react.kind === 'pass') dashLine(chestOf(S.ball), chestOf(S.react.to), '#ffe45c', 3.5);
    if (!view.passOpts) return;
    for (const [id, info] of view.passOpts) dashLine(chestOf(S.ball), chestOf(id), riskColor(info.p), 3);
  }

  // 글자 이름표 하나
  function badge(text, x, y, fill, fs = 12) {
    ctx.font = `700 ${fs}px "Malgun Gothic", system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width + 10, h = fs + 7;
    const bx = Math.max(w / 2 + 2, Math.min(cssW - w / 2 - 2, x));
    ctx.fillStyle = fill; ctx.beginPath(); ctx.roundRect(bx - w / 2, y - h / 2, w, h, 5); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillText(text, bx, y + 1);
  }

  function drawPassLabels() {
    if (!view.passOpts) return;
    for (const [id, info] of view.passOpts) {
      const o = overHead(id);
      const text = (info.tag ? `${info.tag} ${pct(info.p)}` : pct(info.p)) + (info.cut ? ' ★컷인' : info.shot ? ' ★' : '');
      badge(text, o.x, o.y - 4, riskColor(info.p), 13);
    }
  }

  // 클로즈아웃 범위 이름표: 각 범위의 맨 아랫줄 바로 밑에 한 번씩. 둘이 겹치면 하나를 더 아래로 내린다
  function drawCloseLabels() {
    if (!view.closeLabels || !view.closeCells) return;
    const fs = Math.max(11, Math.round(HEX_S * k * 0.66));
    ctx.font = `700 ${fs}px "Malgun Gothic", system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const h = fs + 7, drop = 0;
    const boxes = view.closeLabels.map(l => {
      const text = l.kd === 'shot' ? '슛견제' : '돌파견제';
      return { kd: l.kd, text, x: l.x, y: l.y + drop, w: ctx.measureText(text).width + 12 };
    }).sort((p, q) => p.y - q.y);
    for (let i = 1; i < boxes.length; i++) {
      const p = boxes[i - 1], q = boxes[i];
      if (Math.abs(q.y - p.y) < h + 2 && Math.abs(q.x - p.x) < (p.w + q.w) / 2 + 2) q.y = p.y + h + 3;
    }
    for (const l of boxes) {
      const x = Math.max(l.w / 2 + 2, Math.min(cssW - l.w / 2 - 2, l.x));
      const y = Math.min(cssH - h / 2 - 2, l.y);
      ctx.fillStyle = l.kd === 'shot' ? '#8f2415' : '#17633a';
      ctx.beginPath(); ctx.roundRect(x - l.w / 2, y - h / 2, l.w, h, 6); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.fillText(l.text, x, y + 1);
    }
  }

  // 스크린 표시: 스크리너와 걸린 수비 사이의 바닥에 전술판 기호(짧은 막대)를 그린다
  function drawScreens() {
    if (S.phase === 'result' || S.phase === 'over') return;
    for (const [o, d] of R.screens(S)) {
      const a = disp[o.id], b = disp[d.id];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len > HEX_W * 1.3 || len < 0.01) continue;       // 이동 애니메이션 중에는 건너뛴다
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const nx = -(b.y - a.y) / len * HEX_W * 0.34, ny = (b.x - a.x) / len * HEX_W * 0.34;
      const [x1, y1] = toScreen(mx - nx, my - ny), [x2, y2] = toScreen(mx + nx, my + ny);
      for (const [w, c] of [[7, '#3b2a1a'], [3.5, '#ffe45c']]) {
        ctx.lineWidth = w; ctx.strokeStyle = c; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      }
    }
    ctx.lineCap = 'butt';
  }

  // ───────── 선수: 정면에서 본 2D 캐릭터가 자기 칸에 발을 딛고 서 있다 ─────────
  const FIG = {
    A: { main: '#f0703f', dark: '#c2411b', skin: '#f0c49c', hair: '#3a2a1c' },
    B: { main: '#3f6fb8', dark: '#234a84', skin: '#d6a077', hair: '#1c1a18' },
  };
  const FIG_TILT = 0.86;                                    // 내려다보는 만큼 키가 눌려 보인다
  const heightOf = p => 1.8 + (p.stats.height - 50) * 0.008;   // 높이 능력치 → 키(m): 50 → 1.80, 90 → 2.12

  // 발밑 바닥에 그리는 고리
  function groundRing(g, color, w, rx = 0.55) {
    ctx.beginPath(); ctx.ellipse(g.x, g.y, rx * g.s, rx * 0.42 * g.s, 0, 0, Math.PI * 2);
    ctx.strokeStyle = color; ctx.lineWidth = w; ctx.stroke();
  }

  // ───────── 도트 캐릭터 ─────────
  // 선수 그림은 sprites.js 가 관절 자세로 찍어 만든다(40×66 점). 화면에는 점이 뭉개지지 않게 그대로 키워서 그린다.
  const FIG_BIG = 1.28;                                     // 도트 캐릭터는 코트에서 잘 보이게 실제 키보다 크게 세운다
  const figH = (p, g) => heightOf(p) * g.s * FIG_TILT * FIG_BIG;
  const FACES = ['r', 'br', 'b', 'bl', 'l', 'fl', 'f', 'fr'];   // 오른쪽에서 시계 반대 방향으로(화면 위쪽이 먼 쪽)
  const stride = {};                    // 지금 칸을 옮기는 중인 선수 (달리기 그림을 쓴다)
  // face: 'f' 앞 · 'b' 뒤 · 'l' 왼쪽 · 'r' 오른쪽 · 'fl' 'fr' 'bl' 'br' 45도
  const spriteOf = (team, num, pose, face) => Sprites.get(team, num, pose || 'stand', face === true ? 'b' : face || 'f');

  // ───────── 말풍선 ─────────
  // 슛·패스·스크린·돌파 때 그 선수가 머리 위 말풍선으로 한마디 한다
  const SAY_MS = 1300;
  function say(id, text) {
    view.says = (view.says || []).filter(b => b.id !== id);
    view.says.push({ id, text, until: performance.now() + SAY_MS });
  }
  function drawBubbles(now) {
    if (!view.says || !view.says.length) return false;
    view.says = view.says.filter(b => now < b.until && disp[b.id]);
    for (const b of view.says) {
      const o = overHead(b.id);
      if (b.id === view.markId) o.y -= 0.2 * proj(disp[b.id].x, disp[b.id].y, 0).s;   // 머리 위 볼 표시를 가리지 않게
      ctx.font = 'bold 13px "Malgun Gothic", sans-serif';
      const w = ctx.measureText(b.text).width + 16, h = 23;
      const x = Math.max(4, Math.min(cssW - w - 4, o.x - w / 2)), y = Math.max(4, o.y - h - 9);
      const tx = Math.max(x + 9, Math.min(x + w - 9, o.x));
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, w, h, 8); else ctx.rect(x, y, w, h);
      ctx.moveTo(tx - 5, y + h - 1); ctx.lineTo(tx, y + h + 7); ctx.lineTo(tx + 5, y + h - 1);
      ctx.lineWidth = 3; ctx.strokeStyle = '#1c130d'; ctx.lineJoin = 'round'; ctx.stroke();
      ctx.fillStyle = '#ffffff'; ctx.fill();
      ctx.fillStyle = '#1c130d'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(b.text, x + w / 2, y + h / 2 + 1);
    }
    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
    return view.says.length > 0;
  }
  // 상태가 바뀐 순간을 잡아 말풍선을 띄운다: 돌파(추가 드리블)를 시작할 때, 스크린이 새로 걸릴 때
  function watchSays() {
    if (S.phase !== view.lastPhase) {
      if (S.phase === 'drive' && S.drive) say(S.drive.id, '돌파');
      view.lastPhase = S.phase;
    }
    // 스틸: 판정 결과가 새로 나온 순간, 뺏은 선수가 말한다
    if (S.result !== view.lastResult) {
      view.lastResult = S.result;
      const r = S.result;
      if (r && r.kind === 'steal' && r.by) {
        const id = typeof r.by === 'string' ? r.by : r.by.id;
        say(id, '스틸');
        if (!view.replay) view.stealBy = { id, until: performance.now() + 2000 };
      }
    }
    if (view.replay || S.phase === 'result' || S.phase === 'over') return;
    const poss = S.poss.A + S.poss.B, cur = new Set(R.screens(S).map(([o, d]) => o.id + '>' + d.id));
    if (view.scrPoss === poss && view.scrSet) {
      for (const k of cur) { const id = k.split('>')[0]; if (!view.scrSet.has(k) && id !== S.ball) say(id, '스크린'); }
    }
    view.scrSet = cur; view.scrPoss = poss;
  }

  // opt: pose 자세 · face 보는 방향 · jump 뛰어오른 높이(키에 대한 비율)
  // 그린 그림과 배율을 돌려준다 (볼을 손에 붙일 때 쓴다)
  // under(fig): 그림자 다음, 몸을 그리기 직전에 그릴 것 (몸 뒤에 있어 가려지는 볼)
  function drawFigure(p, g, opt, under) {
    const s = g.s, h = figH(p, g), jump = (opt.jump || 0) * h;
    const sq = 1 - (opt.jump || 0) * 1.2;                     // 뛰어오르면 그림자가 작아진다
    ctx.beginPath(); ctx.ellipse(g.x + 0.06 * s, g.y + 0.02 * s, 0.46 * s * sq, 0.16 * s * sq, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fill();
    const u = h / Sprites.H, img = spriteOf(p.team, p.num, opt.pose, opt.face);   // u: 그림의 한 점이 화면에서 몇 픽셀인가
    const fig = { img, u, jump };
    if (under) under(fig);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, g.x - Sprites.W / 2 * u, g.y - Sprites.FOOT * u - jump, Sprites.W * u, Sprites.CH * u);
    ctx.imageSmoothingEnabled = true;
    return fig;
  }
  // 그린 선수 그림에서 볼이 놓일 자리 (g 는 그 선수의 발 위치)
  const ballSpot = (fig, g) => ({ x: g.x + (fig.img.ball.x - Sprites.W / 2) * fig.u, y: g.y - (Sprites.FOOT - fig.img.ball.y) * fig.u - fig.jump });

  // ───────── 동작 시간표 ─────────
  // 슛: 웅크림 → 도약 → 릴리스(볼이 손을 떠남) → 팔로스루 → 착지
  const SHOT_STEPS = [['sh0', 140], ['sh1', 100], ['shoot', 140], ['sh3', 200], ['land', 120]];
  const SHOT_WIND = 300, SHOT_LAND = 580;              // 볼이 손을 떠나는 때, 발이 땅에 닿는 때
  // 달리기: 디딤(몸이 낮다) → 무릎 들기(몸이 한 점 뜬다) 네 칸
  const RUN_STEPS = ['runC', 'run2', 'runD', 'run1'], RUN_MS = 100;
  // 패스: 가슴으로 당기기 → 두 손 뻗기 → 거두기. 볼은 당긴 뒤에 손을 떠난다
  const PASS_STEPS = [['pass0', 120], ['pass', 160], ['pass2', 140]], PASS_HOLD = 150;
  const BREATH_MS = 700;                                // 서 있는 선수는 0.7초마다 어깨가 한 점 오르내린다
  // 볼 없는 공격수: 무릎을 굽힌 준비 자세로 0.7초마다 좌우로 체중을 옮기고, 4.2초에 한 번(선수마다 다른 때) 손을 들어 볼을 부른다
  const READY_MS = 700, CALL_EVERY = 4200;
  function readyPose(p, now) {
    const t = now + p.num * 700 + (p.team === 'B' ? 350 : 0);
    if (t % CALL_EVERY < READY_MS) return 'call';
    return Math.floor(t / READY_MS) % 2 ? 'readyL' : 'readyR';
  }
  function stepAt(steps, t, last) { let a = 0; for (const [p, d] of steps) { if (t < a + d) return p; a += d; } return last; }
  const jumpArc = (t, t0, t1, h) => (t > t0 && t < t1 ? Math.sin(Math.PI * (t - t0) / (t1 - t0)) * h : 0);
  const DOT = 1 / Sprites.H;                            // 그림 한 점 (키에 대한 비율)

  // 도트 농구공
  let ballSprite = null;
  function makeBall() {
    const n = 13, cv = document.createElement('canvas'); cv.width = n; cv.height = n;
    const c = cv.getContext('2d'), m = (n - 1) / 2;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const dd = Math.hypot(x - m, y - m);
      if (dd > 6.3) continue;
      let col = dd > 5.3 ? '#1c130d' : (x - m) + (y - m) < -3 ? '#ffb057' : (x - m) + (y - m) > 4 ? '#c9560d' : '#ee7f1f';
      if (dd <= 5.3 && (x === m || y === m || Math.abs(Math.hypot(x - m + 7, y - m) - 5) < 0.6 || Math.abs(Math.hypot(x - m - 7, y - m) - 5) < 0.6)) col = '#5a2d0c';
      c.fillStyle = col; c.fillRect(x, y, 1, 1);
    }
    return cv;
  }
  function drawBall(bx, by, br) {
    if (!ballSprite) ballSprite = makeBall();
    const d = Math.max(9, br * 2.3);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(ballSprite, bx - d / 2, by - d / 2, d, d);
    ctx.imageSmoothingEnabled = true;
  }

  function drawPlayers() {
    const turnTeam = R.movingTeam(S);
    const moving = S.phase === 'move' || (S.phase === 'react' && !S.react.moved);
    const passReact = S.phase === 'react' && S.react.kind === 'pass';
    const holder = view.replay ? view.replay.cur.ball : S.ball;
    const handler = disp[holder];
    // 먼 선수부터 그려서 가까운 선수가 앞에 오게 한다
    const depth = id => proj(disp[id].x, disp[id].y, 0).y;
    const order = [...S.players].sort((a, b) => depth(a.id) - depth(b.id));
    const now = performance.now(), sh = view.shot, shotT = sh && !sh.rest ? now - sh.t0 : -1;
    const screeners = (view.replay || S.phase === 'result' || S.phase === 'over') ? new Set() : new Set(R.screens(S).map(([o]) => o.id));
    const pass = view.passer, passT = pass ? now - pass.t0 : -1;
    const faceTo = (id, tgt) => {
      const d = disp[id];
      let fx = tgt.x - d.x, fy = tgt.y - d.y;
      if (flipped) { fx = -fx; fy = -fy; }
      return FACES[((Math.round(Math.atan2(-fy, fx) / (Math.PI / 4)) % 8) + 8) % 8];
    };
    const faceOf = id => faceTo(id, id === holder ? RIM : handler);
    const figs = {};
    // 지금 볼을 손에 든 선수 (날아가는 중이면 null). 든 볼은 그 선수와 앞뒤를 맞춰 그린다: 등을 보이면 몸에 가려진다
    let held = null;
    if (sh) { if (shotT >= 0 && shotT < SHOT_WIND) held = sh.by; else if (sh.rest && !sh.made && sh.reb) held = sh.reb; }
    else {
      const owner = pass && passT < PASS_HOLD ? pass.id : holder;
      if (disp[owner] && Math.hypot(ballDisp.x - disp[owner].x, ballDisp.y - disp[owner].y) < 0.35) held = owner;
    }
    const drawHeld = (id, g, f) => {
      const sp = ballSpot(f, g);
      let by = sp.y;
      // 볼 가진 선수가 달리면 드리블: 손바닥과 바닥 사이를 튄다
      if (id === holder && stride[id] && !sh && !view.replay) {
        const floor = g.y - 0.12 * g.s, b = Math.abs(Math.cos(Math.PI * (now % 380) / 380));
        by = floor + (by - floor) * b;
      }
      const a = ctx.globalAlpha; ctx.globalAlpha = 1;
      drawBall(sp.x, by, 0.17 * g.s);
      ctx.globalAlpha = a;
    };
    for (const p of order) {
      const d = disp[p.id], g = proj(d.x, d.y, 0);
      const reactor = !!(view.reactors && view.reactors.has(p.id));
      const active = moving && p.team === turnTeam && (!passReact || reactor);
      const done = active && p.moved;
      const target = (view.passOpts && view.passOpts.has(p.id)) || (S.phase === 'react' && (p.id === S.ball || p.id === S.react.to));
      const picked = view.selected === p.id;

      // 발밑 표시: 고른 선수·패스 대상은 노랑, 끊으러 갈 수 있는 수비는 초록, 움직일 수 있는 선수는 흰색
      if (picked || target) groundRing(g, '#ffe45c', 4);
      else if (reactor) groundRing(g, '#3ddc84', 4);
      else if (active && !done) groundRing(g, 'rgba(255,255,255,.9)', 2.2, 0.48);

      // 이미 움직였거나, 패스 대응 중 끊으러 갈 수 없는 수비는 흐리게
      ctx.globalAlpha = (view.reactors && p.team === turnTeam && !reactor) ? 0.4 : done ? 0.6 : 1;
      const defending = p.team !== S.offense;
      const near = Math.hypot(d.x - handler.x, d.y - handler.y) < HEX_W * 1.3;
      const rebT = shotT - SHOT_WIND - SHOT_FLY;         // 리바운드: 볼이 림에 닿은 뒤로 흐른 시간
      let pose = 'stand', jump = 0, face = faceOf(p.id);
      if (shotT >= 0 && sh.by === p.id) { pose = stepAt(SHOT_STEPS, shotT, 'stand'); jump = jumpArc(shotT, 140, SHOT_LAND, 0.18); }
      else if (shotT >= 0 && !sh.made && sh.reb === p.id && rebT >= 0) {
        // 준비 자세로 기다리다가, 볼이 오기 직전에 뛰어올라 잡고, 내려와 가슴에 감싼다
        if (rebT < SHOT_BOUNCE - 380) pose = 'land';
        else if (rebT < REB_LAND) { pose = 'reb'; jump = jumpArc(rebT, SHOT_BOUNCE - 380, REB_LAND, 0.2); }
        else pose = 'sh0';
      }
      else if (pass && pass.id === p.id) { pose = stepAt(PASS_STEPS, passT, 'stand'); face = faceTo(p.id, disp[pass.to]); }
      else if (stride[p.id]) { const i = Math.floor(now / RUN_MS) % 4; pose = RUN_STEPS[i] + (p.id === held ? '+d' : ''); jump = i % 2 ? DOT : 0; }
      else if (p.id === held) pose = 'ball';                       // 볼은 언제나 두 손에 들고 있다
      else if (defending && near && S.phase !== 'over') pose = 'up';
      else if (screeners.has(p.id)) pose = 'screen';
      else if (defending && S.phase !== 'over') pose = 'guard';
      else if (S.phase !== 'over') pose = readyPose(p, now);      // 볼 없는 공격수는 가만히 서 있지 않는다
      else if (Math.floor(now / BREATH_MS) % 2) pose = 'breath';
      // 몸의 방향: 볼 가진 선수는 골대를, 나머지는 공격·수비 모두 볼을 본다 (패스하는 선수는 받는 선수를).
      // 보는 쪽을 화면 기준 여덟 방향(45도 간격)으로 나눠 옆·앞·뒤·45도 그림을 고른다
      const hold = p.id === held;
      const fig = drawFigure(p, g, { pose, jump, face }, hold ? f => { if (f.img.ballBehind) drawHeld(p.id, g, f); } : null);
      if (hold && !fig.img.ballBehind) drawHeld(p.id, g, fig);
      figs[p.id] = fig;
      ctx.globalAlpha = 1;
    }

    // 3초 룰: 페인트존에 오래 머문 공격수 발밑에 표시 (2턴째 '3초 주의', 나가야 하는 턴 '3초!')
    if (S.phase === 'move' || S.phase === 'action') {
      for (const p of S.players) {
        if (p.team !== S.offense || !R.inPaint(p) || (p.paint || 0) < R.PAINT_LIMIT - 1) continue;
        const out = p.paint >= R.PAINT_LIMIT;
        const g = proj(disp[p.id].x, disp[p.id].y, 0);
        if (out) groundRing(g, '#ff5a3c', 3, 0.62);
        badge(out ? '3초!' : '3초 주의', g.x, g.y + 0.2 * g.s + 12, out ? '#c8321e' : '#8a6a00');
      }
    }

    // 패스를 끊으러 갈 수 있는 수비: 머리 위에 가장 좋은 칸으로 갔을 때의 스틸 확률
    if (view.reactors) {
      for (const [id, best] of view.reactors) {
        if (view.selected === id) continue;
        const o = overHead(id);
        badge(pct(best), o.x, o.y - 4, '#1d8a4e', 13);
      }
    }

    // 스틸: 볼이 뺏은 선수 손에 닿는 순간 번쩍
    if (view.stealFlash && figs[view.stealFlash]) {
      const id = view.stealFlash, f = figs[id], sp = ballSpot(f, proj(disp[id].x, disp[id].y, 0));
      addFx('flash', { sx: sp.x, sy: sp.y, u: f.u });
      view.stealFlash = null;
    }

    // 날아가는 볼: 슛은 궤적을 따라(점선도 여기서 그린다), 패스·스틸은 볼 위치(ballDisp)를 따라 받는 선수 손 높이로
    if (sh) {
      // 볼이 손을 떠나는 순간의 손 위치를 기억해 두고, 날아가는 길을 거기서 시작한다
      if (shotT >= SHOT_WIND && !sh.relOff && figs[sh.by]) {
        const d = disp[sh.by], sp = ballSpot(figs[sh.by], proj(d.x, d.y, 0)), base = proj(sh.from.x, sh.from.y, 2.45);
        sh.relOff = { x: sp.x - base.x, y: sp.y - base.y };
      }
      const pos = shotBall(figs);
      if (pos && !held) drawBall(pos.x, pos.y, pos.rad);
    } else if (!held) {
      const og = proj(disp[holder].x, disp[holder].y, 0), sp = ballSpot(figs[holder], og), g = proj(ballDisp.x, ballDisp.y, 0);
      drawBall(g.x + (sp.x - og.x), g.y + (sp.y - og.y), 0.17 * g.s);
    }
    // 볼 가진 선수 표시: 머리 위 주황 삼각형 (등을 보여 볼이 가려져도 누가 가졌는지 보이게)
    view.markId = held && (!sh || sh.rest) ? held : null;
    if (view.markId) drawBallMark(view.markId, figs[view.markId]);
  }

  function drawBallMark(id, fig) {
    const p = R.byId(S, id), d = disp[id], g = proj(d.x, d.y, 0);
    const top = g.y - figH(p, g) - (fig ? fig.jump : 0);
    const w = Math.max(13, 0.34 * g.s), h = w * 0.72, y1 = top - 0.1 * g.s, y0 = y1 - h;
    ctx.beginPath(); ctx.moveTo(g.x - w / 2, y0); ctx.lineTo(g.x + w / 2, y0); ctx.lineTo(g.x, y1); ctx.closePath();
    ctx.lineJoin = 'round'; ctx.lineWidth = 3; ctx.strokeStyle = '#1c130d'; ctx.stroke();
    ctx.fillStyle = '#ff9a2e'; ctx.fill();
    ctx.fillStyle = '#ffd08a'; ctx.fillRect(g.x - w / 2 + 3, y0 + 2, w - 6, Math.max(1.5, h * 0.16));   // 윗면 밝은 띠
  }

  // ───────── 타격감 효과: 멈칫 · 화면 흔들림 · 반짝임 · 번쩍 · 먼지 ─────────
  // 크기는 선수 그림의 한 점에 맞춰서 선수와 따로 놀지 않게 한다. at 은 코트 좌표 {x,y,z} 또는 화면 좌표 {sx,sy,u}
  const FX_MS = { dust: 320, spark: 260, flash: 260 };
  function addFx(kind, at, delay = 0) { (view.fx || (view.fx = [])).push({ kind, at, t0: performance.now() + delay }); }
  function drawFx(now) {
    if (!view.fx || !view.fx.length) return false;
    view.fx = view.fx.filter(f => now < f.t0 + FX_MS[f.kind]);
    for (const f of view.fx) {
      const k = (now - f.t0) / FX_MS[f.kind];
      if (k < 0) continue;
      const a = f.at, P = a.sx != null ? { x: a.sx, y: a.sy } : proj(a.x, a.y, a.z || 0);
      const u = a.u || 0.044 * P.s, px = (x, y, w, h, col) => { ctx.fillStyle = col; ctx.fillRect(x, y, w, h); };
      if (f.kind === 'dust') {                 // 발밑 양옆으로 도트 먼지가 퍼지며 옅어진다
        ctx.globalAlpha = 1 - k;
        for (const dir of [-1, 1]) for (let i = 0; i < 3; i++) {
          const x = P.x + dir * (5 + i * 3 + 9 * k * (1 + i * 0.4)) * u, y = P.y - (1 + i * 1.5 + 5 * k * (1 - k) * (2 + i)) * u;
          const r = Math.max(1, Math.round((4 - i) * (1 - k * 0.5))) * u;
          px(x - r / 2, y - r / 2, r, r, i ? '#e4cfa6' : '#f3e6cc');
        }
        ctx.globalAlpha = 1;
      } else if (f.kind === 'spark') {         // 반짝임: 십자 모양 도트가 커졌다 작아진다
        const r = Math.round((a.big ? 4 : 3) * Math.sin(Math.PI * k)), x = P.x + (a.dx || 0) * u, y = P.y + (a.dy || 0) * u;
        const col = k < 0.5 ? '#ffffff' : '#ffe45c';
        px(x - (r + 0.5) * u, y - u / 2, (2 * r + 1) * u, u, col); px(x - u / 2, y - (r + 0.5) * u, u, (2 * r + 1) * u, col);
        if (r >= 2) px(x - 1.5 * u, y - 1.5 * u, 3 * u, 3 * u, '#fff6b0');
      } else if (f.kind === 'flash') {         // 번쩍: 맞은 자리에서 여덟 갈래로 빛이 퍼진다
        const r0 = 2 + 9 * k, r1 = r0 + 4 * (1 - k), col = k < 0.4 ? '#ffffff' : '#ffe45c';
        for (let i = 0; i < 8; i++) {
          const ang = i * Math.PI / 4;
          for (let r = r0; r <= r1; r++) px(P.x + Math.cos(ang) * r * u - u / 2, P.y + Math.sin(ang) * r * u - u / 2, u, u, col);
        }
        if (k < 0.35) { ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.beginPath(); ctx.arc(P.x, P.y, 6 * (1 - k) * u, 0, Math.PI * 2); ctx.fill(); }
      }
    }
    return view.fx.length > 0;
  }
  // 슛 도중 정해진 순간에 한 번씩: 슈터 착지 먼지, 그물 통과(출렁·반짝임·3점이면 흔들림), 리바운드 착지 먼지
  function shotEvents(now) {
    const sh = view.shot;
    if (!sh || sh.rest) return;
    const t = now - sh.t0, ARR = SHOT_WIND + SHOT_FLY;
    sh.fired = sh.fired || new Set();
    const once = (key, cond, fn) => { if (cond && !sh.fired.has(key)) { sh.fired.add(key); fn(); } };
    const feet = id => ({ x: disp[id].x, y: disp[id].y });
    once('land', t >= SHOT_LAND, () => addFx('dust', feet(sh.by)));
    if (sh.made) once('net', t >= ARR, () => {
      view.swish = now;
      const rim = { x: RIM.x, y: RIM.y, z: RIM_Z };
      addFx('spark', { ...rim, dx: -9, dy: -6, big: true });
      addFx('spark', { ...rim, dx: 8, dy: -9 }, 60);
      addFx('spark', { ...rim, dx: -2, dy: -13 }, 110);
      if (sh.three) view.shake = { t0: now, dur: SHAKE_MS, amp: Math.max(2, 0.07 * k) };
    });
    else if (sh.reb) once('reb', t >= ARR + REB_LAND, () => addFx('dust', feet(sh.reb)));
  }

  // ───────── 슛 애니메이션 ─────────
  // 슈터가 웅크렸다 뛰어올라 볼을 놓으면, 볼이 포물선으로 골대까지 날아간다. 들어가면 그물에 닿는 순간 잠깐 멈췄다가(멈칫) 그물에 머무르고,
  // 빗나가면 림에서 튕겨 리바운드를 잡은 선수에게 간다. 두 궤적 모두 점선으로 남긴다.
  const SHOT_FLY = 800, SHOT_HANG = 350, SHOT_BOUNCE = 650;
  const SHOT_STOP = 100, SHAKE_MS = 180, SWISH_MS = 420, STEAL_STOP = 140;   // 멈칫 0.1초 · 3점슛 흔들림 0.18초 · 그물 출렁 · 스틸 멈칫 0.14초
  const REB_LAND = SHOT_BOUNCE + 140;                 // 볼이 림에 닿은 뒤 리바운드 잡은 선수가 땅에 닿는 때

  function startShot(from, result) {
    if (!result || (result.kind !== 'made' && result.kind !== 'miss')) return;
    // 슛 종류는 규칙(rules.js shotInfo)과 같은 기준: 3m 안은 골밑, 3점 라인 밖은 3점, 그 사이는 미들
    const sd = Math.hypot(from.x - RIM.x, from.y - RIM.y);
    const three = sd > 6.75 || (Math.abs(from.x - RIM.x) > 6.6 && from.y < 2.99);
    view.shot = { from, by: result.by, made: result.kind === 'made', reb: result.reb || null, three, t0: performance.now(), rest: false };
    say(result.by, sd <= 3 ? '골밑슛' : three ? '3점슛' : '미들슛');
    // 리바운드: 튕긴 볼을 잡는 순간, 잡은 선수가 말한다
    if (result.kind === 'miss' && result.reb) {
      const shot = view.shot;
      setTimeout(() => { if (view.shot === shot) { say(result.reb, '리바운드'); requestDraw(); } }, SHOT_WIND + SHOT_FLY + SHOT_BOUNCE - 120);
    }
    view.locked = true;
    const total = SHOT_WIND + SHOT_FLY + (view.shot.made ? SHOT_STOP + SHOT_HANG : REB_LAND + 160);
    setTimeout(() => {
      if (!view.shot) return;
      // 결과를 넘길 때까지 그대로 둔다: 들어간 볼은 골대에, 빗나간 볼은 리바운드 잡은 선수 손에. 궤적 점선도 남긴다
      view.shot.rest = true;
      view.locked = false;
      syncUi();
      requestDraw();
    }, total);
    requestDraw();
  }

  // 지금 이 순간 볼이 그려질 화면 위치와 반지름. 궤적 점선도 여기서 그린다. 볼이 아직 손을 떠나기 전이면 null
  function shotBall(figs) {
    const sh = view.shot;
    const raw = sh.rest ? 1e9 : performance.now() - sh.t0, ARR = SHOT_WIND + SHOT_FLY;
    if (raw < SHOT_WIND) return null;
    // 들어간 슛은 볼이 림에 닿는 순간 SHOT_STOP 만큼 멈춘다
    const now = (sh.made && raw > ARR ? Math.max(ARR, raw - SHOT_STOP) : raw) - SHOT_WIND;
    const from = { x: sh.from.x, y: sh.from.y, z: 2.45 }, rim = { x: RIM.x, y: RIM.y, z: RIM_Z };
    const dist = Math.hypot(rim.x - from.x, rim.y - from.y);
    const lift = Math.max(1.1, dist * 0.24);                     // 멀리서 쏠수록 높이 뜬다
    const lerp3 = (a, b, t, up) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t + up * 4 * t * (1 - t) });
    const scr = q => { const p = proj(q.x, q.y, q.z); return { x: p.x, y: p.y, rad: 0.17 * p.s }; };
    const off = sh.relOff || { x: 0, y: 0 };                     // 슈터 손에서 출발하도록 처음엔 손 쪽으로 당긴다
    const fly = t => { const p = scr(lerp3(from, rim, t, lift)); return { x: p.x + off.x * (1 - t), y: p.y + off.y * (1 - t), rad: p.rad }; };

    const dashed = (pts, color) => {
      ctx.save();
      ctx.setLineDash([5, 6]); ctx.lineWidth = 2.5; ctx.strokeStyle = color; ctx.lineCap = 'round';
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
      ctx.restore();
    };
    const tFly = Math.min(1, now / SHOT_FLY);
    const path = [];
    for (let i = 0; i <= 28; i++) { const t = i / 28; if (t <= tFly) path.push(fly(t)); }
    dashed(path, 'rgba(255,255,255,.9)');
    if (now < SHOT_FLY) return fly(tFly);
    if (sh.made) return scr({ x: RIM.x, y: RIM.y, z: RIM_Z - Math.min(0.25, (now - SHOT_FLY) / 170 * 0.25) });   // 그물을 지나 그 안에 머무른다

    // 빗나감: 림에서 튕겨 리바운드 잡은 선수의 손으로
    const d = disp[sh.reb], dg = proj(d.x, d.y, 0), rs = scr(rim);
    const end = figs && figs[sh.reb] ? ballSpot(figs[sh.reb], dg) : scr({ x: d.x + 0.3, y: d.y, z: 1.7 });
    const bounce = t => ({ x: rs.x + (end.x - rs.x) * t, y: rs.y + (end.y - rs.y) * t - 0.9 * dg.s * 4 * t * (1 - t), rad: rs.rad + (0.17 * dg.s - rs.rad) * t });
    const tB = Math.min(1, (now - SHOT_FLY) / SHOT_BOUNCE);
    const bp = [];
    for (let i = 0; i <= 18; i++) { const t = i / 18; if (t <= tB) bp.push(bounce(t)); }
    dashed(bp, 'rgba(255,214,90,.95)');
    return bounce(tB);
  }

  // 슛·패스 판정. 슛이면 볼이 날아가는 모습을 먼저 보여 준다.
  function resolveNow() {
    const shot = S.react.kind === 'shot';
    const from = shot ? { x: disp[S.ball].x, y: disp[S.ball].y } : null;
    const ev = R.resolveReact(S);
    if (shot) startShot(from, ev);
    refresh();
  }

  function draw() {
    let moving = false;
    const ease = (cur, tx, ty) => {
      const ex = tx - cur.x, ey = ty - cur.y;
      if (Math.abs(ex) + Math.abs(ey) > 0.01) { cur.x += ex * 0.3; cur.y += ey * 0.3; moving = true; }
      else { cur.x = tx; cur.y = ty; }
    };
    // 선수는 달리는 모습이 보이도록 일정한 빠르기로 옮긴다 (화면 주사율과 무관하게 시간 기준)
    const now = performance.now(), gap = now - (view.lastDraw || 0), fr = gap > 100 ? 1 : Math.max(0.25, gap / 16.7);
    view.lastDraw = now;
    const walk = (id, tx, ty) => {
      const cur = disp[id], ex = tx - cur.x, ey = ty - cur.y, dist = Math.hypot(ex, ey);
      if (dist > 0.02) {
        const st = Math.min(dist, Math.max(dist * 0.07, 0.085) * fr);
        cur.x += ex / dist * st; cur.y += ey / dist * st; moving = true; stride[id] = dist > 0.12;
      } else { cur.x = tx; cur.y = ty; stride[id] = false; }
    };
    const rp = view.replay ? view.replay.cur : null;      // 리플레이 중이면 기록된 장면의 위치를 쓴다
    const frozen = now < (view.stopUntil || 0);           // 멈칫: 잠깐 모든 움직임을 멈춘다
    if (frozen) moving = true;
    else for (const p of S.players) {
      const at = rp ? rp.p[p.id] : p;
      const c = R.center(at.q, at.r);
      walk(p.id, c.x, c.y);
    }
    const holder = rp ? rp.ball : S.ball;
    // 패스: 볼이 다른 선수에게 넘어가는 동안 준 선수가 팔을 뻗는다
    if (holder !== view.lastHolder) {
      const prev = view.lastHolder; view.lastHolder = holder;
      if (prev && disp[prev] && !view.shot && Math.hypot(ballDisp.x - disp[holder].x, ballDisp.y - disp[holder].y) > 0.6) {
        view.passer = { id: prev, to: holder, t0: now, until: now + 420 };
        if (prev[0] === holder[0]) say(holder, '패스');      // 볼을 받은 선수가 말한다
      }
    }
    if (view.passer) { if (now < view.passer.until) moving = true; else view.passer = null; }
    const passHold = view.passer && now - view.passer.t0 < PASS_HOLD;   // 패스는 볼을 가슴으로 당긴 뒤에 떠난다
    if (view.shot) { ballDisp.x = disp[holder].x; ballDisp.y = disp[holder].y; if (!view.shot.rest) moving = true; }
    else if (!passHold && !frozen) ease(ballDisp, disp[holder].x, disp[holder].y);
    // 스틸: 볼이 뺏은 선수에게 닿는 순간 0.14초 멈칫하고 번쩍
    if (view.stealBy) {
      const st = view.stealBy, d = disp[st.id];
      if (now > st.until || !d) view.stealBy = null;
      else if (Math.hypot(ballDisp.x - d.x, ballDisp.y - d.y) < 0.45) { view.stopUntil = now + STEAL_STOP; view.stealFlash = st.id; view.stealBy = null; }
      moving = true;
    }
    shotEvents(now);

    ctx.clearRect(0, 0, cssW, cssH);
    // 화면 흔들림(3점슛): 바닥을 먼저 칠해 흔들린 가장자리가 비지 않게 한다
    const shk = view.shake && now < view.shake.t0 + view.shake.dur ? view.shake : null;
    if (shk) {
      const a = shk.amp * (1 - (now - shk.t0) / shk.dur);
      ctx.fillStyle = '#12161c'; ctx.fillRect(0, 0, cssW, cssH);
      ctx.save(); ctx.translate(Math.round(Math.sin(now * 0.9) * a), Math.round(Math.cos(now * 1.3) * a * 0.6));
      moving = true;
    }
    drawCourt();
    drawReach();
    drawScreens();
    if (!flipped) drawHoop();           // 골대가 뒤(위)에 있을 때는 선수보다 먼저
    drawPassLines();
    drawPlayers();
    if (flipped) drawHoop();            // 골대가 앞(아래)에 있을 때는 선수 위에 반투명하게
    if (drawFx(now)) moving = true;
    if (view.swish && now - view.swish < SWISH_MS) moving = true;
    drawCloseLabels();
    drawPassLabels();
    watchSays();
    if (drawBubbles(now)) moving = true;
    if (shk) ctx.restore();
    if (moving) requestDraw();
    else if (!view.breathTimer && S.phase !== 'over') {
      // 멈춰 있을 때도 서 있는 선수가 숨을 쉬도록 다음 바뀌는 때에 한 번 더 그린다
      const half = BREATH_MS / 2;
      view.breathTimer = setTimeout(() => { view.breathTimer = null; requestDraw(); }, half - (now % half) + 5);
    }
  }

  // ───────── 입력 ─────────
  function nearestCell(x, y) {
    let best = null, bd = Infinity;
    for (const c of R.cells.values()) {
      const d = (c.x - x) ** 2 + (c.y - y) ** 2;
      if (d < bd) { bd = d; best = c; }
    }
    return bd <= HEX_S * HEX_S ? best : null;
  }

  // 화면의 한 점이 어느 선수의 몸 위인가 (겹치면 앞에 선 선수)
  function hitPlayer(sx, sy) {
    let best = null;
    for (const p of S.players) {
      const d = disp[p.id], g = proj(d.x, d.y, 0);
      const h = figH(p, g);
      if (Math.abs(sx - g.x) > 0.42 * g.s || sy > g.y + 0.2 * g.s || sy < g.y - h - 4) continue;
      if (!best || g.y > best.y) best = { p, y: g.y };
    }
    return best ? best.p : null;
  }

  canvas.addEventListener('pointerdown', e => {
    if (!S || view.locked || aiTurn()) return;
    const [px, py] = localPoint(e, canvas);
    const [x, y] = toCourt(px, py);
    let cell = nearestCell(x, y);
    // 서 있는 선수의 몸을 눌렀으면 그 선수의 칸으로 본다. 단, 누른 바닥이 갈 수 있는 칸이면 이동이 먼저다
    const hit = hitPlayer(px, py);
    const inReach = cell && view.reach && view.reach.has(R.key(cell.q, cell.r));
    if (hit && !inReach) cell = R.cells.get(R.key(hit.q, hit.r));
    const p = cell && R.playerAt(S, cell.q, cell.r);

    if (S.phase === 'action' && view.passOpts) {
      if (p && view.passOpts.has(p.id)) doAct({ type: 'pass', to: p.id });
      return;
    }
    if (S.phase === 'react') {
      const sel = view.selected && R.byId(S, view.selected);
      if (sel && cell && view.reach.has(R.key(cell.q, cell.r))) {
        R.reactMove(S, sel.id, cell.q, cell.r);
        select(null);
        syncUi();
        return;
      }
      const ok = p && p.team !== S.offense && !S.react.moved;
      if (ok && R.reactCells(S, p).size === 0) {
        select(null);
        elHint.textContent = S.react.kind === 'pass' ? '패스 길 근처의 수비만 움직일 수 있습니다' : '움직일 칸이 없습니다';
        return;
      }
      select(ok && !(sel && sel.id === p.id) ? p : null);
      return;
    }
    if (S.phase === 'drive' || S.phase === 'offmove') {
      if (cell && view.reach && view.reach.has(R.key(cell.q, cell.r))) {
        R.move(S, S.phase === 'drive' ? S.ball : S.offMover, cell.q, cell.r);
        select(null);
        syncUi();
      }
      return;
    }
    if (S.phase !== 'move') return;
    if (!cell) { select(null); return; }

    const sel = view.selected && R.byId(S, view.selected);
    if (sel && view.reach.has(R.key(cell.q, cell.r))) {
      R.move(S, sel.id, cell.q, cell.r);
      select(null);
      syncUi();
      return;
    }
    if (p && p.team === R.movingTeam(S)) {
      if (p.moved) { select(null); elHint.textContent = '이 선수는 이번 턴에 이미 움직였습니다'; return; }
      if (S.movesLeft === 0) { select(null); elHint.textContent = '3명을 모두 움직였습니다'; return; }
      select(sel && sel.id === p.id ? null : p);
      return;
    }
    select(null);
  });

  // ───────── AI 대전: 파랑 팀을 AI가 한 수씩 둔다 ─────────
  const HUMAN = 'A', AI_TEAM = 'B', AI_DELAY = 650;
  const AI_HINT = {
    move: 'AI가 선수를 움직이는 중…', action: 'AI가 볼 처리를 고르는 중…', catch: 'AI가 볼 처리를 고르는 중…',
    drive: 'AI가 드리블 돌파 중…', offmove: 'AI가 스크린을 타고 움직이는 중…', react: 'AI가 대응하는 중…',
  };

  // 지금 결정할 차례인 팀
  function decider() {
    if (S.phase === 'move') return R.movingTeam(S);
    if (S.phase === 'react') return R.other(S.offense);
    return S.offense;
  }
  function aiTurn() {
    return mode === 'ai' && !!S && S.phase !== 'result' && S.phase !== 'over' && decider() === AI_TEAM;
  }
  function aiSchedule() {
    if (aiTimer || !aiTurn()) return;
    aiTimer = setTimeout(aiStep, AI_DELAY);
  }
  // force: 자동 검사에서 양 팀 모두 AI 로 둘 때
  function aiStep(force) {
    aiTimer = null;
    if (!force && !aiTurn()) return;
    if (view.locked) { aiSchedule(); return; }
    view.passOpts = null;
    const ph = S.phase;
    if (ph === 'move') {
      const m = AI.nextMove(S);
      if (m) { R.move(S, m.id, m.q, m.r); syncUi(); requestDraw(); }
      else if (!R.canEnd(S) && S.history.length) { while (S.history.length) R.undo(S); syncUi(); requestDraw(); }   // 3초 룰에 막혔으면 이번 턴을 처음부터 다시
      else { view.note = ''; R.endMoves(S); refresh(); }
    } else if (ph === 'action' || ph === 'catch') {
      const a = AI.decide(S);
      const ev = R.act(S, a);
      view.note = ev && ev.kind === 'hold' && ev.tried ? `${label(R.byId(S, ev.tried))}의 스틸 시도 실패 (${pct(ev.p)}) · ` : '';
      refresh();
    } else if (ph === 'drive' || ph === 'offmove') {
      const c = AI.extraCell(S);
      if (c) R.move(S, ph === 'drive' ? S.ball : S.offMover, c.q, c.r);
      else R.act(S, { type: 'driveCancel' });
      refresh();
    } else if (ph === 'react') {
      const m = S.react.moved ? null : AI.react(S);
      if (m) { R.reactMove(S, m.id, m.q, m.r); syncUi(); requestDraw(); }
      else resolveNow();
    }
  }

  function doAct(a) {
    view.passOpts = null;
    const ev = R.act(S, a);
    // 보유 때 수비가 스틸을 시도했다가 실패했으면 다음 수비 턴 안내에 알린다
    view.note = ev && ev.kind === 'hold' && ev.tried
      ? `${label(R.byId(S, ev.tried))}의 스틸 시도 실패 (${pct(ev.p)}) · ` : '';
    refresh();
  }

  elBar.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || b.disabled || view.locked || aiTurn()) return;
    switch (b.dataset.act) {
      case 'undo': R.undo(S); select(null); syncUi(); break;
      case 'end': view.note = ''; select(null); R.endMoves(S); refresh(); break;
      case 'back': R.backToMoves(S); refresh(); break;
      case 'drive': {
        const ev = R.act(S, { type: 'drive' });
        if (ev && ev.kind === 'steal') { select(null); refresh(); break; }      // 돌파하려다 뺏겼다
        view.note = ev && ev.tried ? `${label(R.byId(S, ev.tried))}의 스틸 시도 실패 (${pct(ev.p)}) · ` : view.note;
        select(R.byId(S, S.ball)); syncUi(); break;
      }
      case 'off': R.act(S, { type: 'offMove', id: b.dataset.id }); select(R.byId(S, b.dataset.id)); syncUi(); break;
      case 'driveCancel': R.act(S, { type: 'driveCancel' }); select(null); syncUi(); break;
      case 'hold': doAct({ type: 'hold' }); break;
      case 'shoot': doAct({ type: 'shoot' }); break;
      case 'pass': {
        const h = R.byId(S, S.ball);
        view.passOpts = new Map(S.players
          .filter(p => p.team === S.offense && p.id !== h.id)
          .map(p => { const shot = R.canCatchShoot(S, p); return [p.id, { ...R.passInfo(S, h, p), shot, cut: shot && R.isCut(p) }]; }));
        refresh();
        break;
      }
      case 'reactUndo': R.reactUndo(S); select(null); syncUi(); break;
      case 'resolve': select(null); resolveNow(); break;
      case 'passCancel': view.passOpts = null; refresh(); break;
    }
  });

  $('ovReplay').addEventListener('click', () => { if (!view.locked) startReplay(); });

  elOvBtn.addEventListener('click', () => {
    if (view.locked) return;
    view.shot = null;
    if (S.phase === 'over') { showSetup(); return; }
    const change = S.result.next === 'change';
    R.proceed(S);
    refresh(change);
  });

  window.addEventListener('resize', resize);

  // ───────── 시작 화면: 팀별 수비 대형 고르기 ─────────
  const elSetup = $('setup');

  function renderForms() {
    for (const team of ['A', 'B']) {
      const box = $('forms' + team);
      box.innerHTML = '';
      for (const [id, f] of Object.entries(R.FORMATIONS)) {
        const b = document.createElement('button');
        b.textContent = f.name;
        b.dataset.id = id;
        if (id === formation[team]) b.className = 'on';
        b.addEventListener('click', () => { formation[team] = id; renderForms(); });
        box.appendChild(b);
      }
      $('desc' + team).textContent = R.FORMATIONS[formation[team]].desc;
    }
  }

  function showSetup() { renderForms(); syncBuildButtons(); elSetup.hidden = false; }

  // ───────── 능력치 조정 ─────────
  const STAT_UI = [
    ['inside', '골밑슛', '골대 3m 안의 슛'],
    ['mid', '미들슛', '3점 라인 안쪽 중거리 슛'],
    ['three', '3점슛', '3점 라인 밖의 슛'],
    ['dribble', '드리블', '돌파 · 볼 지키기'],
    ['pass', '패스', '패스가 덜 끊김'],
    ['box', '박스아웃', '리바운드 · 박스아웃 · 스크린'],
    ['contest', '슛견제', '상대 슛 성공률을 깎음'],
    ['steal', '스틸', '패스 끊기 · 볼 뺏기'],
    ['height', '높이', '슛견제 · 골밑 미스매치 · 리바운드'],
    ['speed', '스피드', '이동력 · 돌파 막기 (78 이상 4칸, 45 이상 3칸)'],
  ];
  const UNIT = {};
  const BUILD_KEY = 'nonggu-omok-builds-v2';
  const emptyTeam = () => ({ 1: {}, 2: {}, 3: {}, 4: {}, 5: {} });
  const builds = { A: emptyTeam(), B: emptyTeam() };

  try {
    const saved = JSON.parse(localStorage.getItem(BUILD_KEY) || 'null');
    for (const t of ['A', 'B']) for (let n = 1; n <= 5; n++) {
      const d = saved && saved[t] && saved[t][n];
      if (R.validBuild(d)) builds[t][n] = d;
    }
  } catch (e) { /* 저장된 값이 깨졌으면 기본값으로 */ }

  const saveBuilds = () => { try { localStorage.setItem(BUILD_KEY, JSON.stringify(builds)); } catch (e) { /* 저장 불가 환경 */ } };
  const changed = d => Object.values(d).some(v => v);

  function syncBuildButtons() {
    for (const t of ['A', 'B']) {
      const n = Object.values(builds[t]).filter(changed).length;
      $('build' + t).textContent = n ? `선수 능력치 조정 · ${n}명 변경됨` : '선수 능력치 조정';
    }
  }

  // ───────── 능력치 도형(레이더) ─────────
  // 축 순서: 공격(슛 3종·드리블·패스) → 수비·몸(스틸·스피드·슛견제·높이·박스아웃)
  const AXES = [
    ['inside', '골밑슛'], ['mid', '미들슛'], ['three', '3점슛'], ['dribble', '드리블'], ['pass', '패스'],
    ['steal', '스틸'], ['speed', '스피드'], ['contest', '슛견제'], ['height', '높이'], ['box', '박스아웃'],
  ];

  // st: 그릴 능력치, base: 비교용 기본값(다를 때만 점선으로 그린다), color: 팀 색
  function radarSvg(st, base, color) {
    const n = AXES.length, cx = 110, cy = 104, rad = 60;
    const ang = i => -Math.PI / 2 + i * 2 * Math.PI / n;
    const at = (i, r) => [cx + r * Math.cos(ang(i)), cy + r * Math.sin(ang(i))];
    const rOf = v => rad * Math.max(0.06, Math.min(1, (v - 30) / 70));     // 30 → 중심, 100 → 바깥
    const poly = f => AXES.map((a, i) => at(i, f(a[0], i)).map(v => v.toFixed(1)).join(',')).join(' ');
    let h = `<svg viewBox="0 0 220 208" xmlns="http://www.w3.org/2000/svg">`;
    for (const k of [1 / 3, 2 / 3, 1]) h += `<polygon points="${poly(() => rad * k)}" fill="none" stroke="#2c3440" stroke-width="1"/>`;
    for (let i = 0; i < n; i++) { const [x, y] = at(i, rad); h += `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#2c3440" stroke-width="1"/>`; }
    if (base && AXES.some(a => base[a[0]] !== st[a[0]])) {
      h += `<polygon points="${poly(k => rOf(base[k]))}" fill="none" stroke="#8b96a5" stroke-width="1.2" stroke-dasharray="3 3"/>`;
    }
    h += `<polygon points="${poly(k => rOf(st[k]))}" fill="${color}" fill-opacity=".38" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>`;
    AXES.forEach((a, i) => {
      const [x, y] = at(i, rad + 22);
      const d = base ? st[a[0]] - base[a[0]] : 0;
      const vc = d > 0 ? '#6fd39a' : d < 0 ? '#ff8a6b' : '#eef1f5';
      h += `<text x="${x.toFixed(1)}" y="${(y - 3).toFixed(1)}" text-anchor="middle" font-size="10" fill="#9aa5b4">${a[1]}</text>`;
      h += `<text x="${x.toFixed(1)}" y="${(y + 9).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="700" fill="${vc}">${st[a[0]]}</text>`;
    });
    return h + '</svg>';
  }

  const RADAR_COLOR = { A: '#f0764f', B: '#5b93e6' };

  // 경기 중 '능력치' 버튼: 두 팀 선수 10명의 능력치를 한쪽 패널에 나란히 보여 준다
  const elStats = $('statsPanel');
  function showStats() {
    let h = '';
    for (let n = 1; n <= 5; n++) {
      for (const t of ['A', 'B']) {
        const p = R.byId(S, t + n);
        h += `<div class="cell"><div class="who"><b class="t${t}">${n}</b>${R.POS[n].split(' ')[0]}<span>이동 ${p.move}칸</span></div>${radarSvg(p.stats, R.STATS[n], RADAR_COLOR[t])}</div>`;
      }
    }
    $('statsGrid').innerHTML = h;
    elStats.hidden = false;
  }
  $('btnStats').addEventListener('click', showStats);
  $('statsClose').addEventListener('click', () => { elStats.hidden = true; });
  elStats.addEventListener('click', e => { if (e.target === elStats) elStats.hidden = true; });

  const elEditor = $('editor');
  const ed = { team: 'A', num: 1 };

  function openEditor(team) {
    ed.team = team; ed.num = 1;
    elEditor.className = team === 'A' ? 'teamA' : 'teamB';
    renderEditor();
    elEditor.hidden = false;
  }

  function renderEditor() {
    $('edTitle').textContent = `${TEAM[ed.team].name} 팀 능력치`;
    $('edTabs').innerHTML = [1, 2, 3, 4, 5].map(n =>
      `<button data-num="${n}" class="${n === ed.num ? 'on' : ''}">${n}<small>${R.POS[n].split(' ')[0]}</small>${changed(builds[ed.team][n]) ? '<i></i>' : ''}</button>`).join('');
    const base = R.STATS[ed.num];
    $('edRows').innerHTML = STAT_UI.map(([k, name, eff]) => {
      const t = R.TUNE[k];
      return `<div class="row">
        <div class="top"><b>${name}</b><span class="eff">${eff}</span><span class="val" id="edVal_${k}"></span></div>
        <input type="range" data-k="${k}" min="${base[k] - t.cap}" max="${base[k] + t.cap}" step="${t.step}" value="${base[k] + (builds[ed.team][ed.num][k] || 0)}">
      </div>`;
    }).join('');
    syncEditor();
  }

  function syncEditor() {
    const d = builds[ed.team][ed.num], base = R.STATS[ed.num];
    for (const [k] of STAT_UI) {
      const v = d[k] || 0;
      const mark = v ? `<em class="${v > 0 ? 'up' : 'down'}">${v > 0 ? '+' : ''}${v}</em>` : '';
      $('edVal_' + k).innerHTML = `${base[k] + v}${UNIT[k] || ''}${mark}`;
    }
    $('edRadar').innerHTML = radarSvg(R.applyBuild(ed.num, d), base, RADAR_COLOR[ed.team]);
    const left = -R.buildCost(d);
    $('edPoints').textContent = `남은 포인트 ${left}`;
    $('edPoints').classList.toggle('zero', left === 0);
    const mv = R.moveFor(ed.num, d), mb = R.MOVE[ed.num];
    $('edMove').textContent = `이동력 ${mv}칸` + (mv > mb ? ' (스피드가 올라 +1)' : mv < mb ? ' (스피드가 내려 -1)' : '');
    $('edMove').className = mv > mb ? 'up' : mv < mb ? 'down' : '';
  }

  $('edRows').addEventListener('input', e => {
    const k = e.target.dataset.k;
    if (!k) return;
    const d = builds[ed.team][ed.num], base = R.STATS[ed.num], step = R.TUNE[k].step;
    d[k] = Math.round((+e.target.value - base[k]) / step) * step;
    while (R.buildCost(d) > 0) d[k] -= step;       // 포인트가 모자라면 올릴 수 있는 데까지만
    if (!d[k]) delete d[k];
    e.target.value = base[k] + (d[k] || 0);
    syncEditor();
  });
  $('edTabs').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    ed.num = +b.dataset.num;
    renderEditor();
  });
  $('edReset').addEventListener('click', () => { builds[ed.team][ed.num] = {}; renderEditor(); });
  $('edDone').addEventListener('click', () => { saveBuilds(); syncBuildButtons(); elEditor.hidden = true; });
  $('buildA').addEventListener('click', () => openEditor('A'));
  $('buildB').addEventListener('click', () => openEditor('B'));

  function startGame() {
    clearTimeout(aiTimer); aiTimer = null;
    view.shot = null; view.replay = null; tape.poss = -1; tape.frames = [];
    view.fx = []; view.shake = null; view.swish = null; view.stealBy = null; view.stealFlash = null; view.stopUntil = 0;
    S = R.newGame(formation, (Math.random() * 0x7fffffff) | 0, builds);
    Sprites.warm();                     // 선수 그림을 한가할 때 미리 만들어 둔다 (폰에서 처음 나오는 자세가 끊기지 않게)
    window.__game.state = S;
    view.selected = view.reach = view.passOpts = null;
    view.locked = false;
    flipped = false;
    elSetup.hidden = true;
    snap();
    resize();
    syncUi();
  }

  $('btnStart').addEventListener('click', startGame);
  $('btnExit').addEventListener('click', () => { clearTimeout(aiTimer); aiTimer = null; showSetup(); });
  for (const b of document.querySelectorAll('#modes button')) {
    b.addEventListener('click', () => { mode = b.dataset.mode; syncMode(); });
  }
  function syncMode() {
    for (const b of document.querySelectorAll('#modes button')) b.classList.toggle('on', b.dataset.mode === mode);
    $('modeDesc').textContent = mode === 'ai'
      ? '주황 팀을 직접 조종하고, 파랑 팀은 AI가 공격·수비·대응을 모두 합니다'
      : '한 기기에서 둘이 번갈아 조종합니다 (혼자 양쪽을 다 움직여 연습할 수도 있습니다)';
    $('nameB').textContent = mode === 'ai' ? '파랑 팀(AI) 수비 대형' : '파랑 팀 수비 대형';
  }
  syncMode();

  const elHelp = $('help');
  for (const b of document.querySelectorAll('.btnHelp')) b.addEventListener('click', () => { elHelp.hidden = false; });
  $('helpClose').addEventListener('click', () => { elHelp.hidden = true; });

  // 자동 검사용
  window.__game = { state: null, toScreen, view, builds, tape, spriteOf, isRotated: () => rotated, disp, startShot, requestDraw, autoStep: () => { if (S && !view.locked && S.phase !== 'result' && S.phase !== 'over') aiStep(true); } };

  showSetup();
})();
