/* =====================================================================
   LiveLyric — 实时歌词同步系统
   一个文件两副面孔：控制台 / 投屏输出（?mode=output）
   ===================================================================== */
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const QS = new URLSearchParams(location.search);
const IS_OUT = QS.get('mode') === 'output';
const pad2 = n => String(n).padStart(2, '0');

/* ---------- 时间码 ---------- */
function secToTc(sec, fps) {
  if (!isFinite(sec)) sec = 0;
  const neg = sec < 0;
  let tf = Math.round(Math.abs(sec) * fps);
  const ff = tf % fps; tf = Math.floor(tf / fps);
  const ss = tf % 60; tf = Math.floor(tf / 60);
  const mm = tf % 60; tf = Math.floor(tf / 60);
  const hh = tf % 24;
  return (neg ? '-' : '') + pad2(hh) + ':' + pad2(mm) + ':' + pad2(ss) + ':' + pad2(ff);
}
function parseTimeStr(s) {
  if (s == null) return 0;
  s = String(s).trim();
  if (!s) return 0;
  if (/ms$/.test(s)) return parseFloat(s) / 1000;
  if (/s$/.test(s)) return parseFloat(s);
  const p = s.split(':').map(Number);
  if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
  if (p.length === 2) return p[0] * 60 + p[1];
  return parseFloat(s) || 0;
}
function tcToSec(tc, fps) {
  const p = String(tc).replace('-', '').split(':').map(Number);
  if (p.length === 4) return p[0] * 3600 + p[1] * 60 + p[2] + p[3] / fps;
  if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
  return parseFloat(tc) || 0;
}
function msToSec(s) { const v = parseFloat(s); return isFinite(v) ? v / 1000 : 0; }

/* ---------- 状态 ---------- */
const APP_VER = '1.4.11';
const DEF_STATE = {
  style: 'classic', bg: 'none', fs: 100, lh: 150, ratio: '16:9',
  fps: 25, offset: 0, smooth: true, showTc: false, cap: true,
  anchor: 3600, src: 'internal', wsUrl: 'ws://127.0.0.1:8080', api: '',
  /* 歌词驱动方式：
     timeline — 用歌词自带时间轴（默认）
     clock    — 忽略歌词时间轴，时间码线性映射到整首时长
     cue      — 每行绑一个绝对时间码，由 cue 表决定当前行 */
  tcMode: 'timeline',
  /* 舞台可读性（1.4.0）
     tracking 字距倍数 100=原样；strokeW 描边像素；shadowB 阴影模糊 */
  tracking: 100, strokeW: 0, strokeC: '#000000', shadowB: 0, shadowC: '#000000',
  /* 视觉增强（1.4.5）：边缘渐隐让首尾行淡出；聚焦放大让当前行比其他行略大 */
  fade: true, focus: false,
  /* 组合预设：一套样式 + 参数存成一槽，现场一键切换（1.4.7） */
  presetMine: null,
  mirror: 'off',
  /* 现场工具：倒计时与临时上屏 */
  cdFull: false, cdEndAt: 0, cdTotal: 0, subText: '', subOn: false,
  /* 本首偏移：按曲目名为键，切歌自动生效；base 存「应用前」的值供一次性恢复 */
  perSongOff: {}, perSongBase: {},
  /* 歌单响应方式：indep 各首独立；chain 按列表顺序累计时长 + 间隔 */
  setlistMode: 'indep', setlistGap: 0,
  /* 多首：每首带自己的入出点与基准，时间码落进区间就切歌 */
  setlist: [],
  songIdx: 0
};
let S = Object.assign({}, DEF_STATE);
let LINES = [];
let META = { title: '', artist: '', source: '' };
const LS_STATE = 'livelyric.state.v1';
const LS_BUS = 'livelyric.bus.v1';

function saveState() {
  try {
    localStorage.setItem(LS_STATE, JSON.stringify({
      S, LINES, META, savedAt: Date.now()
    }));
  } catch (e) { console.warn('save fail', e); }
}
function loadState() {
  try {
    const raw = localStorage.getItem(LS_STATE);
    if (!raw) return false;
    const d = JSON.parse(raw);
    if (d.S) {
      S = Object.assign({}, DEF_STATE, d.S);
      /* 存档里可能残留超范围的 offset，读出来先夹紧，否则整首歌词会整体错位 */
      const bad = S.offset;
      S.offset = clampOffset(S.offset);
      if (S.offset !== bad) saveState();   // 直接把脏值修回存档，下次不必再夹
    }
    if (Array.isArray(d.LINES)) LINES = d.LINES;
    if (d.META) META = Object.assign({ title: '', artist: '', source: '' }, d.META);
    return LINES.length > 0;
  } catch (e) { return false; }
}

