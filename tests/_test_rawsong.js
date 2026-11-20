/* 复核 rawSong 的口径：内部音频源不扣本首偏移，外部源要扣 */
const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync('E:\\AI\\豆包\\vj\\LiveLyric\\_p9_js_console.js', 'utf8');
const fn = src.slice(src.indexOf('function rawSong'), src.indexOf('const Transport'));

function run(srcMode, perSong) {
  const ctx = {
    S: { src: srcMode },
    Clock: { nowSong: () => 12.3 },
    perSongOffMs: () => perSong,
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(fn + '\nthis.__r = rawSong;', ctx);
  return ctx.__r();
}

const a = run('internal', 2500), b = run('ws', 2500), c = run('internal', 0);
console.log('internal + 2500ms →', a.toFixed(2), '（期望 12.30）');
console.log('ws       + 2500ms →', b.toFixed(2), '（期望 9.80）');
console.log('internal + 0ms    →', c.toFixed(2), '（期望 12.30）');
console.log('RESULT', JSON.stringify({
  internalKeepsRaw: Math.abs(a - 12.3) < 0.01,
  externalSubtracts: Math.abs(b - 9.8) < 0.01,
  zeroIsZero: Math.abs(c - 12.3) < 0.01,
}));
