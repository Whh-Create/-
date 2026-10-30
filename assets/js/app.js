/* =========================================================
   应用层：界面联动、人机对局、数子结算、SGF 导出
   ========================================================= */
(function () {
  'use strict';

  var GoGame = window.GoGame;
  var BoardView = window.BoardView;
  var AI = window.WeiqiAI;
  var BLACK = 1;
  var WHITE = 2;

  var PREF_KEY = 'weiqi.prefs.v1';

  var state = {
    size: 19,
    mode: 'ai',
    level: 'medium',
    game: null,
    playing: false,
    scoring: false,
    thinking: false,
    token: 0,
    estimateOn: false
  };

  var el = {};
  var view = null;
  var toastTimer = null;
  var confirmCallback = null;

  function $(id) { return document.getElementById(id); }

  function fmt(n) {
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
  }

  function loadPrefs() {
    try {
      var raw = window.localStorage.getItem(PREF_KEY);
      if (!raw) return;
      var p = JSON.parse(raw);
      if (p && [9, 13, 19].indexOf(p.size) >= 0) state.size = p.size;
      if (p && (p.mode === 'ai' || p.mode === 'pvp')) state.mode = p.mode;
      if (p && AI.levels.indexOf(p.level) >= 0) state.level = p.level;
    } catch (err) { /* 忽略损坏的偏好设置 */ }
  }

  function savePrefs() {
    try {
      window.localStorage.setItem(PREF_KEY, JSON.stringify({
        size: state.size,
        mode: state.mode,
        level: state.level
      }));
    } catch (err) { /* 隐私模式下可能不可用 */ }
  }

  function toast(message) {
    el.toast.textContent = message;
    el.toast.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      el.toast.classList.remove('is-visible');
    }, 2200);
  }

  /* ---------------- 对局流程 ---------------- */

  function newGame() {
    state.token += 1;
    state.thinking = false;
    state.scoring = false;
    state.estimateOn = false;
    document.body.classList.remove('is-scoring');
    closeScorePanel();
    view.setMarkDead(false);
    view.setTerritory(null);

    var size = state.size;
    state.game = new GoGame(size, GoGame.defaultKomi(size));
    view.setGame(state.game);
    el.record.innerHTML = '';
    state.renderedMoves = 0;
    updateUI();
  }

  function isHumanTurn() {
    var g = state.game;
    if (!g || g.over || state.scoring || state.thinking) return false;
    if (state.mode === 'pvp') return true;
    return g.turn === BLACK;
  }

  function place(x, y) {
    var g = state.game;
    if (state.scoring) {
      if (g.toggleDead(x, y)) {
        view.setTerritory(g.score().territory);
        updateScoreDialog();
        updateUI();
      }
      return;
    }
    if (!isHumanTurn()) return;

    var res = g.play(x, y);
    if (!res.ok) {
      var msg = {
        occupied: '此处已有棋子',
        suicide: '不可自杀：落子后己方无气',
        ko: '打劫：不能立即回提，请先寻劫',
        over: '对局已结束'
      }[res.reason] || '此处不可落子';
      toast(msg);
      return;
    }

    state.estimateOn = false;
    view.setTerritory(null);
    view.animateMove(g.moves[g.moves.length - 1]);
    updateUI();
    scheduleAI();
  }

  function doPass() {
    var g = state.game;
    if (!isHumanTurn()) return;
    var res = g.pass();
    if (!res.ok) return;
    state.estimateOn = false;
    view.setTerritory(null);
    updateUI();
    if (res.bothPassed) {
      enterScoring();
      return;
    }
    toast((res.color === BLACK ? '黑棋' : '白棋') + '停一手');
    scheduleAI();
  }

  function scheduleAI() {
    var g = state.game;
    if (state.mode !== 'ai' || g.over || state.scoring || g.turn !== WHITE || state.thinking) return;

    state.thinking = true;
    updateUI();
    var token = ++state.token;

    window.setTimeout(function () {
      if (token !== state.token || !state.thinking) return;
      var ai = state.game;
      var mv = AI.chooseMove(ai, state.level);
      state.thinking = false;

      if (mv) {
        var res = ai.play(mv.x, mv.y);
        if (res.ok) view.animateMove(ai.moves[ai.moves.length - 1]);
      } else {
        ai.pass();
      }
      updateUI();
      if (ai.consecutivePasses >= 2) enterScoring();
    }, 240 + Math.random() * 300);
  }

  function undo() {
    var g = state.game;
    if (!g || state.scoring || state.thinking) return;
    if (!g.canUndo()) {
      toast('没有可悔的棋了');
      return;
    }
    var steps = 0;
    g.undo();
    steps += 1;
    if (state.mode === 'ai' && g.turn === WHITE && g.canUndo()) {
      g.undo();
      steps += 1;
    }
    state.estimateOn = false;
    view.setTerritory(null);
    state.renderedMoves = 0;
    el.record.innerHTML = '';
    updateUI();
    toast(steps > 1 ? '已悔棋两手' : '已悔棋');
  }

  function resign() {
    var g = state.game;
    if (!g || g.over || state.scoring) return;
    askConfirm('确认认输？', '认输后本局立即结束。', function () {
      var res = g.resign();
      if (res.ok) {
        view.setMarkDead(false);
        view.setTerritory(null);
        updateUI();
        toast(g.result.text);
      }
    });
  }

  function toggleEstimate() {
    var g = state.game;
    if (!g || g.over || state.scoring) return;
    state.estimateOn = !state.estimateOn;
    if (state.estimateOn) {
      var s = g.score();
      view.setTerritory(s.territory);
      toast('形势判断：黑 ' + fmt(s.black) + ' · 白 ' + fmt(s.white) + '（未终局，仅供参考）');
    } else {
      view.setTerritory(null);
    }
  }

  function requestFinish() {
    var g = state.game;
    if (!g || g.over || state.scoring || state.thinking) return;
    if (g.moveCount() === 0) {
      toast('尚未落子，无需数子');
      return;
    }
    askConfirm('结束对局并数子？', '双方直接进入终局数子，可点选死子后确认结果。', enterScoring);
  }

  function enterScoring() {
    var g = state.game;
    if (g.over) return;
    state.scoring = true;
    state.thinking = false;
    state.token += 1;
    document.body.classList.add('is-scoring');
    view.setMarkDead(true);
    view.setTerritory(g.score().territory);
    updateScoreDialog();
    updateUI();
    if (typeof el.scoreDialog.show === 'function') {
      if (!el.scoreDialog.open) el.scoreDialog.show();
    } else {
      el.scoreDialog.setAttribute('open', '');
    }
  }

  function closeScorePanel() {
    if (!el || !el.scoreDialog) return;
    if (el.scoreDialog.open) el.scoreDialog.close();
    else el.scoreDialog.removeAttribute('open');
  }

  function updateScoreDialog() {
    var g = state.game;
    var s = g.score();
    el.scoreBlack.textContent = fmt(s.black);
    el.scoreWhite.textContent = fmt(s.white);
    el.scoreDetail.textContent =
      '黑：' + s.blackStones + ' 子 ＋ ' + s.blackTerritory + ' 目空　·　' +
      '白：' + s.whiteStones + ' 子 ＋ ' + s.whiteTerritory + ' 目空 ＋ 贴目 ' + fmt(g.komi);
    if (s.diff === 0) {
      el.scoreVerdict.textContent = '和棋';
    } else {
      el.scoreVerdict.textContent = (s.diff > 0 ? '黑' : '白') + '胜 ' + Math.abs(s.diff).toFixed(1) + ' 子';
    }
  }

  function cancelScoring() {
    var g = state.game;
    state.scoring = false;
    document.body.classList.remove('is-scoring');
    closeScorePanel();
    view.setMarkDead(false);
    view.setTerritory(null);
    g.dead.clear();
    g.consecutivePasses = 0;
    updateUI();
    toast('继续对弈');
  }

  function confirmScoring() {
    var g = state.game;
    state.scoring = false;
    document.body.classList.remove('is-scoring');
    closeScorePanel();
    view.setMarkDead(false);
    var s = g.finish();
    view.setTerritory(s.territory);
    updateUI();
    toast(g.result.text);
  }

  /* ---------------- SGF ---------------- */

  function downloadSGF() {
    var g = state.game;
    var text = g.toSGF();
    var blob = new Blob([text], { type: 'application/x-go-sgf;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var d = new Date();
    var stamp = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
    a.href = url;
    a.download = 'weiqi-' + g.size + '-' + stamp + '.sgf';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('已导出 SGF 棋谱');
  }

  /* ---------------- 界面更新 ---------------- */

  function renderRecord() {
    var g = state.game;
    var moves = g.moves;
    if (moves.length < state.renderedMoves) {
      el.record.innerHTML = '';
      state.renderedMoves = 0;
    }
    while (state.renderedMoves < moves.length) {
      var i = state.renderedMoves;
      var m = moves[i];
      var li = document.createElement('li');
      var no = document.createElement('span');
      no.className = 'record__no';
      no.textContent = String(i + 1);

      var dot = document.createElement('span');
      dot.className = 'dot ' + (m.color === BLACK ? 'dot--black' : 'dot--white');

      var coord = document.createElement('span');
      coord.className = 'record__coord';
      coord.textContent = m.pass ? '停一手' : g.coordLabel(m.x, m.y);
      if (m.pass) coord.classList.add('record__pass');

      li.appendChild(no);
      li.appendChild(dot);
      li.appendChild(coord);

      if (!m.pass && m.captured && m.captured.length) {
        var cap = document.createElement('span');
        cap.className = 'record__cap';
        cap.textContent = '提 ' + m.captured.length;
        li.appendChild(cap);
      }

      el.record.appendChild(li);
      state.renderedMoves += 1;
    }

    var items = el.record.children;
    for (var k = 0; k < items.length; k += 1) items[k].classList.remove('is-latest');
    if (items.length) {
      items[items.length - 1].classList.add('is-latest');
      el.record.scrollTop = el.record.scrollHeight;
    }

    el.recordEmpty.style.display = moves.length ? 'none' : '';
    el.recordCount.textContent = moves.length + ' 手';
  }

  function updateUI() {
    var g = state.game;
    if (!g) return;

    el.metaMove.textContent = g.moveCount();
    el.metaCapBlack.textContent = g.captures[BLACK];
    el.metaCapWhite.textContent = g.captures[WHITE];
    el.metaKomi.textContent = fmt(g.komi);
    el.boardTag.textContent = g.size + ' 路';

    el.turnStone.style.display = '';
    el.turnText.classList.remove('is-thinking');

    if (g.over) {
      el.turnText.textContent = g.result ? g.result.text : '对局结束';
      el.turnStone.style.display = 'none';
    } else if (state.scoring) {
      el.turnText.textContent = '终局数子中… 点击棋子标记死子';
      el.turnStone.style.display = 'none';
    } else if (state.thinking) {
      el.turnText.textContent = '白棋思考中…';
      el.turnText.classList.add('is-thinking');
      el.turnStone.className = 'turn-stone is-white';
    } else {
      var isBlack = g.turn === BLACK;
      el.turnStone.className = 'turn-stone ' + (isBlack ? 'is-black' : 'is-white');
      el.turnText.textContent = isBlack ? '黑棋行棋' : '白棋行棋';
    }

    el.btnUndo.disabled = !g.canUndo() || state.thinking || state.scoring;
    el.btnPass.disabled = g.over || state.thinking || state.scoring;
    el.btnResign.disabled = g.over || state.scoring;
    el.btnEstimate.disabled = g.over || state.scoring;
    el.btnFinish.disabled = g.over || state.scoring || state.thinking;
    el.btnSGF.disabled = false;

    el.canvas.classList.toggle('is-locked', g.over || state.scoring || state.thinking);

    if (state.mode === 'ai') {
      el.hintLine.textContent = g.over
        ? '对局结束，点「新对局」再来一盘。'
        : state.thinking
          ? 'AI 正在计算落点…'
          : '你执黑棋，点击棋盘落子。';
    } else {
      el.hintLine.textContent = g.over ? '对局结束，点「新对局」再来一盘。' : '双人对弈，黑先白后。';
    }

    el.segSize.querySelectorAll('button').forEach(function (b) {
      b.setAttribute('aria-pressed', String(Number(b.dataset.size) === state.size));
    });
    el.segMode.querySelectorAll('button').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode));
    });
    el.segLevel.querySelectorAll('button').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.level === state.level));
    });
    el.fieldLevel.style.display = state.mode === 'ai' ? '' : 'none';

    renderRecord();
    syncScoringVisual();
  }

  function syncScoringVisual() {
    var g = state.game;
    if (!g) return;
    var showTerritory = state.scoring || g.over || state.estimateOn;
    if (!showTerritory) view.setTerritory(null);
  }

  /* ---------------- 弹窗 ---------------- */

  function askConfirm(title, desc, onOk) {
    el.confirmTitle.textContent = title;
    el.confirmDesc.textContent = desc;
    confirmCallback = onOk;
    if (typeof el.confirmDialog.showModal === 'function') el.confirmDialog.showModal();
    else el.confirmDialog.setAttribute('open', '');
  }

  function closeConfirm() {
    if (el.confirmDialog.open) el.confirmDialog.close();
    else el.confirmDialog.removeAttribute('open');
    confirmCallback = null;
  }

  function requestNewGame() {
    var g = state.game;
    if (g && g.moveCount() > 0 && !g.over) {
      askConfirm('开始新对局？', '当前棋谱共 ' + g.moveCount() + ' 手，将被清空。', newGame);
    } else {
      newGame();
    }
  }

  function requestSizeChange(size) {
    if (size === state.size) return;
    var g = state.game;
    if (g && g.moveCount() > 0 && !g.over) {
      askConfirm('切换为 ' + size + ' 路棋盘？', '切换棋盘会开始新对局。', function () {
        state.size = size;
        savePrefs();
        newGame();
      });
    } else {
      state.size = size;
      savePrefs();
      newGame();
    }
  }

  function requestModeChange(mode) {
    if (mode === state.mode) return;
    var g = state.game;
    if (g && g.moveCount() > 0 && !g.over) {
      askConfirm(mode === 'ai' ? '切换为人机对弈？' : '切换为双人对弈？', '切换模式会开始新对局。', function () {
        state.mode = mode;
        savePrefs();
        newGame();
      });
    } else {
      state.mode = mode;
      savePrefs();
      newGame();
    }
  }

  /* ---------------- 事件绑定 ---------------- */

  function bind() {
    view.onPoint = function (x, y) {
      if (state.game && state.game.over) return;
      place(x, y);
    };

    document.querySelectorAll('[data-action]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var action = btn.dataset.action;
        if (action === 'new') requestNewGame();
        else if (action === 'undo') undo();
        else if (action === 'pass') doPass();
        else if (action === 'resign') resign();
        else if (action === 'estimate') toggleEstimate();
        else if (action === 'sgf') downloadSGF();
        else if (action === 'finish') requestFinish();
      });
    });

    el.segSize.addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-size]');
      if (b) requestSizeChange(Number(b.dataset.size));
    });

    el.segMode.addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-mode]');
      if (b) requestModeChange(b.dataset.mode);
    });

    el.segLevel.addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-level]');
      if (!b) return;
      state.level = b.dataset.level;
      savePrefs();
      updateUI();
      toast('AI 难度：' + b.textContent);
    });

    $('btn-help').addEventListener('click', function () {
      if (typeof el.helpDialog.showModal === 'function') el.helpDialog.showModal();
      else el.helpDialog.setAttribute('open', '');
    });
    $('help-close').addEventListener('click', function () {
      if (el.helpDialog.open) el.helpDialog.close();
      else el.helpDialog.removeAttribute('open');
    });

    el.scoreCancel.addEventListener('click', cancelScoring);
    el.scoreConfirm.addEventListener('click', confirmScoring);

    el.confirmCancel.addEventListener('click', closeConfirm);
    el.confirmOk.addEventListener('click', function () {
      var cb = confirmCallback;
      closeConfirm();
      if (cb) cb();
    });

    el.scoreDialog.addEventListener('cancel', function (ev) {
      ev.preventDefault();
      cancelScoring();
    });
    el.confirmDialog.addEventListener('cancel', function (ev) {
      ev.preventDefault();
      closeConfirm();
    });

    document.addEventListener('keydown', function (ev) {
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      var tag = (ev.target && ev.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      var key = ev.key.toLowerCase();
      if (key === 'escape' && state.scoring) {
        cancelScoring();
        return;
      }
      if (document.querySelector('dialog[open]')) return;
      if (key === 'n') requestNewGame();
      else if (key === 'u') undo();
      else if (key === 'p') doPass();
      else if (key === 'e') toggleEstimate();
    });
  }

  function cacheElements() {
    el.canvas = $('board');
    el.toast = $('toast');
    el.turnStone = $('turn-stone');
    el.turnText = $('turn-text');
    el.metaMove = $('meta-move');
    el.metaCapBlack = $('meta-cap-black');
    el.metaCapWhite = $('meta-cap-white');
    el.metaKomi = $('meta-komi');
    el.boardTag = $('board-tag');
    el.record = $('record');
    el.recordCount = $('record-count');
    el.recordEmpty = $('record-empty');
    el.hintLine = $('hint-line');
    el.segSize = $('seg-size');
    el.segMode = $('seg-mode');
    el.segLevel = $('seg-level');
    el.fieldLevel = $('field-level');
    el.btnUndo = document.querySelector('[data-action="undo"]');
    el.btnPass = document.querySelector('[data-action="pass"]');
    el.btnResign = document.querySelector('[data-action="resign"]');
    el.btnEstimate = document.querySelector('[data-action="estimate"]');
    el.btnFinish = document.querySelector('[data-action="finish"]');
    el.btnSGF = document.querySelector('[data-action="sgf"]');
    el.scoreDialog = $('dlg-score');
    el.scoreBlack = $('score-black');
    el.scoreWhite = $('score-white');
    el.scoreDetail = $('score-detail');
    el.scoreVerdict = $('score-verdict');
    el.scoreCancel = $('score-cancel');
    el.scoreConfirm = $('score-confirm');
    el.helpDialog = $('dlg-help');
    el.confirmDialog = $('dlg-confirm');
    el.confirmTitle = $('confirm-title');
    el.confirmDesc = $('confirm-desc');
    el.confirmCancel = $('confirm-cancel');
    el.confirmOk = $('confirm-ok');
  }

  function init() {
    cacheElements();
    loadPrefs();
    view = new BoardView(el.canvas);
    state.renderedMoves = 0;
    newGame();
    bind();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