/* ---------- 跨窗口总线 ---------- */
const Bus = {
  ch: null, seen: {},
  init() {
    try { this.ch = new BroadcastChannel('livelyric'); } catch (e) { this.ch = null; }
  },
  key(type) { return LS_BUS + '.' + type; },
  send(type, payload) {
    const msg = Object.assign({ type: type, t: Date.now() }, payload || {});
    let raw = '';
    try { raw = JSON.stringify(msg); } catch (e) { return; }
    if (this.ch) { try { this.ch.postMessage(msg); } catch (e) { } }
    try { localStorage.setItem(this.key(type), raw); } catch (e) { }
  },
  listen(cb) {
    if (this.ch) {
      this.ch.onmessage = ev => { if (ev.data && ev.data.type) cb(ev.data); };
    }
    window.addEventListener('storage', ev => {
      if (ev.key && ev.key.indexOf(LS_BUS) === 0 && ev.newValue) {
        try {
          const m = JSON.parse(ev.newValue);
          if (m && m.type) { this.seen[ev.key] = ev.newValue; cb(m); }
        } catch (e) { }
      }
    });
    const self = this;
    setInterval(() => {
      let n = 0;
      try { n = localStorage.length; } catch (e) { return; }
      for (let i = 0; i < n; i++) {
        let k = null;
        try { k = localStorage.key(i); } catch (e) { continue; }
        if (!k || k.indexOf(LS_BUS + '.') !== 0) continue;
        let raw = null;
        try { raw = localStorage.getItem(k); } catch (e) { continue; }
        if (!raw || self.seen[k] === raw) continue;
        self.seen[k] = raw;
        try {
          const m = JSON.parse(raw);
          if (m && m.type) cb(m);
        } catch (e) { }
      }
    }, 160);
  }
};
Bus.init();

/* ---------- 歌词解析 ---------- */
function normLine(t) {
  return String(t).replace(/\u200b/g, '').replace(/\s+/g, ' ').trim();
}

