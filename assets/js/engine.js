/* =========================================================
   围棋规则引擎 GoGame
   - 棋盘：一维 Int8Array，0 空 / 1 黑 / 2 白
   - 规则：提子、自杀禁着、简单劫、连续停一手终局
   - 数子：中式数子法（子 + 空 + 贴目），支持标记死子
   - 导出：SGF
   ========================================================= */
(function (global) {
  'use strict';

  var EMPTY = 0;
  var BLACK = 1;
  var WHITE = 2;
  var DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  var COORD_LETTERS = 'ABCDEFGHJKLMNOPQRSTUVWXYZ';

  function other(color) {
    return color === BLACK ? WHITE : BLACK;
  }

  function keyOf(board) {
    var out = '';
    for (var i = 0; i < board.length; i += 1) out += board[i];
    return out;
  }

  function GoGame(size, komi) {
    this.size = size || 19;
    this.komi = typeof komi === 'number' ? komi : 7.5;
    this.reset();
  }

  GoGame.BLACK = BLACK;
  GoGame.WHITE = WHITE;
  GoGame.EMPTY = EMPTY;
  GoGame.DIRS = DIRS;

  GoGame.prototype.reset = function () {
    var n = this.size * this.size;
    this.board = new Int8Array(n);
    this.turn = BLACK;
    this.captures = { 1: 0, 2: 0 };
    this.moves = [];
    this.history = [];
    this.positions = [keyOf(this.board)];
    this.lastMove = null;
    this.consecutivePasses = 0;
    this.over = false;
    this.result = null;
    this.dead = new Set();
  };

  GoGame.prototype.idx = function (x, y) {
    return y * this.size + x;
  };

  GoGame.prototype.onBoard = function (x, y) {
    return x >= 0 && y >= 0 && x < this.size && y < this.size;
  };

  GoGame.prototype.get = function (x, y) {
    if (!this.onBoard(x, y)) return -1;
    return this.board[this.idx(x, y)];
  };

  GoGame.prototype.moveCount = function () {
    return this.moves.length;
  };

  /* 计算某点所在棋块：{ color, stones:[idx], liberties:Number } */
  GoGame.prototype.groupAt = function (x, y, board) {
    board = board || this.board;
    if (!this.onBoard(x, y)) return null;
    var size = this.size;
    var start = this.idx(x, y);
    var color = board[start];
    if (color === EMPTY) return null;

    var seen = new Uint8Array(board.length);
    var libSeen = new Uint8Array(board.length);
    var stack = [start];
    var stones = [];
    var liberties = 0;
    seen[start] = 1;

    while (stack.length) {
      var i = stack.pop();
      stones.push(i);
      var cx = i % size;
      var cy = (i / size) | 0;

      for (var d = 0; d < 4; d += 1) {
        var nx = cx + DIRS[d][0];
        var ny = cy + DIRS[d][1];
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        var ni = ny * size + nx;
        var v = board[ni];
        if (v === EMPTY) {
          if (!libSeen[ni]) {
            libSeen[ni] = 1;
            liberties += 1;
          }
        } else if (v === color && !seen[ni]) {
          seen[ni] = 1;
          stack.push(ni);
        }
      }
    }

    return { color: color, stones: stones, liberties: liberties };
  };

  /* 在副本上试下，返回 { board, captured, liberties } */
  GoGame.prototype.simulate = function (x, y, color, baseBoard) {
    var board = new Int8Array(baseBoard || this.board);
    var size = this.size;
    var i = this.idx(x, y);
    board[i] = color;
    var opp = other(color);
    var captured = [];

    for (var d = 0; d < 4; d += 1) {
      var nx = x + DIRS[d][0];
      var ny = y + DIRS[d][1];
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      var ni = ny * size + nx;
      if (board[ni] === opp) {
        var g = this.groupAt(nx, ny, board);
        if (g && g.liberties === 0) {
          for (var k = 0; k < g.stones.length; k += 1) {
            board[g.stones[k]] = EMPTY;
            captured.push(g.stones[k]);
          }
        }
      }
    }

    var own = this.groupAt(x, y, board);
    return { board: board, captured: captured, liberties: own ? own.liberties : 0 };
  };

  /* 合法性：{ ok, reason } reason ∈ occupied|suicide|ko|over|out */
  GoGame.prototype.isLegal = function (x, y) {
    if (this.over) return { ok: false, reason: 'over' };
    if (!this.onBoard(x, y)) return { ok: false, reason: 'out' };
    if (this.board[this.idx(x, y)] !== EMPTY) return { ok: false, reason: 'occupied' };

    var sim = this.simulate(x, y, this.turn);
    if (sim.liberties === 0 && sim.captured.length === 0) {
      return { ok: false, reason: 'suicide' };
    }

    var n = this.positions.length;
    if (n >= 2 && keyOf(sim.board) === this.positions[n - 2]) {
      return { ok: false, reason: 'ko' };
    }

    return { ok: true };
  };

  GoGame.prototype.snapshot = function () {
    this.history.push({
      board: new Int8Array(this.board),
      turn: this.turn,
      captures: { 1: this.captures[1], 2: this.captures[2] },
      lastMove: this.lastMove,
      consecutivePasses: this.consecutivePasses,
      positionsLen: this.positions.length,
      over: this.over,
      result: this.result
    });
  };

  GoGame.prototype.play = function (x, y) {
    var check = this.isLegal(x, y);
    if (!check.ok) return check;

    var color = this.turn;
    var sim = this.simulate(x, y, color);

    this.snapshot();
    this.board = sim.board;
    for (var i = 0; i < sim.captured.length; i += 1) {
      this.captures[color] += 1;
    }
    this.moves.push({
      color: color,
      x: x,
      y: y,
      pass: false,
      captured: sim.captured.slice()
    });
    this.lastMove = { x: x, y: y, color: color };
    this.consecutivePasses = 0;
    this.positions.push(keyOf(this.board));
    this.turn = other(color);

    return { ok: true, color: color, captured: sim.captured };
  };

  GoGame.prototype.pass = function () {
    if (this.over) return { ok: false, reason: 'over' };
    var color = this.turn;
    this.snapshot();
    this.moves.push({ color: color, pass: true });
    this.consecutivePasses += 1;
    this.turn = other(color);
    this.lastMove = null;
    return {
      ok: true,
      color: color,
      bothPassed: this.consecutivePasses >= 2
    };
  };

  GoGame.prototype.resign = function () {
    if (this.over) return { ok: false, reason: 'over' };
    var color = this.turn;
    var winner = other(color);
    this.over = true;
    this.result = {
      winner: winner,
      reason: 'resign',
      text: (winner === BLACK ? '黑棋' : '白棋') + '中盘胜',
      sgf: (winner === BLACK ? 'B' : 'W') + '+R'
    };
    return { ok: true, winner: winner };
  };

  GoGame.prototype.undo = function () {
    if (!this.history.length) return false;
    var snap = this.history.pop();
    this.board = snap.board;
    this.turn = snap.turn;
    this.captures = snap.captures;
    this.lastMove = snap.lastMove;
    this.consecutivePasses = snap.consecutivePasses;
    this.positions.length = snap.positionsLen;
    this.over = snap.over;
    this.result = snap.result;
    this.moves.pop();
    this.dead.clear();
    return true;
  };

  GoGame.prototype.canUndo = function () {
    return this.history.length > 0;
  };

  GoGame.prototype.toggleDead = function (x, y) {
    var i = this.idx(x, y);
    if (this.board[i] === EMPTY) return false;
    var group = this.groupAt(x, y);
    var dead = this.dead;
    var allDead = group.stones.every(function (s) { return dead.has(s); });
    for (var k = 0; k < group.stones.length; k += 1) {
      if (allDead) dead.delete(group.stones[k]);
      else dead.add(group.stones[k]);
    }
    return true;
  };

  /* 中式数子：子 + 空；白方加贴目。返回详细结果 */
  GoGame.prototype.score = function () {
    var size = this.size;
    var board = new Int8Array(this.board);
    var i, n;

    for (i = 0; i < board.length; i += 1) {
      if (this.dead.has(i)) board[i] = EMPTY;
    }

    var blackStones = 0;
    var whiteStones = 0;
    for (i = 0; i < board.length; i += 1) {
      if (board[i] === BLACK) blackStones += 1;
      else if (board[i] === WHITE) whiteStones += 1;
    }

    var territory = new Int8Array(board.length);
    var visited = new Uint8Array(board.length);
    var blackTerritory = 0;
    var whiteTerritory = 0;
    var neutral = 0;
    var regions = [];

    for (i = 0; i < board.length; i += 1) {
      if (board[i] !== EMPTY || visited[i]) continue;
      var stack = [i];
      var points = [];
      var borders = 0; /* 1 黑 / 2 白 / 3 双方 */
      visited[i] = 1;

      while (stack.length) {
        n = stack.pop();
        points.push(n);
        var cx = n % size;
        var cy = (n / size) | 0;
        for (var d = 0; d < 4; d += 1) {
          var nx = cx + DIRS[d][0];
          var ny = cy + DIRS[d][1];
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          var ni = ny * size + nx;
          var v = board[ni];
          if (v === EMPTY) {
            if (!visited[ni]) {
              visited[ni] = 1;
              stack.push(ni);
            }
          } else {
            borders |= v;
          }
        }
      }

      var owner = borders === BLACK ? BLACK : borders === WHITE ? WHITE : 0;
      if (owner === BLACK) {
        blackTerritory += points.length;
      } else if (owner === WHITE) {
        whiteTerritory += points.length;
      } else {
        neutral += points.length;
      }
      for (n = 0; n < points.length; n += 1) territory[points[n]] = owner;
      regions.push({ size: points.length, owner: owner });
    }

    var blackScore = blackStones + blackTerritory;
    var whiteScore = whiteStones + whiteTerritory + this.komi;
    var diff = blackScore - whiteScore;

    return {
      blackStones: blackStones,
      whiteStones: whiteStones,
      blackTerritory: blackTerritory,
      whiteTerritory: whiteTerritory,
      neutral: neutral,
      komi: this.komi,
      black: blackScore,
      white: whiteScore,
      diff: diff,
      territory: territory,
      regions: regions,
      winner: diff === 0 ? 0 : diff > 0 ? BLACK : WHITE
    };
  };

  GoGame.prototype.finish = function () {
    var s = this.score();
    this.over = true;
    var text;
    var sgf;
    if (s.diff === 0) {
      text = '和棋';
      sgf = '0';
    } else {
      var winnerName = s.winner === BLACK ? '黑棋' : '白棋';
      text = winnerName + '胜 ' + Math.abs(s.diff).toFixed(1) + ' 子';
      sgf = (s.winner === BLACK ? 'B' : 'W') + '+' + Math.abs(s.diff).toFixed(1);
    }
    this.result = {
      winner: s.winner,
      reason: 'score',
      text: text,
      sgf: sgf,
      score: s
    };
    return s;
  };

  GoGame.prototype.coordLabel = function (x, y) {
    return COORD_LETTERS[x] + String(this.size - y);
  };

  GoGame.prototype.toSGF = function () {
    var self = this;
    function c(i) {
      var x = i % self.size;
      var y = (i / self.size) | 0;
      return String.fromCharCode(97 + x) + String.fromCharCode(97 + y);
    }
    var s = '(;GM[1]FF[4]CA[UTF-8]AP[Weiqi:1.0]SZ[' + this.size + ']KM[' + this.komi + ']RU[Chinese]';
    for (var i = 0; i < this.moves.length; i += 1) {
      var m = this.moves[i];
      s += ';' + (m.color === BLACK ? 'B' : 'W') + '[' + (m.pass ? '' : c(this.idx(m.x, m.y))) + ']';
    }
    if (this.over && this.result && this.result.sgf) s += 'RE[' + this.result.sgf + ']';
    return s + ')\n';
  };

  /* 默认贴目：19 路 7.5，13/9 路 5.5 */
  GoGame.defaultKomi = function (size) {
    return size >= 19 ? 7.5 : 5.5;
  };

  global.GoGame = GoGame;
})(typeof window !== 'undefined' ? window : globalThis);
