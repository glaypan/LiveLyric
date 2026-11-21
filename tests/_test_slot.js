/* 独立验证歌单「连续模式」的累计推后：从 _p6_js_core.js 原样提取 entryDur / slotList */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', '_p6_js_core.js'), 'utf8');

function grab(name) {
  const start = src.indexOf('function ' + name);
  if (start < 0) throw new Error('not found: ' + name);
  let depth = 0, i = src.indexOf('{', start);
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

const S = {
  setlist: [
    { tcIn: 3600, title: 'A', lines: [{ t: 0 }, { t: 100, dur: 5 }] },
    { tcIn: 3900, title: 'B', lines: [{ t: 0 }, { t: 50, dur: 2.5 }] },
    { tcIn: 4200, title: 'C', lines: [] }
  ],
  setlistMode: 'indep', setlistGap: 0
};
const ctx = { S, console, _slotCache: null, _slotSig: '' };
vm.createContext(ctx);
vm.runInContext(grab('entryDur'), ctx);
vm.runInContext(grab('slotList'), ctx);

function show(label) {
  const r = ctx.slotList();
  console.log(label, r.map(e => e.title + '=' + e.tcIn).join(' '));
  return r;
}

const indep = show('独立  ');
console.log('  独立模式保持原值:', indep[0].tcIn === 3600 && indep[1].tcIn === 3900 && indep[2].tcIn === 4200);

S.setlistMode = 'chain'; S.setlistGap = 0;
ctx._slotCache = null;
const chain = show('连续  ');
const dA = 105, dB = 52.5, dC = 300;
console.log('  A→B 应为', 3600 + dA, '实际', chain[1].tcIn, '=>', chain[1].tcIn === 3600 + dA);
console.log('  B→C 应为', 3600 + dA + dB, '实际', chain[2].tcIn, '=>', chain[2].tcIn === 3600 + dA + dB);

S.setlistGap = 2;
ctx._slotCache = null;
const gap = show('间隔2m ');
console.log('  含间隔 A→B 应为', 3600 + dA + 120, '实际', gap[1].tcIn, '=>', gap[1].tcIn === 3600 + dA + 120);

/* 缓存不应把改动盖掉 */
S.setlistMode = 'indep';
const back = show('切回独立');
console.log('  缓存失效正确:', back[1].tcIn === 3900);
