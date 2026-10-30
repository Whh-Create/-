/* =========================================================
   棋盘渲染 BoardView
   Canvas 2D：木纹底、网格、星位、棋子渐变、落子/提子动画、
   最后一手标记、形势判断的目数标记、死子标记
   ========================================================= */
(function (global) {
  'use strict';

  var BLACK = 1;
  var WHITE = 2;
  var EMPTY = 0;
  var LETTERS = 'ABCDEFGHJKLMNOPQRSTUVWXYZ';
  var TAU = Math.PI * 2;

  function mulberry32(seed) {
    return function () {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function easeOutBack(t) {
    var c1 = 1.70158;
    var c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function BoardView(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.game = null;
    this.dpr = Math.min(global.devicePixelRatio || 1, 2.5);
    this.hover = null;
    this.territory = null;
    this.markDead = false;
    this.animStones = {};
    this.animCaptures = [];
    this.wood = null;
    this.woodSize = 0;
    this.raf = null;
    this.sizeCss = 0;
    this.layout = { pad: 0, cell: 0 };
    this.onPoint = null;
    this.onHover = null;
    this.bind();
  }

  BoardView.prototype.bind = function () {
    var self = this;
    this.canvas.addEventListener('pointermove', function (ev) {
      var p = self.pointAt(ev);
      var changed = (p && (!self.hover || p.x !== self.hover.x || p.y !== self.hover.y)) ||
        (!p && self.hover);
      self.hover = p;
      if (changed) self.kick();
    });
    this.canvas.addEventListener('pointerleave', function () {
      if (self.hover) {
        self.hover = null;
        self.kick();
      }
    });
    this.canvas.addEventListener('pointerdown', function (ev) {
      ev.preventDefault();
      var p = self.pointAt(ev);
      if (!p) return;
      if (self.onPoint) self.onPoint(p.x, p.y);
    });
    if (typeof global.ResizeObserver === 'function') {
      this.observer = new global.ResizeObserver(function () {
        self.syncSize();
        self.kick();
      });
      this.observer.observe(this.canvas);
    }
    global.addEventListener('resize', function () {
      self.syncSize();
      self.kick();
    });
  };

  BoardView.prototype.setGame = function (game) {
    this.game = game;
    this.animStones = {};
    this.animCaptures = [];
    this.territory = null;
    this.hover = null;
    this.syncSize();
    this.kick();
  };

  BoardView.prototype.syncSize = function () {
    var rect = this.canvas.getBoundingClientRect();
    var w = Math.max(120, Math.round(rect.width));
    if (w === this.sizeCss && this.canvas.width) return;
    this.sizeCss = w;
    this.dpr = Math.min(global.devicePixelRatio || 1, 2.5);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(w * this.dpr);
    this.buildWood(w);
  };

  BoardView.prototype.buildWood = function (w) {
    var canvas = document.createElement('canvas');
    var px = Math.round(w * this.dpr);
    canvas.width = px;
    canvas.height = px;
    var c = canvas.getContext('2d');
    c.scale(this.dpr, this.dpr);

    var base = c.createLinearGradient(0, 0, w, w);
    base.addColorStop(0, '#e8c790');
    base.addColorStop(0.38, '#dfba7f');
    base.addColorStop(0.72, '#d2a86c');
    base.addColorStop(1, '#c69a5e');
    c.fillStyle = base;
    c.fillRect(0, 0, w, w);

    var glow = c.createRadialGradient(w * 0.42, w * 0.34, w * 0.05, w * 0.5, w * 0.5, w * 0.78);
    glow.addColorStop(0, 'rgba(255, 240, 205, 0.55)');
    glow.addColorStop(0.55, 'rgba(255, 230, 185, 0.12)');
    glow.addColorStop(1, 'rgba(110, 70, 25, 0.22)');
    c.fillStyle = glow;
    c.fillRect(0, 0, w, w);

    var rand = mulberry32(20241107);
    c.lineCap = 'round';

    for (var i = 0; i < 120; i += 1) {
      var y0 = rand() * w;
      var amp = 2 + rand() * 9;
      var alpha = 0.025 + rand() * 0.05;
      var width = 0.5 + rand() * 1.6;
      c.beginPath();
      c.moveTo(-10, y0);
      c.bezierCurveTo(w * 0.3, y0 + amp, w * 0.62, y0 - amp * 1.2, w + 10, y0 + amp * 0.4);
      c.strokeStyle = 'rgba(126, 82, 34, ' + alpha.toFixed(3) + ')';
      c.lineWidth = width;
      c.stroke();
    }

    for (var j = 0; j < 14; j += 1) {
      var yy = rand() * w;
      c.beginPath();
      c.moveTo(-10, yy);
      c.lineTo(w + 10, yy + (rand() - 0.5) * 15);
      c.strokeStyle = 'rgba(150, 104, 52, ' + (0.02 + rand() * 0.03).toFixed(3) + ')';
      c.lineWidth = 3 + rand() * 7;
      c.stroke();
    }

    var vignette = c.createRadialGradient(w * 0.5, w * 0.5, w * 0.3, w * 0.5, w * 0.5, w * 0.78);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(70, 40, 10, 0.22)');
    c.fillStyle = vignette;
    c.fillRect(0, 0, w, w);

    this.wood = canvas;
    this.woodSize = w;
  };

  BoardView.prototype.computeLayout = function () {
    var w = this.sizeCss;
    var size = this.game ? this.game.size : 19;
    var ratio = size === 9 ? 0.105 : size === 13 ? 0.088 : 0.076;
    var pad = w * ratio;
    var cell = (w - pad * 2) / (size - 1);
    this.layout = { pad: pad, cell: cell };
    return this.layout;
  };

  BoardView.prototype.pointAt = function (ev) {
    if (!this.game) return null;
    var rect = this.canvas.getBoundingClientRect();
    var x = ev.clientX - rect.left;
    var y = ev.clientY - rect.top;
    var lay = this.layout.cell ? this.layout : this.computeLayout();
    if (!lay.cell) return null;
    var gx = Math.round((x - lay.pad) / lay.cell);
    var gy = Math.round((y - lay.pad) / lay.cell);
    if (gx < 0 || gy < 0 || gx >= this.game.size || gy >= this.game.size) return null;
    var dx = x - (lay.pad + gx * lay.cell);
    var dy = y - (lay.pad + gy * lay.cell);
    if (Math.sqrt(dx * dx + dy * dy) > lay.cell * 0.62) return null;
    return { x: gx, y: gy };
  };

  BoardView.prototype.animateMove = function (move) {
    var now = (global.performance || Date).now();
    var i;
    if (!move.pass) {
      var key = move.y * this.game.size + move.x;
      this.animStones[key] = { start: now };
      for (i = 0; i < (move.captured || []).length; i += 1) {
        var idx = move.captured[i];
        this.animCaptures.push({
          x: idx % this.game.size,
          y: (idx / this.game.size) | 0,
          color: move.color === BLACK ? WHITE : BLACK,
          start: now
        });
      }
    }
    this.kick();
  };

  BoardView.prototype.kick = function () {
    if (this.raf) return;
    var self = this;
    this.raf = global.requestAnimationFrame(function (ts) {
      self.raf = null;
      self.draw(ts);
      if (self.animating(ts)) self.kick();
    });
  };

  BoardView.prototype.animating = function (ts) {
    var self = this;
    var active = false;
    if (ts === undefined) ts = (global.performance || Date).now();
    for (var k in this.animStones) {
      if (ts - this.animStones[k].start < 220) { active = true; break; }
    }
    if (!active) {
      for (var i = 0; i < this.animCaptures.length; i += 1) {
        if (ts - this.animCaptures[i].start < 260) { active = true; break; }
      }
    }
    return active;
  };

  BoardView.prototype.setTerritory = function (territory) {
    this.territory = territory || null;
    this.kick();
  };

  BoardView.prototype.setMarkDead = function (on) {
    this.markDead = !!on;
    this.kick();
  };

  BoardView.prototype.draw = function (ts) {
    if (!this.game) return;
    var ctx = this.ctx;
    var w = this.sizeCss;
    var lay = this.computeLayout();
    var pad = lay.pad;
    var cell = lay.cell;
    var size = this.game.size;
    var game = this.game;
    var i, x, y;

    if (ts === undefined) ts = (global.performance || Date).now();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, w);

    if (this.wood) ctx.drawImage(this.wood, 0, 0, w, w);
    else {
      ctx.fillStyle = '#dcb87d';
      ctx.fillRect(0, 0, w, w);
    }

    /* 网格 */
    var lineAlpha = 0.62;
    var gridColor = 'rgba(58, 36, 14, ' + lineAlpha + ')';
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = Math.max(1, w / 760);
    ctx.beginPath();
    for (i = 0; i < size; i += 1) {
      var p = pad + i * cell;
      ctx.moveTo(pad, p);
      ctx.lineTo(pad + (size - 1) * cell, p);
      ctx.moveTo(p, pad);
      ctx.lineTo(p, pad + (size - 1) * cell);
    }
    ctx.stroke();

    /* 外框 */
    ctx.strokeStyle = 'rgba(52, 30, 10, 0.85)';
    ctx.lineWidth = Math.max(1.6, w / 420);
    ctx.strokeRect(pad - 0.5, pad - 0.5, (size - 1) * cell + 1, (size - 1) * cell + 1);

    /* 星位 */
    var stars = [];
    var pts = size === 9 ? [2, 4, 6] : size === 13 ? [3, 6, 9] : size === 19 ? [3, 9, 15] : [];
    var a, b;
    for (a = 0; a < pts.length; a += 1) {
      for (b = 0; b < pts.length; b += 1) {
        if (size === 9) {
          if ((pts[a] === 4) !== (pts[b] === 4)) continue;
        }
        stars.push([pts[a], pts[b]]);
      }
    }
    ctx.fillStyle = 'rgba(44, 26, 8, 0.85)';
    for (i = 0; i < stars.length; i += 1) {
      ctx.beginPath();
      ctx.arc(pad + stars[i][0] * cell, pad + stars[i][1] * cell, Math.max(2, cell * 0.085), 0, TAU);
      ctx.fill();
    }

    /* 坐标 */
    var fontSize = Math.max(9, Math.min(cell * 0.36, w * 0.022));
    ctx.fillStyle = 'rgba(74, 45, 16, 0.55)';
    ctx.font = '500 ' + fontSize.toFixed(1) + 'px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (i = 0; i < size; i += 1) {
      ctx.fillText(LETTERS[i], pad + i * cell, pad - cell * 0.62);
      ctx.fillText(String(size - i), pad - cell * 0.62, pad + i * cell);
    }

    /* 领地标记 */
    if (this.territory) {
      for (y = 0; y < size; y += 1) {
        for (x = 0; x < size; x += 1) {
          var owner = this.territory[y * size + x];
          if (!owner) continue;
          var cx = pad + x * cell;
          var cy = pad + y * cell;
          ctx.beginPath();
          ctx.arc(cx, cy, Math.max(1.6, cell * 0.11), 0, TAU);
          ctx.fillStyle = owner === BLACK ? 'rgba(20, 16, 12, 0.58)' : 'rgba(252, 248, 238, 0.82)';
          ctx.fill();
          ctx.strokeStyle = owner === BLACK ? 'rgba(20, 16, 12, 0.2)' : 'rgba(120, 100, 70, 0.35)';
          ctx.lineWidth = Math.max(0.6, w / 1400);
          ctx.stroke();
        }
      }
    }

    /* 棋子 */
    for (i = 0; i < game.board.length; i += 1) {
      var v = game.board[i];
      if (v === EMPTY) continue;
      var sx = pad + (i % size) * cell;
      var sy = pad + ((i / size) | 0) * cell;
      var scale = 1;
      var anim = this.animStones[i];
      if (anim) {
        var t = Math.min(1, (ts - anim.start) / 190);
        scale = 0.55 + 0.45 * easeOutBack(t);
        if (t >= 1) delete this.animStones[i];
      }
      this.stone(ctx, sx, sy, cell * 0.472 * scale, v, 1);
    }

    /* 提子动画 */
    for (i = this.animCaptures.length - 1; i >= 0; i -= 1) {
      var cap = this.animCaptures[i];
      var ct = Math.min(1, (ts - cap.start) / 240);
      if (ct >= 1) {
        this.animCaptures.splice(i, 1);
        continue;
      }
      var shrink = 1 - easeOutCubic(ct) * 0.75;
      this.stone(
        ctx,
        pad + cap.x * cell,
        pad + cap.y * cell,
        cell * 0.472 * shrink,
        cap.color,
        1 - ct * 0.9
      );
    }

    /* 最后一手 */
    if (game.lastMove && !game.over) {
      var lm = game.lastMove;
      var lx = pad + lm.x * cell;
      var ly = pad + lm.y * cell;
      ctx.beginPath();
      ctx.arc(lx, ly, Math.max(2, cell * 0.13), 0, TAU);
      ctx.fillStyle = lm.color === BLACK ? 'rgba(240, 230, 210, 0.9)' : 'rgba(34, 26, 18, 0.85)';
      ctx.fill();
    }

    /* 死子标记 */
    if (game.dead && game.dead.size) {
      var deadArr = Array.from(game.dead);
      for (i = 0; i < deadArr.length; i += 1) {
        var di = deadArr[i];
        var dx2 = pad + (di % size) * cell;
        var dy2 = pad + ((di / size) | 0) * cell;
        var r2 = cell * 0.3;
        ctx.strokeStyle = 'rgba(196, 64, 48, 0.92)';
        ctx.lineWidth = Math.max(2, cell * 0.075);
        ctx.beginPath();
        ctx.moveTo(dx2 - r2, dy2 - r2);
        ctx.lineTo(dx2 + r2, dy2 + r2);
        ctx.moveTo(dx2 + r2, dy2 - r2);
        ctx.lineTo(dx2 - r2, dy2 + r2);
        ctx.stroke();
      }
    }

    /* 悬停预览 */
    if (this.hover && !game.over && !this.markDead) {
      var hx = pad + this.hover.x * cell;
      var hy = pad + this.hover.y * cell;
      var legal = game.isLegal(this.hover.x, this.hover.y);
      if (legal.ok) {
        this.stone(ctx, hx, hy, cell * 0.472, game.turn, 0.38);
      } else if (game.board[this.hover.y * size + this.hover.x] === EMPTY) {
        ctx.beginPath();
        ctx.arc(hx, hy, cell * 0.3, 0, TAU);
        ctx.strokeStyle = 'rgba(178, 70, 52, 0.55)';
        ctx.lineWidth = Math.max(1.2, cell * 0.055);
        ctx.stroke();
      }
    }
  };

  BoardView.prototype.stone = function (ctx, cx, cy, r, color, alpha) {
    if (r <= 0.2) return;
    ctx.save();
    ctx.globalAlpha = alpha;

    /* 影子 */
    ctx.beginPath();
    ctx.arc(cx + r * 0.06, cy + r * 0.1, r * 1.02, 0, TAU);
    ctx.fillStyle = 'rgba(46, 28, 8, 0.28)';
    ctx.fill();

    var grad;
    if (color === BLACK) {
      grad = ctx.createRadialGradient(cx - r * 0.38, cy - r * 0.42, r * 0.1, cx, cy, r * 1.08);
      grad.addColorStop(0, '#787878');
      grad.addColorStop(0.32, '#333333');
      grad.addColorStop(0.72, '#111111');
      grad.addColorStop(1, '#000000');
    } else {
      grad = ctx.createRadialGradient(cx - r * 0.36, cy - r * 0.42, r * 0.1, cx, cy, r * 1.08);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.42, '#f6f2e7');
      grad.addColorStop(0.78, '#ded7c4');
      grad.addColorStop(1, '#b9b19c');
    }

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, cy, r - 0.4, 0, TAU);
    ctx.strokeStyle = color === BLACK ? 'rgba(255, 255, 255, 0.10)' : 'rgba(90, 78, 58, 0.28)';
    ctx.lineWidth = Math.max(0.6, r * 0.055);
    ctx.stroke();

    /* 高光 */
    ctx.beginPath();
    ctx.ellipse(cx - r * 0.3, cy - r * 0.36, r * 0.34, r * 0.2, -0.7, 0, TAU);
    ctx.fillStyle = color === BLACK ? 'rgba(255, 255, 255, 0.16)' : 'rgba(255, 255, 255, 0.85)';
    ctx.fill();

    ctx.restore();
  };

  global.BoardView = BoardView;
})(typeof window !== 'undefined' ? window : globalThis);