function parseLyric(raw) {
  raw = String(raw || '').replace(/\r\n?/g, '\n').trim();
  if (!raw) return [];
  /* 4ROCK / 金老斯 歌词库：⌚ 标记行，或整份带 songs 的工程 JSON */
  if (/^[⌚⏱]/m.test(raw)) return parseTcLib(raw);
  if (/^\s*\{/.test(raw) && /"songs"\s*:/.test(raw)) return parseTcLib(raw);
  if (/<tt[\s>]/.test(raw) || /<p\s+[^>]*begin=/i.test(raw)) return parseTTML(raw);
  if (/\n\s*\d+\s*\n\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->/m.test('\n' + raw)) return parseSRT(raw);
  if (/\[[0-9]{1,2}:[0-9]{2}/.test(raw) || /<\d{1,2}:\d{2}/.test(raw)) return parseLRC(raw);
  return parsePlain(raw);
}

/* 外部歌词库（⌚时:分:秒:帧 页标记）
   ⌚ 行标记紧随其后的一「页」；同页多行均分到下一页之前的时长，
   这样逐行显示时不会挤成一团，也不会和下一页重叠。 */
let _libTitle = '';
function parseTcLib(raw) {
  let text = String(raw || '');
  let libTitle = '';
  if (/^\s*\{/.test(text)) {
    try {
      const j = JSON.parse(text);
      const songs = Array.isArray(j.songs) ? j.songs : null;
      const pick = songs ? (songs.find(s => s.id === j.currentId) || songs[0]) : j;
      if (pick) {
        if (pick.title) libTitle = String(pick.title);
        text = String(pick.raw || pick.text || pick.lyric || text);
      }
      if (songs && songs.length > 1) libTitle = libTitle + '（库内 ' + songs.length + ' 首）';
    } catch (e) { /* 解析失败就按纯文本走 */ }
  }
  _libTitle = libTitle;
  if (libTitle) META.title = libTitle;

  const rows = text.replace(/\r\n?/g, '\n').split('\n');
  const pages = [];
  let cur = null;
  const re = /^[⌚⏱]\s*(\d{1,2}):(\d{2}):(\d{2})[:;.,](\d{1,3})$/;
  for (let i = 0; i < rows.length; i++) {
    const line = rows[i].trim();
    if (!line) continue;
    if (line === '{' || line === '}') continue;      // 强制分组标记不参与显示
    const m = line.match(re);
    if (m) {
      const fps = S.fps || 25;
      const t = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / fps;
      cur = { t: t, rows: [] };
      pages.push(cur);
      continue;
    }
    if (!cur) { cur = { t: 0, rows: [] }; pages.push(cur); }
    cur.rows.push(line);
  }
  if (!pages.length) return [];

  const out = [];
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const next = i + 1 < pages.length ? pages[i + 1].t : p.t + Math.max(2.5, p.rows.length * 2.5);
    const span = Math.max(0.4, next - p.t);
    const n = Math.max(1, p.rows.length);
    for (let k = 0; k < p.rows.length; k++) {
      out.push({ t: p.t + span * (k / n), text: p.rows[k], dur: Math.max(0.3, span / n) });
    }
  }
  /* 整小时基准归零：⌚ 库通常写成 01:00:00:00 起的绝对码（QLab / LTC 习惯），
     而歌词内部一律按歌曲起点相对计秒。不归零的话导入后整首会差一小时。 */
  if (out.length) {
    const base = Math.floor(out[0].t / 3600) * 3600;
    if (base > 0) for (let i = 0; i < out.length; i++) out[i].t = Math.max(0, out[i].t - base);
  }
  return dedupeSort(out);
}

/* 把「相对时间轴」的歌词镶成带绝对时间码的 ⌚ 库文本。
   每行一个 ⌚ 标记，单行成页，解析回来 t 与原文一一对应（可无损往返）。
   逐字（words）在这个格式里没有位置，只有行级时间。 */
function buildTcLib(lines, anchorSec, fps) {
  const a = lines || LINES;
  const f = fps || S.fps || 25;
  const a0 = Math.max(0, Number(anchorSec) || 0);
  const rows = [];
  for (let i = 0; i < a.length; i++) {
    const tx = String(a[i].text || '').replace(/[\r\n]+/g, ' ').trim();
    if (!tx || /^[⌚⏱]/.test(tx)) continue;
    rows.push('⌚' + secToTc((a[i].t || 0) + a0, f));
    rows.push(tx);
  }
  return rows.length ? rows.join('\n') + '\n' : '';
}

function parseLRC(raw) {
  const out = [];
  let offset = 0;
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const om = line.match(/^\[(?:offset|OFFSET)\s*:\s*([+-]?\d+)\s*\]/);
    if (om) { offset = parseInt(om[1], 10) / 1000; continue; }
    if (/^\[(ti|ar|al|by|re|ve|length)\s*:/i.test(line)) {
      const tm = line.match(/^\[ti\s*:\s*(.*?)\]/i);
      if (tm && !META.title) META.title = tm[1].trim();
      const am = line.match(/^\[ar\s*:\s*(.*?)\]/i);
      if (am && !META.artist) META.artist = am[1].trim();
      continue;
    }
    const tags = [];
    let rest = line;
    let m;
    const re = /^\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/;
    while ((m = re.exec(rest))) {
      const frac = m[3] ? parseFloat('0.' + m[3].padEnd(3, '0').slice(0, 3)) : 0;
      tags.push(parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + frac);
      rest = rest.slice(m[0].length);
    }
    if (!tags.length) continue;
    const words = parseWordTags(rest, tags[0]);
    const text = normLine(rest.replace(/<[^>]*>/g, ''));
    if (!text) continue;
    for (let k = 0; k < tags.length; k++) {
      out.push({ t: tags[k] + offset, text: text, words: words ? words.words : null, wbase: words ? words.base : tags[k] + offset });
    }
  }
  return dedupeSort(out);
}

/* 增强 LRC：<00:01.20>字 —— 标签表示该段起点 */
function parseWordTags(rest, lineStart) {
  if (!/<\d{1,2}:\d{2}/.test(rest)) return null;
  const segs = [];
  let curT = lineStart, buf = '';
  let i = 0;
  const re = /<(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?>/;
  while (i < rest.length) {
    const sub = rest.slice(i);
    const m = re.exec(sub);
    if (m && m.index === 0) {
      if (buf) segs.push({ t: curT, text: buf });
      const frac = m[3] ? parseFloat('0.' + m[3].padEnd(3, '0').slice(0, 3)) : 0;
      curT = parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + frac;
      buf = '';
      i += m[0].length;
    } else if (m && sub.slice(0, m.index).indexOf('<') < 0) {
      buf += sub.slice(0, m.index);
      i += m.index;
    } else {
      buf += sub[0];
      i += 1;
    }
  }
  if (buf) segs.push({ t: curT, text: buf });
  const words = [];
  let base = null;
  for (let s = 0; s < segs.length; s++) {
    const seg = segs[s];
    const next = s + 1 < segs.length ? segs[s + 1].t : seg.t + Math.max(0.25, seg.text.length * 0.18);
    if (base === null) base = seg.t;
    const chars = Array.from(seg.text);
    const dur = Math.max(0.02, next - seg.t);
    for (let c = 0; c < chars.length; c++) {
      words.push({ c: chars[c], t: seg.t + dur * (c / chars.length), d: dur / chars.length });
    }
  }
  return { words: words, base: base };
}

function parseTTML(raw) {
  const out = [];
  try {
    const doc = new DOMParser().parseFromString(raw, 'text/xml');
    const ps = doc.querySelectorAll('p');
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      const bt = p.getAttribute('begin');
      const et = p.getAttribute('end');
      if (!bt) continue;
      const t = parseTimeStr(bt);
      const dur = et ? Math.max(0, parseTimeStr(et) - t) : 0;
      const spans = p.querySelectorAll('span');
      let words = null;
      if (spans.length > 1) {
        words = [];
        for (let s = 0; s < spans.length; s++) {
          const sp = spans[s];
          const st = sp.getAttribute('begin') ? parseTimeStr(sp.getAttribute('begin')) : t;
          const se = sp.getAttribute('end') ? parseTimeStr(sp.getAttribute('end')) : st + 0.2;
          const ch = Array.from(normLine(sp.textContent)).filter(x => x !== ' ');
          const d = Math.max(0.02, se - st);
          for (let c = 0; c < ch.length; c++) {
            words.push({ c: ch[c], t: st + d * (c / ch.length), d: d / ch.length });
          }
        }
      }
      let text = normLine(p.textContent);
      if (!text) continue;
      // 去掉空行与过短的气口
      out.push({ t: t, text: text, words: words });
    }
  } catch (e) { console.warn('TTML parse', e); }
  return dedupeSort(out);
}

function parseSRT(raw) {
  const out = [];
  const blocks = raw.split(/\n{2,}/);
  const re = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;
  for (const b of blocks) {
    const m = b.match(re);
    if (!m) continue;
    const st = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + msToSec(m[4]);
    const et = (+m[5]) * 3600 + (+m[6]) * 60 + (+m[7]) + msToSec(m[8]);
    const text = normLine(b.split('\n').filter(l => !/^\d+$/.test(l.trim()) && !re.test(l)).join(' '));
    if (!text) continue;
    out.push({ t: st, text: text, dur: Math.max(0.3, et - st) });
  }
  return dedupeSort(out);
}

function parsePlain(raw) {
  const lines = raw.split('\n').map(normLine).filter(Boolean);
  if (!lines.length) return [];
  const total = Math.max(60, lines.reduce((a, l) => a + l.length, 0) * 0.34);
  const weights = lines.map(l => Math.max(3, l.length));
  const sum = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    out.push({ t: total * (acc / sum), text: lines[i] });
    acc += weights[i];
  }
  return out;
}

function dedupeSort(arr) {
  const seen = new Set();
  const res = [];
  for (const l of arr) {
    const key = l.t.toFixed(3) + '|' + l.text;
    if (seen.has(key)) continue;
    seen.add(key);
    res.push(l);
  }
  res.sort((a, b) => a.t - b.t);
  return res.map((l, i) => {
    if (!l.dur) {
      const nxt = res[i + 1];
      l.dur = nxt ? Math.max(0.25, nxt.t - l.t) : Math.max(1, l.text.length * 0.3);
    }
    return l;
  });
}

/* 当前行索引
   timeline：按歌词时间轴
   clock   ：不看时间轴，把当前曲目时长线性摊到各行（无时间轴时的兜底）
   cue     ：按每行绑定的绝对时间码（line.cue），没有 cue 的行跳过 */
let _cueRows = null, _cueSrc = null, _cueLen = -1;
function cueTable(arr) {
  if (_cueRows && _cueSrc === arr && _cueLen === arr.length) return _cueRows;
  const t = [];
  for (let i = 0; i < arr.length; i++) {
    const c = arr[i].cue;
    if (typeof c === 'number' && isFinite(c)) t.push({ c: c, i: i });
  }
  t.sort((a, b) => a.c - b.c);
  _cueRows = t; _cueSrc = arr; _cueLen = arr.length;
  return t;
}
function indexAt(time, lines) {
  const arr = lines || LINES;
  if (!arr.length) return -1;

  if (S.tcMode === 'cue') {
    const t = cueTable(arr);
    if (t.length) {
      if (time < t[0].c) return -1;
      let lo = 0, hi = t.length - 1, ans = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (t[mid].c <= time) { ans = mid; lo = mid + 1; } else { hi = mid - 1; }
      }
      return t[ans].i;
    }
    /* 没有任何 cue 时退回时间轴，不至于整屏空着 */
  }

  /* 「均摊」只给没有时间码的纯文本歌词用：那些行本来没有真实时间，
     只能按行序平铺。歌词自带时间轴时摊分必然整首错位，直接落到下面的时间轴二分。 */
  if (S.tcMode === 'clock' && !linesHaveTimeline(arr)) {
    /* 线性摊分：首行时间 → 末行时间 + 末行估算时长 */
    const first = arr[0].t;
    const last = arr[arr.length - 1].t;
    const span = Math.max(0.5, last - first + 2.5);
    const n = arr.length;
    if (time <= first) return -1;
    const rel = Math.min(1, (time - first) / span);
    const idx = Math.floor(rel * n);
    return Math.max(0, Math.min(n - 1, idx));
  }

  if (time < arr[0].t) return -1;
  let lo = 0, hi = arr.length - 1, ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].t <= time) { ans = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  return ans;
}

