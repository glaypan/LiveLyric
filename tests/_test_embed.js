/* 验证「镶嵌时间码」的生成与回转：
   相对时间轴 → ⌚绝对码库 → 再解析回来，行时间必须一致（误差 ≤1 帧）。 */
const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync('E:\\AI\\豆包\\vj\\LiveLyric\\_p6_js_core.js', 'utf8');

function grab(header) {
  const start = src.indexOf(header);
  if (start < 0) throw new Error('not found: ' + header);
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

const bodies = [
  "const pad2 = n => String(n).padStart(2,'0');",
  grab('function secToTc'),
  grab('function dedupeSort'),
  grab('function parseTcLib'),
  grab('function buildTcLib'),
].join('\n');

const ctx = { S: { fps: 30 }, META: {}, LINES: [], console };
vm.createContext(ctx);
vm.runInContext(bodies + '\nthis.build=buildTcLib; this.parse=parseTcLib; this.s2t=secToTc;', ctx);

const probe = [{ t: 0, text: '第一行' }, { t: 3.6, text: '第二行' }, { t: 13.152, text: '第三行' }];
const txt = ctx.build(probe, 3600, 30);
console.log('生成：\n' + txt);
const back = ctx.parse(txt);
console.log('回转：', JSON.stringify(back.map(l => [+l.t.toFixed(3), l.text])));

const f = 1 / 30 + 0.001;
const ok = back.length === 3
  && Math.abs(back[0].t - 0) < f
  && Math.abs(back[1].t - 3.6) < f
  && Math.abs(back[2].t - 13.152) < f
  && back[1].text === '第二行' && back[2].text === '第三行';
console.log('RESULT', ok ? 'PASS' : 'FAIL', '| 首行码', ctx.s2t(3600, 30), '| 第三行码', ctx.s2t(3600 + 13.152, 30));
