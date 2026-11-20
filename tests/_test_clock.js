/* 复现「载入音频后歌词与音频对不上」的时序条件。
   直接取 _p7_js_clock.js 里的 nowSong 原文执行，不重写逻辑。
   判据：有音频且 duration 尚未就绪时，歌曲位置必须来自 audio.currentTime，
   不能回退到无音频时才该用的 wall 时钟。 */
const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync('E:\\AI\\豆包\\vj\\LiveLyric\\_p7_js_clock.js', 'utf8');

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

const body = grabMethod('nowSong');
const ctx = { S: { anchor: 3600 }, console };
vm.createContext(ctx);
vm.runInContext('var nowSong = function ' + body.replace(/^nowSong/, 'nowSong') + ';', ctx);

function makeClock(fields) {
  const c = Object.assign({
    src: 'internal', running: true, useWall: false, wallStart: Date.now(), wallOffset: 0, audio: null
  }, fields);
  c.nowSong = ctx.nowSong;
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

const a = wallAt305.nowSong(), b = loaded.nowSong(), c = noAudio.nowSong();
const okA = Math.abs(a - 12.3) < 0.1, okB = Math.abs(b - 12.3) < 0.1, okC = Math.abs(c - 305) < 1;
console.log('RESULT', JSON.stringify({ A: okA, B: okB, C: okC }), (okA && okB && okC) ? 'PASS' : 'FAIL');
