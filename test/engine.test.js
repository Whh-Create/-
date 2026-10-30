/* 规则引擎单元测试：node test/engine.test.js */
'use strict';

const path = require('path');
require(path.join(__dirname, '..', 'assets', 'js', 'engine.js'));
require(path.join(__dirname, '..', 'assets', 'js', 'ai.js'));

const GoGame = globalThis.GoGame;
const AI = globalThis.WeiqiAI;

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    console.error('  FAIL  ' + name);
  }
}

function equal(actual, expected, name) {
  const ok = actual === expected;
  if (!ok) console.error('  FAIL  ' + name + ' → 实际 ' + actual + '，期望 ' + expected);
  assert(ok, name);
}

function make(size, komi) {
  return new GoGame(size, typeof komi === 'number' ? komi : 0);
}

/* 直接摆子（测试用） */
function setup(game, stones) {
  for (const [x, y, c] of stones) game.board[y * game.size + x] = c;
  game.positions = [game.board.join('')];
  game.history = [];
}

console.log('· 提子');
{
  const g = make(5);
  setup(g, [[2, 2, 2], [1, 2, 1], [3, 2, 1], [2, 1, 1]]);
  const res = g.play(2, 3);
  assert(res.ok, '合法落子');
  equal(res.captured.length, 1, '提掉一子');
  equal(g.get(2, 2), 0, '被提子位置为空');
  equal(g.captures[1], 1, '黑方提子计数');
}

console.log('· 自杀禁着');
{
  const g = make(5);
  const fill = [];
  for (let y = 0; y < 5; y += 1) {
    for (let x = 0; x < 5; x += 1) {
      if (x === 1 && y === 1) continue;
      fill.push([x, y, 1]);
    }
  }
  setup(g, fill);
  const res = g.play(1, 1);
  assert(!res.ok, '自杀被拒绝');
  equal(res.reason, 'suicide', '拒绝原因');
}

console.log('· 打劫');
{
  const g = make(5);
  setup(g, [
    [0, 1, 1], [1, 0, 1], [1, 2, 1],
    [1, 1, 2], [2, 0, 2], [2, 2, 2], [3, 1, 2]
  ]);
  g.turn = 1;
  const capture = g.play(2, 1);
  assert(capture.ok, '黑棋提劫');
  equal(capture.captured.length, 1, '提劫提掉一子');
  const retake = g.play(1, 1);
  assert(!retake.ok, '白棋不能立即回提');
  equal(retake.reason, 'ko', '打劫判定');
}

console.log('· 数子（中式）');
{
  const g = make(5, 0);
  setup(g, [[1, 0, 1], [0, 1, 1], [1, 1, 1], [3, 3, 2]]);
  const s = g.score();
  equal(s.blackStones, 3, '黑子数');
  equal(s.blackTerritory, 1, '黑空');
  equal(s.black, 4, '黑总子');
  equal(s.whiteStones, 1, '白子数');
  equal(s.white, 1, '白总子');
  equal(s.diff, 3, '差值');
  equal(s.winner, 1, '胜方');
  equal(s.neutral, 20, '双方交界处为单官');
}

console.log('· 贴目与胜负');
{
  const g = make(9, 5.5);
  setup(g, []);
  const s = g.score();
  equal(s.white, 5.5, '空盘白方贴目');
  equal(s.winner, 2, '空盘白胜');
}

console.log('· 死子标记');
{
  const g = make(5, 0);
  setup(g, [
    [0, 0, 2], [0, 1, 1], [1, 0, 1], [1, 1, 1]
  ]);
  const before = g.score();
  equal(before.whiteStones, 1, '标记前白子');
  equal(before.black, 24, '标记前黑方总分');
  g.toggleDead(0, 0);
  const after = g.score();
  equal(after.whiteStones, 0, '标记后白子移除');
  equal(after.blackTerritory, 22, '死子点变为空点');
  equal(after.black, 25, '标记后黑方总分');
}

console.log('· 悔棋');
{
  const g = make(9);
  g.play(3, 3);
  g.play(5, 5);
  equal(g.moveCount(), 2, '两手棋');
  g.play(3, 5);
  g.undo();
  equal(g.moveCount(), 2, '悔棋后手数');
  equal(g.get(3, 5), 0, '悔棋清空落子');
  equal(g.turn, 1, '轮次还原');
}

console.log('· 停一手与终局');
{
  const g = make(9);
  const p1 = g.pass();
  assert(!p1.bothPassed, '第一次停一手未终局');
  const p2 = g.pass();
  assert(p2.bothPassed, '连续两次停一手终局');
  const s = g.finish();
  assert(g.over, '对局结束');
  assert(typeof g.result.text === 'string' && g.result.text.length > 0, '结果文案');
  assert(s.black + s.komi * 0 === s.black, '分数结构');
}

console.log('· SGF');
{
  const g = make(19);
  g.play(3, 3);
  g.play(15, 15);
  const sgf = g.toSGF();
  assert(sgf.indexOf('(;GM[1]') === 0, 'SGF 开头');
  assert(sgf.indexOf('SZ[19]') > 0, 'SGF 棋盘尺寸');
  assert(sgf.indexOf(';B[dd]') > 0, '黑棋坐标');
  assert(sgf.indexOf(';W[pp]') > 0, '白棋坐标');
}

console.log('· AI 落子合法性');
{
  const g = make(19);
  let ok = true;
  for (let i = 0; i < 30; i += 1) {
    const mv = AI.chooseMove(g, 'medium');
    if (!mv) {
      const res = g.pass();
      if (!res.ok) { ok = false; break; }
      if (res.bothPassed) break;
      continue;
    }
    const legal = g.isLegal(mv.x, mv.y);
    if (!legal.ok) { ok = false; break; }
    const res = g.play(mv.x, mv.y);
    if (!res.ok) { ok = false; break; }
  }
  assert(ok, 'AI 连续 30 手均合法');
}

console.log('· AI 提子倾向');
{
  const g = make(9);
  setup(g, [
    [2, 2, 2], [1, 2, 1], [3, 2, 1], [2, 1, 1]
  ]);
  g.turn = 1;
  const mv = AI.chooseMove(g, 'hard');
  assert(mv && mv.x === 2 && mv.y === 3, 'AI 会提掉被打吃的白子');
}

console.log('\n通过 ' + passed + ' 项，失败 ' + failed + ' 项');
process.exit(failed ? 1 : 0);
