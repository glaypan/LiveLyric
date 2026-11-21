/* 独立验证 4ROCK 歌词库（⌚ 页标记 + 工程 JSON 两种形态）能否正确解析。
   从 _p6_js_core.js 里原样提取 dedupeSort / parseTcLib，不重写解析逻辑。 */
const fs = require('fs');
const vm = require('vm');
const srcPath = require('path').join(__dirname, '..', 'src', '_p6_js_core.js');
const src = fs.readFileSync(srcPath, 'utf8');

function grab(name) {
  const start = src.indexOf('function ' + name);
  if (start < 0) throw new Error('not found: ' + name);
  let depth = 0, i = src.indexOf('{', start);
  const open = i;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

const ctx = {
  S: { fps: 25 },
  META: { title: '' },
  _libTitle: '',
  console,
};
vm.createContext(ctx);
vm.runInContext(grab('dedupeSort'), ctx);
vm.runInContext(grab('parseTcLib'), ctx);

const libPath = 'E:\\BaiduNetdiskDownload\\金老斯手搓提词器\\4ROCK-歌词库(带时间码).json';
const raw = fs.readFileSync(libPath, 'utf8');

function fmt(t) {
  const hh = Math.floor(t / 3600), mm = Math.floor(t / 60) % 60, ss = Math.floor(t) % 60;
  const ff = Math.round((t - Math.floor(t)) * 25);
  return [hh, mm, ss, ff].map((n, i) => (i ? String(n).padStart(2, '0') : n)).join(':');
}

const lines = ctx.parseTcLib(raw);
console.log('JSON 库标题:', ctx.META.title, '| _libTitle:', ctx._libTitle);
console.log('解析行数:', lines.length);
console.log('首 3 行:');
lines.slice(0, 3).forEach(l => console.log('  ', fmt(l.t), JSON.stringify(l.text), 'dur=' + l.dur.toFixed(2)));
console.log('末 2 行:');
lines.slice(-2).forEach(l => console.log('  ', fmt(l.t), JSON.stringify(l.text)));

const residues = lines.filter(l => /⌚/.test(l.text));
console.log('残留 ⌚ 行数:', residues.length);
const mono = lines.every((l, i) => i === 0 || l.t >= lines[i - 1].t);
console.log('时间单调递增:', mono);

/* 纯文本形态（不带 JSON 外层）也要能走通 */
const song = JSON.parse(raw).songs[0];
const t2 = ctx.parseTcLib(song.raw);
console.log('纯文本形态行数:', t2.length, '首行:', fmt(t2[0].t), JSON.stringify(t2[0].text));
console.log('纯文本首行时间是否等于 53s:', Math.abs(t2[0].t - 53) < 0.05);
