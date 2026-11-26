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
    for (let i = 0; i < 12; i++) {
      const t = Math.PI * 2 * i / 12;
      pathOf([proj(RIM.x + 0.23 * Math.cos(t), RIM.y + 0.23 * Math.sin(t), RIM_Z), proj(RIM.x + 0.12 * Math.cos(t + 0.4), RIM.y + 0.12 * Math.sin(t + 0.4), RIM_Z - 0.42)]); ctx.stroke();
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
  // 작은 그림(34×58 점)을 코드로 찍어 만든 뒤, 화면에는 점이 뭉개지지 않게 그대로 키워서 그린다.
  // 팀·번호·자세마다 한 장씩 만들어 두고 다시 쓴다.
  const FIG_BIG = 1.28;                                     // 도트 캐릭터는 머리가 큰 비율이라 실제 키보다 크게 세운다
  const figH = (p, g) => heightOf(p) * g.s * FIG_TILT * FIG_BIG;
  const SPR_W = 40, SPR_H = 58, SPR_TOP = 10, SPR_FOOT = 55, SPR_MID = 20;   // 머리 꼭대기 줄, 발바닥 줄, 가운데 세로줄
  // 포지션별 체형: 몸통 반폭 · 팔 굵기 · 다리 굵기 (가드는 날씬하게, 센터는 어깨가 넓고 굵게)
  const SPR_BUILD = {
    1: { hw: 7, arm: 2, leg: 4 }, 2: { hw: 7, arm: 3, leg: 4 }, 3: { hw: 8, arm: 3, leg: 5 },
    4: { hw: 9, arm: 3, leg: 5 }, 5: { hw: 9, arm: 4, leg: 6 },
  };

  const SPR_TEAM = {
    A: { jersey: ['#ff9a66', '#ee6a36', '#b9431a'], shorts: ['#d9552a', '#b9431a', '#8a2f10'], trim: '#fff3e6' },
    B: { jersey: ['#6f9fe6', '#3f6fb8', '#264c88'], shorts: ['#3a66ab', '#274d88', '#19345f'], trim: '#e9f1ff' },
  };
  // 번호마다 피부색과 머리 모양을 다르게 해서 누가 누구인지 구분되게 한다
  const SPR_LOOK = {
    1: { skin: ['#ffd9b5', '#f2bb8e', '#c98f62'], hair: ['#4a3324', '#2a1c12'], style: 'short' },
    2: { skin: ['#e9b98a', '#d39a68', '#a87245'], hair: ['#2b2320', '#15100e'], style: 'band' },
    3: { skin: ['#c98d5e', '#a86e42', '#7e4f2c'], hair: ['#241a16', '#120c0a'], style: 'flat' },
    4: { skin: ['#f3c9a0', '#dca777', '#b07d50'], hair: ['#7a4a22', '#4f2e12'], style: 'afro' },
    5: { skin: ['#9a6238', '#7e4c28', '#5a3418'], hair: ['#1c1512', '#0c0807'], style: 'beard' },
  };
  const SPR_DIGIT = {
    1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
    2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
    3: ['.###.', '#...#', '....#', '..##.', '....#', '#...#', '.###.'],
    4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
    5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  };
  const spriteCache = new Map();
  const FACES = ['r', 'br', 'b', 'bl', 'l', 'fl', 'f', 'fr'];   // 오른쪽에서 시계 반대 방향으로(화면 위쪽이 먼 쪽)
  const stride = {};                    // 지금 칸을 옮기는 중인 선수 (달리기 그림을 쓴다)

  // 자세: stand 서기 · ball 볼 들기 · up 수비 팔 들기 · shoot 슛 · run1/run2 달리기 · passL/passR 패스 · reb 리바운드 · screen 스크린
  // back 이 참이면 뒷모습(얼굴 대신 뒤통수, 등번호)
  // turn 이 1 이면 화면 오른쪽으로, -1 이면 왼쪽으로 45도 돌아선 모습 (오른쪽 그림을 좌우로 뒤집어 왼쪽을 만든다)
  function makeSprite(team, num, pose, back, turn = 0) {
    const mir = turn < 0, T = turn ? 1 : 0;
    if (mir) pose = pose === 'passL' ? 'passR' : pose === 'passR' ? 'passL' : pose;
    const cv = document.createElement('canvas'); cv.width = SPR_W; cv.height = SPR_H;
    const c = cv.getContext('2d');
    const t = SPR_TEAM[team], look = SPR_LOOK[num], sk = look.skin, hr = look.hair, bd = SPR_BUILD[num], M = SPR_MID;
    const raw = (x0, y0, x1, y1, col) => { c.fillStyle = col; c.fillRect(x0, y0, x1 - x0 + 1, y1 - y0 + 1); };
    const box = (x0, y0, x1, y1, col) => mir ? raw(SPR_W - 1 - x1, y0, SPR_W - 1 - x0, y1, col) : raw(x0, y0, x1, y1, col);
    const dot = (x, y, col) => box(x, y, x, y, col);
    // 밝은 면(왼쪽 한 줄) · 기본 · 어두운 면(오른쪽 두 줄)
    const shade = (x0, y0, x1, y1, pal) => { box(x0, y0, x1, y1, pal[1]); box(x0, y0, x0, y1, pal[0]); box(Math.max(x0 + 1, x1 - 1), y0, x1, y1, pal[2]); };
    const WHITE = ['#ffffff', '#eef0f3', '#c3c9d1'];
    const tx0 = M - bd.hw + T, tx1 = M - 1 + bd.hw;                  // 몸통의 왼쪽·오른쪽 끝 (돌아서면 조금 좁아 보인다)
    const lift = pose === 'run1' ? 'L' : pose === 'run2' ? 'R' : null;   // 달리기: 든 다리
    const wide = pose === 'screen' || pose === 'guard' ? 1 : 0;       // 스크린·수비: 다리를 벌리고 버틴다

    // 다리 · 양말 · 신발
    for (const [x0, x1, side] of [[tx0 + 1 - wide, tx0 + bd.leg - wide, 'L'], [tx1 - bd.leg + wide, tx1 - 1 + wide, 'R']]) {
      const up = lift === side ? 4 : 0;                               // 든 다리는 무릎을 접어 짧게 보인다
      shade(x0, 46, x1, 50 - up, sk); shade(x0, 51 - up, x1, 52 - up, WHITE);
      shade(x0 - 1, 53 - up, x1 + 1, 54 - up, WHITE); box(x0 - 1, 55 - up, x1 + 1, 55 - up, '#3a3f48');
      dot(x0 + 1, 53 - up, t.jersey[1]);                              // 신발의 팀 색 포인트
    }
    // 반바지
    shade(tx0, 39, tx1, 45, t.shorts);
    c.clearRect(M - 1, 43, 2, 3);
    box(tx0, 39, tx1, 39, t.trim);                                    // 허리 밴드
    box(tx0, 41, tx0, 45, t.trim); box(tx1, 41, tx1, 45, t.trim);     // 옆줄

    // 팔 (몸통보다 먼저 그려서 어깨가 덮이게). 안쪽 끝에서 바깥으로 o0~o1 칸, 세로 y0~y1
    const aR0 = tx1 + 2 - T, aL1 = tx0 - 2, W = bd.arm - 1;          // 돌아선 쪽 팔은 몸 뒤로 반쯤 가린다
    const seg = (side, o0, o1, y0, y1) => side === 'R' ? shade(aR0 + o0, y0, aR0 + o1, y1, sk) : shade(aL1 - o1, y0, aL1 - o0, y1, sk);
    const both = (...a) => { seg('L', ...a); seg('R', ...a); };
    const down = side => { seg(side, 0, W, 27, 39); seg(side, 0, W, 40, 41); };
    const passSide = pose === 'passL' ? 'L' : pose === 'passR' ? 'R' : null;
    if (pose === 'up') { both(0, W, 13, 28); both(0, W + 1, 10, 13); }                  // 수비: 양팔을 위로
    else if (pose === 'shoot') { both(-2, W - 2, 9, 28); both(-5, -2, 4, 9); }          // 슛: 양팔을 머리 위로 모은다
    else if (pose === 'reb') { both(-1, W - 1, 6, 28); both(-1, W, 2, 6); }             // 리바운드: 양팔을 끝까지 뻗는다
    else if (pose === 'ball') { down('L'); seg('R', 0, W, 27, 33); seg('R', 0, W + 3, 33, 36); }   // 볼을 든 팔은 앞으로
    else if (lift) {                                                  // 달리기: 든 다리의 반대쪽 팔을 접어 올린다
      const fw = lift === 'L' ? 'R' : 'L';
      seg(fw, 0, W, 27, 32); seg(fw, 0, W + 2, 30, 33); seg(lift, 0, W, 27, 37);
    }
    else if (passSide) { seg(passSide, 0, W, 27, 28); seg(passSide, 0, W + 5, 28, 31); }   // 패스: 보내는 쪽으로 팔을 뻗는다
    else if (pose === 'screen') both(0, W, 27, 36);                   // 스크린: 팔을 몸 앞으로 모은다
    else if (pose === 'guard') { both(0, W + 1, 27, 30); both(2, W + 3, 29, 33); both(4, W + 5, 32, 35); }   // 수비: 양팔을 옆으로 벌린다
    else { down('L'); down('R'); }

    // 유니폼 상의
    shade(tx0, 26, tx1, 38, t.jersey);
    box(tx0 - 1, 26, tx0 - 1, 28, t.jersey[0]); box(tx1 + 1, 26, tx1 + 1, 28, t.jersey[2]);   // 어깨
    box(tx0, 26, tx1, 26, t.trim);                                    // 목둘레 선
    if (!back) { box(M - 2 + T, 26, M + 1 + T, 27, sk[1]); dot(M - 1 + T, 28, sk[2]); dot(M + T, 28, sk[2]); }   // V자 목선
    box(tx0, 38, tx1, 38, t.jersey[2]);
    // 등번호(앞은 가슴, 뒤는 등)
    const sT = back ? -T : T, dgx = mir ? SPR_W - 1 - (M + 1 + sT) : M - 3 + sT;   // 글자는 뒤집지 않고 자리만 옮긴다
    SPR_DIGIT[num].forEach((row, j) => [...row].forEach((ch, i) => { if (ch === '#') raw(dgx + i, 30 + j, dgx + i, 30 + j, '#ffffff'); }));
    // 몸 앞으로 오는 팔 (뒷모습에서는 몸에 가려 안 보인다)
    if (!back && passSide) shade(tx0 - 1, 29, tx1 + 1, 31, sk);       // 반대쪽 팔이 가슴 앞을 가로지른다
    if (!back && pose === 'screen') {                                 // 두 손을 허리 앞에 모은다
      shade(tx0, 36, tx0 + 2, 37, sk); shade(tx1 - 2, 36, tx1, 37, sk); shade(M - 3, 37, M + 2, 40, sk);
    }
    // 목 · 머리
    box(M - 2, 24, M + 1, 25, sk[2]);
    const cx = M - 0.5, cy = 17, rx = 6.6, ry = 7.2;
    const inHead = (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
    for (let y = 9; y <= 25; y++) for (let x = M - 8; x <= M + 7; x++) if (inHead(x, y)) dot(x, y, x < M - 5 ? sk[0] : x > M + 4 ? sk[2] : sk[1]);
    if (!(T && back)) { dot(M - 8, 17, sk[2]); dot(M - 8, 18, sk[2]); }   // 귀 (돌아서면 한쪽만 보인다)
    if (!(T && !back)) { dot(M + 7, 17, sk[2]); dot(M + 7, 18, sk[2]); }
    // 머리카락
    const hairAt = (x, y) => dot(x, y, x > M + 3 ? hr[1] : hr[0]);
    const cap = top => { for (let y = 9; y <= top; y++) for (let x = M - 8; x <= M + 7; x++) if (inHead(x, y)) hairAt(x, y); };
    const afro = full => { for (let y = 4; y <= 15; y++) for (let x = M - 11; x <= M + 10; x++) if (((x - cx) / 9.4) ** 2 + ((y - 11) / 6.6) ** 2 <= 1 && (full || !(inHead(x, y) && y > 13))) hairAt(x, y); };
    const band = () => { box(M - 7, 13, M + 6, 14, '#f4f4f4'); box(M + 5, 13, M + 6, 14, '#c3c9d1'); };
    const flat = () => { box(M - 6, 8, M + 5, 9, hr[0]); box(M + 3, 8, M + 5, 9, hr[1]); };
    if (back) {                     // 뒷모습: 뒤통수가 머리카락으로 덮이고 목덜미만 살색
      cap(look.style === 'beard' ? 18 : 21);
      if (look.style === 'afro') afro(true);
      if (look.style === 'band') band();
      if (look.style === 'flat') flat();
      if (T) {                      // 45도 뒷모습: 돌아선 쪽으로 뺨과 눈썹 끝이 살짝 보인다
        for (let y = 15; y <= 22; y++) for (let x = M + 5; x <= M + 7; x++) if (inHead(x, y)) dot(x, y, sk[1]);
        dot(M + 6, 16, hr[1]);
      }
    } else if (T) {                 // 45도 앞모습: 얼굴이 돌아선 쪽으로 쏠리고, 반대쪽은 옆머리가 보인다
      if (look.style === 'short') cap(13);
      else if (look.style === 'band') { cap(12); band(); }
      else if (look.style === 'flat') { cap(12); flat(); }
      else if (look.style === 'afro') afro(false);
      else if (look.style === 'beard') { cap(11); for (let y = 20; y <= 25; y++) for (let x = M - 5; x <= M + 7; x++) if (inHead(x, y) && !(y === 21 && x >= M && x <= M + 3)) hairAt(x, y); }
      for (let y = 9; y <= 19; y++) for (let x = M - 8; x <= M - 5; x++) if (inHead(x, y) && !(look.style === 'band' && (y === 13 || y === 14))) hairAt(x, y);
      box(M - 2, 17, M - 1, 18, '#1b1410'); box(M + 4, 17, M + 4, 18, '#1b1410'); dot(M - 2, 17, '#ffffff');
      box(M - 3, 15, M - 1, 15, hr[1]); box(M + 3, 15, M + 5, 15, hr[1]);
      dot(M + 2, 19, sk[2]);                                          // 코
      box(M, 21, M + 3, 21, look.style === 'beard' ? '#e9b9a0' : sk[2]);
    } else {
      if (look.style === 'short') { cap(13); for (let y = 14; y <= 15; y++) { hairAt(M - 7, y); hairAt(M + 6, y); } }
      else if (look.style === 'band') { cap(12); band(); }
      else if (look.style === 'flat') { cap(12); flat(); }
      else if (look.style === 'afro') afro(false);
      else if (look.style === 'beard') { cap(11); for (let y = 20; y <= 25; y++) for (let x = M - 8; x <= M + 7; x++) if (inHead(x, y) && !(y === 21 && x >= M - 2 && x <= M + 1)) hairAt(x, y); }
      // 눈 · 눈썹 · 입
      box(M - 4, 17, M - 3, 18, '#1b1410'); box(M + 2, 17, M + 3, 18, '#1b1410'); dot(M - 4, 17, '#ffffff'); dot(M + 2, 17, '#ffffff');
      box(M - 5, 15, M - 3, 15, hr[1]); box(M + 2, 15, M + 4, 15, hr[1]);
      box(M - 2, 21, M + 1, 21, look.style === 'beard' ? '#e9b9a0' : sk[2]);
    }

    // 바깥선: 그림 가장자리에 어두운 테두리를 둘러 도트 그림답게 또렷하게 한다
    const img = c.getImageData(0, 0, SPR_W, SPR_H), d = img.data, edge = [];
    const solid = (x, y) => x >= 0 && y >= 0 && x < SPR_W && y < SPR_H && d[(y * SPR_W + x) * 4 + 3] > 0;
    for (let y = 0; y < SPR_H; y++) for (let x = 0; x < SPR_W; x++) {
      if (!solid(x, y) && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))) edge.push([x, y]);
    }
    for (const [x, y] of edge) raw(x, y, x, y, '#1c130d');
    return cv;
  }

  // 옆모습. 오른쪽을 보는 그림을 찍고, left 면 좌우를 뒤집어 찍는다(번호 글자만은 뒤집지 않는다).
  function makeSide(team, num, pose, left) {
    const cv = document.createElement('canvas'); cv.width = SPR_W; cv.height = SPR_H;
    const c = cv.getContext('2d');
    const t = SPR_TEAM[team], look = SPR_LOOK[num], sk = look.skin, hr = look.hair, bd = SPR_BUILD[num], M = SPR_MID;
    const raw = (x0, y0, x1, y1, col) => { c.fillStyle = col; c.fillRect(x0, y0, x1 - x0 + 1, y1 - y0 + 1); };
    const box = (x0, y0, x1, y1, col) => left ? raw(SPR_W - 1 - x1, y0, SPR_W - 1 - x0, y1, col) : raw(x0, y0, x1, y1, col);
    const dot = (x, y, col) => box(x, y, x, y, col);
    const shade = (x0, y0, x1, y1, pal) => { box(x0, y0, x1, y1, pal[1]); box(x0, y0, x0, y1, pal[0]); box(Math.max(x0 + 1, x1 - 1), y0, x1, y1, pal[2]); };
    const WHITE = ['#ffffff', '#eef0f3', '#c3c9d1'], FAR = [sk[1], sk[2], sk[2]];
    const w = bd.hw + 1, tx0 = M - (w >> 1), tx1 = tx0 + w - 1;      // 옆에서 본 몸통 두께
    const W = bd.arm - 1, ax0 = tx0 + 1, ax1 = ax0 + W;               // 팔이 어깨에 붙는 자리
    const passing = pose === 'passL' || pose === 'passR';

    // 다리: 먼 쪽 다리를 먼저(어둡게), 가까운 쪽 다리를 나중에
    const leg = (off, up, pal) => {
      const x0 = M - (bd.leg >> 1) - 1 + off, x1 = x0 + bd.leg - 1;
      shade(x0, 46, x1, 50 - up, pal); shade(x0, 51 - up, x1, 52 - up, WHITE);
      shade(x0 - 1, 53 - up, x1 + 2, 54 - up, WHITE); box(x0 - 1, 55 - up, x1 + 2, 55 - up, '#3a3f48');
      dot(x1 + 1, 53 - up, t.jersey[1]);
    };
    if (pose === 'run1') { leg(-3, 0, FAR); leg(3, 3, sk); }
    else if (pose === 'run2') { leg(3, 3, FAR); leg(-3, 0, sk); }
    else if (pose === 'screen' || pose === 'guard') { leg(3, 0, FAR); leg(-3, 0, sk); }
    else { leg(1, 0, FAR); leg(-1, 0, sk); }
    // 반바지 · 상의
    shade(tx0, 39, tx1, 45, t.shorts); box(tx0, 39, tx1, 39, t.trim); box(M, 41, M, 45, t.trim);
    shade(tx0, 26, tx1, 38, t.jersey); box(tx0, 26, tx1, 26, t.trim); box(tx0, 38, tx1, 38, t.jersey[2]);
    // 번호: 몸통 앞쪽에. 글자는 뒤집지 않는다
    const dx = left ? SPR_W - 1 - (tx1 - 1) : tx1 - 5;
    SPR_DIGIT[num].forEach((row, j) => [...row].forEach((ch, i) => { if (ch === '#') raw(dx + i, 30 + j, dx + i, 30 + j, '#ffffff'); }));
    // 목 · 머리
    box(M - 1, 24, M + 2, 25, sk[2]);
    const cx = M + 0.5, cy = 17, rx = 6.6, ry = 7.2;
    const inHead = (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
    const each = fn => { for (let y = 3; y <= 25; y++) for (let x = M - 11; x <= M + 11; x++) fn(x, y); };
    each((x, y) => { if (inHead(x, y)) dot(x, y, x < M - 3 ? sk[2] : x > M + 5 ? sk[0] : sk[1]); });
    dot(M + 8, 19, sk[1]);                                            // 코
    // 머리카락: 윗머리와 뒤통수
    const hairAt = (x, y) => dot(x, y, x < M - 2 ? hr[1] : hr[0]);
    const cap = (top, backTo) => each((x, y) => { if (inHead(x, y) && (y <= top || (x <= M - 2 && y <= backTo))) hairAt(x, y); });
    if (look.style === 'short') cap(13, 20);
    else if (look.style === 'band') { cap(12, 20); box(M - 6, 13, M + 7, 14, '#f4f4f4'); box(M - 6, 13, M - 5, 14, '#c3c9d1'); }
    else if (look.style === 'flat') { cap(12, 19); box(M - 5, 8, M + 6, 9, hr[0]); box(M - 5, 8, M - 3, 9, hr[1]); }
    else if (look.style === 'afro') { cap(13, 20); each((x, y) => { if (y <= 15 && ((x - cx) / 9.4) ** 2 + ((y - 11) / 6.6) ** 2 <= 1 && !(inHead(x, y) && y > 13 && x > M - 2)) hairAt(x, y); }); }
    else if (look.style === 'beard') { cap(11, 17); each((x, y) => { if (inHead(x, y) && y >= 20 && x >= M - 1 && !(y === 21 && x >= M + 5)) hairAt(x, y); }); }
    if (look.style !== 'afro') box(M - 1, 17, M, 18, sk[2]);          // 귀
    box(M + 4, 17, M + 5, 18, '#1b1410'); dot(M + 4, 17, '#ffffff');  // 눈
    box(M + 3, 15, M + 6, 15, hr[1]);                                 // 눈썹
    box(M + 5, 21, M + 7, 21, look.style === 'beard' ? '#e9b9a0' : sk[2]);   // 입
    // 팔 (가까운 쪽 한 팔)
    const limb = (xa, ya, xb, yb) => {
      const n = Math.max(Math.abs(xb - xa), Math.abs(yb - ya));
      for (let i = 0; i <= n; i++) { const x = Math.round(xa + (xb - xa) * i / n), y = Math.round(ya + (yb - ya) * i / n); shade(x, y, x + W, y + 1, sk); }
    };
    if (pose === 'up') limb(ax0, 28, M + 9, 12);                                          // 수비: 팔을 앞으로 들어 올린다
    else if (pose === 'shoot') { limb(ax0, 28, M + 8, 6); shade(M + 8, 3, M + 9 + W, 5, sk); }   // 슛: 머리 위로 뻗고 손목을 꺾는다
    else if (pose === 'reb') limb(ax0, 28, M + 7, 2);                                     // 리바운드: 끝까지 뻗는다
    else if (pose === 'ball') { shade(ax0, 27, ax1, 33, sk); shade(ax0, 33, tx1 + 4, 35, sk); }   // 볼을 든 팔은 앞으로
    else if (pose === 'run1') { shade(ax0, 27, ax1, 32, sk); shade(ax0, 31, tx1 + 2, 33, sk); }
    else if (pose === 'run2') { shade(ax0, 27, ax1, 32, sk); shade(tx0 - 3, 31, ax1, 33, sk); }
    else if (passing) shade(ax0, 28, tx1 + 7, 31, sk);                                    // 패스: 앞으로 쭉 뻗는다
    else if (pose === 'screen') { shade(ax0, 27, ax1, 33, sk); shade(ax0, 33, tx1 + 1, 36, sk); }   // 스크린: 팔을 가슴 앞에 댄다
    else if (pose === 'guard') limb(ax0, 28, tx1 + 5, 35);                                // 수비: 팔을 앞으로 벌려 내민다
    else shade(ax0, 27, ax1, 41, sk);

    const img = c.getImageData(0, 0, SPR_W, SPR_H), d = img.data, edge = [];
    const solid = (x, y) => x >= 0 && y >= 0 && x < SPR_W && y < SPR_H && d[(y * SPR_W + x) * 4 + 3] > 0;
    for (let y = 0; y < SPR_H; y++) for (let x = 0; x < SPR_W; x++) {
      if (!solid(x, y) && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))) edge.push([x, y]);
    }
    for (const [x, y] of edge) raw(x, y, x, y, '#1c130d');
    return cv;
  }

  // face: 'f' 앞 · 'b' 뒤 · 'l' 왼쪽 · 'r' 오른쪽 · 'fl' 'fr' 'bl' 'br' 45도
  function spriteOf(team, num, pose, face) {
    face = face === true ? 'b' : face || 'f';
    const key = team + num + pose + '/' + face;
    if (!spriteCache.has(key)) {
      spriteCache.set(key, face === 'l' || face === 'r' ? makeSide(team, num, pose, face === 'l')
        : makeSprite(team, num, pose, face[0] === 'b', face[1] === 'r' ? 1 : face[1] === 'l' ? -1 : 0));
    }
    return spriteCache.get(key);
  }

  // 볼 든 손끝이 그림 속 어디인가 (makeSprite·makeSide 의 '볼 들기' 팔 끝과 맞춘다)
  function handAt(p, face) {
    const bd = SPR_BUILD[p.num], W = bd.arm - 1;
    let px;
    if (face === 'l' || face === 'r') { const w = bd.hw + 1; px = SPR_MID - (w >> 1) + w + 6; }
    else px = SPR_MID + bd.hw + W + 6 - (face.length > 1 ? 1 : 0);
    if (face === 'l' || face[1] === 'l') px = SPR_W - 1 - px;
    return { px, py: 34 };
  }

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
      if (r && r.kind === 'steal' && r.by) say(typeof r.by === 'string' ? r.by : r.by.id, '스틸');
    }
    if (view.replay || S.phase === 'result' || S.phase === 'over') return;
    const poss = S.poss.A + S.poss.B, cur = new Set(R.screens(S).map(([o, d]) => o.id + '>' + d.id));
    if (view.scrPoss === poss && view.scrSet) {
      for (const k of cur) { const id = k.split('>')[0]; if (!view.scrSet.has(k) && id !== S.ball) say(id, '스크린'); }
    }
    view.scrSet = cur; view.scrPoss = poss;
  }

  // opt: pose 자세 · face 보는 방향 · jump 뛰어오른 높이(키에 대한 비율)
  function drawFigure(p, g, opt) {
    const s = g.s, h = figH(p, g), jump = (opt.jump || 0) * h;
    const sq = 1 - (opt.jump || 0) * 1.2;                     // 뛰어오르면 그림자가 작아진다
    ctx.beginPath(); ctx.ellipse(g.x + 0.06 * s, g.y + 0.02 * s, 0.46 * s * sq, 0.16 * s * sq, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fill();
    const u = h / (SPR_FOOT - SPR_TOP + 1);                   // 그림의 한 점이 화면에서 몇 픽셀인가
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(spriteOf(p.team, p.num, opt.pose || 'stand', opt.face), g.x - SPR_MID * u, g.y - (SPR_FOOT + 1) * u - jump, SPR_W * u, SPR_H * u);
    ctx.imageSmoothingEnabled = true;
  }

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
    const faceOf = id => {
      const d = disp[id], tgt = id === holder ? RIM : handler;
      let fx = tgt.x - d.x, fy = tgt.y - d.y;
      if (flipped) { fx = -fx; fy = -fy; }
      return FACES[((Math.round(Math.atan2(-fy, fx) / (Math.PI / 4)) % 8) + 8) % 8];
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
      let pose = 'stand', jump = 0;
      if (shotT >= 0 && sh.by === p.id) { pose = 'shoot'; jump = shotT < 520 ? Math.sin(Math.PI * shotT / 520) * 0.16 : 0; }
      else if (shotT >= SHOT_FLY && !sh.made && sh.reb === p.id) { pose = 'reb'; jump = Math.sin(Math.PI * Math.min(1, (shotT - SHOT_FLY) / SHOT_BOUNCE)) * 0.2; }
      else if (view.passer && view.passer.id === p.id) pose = proj(disp[view.passer.to].x, disp[view.passer.to].y, 0).x >= g.x ? 'passR' : 'passL';
      else if (stride[p.id]) pose = Math.floor(now / 110) % 2 ? 'run1' : 'run2';
      else if (defending && near && S.phase !== 'over') pose = 'up';
      else if (p.id === holder && !sh) pose = 'ball';
      else if (screeners.has(p.id) && p.id !== holder) pose = 'screen';
      else if (defending && S.phase !== 'over') pose = 'guard';
      // 몸의 방향: 볼 가진 선수는 골대를, 나머지는 공격·수비 모두 볼을 본다.
      // 보는 쪽을 화면 기준 여덟 방향(45도 간격)으로 나눠 옆·앞·뒤·45도 그림을 고른다
      const face = faceOf(p.id);
      drawFigure(p, g, { pose, jump, face });
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

    // 공: 슛 중에는 궤적을 따라가고, 평소에는 볼 가진 선수의 손에
    if (view.shot) {
      const pos = shotBall();
      drawBall(pos.x, pos.y, pos.rad);
    } else {
      const g = proj(ballDisp.x, ballDisp.y, 0), hp = R.byId(S, holder);
      // 볼은 볼 든 손끝에 붙인다 (보는 방향에 따라 손의 자리가 다르다)
      const u = figH(hp, g) / (SPR_FOOT - SPR_TOP + 1), hand = handAt(hp, faceOf(holder));
      drawBall(g.x + (hand.px + 0.5 - SPR_MID) * u, g.y - (SPR_FOOT + 0.5 - hand.py) * u, 0.17 * g.s);
    }
  }

  // ───────── 슛 애니메이션 ─────────
  // 볼이 슈터에게서 포물선으로 골대까지 날아간다. 들어가면 골대에 머무르고,
  // 빗나가면 림에서 튕겨 리바운드를 잡은 선수에게 간다. 두 궤적 모두 점선으로 남긴다.
  const SHOT_FLY = 800, SHOT_HANG = 350, SHOT_BOUNCE = 650;

  function startShot(from, result) {
    if (!result || (result.kind !== 'made' && result.kind !== 'miss')) return;
    view.shot = { from, by: result.by, made: result.kind === 'made', reb: result.reb || null, t0: performance.now(), rest: false };
    // 슛 종류는 규칙(rules.js shotInfo)과 같은 기준: 3m 안은 골밑, 3점 라인 밖은 3점, 그 사이는 미들
    const sd = Math.hypot(from.x - RIM.x, from.y - RIM.y);
    const three = sd > 6.75 || (Math.abs(from.x - RIM.x) > 6.6 && from.y < 2.99);
    say(result.by, sd <= 3 ? '골밑슛' : three ? '3점슛' : '미들슛');
    // 리바운드: 튕긴 볼을 잡는 순간, 잡은 선수가 말한다
    if (result.kind === 'miss' && result.reb) {
      const shot = view.shot;
      setTimeout(() => { if (view.shot === shot) { say(result.reb, '리바운드'); requestDraw(); } }, SHOT_FLY + SHOT_BOUNCE - 120);
    }
    view.locked = true;
    const total = SHOT_FLY + (view.shot.made ? SHOT_HANG : SHOT_BOUNCE);
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

  // 지금 이 순간 볼이 그려질 화면 위치와 반지름. 궤적 점선도 여기서 그린다.
  function shotBall() {
    const sh = view.shot;
    const now = sh.rest ? 1e9 : performance.now() - sh.t0;
    const from = { x: sh.from.x, y: sh.from.y, z: 2.45 }, rim = { x: RIM.x, y: RIM.y, z: RIM_Z };
    const dist = Math.hypot(rim.x - from.x, rim.y - from.y);
    const lift = Math.max(1.1, dist * 0.24);                     // 멀리서 쏠수록 높이 뜬다
    const lerp3 = (a, b, t, up) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t + up * 4 * t * (1 - t) });
    const scr = q => { const p = proj(q.x, q.y, q.z); return { x: p.x, y: p.y, rad: 0.17 * p.s }; };
    const fly = t => scr(lerp3(from, rim, t, lift));

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
    if (sh.made) return scr({ x: RIM.x, y: RIM.y, z: RIM_Z - 0.25 });      // 그물 안에 머무른다

    // 빗나감: 림에서 튕겨 리바운드 잡은 선수의 손으로
    const d = disp[sh.reb];
    const hand = { x: d.x + 0.3, y: d.y, z: 1.7 };
    const bounce = t => scr(lerp3(rim, hand, t, 0.9));
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
    for (const p of S.players) {
      const at = rp ? rp.p[p.id] : p;
      const c = R.center(at.q, at.r);
      walk(p.id, c.x, c.y);
    }
    const holder = rp ? rp.ball : S.ball;
    // 패스: 볼이 다른 선수에게 넘어가는 동안 준 선수가 팔을 뻗는다
    if (holder !== view.lastHolder) {
      const prev = view.lastHolder; view.lastHolder = holder;
      if (prev && disp[prev] && !view.shot && Math.hypot(ballDisp.x - disp[holder].x, ballDisp.y - disp[holder].y) > 0.6) {
        view.passer = { id: prev, to: holder, until: now + 420 };
        if (prev[0] === holder[0]) say(holder, '패스');      // 볼을 받은 선수가 말한다
      }
    }
    if (view.passer) { if (now < view.passer.until) moving = true; else view.passer = null; }
    if (view.shot) { ballDisp.x = disp[holder].x; ballDisp.y = disp[holder].y; if (!view.shot.rest) moving = true; }
    else ease(ballDisp, disp[holder].x, disp[holder].y);

    ctx.clearRect(0, 0, cssW, cssH);
    drawCourt();
    drawReach();
    drawScreens();
    if (!flipped) drawHoop();           // 골대가 뒤(위)에 있을 때는 선수보다 먼저
    drawPassLines();
    drawPlayers();
    if (flipped) drawHoop();            // 골대가 앞(아래)에 있을 때는 선수 위에 반투명하게
    drawCloseLabels();
    drawPassLabels();
    watchSays();
    if (drawBubbles(now)) moving = true;
    if (moving) requestDraw();
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
  function aiStep() {
    aiTimer = null;
    if (!aiTurn()) return;
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
    S = R.newGame(formation, (Math.random() * 0x7fffffff) | 0, builds);
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
  window.__game = { state: null, toScreen, view, builds, tape, spriteOf, isRotated: () => rotated };

  showSetup();
})();