/* 这份歌词是否自带真实时间轴。
   判据：至少 3 行、行间隔全部为正且间隔种类足够多。
   无时间码的纯文本会被 parseLyric 按相等间隔铺开，间隔种类只剩 1~2 种，
   用「时间码均摊」是合理的；而真实歌词的间隔天然参差，均摊必然整段错位。 */
function linesHaveTimeline(arr) {
  const a = arr || LINES;
  if (!a || a.length < 3) return false;
  const gaps = [];
  for (let i = 1; i < a.length; i++) {
    const g = +(a[i].t - a[i - 1].t).toFixed(3);
    if (!(g > 0)) return false;
    gaps.push(g);
  }
  const uniq = new Set(gaps);
  return uniq.size >= 3;
}

/* 行索引 → 该行沿用多久（给进度条与逐字用） */
function lineSpan(i, arr) {
  const a = arr || LINES;
  if (i < 0 || i >= a.length) return 2;
  if (i + 1 < a.length) {
    const d = a[i + 1].t - a[i].t;
    return d > 0.05 ? d : 2;
  }
  return 2.5;
}

/* ---------- 歌单的有效入点 ----------
   独立：各首用自己填的入点。
   连续：按列表顺序累计前一首的总时长 + 间隔，依次推后起点；
        歌词里的时间码本身不变，只是响应的基准变了。 */
