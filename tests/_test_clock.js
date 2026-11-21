/* 复现「载入音频后歌词与音频对不上」的时序条件。
   直接取 src/_p7_js_clock.js 里的 songRaw / songShift / nowSong 原文执行，不重写逻辑。
   判据：有音频且 duration 尚未就绪时，歌曲位置必须来自 audio.currentTime，
   不能回退到无音频时才该用的 wall 时钟。
   v1.4.9 起 nowSong 拆成 songRaw + songShift，测试须同时装载三者，
   否则 nowSong 里的 this.songRaw 不存在（旧版测试因此报 TypeError）。 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', '_p7_js_clock.js'), 'utf8');

function grabMethod(name) {
  const start = src.indexOf(name + '()');
  if (start < 0) throw new Error('not found: ' + name);
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

const methods = {}
for (const name of ['songRaw', 'songShift', 'nowSong']) {
  methods[name] = grabMethod(name);
}

const ctx = { S: { anchor: 3600, offset: 0 }, perSongOffMs: () => 0, console };
vm.createContext(ctx);
vm.runInContext(
  'var proto = { songRaw: function ' + methods.songRaw + ','
  + ' songShift: function ' + methods.songShift + ','
  + ' nowSong: function ' + methods.nowSong + ' };',
  ctx
);

function makeClock(fields) {
  const c = Object.assign({
    src: 'internal', running: true, useWall: false, wallStart: Date.now(), wallOffset: 0, audio: null
  }, fields, ctx.proto);
  return c;
}

/* 场景 A：之前空载点过播放（wall 跑到 305s），随后载入音频，元数据还没到 */
const wallAt305 = makeClock({ useWall: true, wallStart: Date.now() - 305000, wallOffset: 0, audio: { currentTime: 12.3, duration: NaN } });
console.log('A 有音频/元数据未就绪 →', wallAt305.nowSong().toFixed(2), '（期望 12.30）');

/* 场景 B：音频元数据已就绪 */
const loaded = makeClock({ useWall: true, wallStart: Date.now() - 305000, audio: { currentTime: 12.3, duration: 240 } });
console.log('B 元数据就绪 →', loaded.nowSong().toFixed(2), '（期望 12.30）');

/* 场景 C：真的没有音频（必须保持原行为） */
const noAudio = makeClock({ useWall: true, wallStart: Date.now() - 305000, audio: null });
console.log('C 无音频 →', noAudio.nowSong().toFixed(2), '（期望 ≈305）');

/* 场景 D：v1.4.9 回归——内部源下 offset 必须真的进到 nowSong，songRaw 不许被污染 */
const shifted = makeClock({ audio: { currentTime: 12.3, duration: 240 } });
ctx.S.offset = 2500;
const dRaw = shifted.songRaw(), dSong = shifted.nowSong();
ctx.S.offset = 0;
console.log('D offset +2500ms → raw', dRaw.toFixed(2), '· nowSong', dSong.toFixed(2), '（期望 12.30 / 14.80）');

const a = wallAt305.nowSong(), b = loaded.nowSong(), c = noAudio.nowSong();
const okA = Math.abs(a - 12.3) < 0.1, okB = Math.abs(b - 12.3) < 0.1, okC = Math.abs(c - 305) < 1;
const okD = Math.abs(dRaw - 12.3) < 0.1 && Math.abs(dSong - 14.8) < 0.1;
console.log('RESULT', JSON.stringify({ A: okA, B: okB, C: okC, D: okD }), (okA && okB && okC && okD) ? 'PASS' : 'FAIL');
