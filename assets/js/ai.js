/* =========================================================
   启发式围棋 AI（非神经网络，适合休闲对弈）
   思路：在「有棋子附近」的候选点中，逐点模拟并打分：
   提子 / 救活被打吃的棋块 / 打吃对方 / 气数 / 自紧气惩罚 /
   填眼惩罚 / 边线偏好 / 局部接触 / 终局让子判断
   ========================================================= */
(function (global) {
  'use strict';

  var GoGame = global.GoGame;
  var BLACK = 1;
  var WHITE = 2;
  var EMPTY = 0;
  var DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  var DIAGS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

  var LEVELS = {
    easy: {
      noise: 70, capture: 85, save: 45, atari: 12, lib: 4,
      eye: 220, selfAtari: 200, ownArea: 18, line: 0.45,
      lookahead: 0, radius: 2, passBelow: -20
    },
    medium: {
      noise: 26, capture: 130, save: 85, atari: 24, lib: 6,
      eye: 380, selfAtari: 300, ownArea: 40, line: 0.8,
      lookahead: 0, radius: 2, passBelow: -35
    },
    hard: {
      noise: 10, capture: 165, save: 120, atari: 36, lib: 8,
      eye: 520, selfAtari: 380, ownArea: 55, line: 1,
      lookahead: 1, radius: 2, passBelow: -50
    }
  };

  function isEyeLike(game, x, y, color) {
    var size = game.size;
    var board = game.board;
    var orthoOpen = 0;
    var diagBad = 0;
    var diagGood = 0;

    for (var d = 0; d < 4; d += 1) {
      var nx = x + DIRS[d][0];
      var ny = y + DIRS[d][1];
      if (!game.onBoard(nx, ny)) continue;
      if (board[ny * size + nx] !== color) orthoOpen += 1;
    }
    if (orthoOpen > 0) return false;

    for (var k = 0; k < 4; k += 1) {
      var dx = x + DIAGS[k][0];
      var dy = y + DIAGS[k][1];
      if (!game.onBoard(dx, dy)) continue;
      var v = board[dy * size + dx];
      if (v === 0) diagBad += 0.6;
      else if (v !== color) diagBad += 1;
      else diagGood += 1;
    }

    if (diagBad >= 2) return false;
    if (diagBad >= 1.5 && diagGood <= 1) return false;
    return true;
  }

  function ownAreaPoint(game, x, y, color) {
    var size = game.size;
    var board = game.board;
    var own = 0;
    var opp = 0;
    for (var dy = -2; dy <= 2; dy += 1) {
      for (var dx = -2; dx <= 2; dx += 1) {
        var nx = x + dx;
        var ny = y + dy;
        if (!game.onBoard(nx, ny)) continue;
        var v = board[ny * size + nx];
        if (v === color) own += 1;
        else if (v !== EMPTY) opp += 1;
      }
    }
    return opp === 0 && own >= 5;
  }

  function openingPoints(size) {
    var edge = size >= 13 ? 3 : 2;
    var far = size - 1 - edge;
    var mid = Math.floor((size - 1) / 2);
    var raw = [
      [edge, far], [far, edge], [far, far], [edge, edge],
      [edge, mid], [mid, edge], [far, mid], [mid, far]
    ];
    if (size % 2 === 1) raw.push([mid, mid]);
    return raw.map(function (p) { return { x: p[0], y: p[1] }; });
  }

  function collectCandidates(game, lv) {
    var size = game.size;
    var board = game.board;
    var empties = [];
    var seen = new Uint8Array(board.length);
    var hasStone = false;

    for (var i = 0; i < board.length; i += 1) {
      if (board[i] !== EMPTY) { hasStone = true; break; }
    }
    if (!hasStone) return openingPoints(size);

    var radius = lv.radius;
    for (var y = 0; y < size; y += 1) {
      for (var x = 0; x < size; x += 1) {
        if (board[y * size + x] !== EMPTY) continue;
        var near = false;
        for (var dy = -radius; dy <= radius && !near; dy += 1) {
          for (var dx = -radius; dx <= radius; dx += 1) {
            var nx = x + dx;
            var ny = y + dy;
            if (!game.onBoard(nx, ny)) continue;
            if (board[ny * size + nx] !== EMPTY) { near = true; break; }
          }
        }
        if (near && !seen[y * size + x]) {
          seen[y * size + x] = 1;
          empties.push({ x: x, y: y });
        }
      }
    }

    if (!empties.length) {
      for (var j = 0; j < board.length; j += 1) {
        if (board[j] === EMPTY) empties.push({ x: j % size, y: (j / size) | 0 });
      }
    }
    return empties;
  }

  function evaluate(game, move, lv) {
    var size = game.size;
    var x = move.x;
    var y = move.y;
    var color = game.turn;
    var opp = color === BLACK ? WHITE : BLACK;
    var sim = game.simulate(x, y, color);
    var score = 0;
    var d, nx, ny;

    score += sim.captured.length * lv.capture;

    if (sim.captured.length === 0 && sim.liberties === 1) {
      score -= lv.selfAtari;
    }

    score += Math.min(sim.liberties, 5) * lv.lib;

    /* 救活被打吃的己方棋块 */
    var saved = 0;
    for (d = 0; d < 4; d += 1) {
      nx = x + DIRS[d][0];
      ny = y + DIRS[d][1];
      if (!game.onBoard(nx, ny)) continue;
      if (game.board[ny * size + nx] !== color) continue;
      var g = game.groupAt(nx, ny);
      if (g && g.liberties === 1) saved += g.stones.length;
    }
    if (saved > 0) score += saved * lv.save;

    /* 打吃对方 */
    var threatened = 0;
    for (d = 0; d < 4; d += 1) {
      nx = x + DIRS[d][0];
      ny = y + DIRS[d][1];
      if (!game.onBoard(nx, ny)) continue;
      if (sim.board[ny * size + nx] !== opp) continue;
      var og = game.groupAt(nx, ny, sim.board);
      if (og && og.liberties === 1) threatened += og.stones.length;
    }
    if (threatened > 0) score += threatened * lv.atari;

    /* 不填自己的眼 */
    if (isEyeLike(game, x, y, color)) score -= lv.eye;

    /* 不往自家空里填子 */
    if (ownAreaPoint(game, x, y, color) && sim.captured.length === 0) {
      score -= lv.ownArea;
    }

    /* 边线偏好：开局喜欢三四线，避免一线 */
    var dist = Math.min(x, y, size - 1 - x, size - 1 - y);
    var phase = Math.min(1, game.moveCount() / Math.max(6, size * 1.5));
    var lineBonus = 0;
    if (dist === 0) lineBonus = -45;
    else if (dist === 1) lineBonus = -2;
    else if (dist === 2) lineBonus = 34;
    else if (dist === 3) lineBonus = 30;
    else if (dist === 4) lineBonus = 6;
    else lineBonus = -14;
    score += lineBonus * lv.line * (1 - 0.55 * phase);

    /* 局部接触：靠近双方棋子更有价值 */
    var around = 0;
    var contact = 0;
    for (var dy = -2; dy <= 2; dy += 1) {
      for (var dx = -2; dx <= 2; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        nx = x + dx;
        ny = y + dy;
        if (!game.onBoard(nx, ny)) continue;
        var v = game.board[ny * size + nx];
        if (v === EMPTY) continue;
        around += 1;
        if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) contact += 1;
      }
    }
    score += Math.min(around, 8) * 7 + contact * 6;

    /* 跟着对手上一手走 */
    if (game.lastMove) {
      var dm = Math.max(Math.abs(game.lastMove.x - x), Math.abs(game.lastMove.y - y));
      if (dm <= 3) score += (4 - dm) * 6;
    }

    score += (Math.random() - 0.5) * lv.noise;
    return score;
  }

  /* 高手模式：检查对手的最佳反击（提子/打吃） */
  function opponentPunish(game, move, sim, lv) {
    var size = game.size;
    var color = game.turn;
    var opp = color === BLACK ? WHITE : BLACK;
    var worst = 0;
    var seen = {};

    function inspect(px, py) {
      var key = py * size + px;
      if (seen[key]) return;
      seen[key] = 1;
      var legal = { ok: true };
      var g = game.groupAt(px, py, sim.board);
      if (!g || g.liberties !== 1) return;
      /* 对手提掉该棋块 */
      var test = new Int8Array(sim.board);
      test[py * size + px] = opp;
      var captured = 0;
      var stones = g.stones;
      var i, d, nx, ny;
      for (i = 0; i < stones.length; i += 1) {
        test[stones[i]] = EMPTY;
        captured += 1;
      }
      for (i = 0; i < stones.length; i += 1) {
        var cx = stones[i] % size;
        var cy = (stones[i] / size) | 0;
        for (d = 0; d < 4; d += 1) {
          nx = cx + DIRS[d][0];
          ny = cy + DIRS[d][1];
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          if (test[ny * size + nx] !== EMPTY) continue;
          var resp = { x: nx, y: ny };
          var sim2 = game.simulate(resp.x, resp.y, opp, test);
          if (sim2.captured.length > captured) captured = sim2.captured.length;
        }
      }
      if (captured > worst) worst = captured;
      void legal;
    }

    /* 检查我方刚落下的棋块 */
    var own = game.groupAt(move.x, move.y, sim.board);
    if (own && own.liberties === 1) {
      for (var i = 0; i < own.stones.length; i += 1) {
        var cx = own.stones[i] % size;
        var cy = (own.stones[i] / size) | 0;
        for (var d = 0; d < 4; d += 1) {
          var nx = cx + DIRS[d][0];
          var ny = cy + DIRS[d][1];
          if (nx >= 0 && ny >= 0 && nx < size && ny < size && sim.board[ny * size + nx] === EMPTY) {
            inspect(nx, ny);
          }
        }
      }
    }

    /* 检查附近被打吃的己方棋块 */
    for (var dy = -2; dy <= 2; dy += 1) {
      for (var dx = -2; dx <= 2; dx += 1) {
        var px = move.x + dx;
        var py = move.y + dy;
        if (px < 0 || py < 0 || px >= size || py >= size) continue;
        if (sim.board[py * size + px] !== color) continue;
        var grp = game.groupAt(px, py, sim.board);
        if (grp && grp.liberties === 1) inspect(px, py);
      }
    }

    return worst * lv.capture * 0.75;
  }

  function shouldPass(game, best) {
    if (game.moveCount() === 0) return false;
    if (best === null) return true;
    return best < -18;
  }

  function nearOpponent(game, x, y, radius) {
    var size = game.size;
    var board = game.board;
    var opp = game.turn === BLACK ? WHITE : BLACK;
    for (var dy = -radius; dy <= radius; dy += 1) {
      for (var dx = -radius; dx <= radius; dx += 1) {
        var nx = x + dx;
        var ny = y + dy;
        if (!game.onBoard(nx, ny)) continue;
        if (board[ny * size + nx] === opp) return true;
      }
    }
    return false;
  }

  function chooseMove(game, level) {
    if (game.over) return null;
    var lv = LEVELS[level] || LEVELS.medium;
    var candidates = collectCandidates(game, lv);
    var territory = game.moveCount() > game.size * 2 ? game.score().territory : null;
    var scored = [];
    var i;

    for (i = 0; i < candidates.length; i += 1) {
      var mv = candidates[i];
      var idx = mv.y * game.size + mv.x;
      /* 终局阶段不要往自己的空里填子 */
      if (territory && territory[idx] === game.turn && !nearOpponent(game, mv.x, mv.y, 3)) {
        continue;
      }
      var legal = game.isLegal(mv.x, mv.y);
      if (!legal.ok) continue;
      scored.push({
        x: mv.x,
        y: mv.y,
        score: evaluate(game, mv, lv)
      });
    }

    if (!scored.length) return null;

    scored.sort(function (a, b) { return b.score - a.score; });

    if (lv.lookahead) {
      var top = scored.slice(0, 6);
      for (i = 0; i < top.length; i += 1) {
        var sim = game.simulate(top[i].x, top[i].y, game.turn);
        top[i].score -= opponentPunish(game, top[i], sim, lv);
      }
      top.sort(function (a, b) { return b.score - a.score; });
      scored = top.concat(scored.slice(6));
    }

    var best = scored[0];
    if (shouldPass(game, best.score)) return null;
    /* 对手刚停一手：若没有提子/救棋等有价值的着手，礼貌收束对局 */
    if (game.consecutivePasses === 1 && best.score < 45) return null;
    return { x: best.x, y: best.y };
  }

  global.WeiqiAI = {
    chooseMove: chooseMove,
    levels: Object.keys(LEVELS)
  };
})(typeof window !== 'undefined' ? window : globalThis);