let _slotCache = null, _slotSig = '';
function entryDur(e) {
  const ls = (e && e.lines) || [];
  if (!ls.length) return 300;
  const last = ls[ls.length - 1];
  return Math.max(30, (last.t || 0) + (last.dur || 2.5));
}
function slotList() {
  const list = S.setlist || [];
  if (!list.length) return list;
  const sig = list.length + '|' + S.setlistMode + '|' + S.setlistGap + '|' +
    list.map(e => (e.tcIn || 0) + ':' + entryDur(e)).join(',');
  if (_slotCache && _slotSig === sig) return _slotCache;
  let out;
  if (S.setlistMode !== 'chain') {
    out = list;
  } else {
    const gap = Math.max(0, Math.min(30, Number(S.setlistGap) || 0)) * 60;
    out = [];
    let acc = list[0].tcIn || 0;
    for (let i = 0; i < list.length; i++) {
      if (i > 0) acc = acc + entryDur(list[i - 1]) + gap;
      out.push(Object.assign({}, list[i], { tcIn: acc, anchor: acc }));
    }
  }
  _slotCache = out;
  _slotSig = sig;
  return out;
}

/* ---------- 本首偏移（与全局 offset 叠加） ---------- */
const SONG_OFF_LIMIT = 90000;
function clampSongOff(v) {
  v = Number(v);
  if (!isFinite(v)) return 0;
  v = Math.round(v);
  return Math.max(-SONG_OFF_LIMIT, Math.min(SONG_OFF_LIMIT, v));
}
function songKey() {
  const t = (META && META.title ? String(META.title) : '').trim();
  return t || ('__song' + (S.songIdx || 0));
}
function perSongOffMs() {
  const m = S.perSongOff || {};
  return clampSongOff(m[songKey()]);
}
