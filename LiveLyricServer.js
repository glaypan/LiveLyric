/*
 * LiveLyric 本地服务（零依赖，Node 18+）
 *
 * 双击「启动 LiveLyric.bat」即可。它会：
 *   1. 在 127.0.0.1:17321 托管 LiveLyric.html
 *   2. 提供 /lyric 歌词代理（网易云 / QQ），解决浏览器的同源限制
 *   3. 自动打开浏览器
 *
 * 页面与接口同源，所以取词是内置的，不需要在页面里填任何地址。
 *
 * 端口用 17321 而不是 3000：3000 是 Node / Vite / Next 等开发服务的默认端口，
 * 同时开另一个项目就会撞。要改端口用 --port 或环境变量 PORT。
 *
 * 手动启动：node LiveLyricServer.js [--no-open] [--port 17321]
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const { spawn } = require('child_process');

const args = process.argv.slice(2);
const NO_OPEN = args.includes('--no-open');
const portIdx = args.indexOf('--port');
const PORT = portIdx >= 0 ? parseInt(args[portIdx + 1], 10) : parseInt(process.env.PORT || '17321', 10);
const HOST = '127.0.0.1';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const PAGE = path.join(__dirname, 'LiveLyric.html');

function get(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: Object.assign({ 'User-Agent': UA }, headers || {}) }, r => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        resolve(get(r.headers.location, headers));
        return;
      }
      let d = '';
      r.setEncoding('utf8');
      r.on('data', c => d += c);
      r.on('end', () => resolve({ status: r.statusCode, body: d }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('请求超时')));
  });
}

function fmt(sec) {
  sec = Math.max(0, sec);
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return String(m).padStart(2, '0') + ':' + s.toFixed(2).padStart(5, '0');
}

/* 毫秒精度版本，供 eapi 的新格式使用（[mm:ss.mmm]） */
function fmt3(sec) {
  sec = Math.max(0, sec);
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return String(m).padStart(2, '0') + ':' + s.toFixed(3).padStart(6, '0');
}

/* =====================================================================
   网易云 eapi（新版歌词接口）
   ---------------------------------------------------------------------
   请求路径是 https://interface.music.163.com/eapi/api/song/lyric/v1
   但参与签名的是 /api/song/lyric/v1（少了 /eapi 前缀会 404）。
   返回的 lrc / yrc / klyric 已改成逐行 JSON（NDJSON），不是传统 LRC。
   ===================================================================== */
const EAPI_KEY = 'e82ckenh8dichen8';
const EAPI_MAGIC = '-36cd479b6b5-';
const EAPI_HOST = 'https://interface.music.163.com';
const EAPI_PATH = '/api/song/lyric/v1';

function eapiEncrypt(url, payload) {
  const json = JSON.stringify(payload);
  const digest = crypto.createHash('md5')
    .update('nobody' + url + 'use' + json + 'md5forencrypt').digest('hex');
  const data = url + EAPI_MAGIC + json + EAPI_MAGIC + digest;
  const c = crypto.createCipheriv('aes-128-ecb', Buffer.from(EAPI_KEY, 'utf8'), null);
  return (c.update(data, 'utf8', 'hex') + c.final('hex')).toUpperCase();
}

function postForm(urlStr, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const buf = Buffer.from(body);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers: Object.assign({
        'User-Agent': UA,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': buf.length,
        'Referer': 'https://music.163.com/',
        'Origin': 'https://music.163.com'
      }, headers || {})
    }, r => {
      let d = '';
      r.setEncoding('utf8');
      r.on('data', c => d += c);
      r.on('end', () => resolve({ status: r.statusCode, body: d }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('请求超时')));
    req.write(buf);
    req.end();
  });
}

/* NDJSON -> 传统 LRC 文本，前端解析逻辑不需要改
   每行：{"t":毫秒,"c":[{"tx":"文本","t":毫秒,"d":时长}]}
   c 里带 t 的才可能是字级；只有 1 个含 t 的单元视为行级。 */
function ndjsonToLrc(raw) {
  const rows = String(raw || '').split('\n');
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const line = rows[i].trim();
    if (!line) continue;
    let o;
    try { o = JSON.parse(line); } catch (e) { continue; }
    if (!o || !Array.isArray(o.c)) continue;
    const lineT = typeof o.t === 'number' ? o.t / 1000 : null;
    if (lineT === null) continue;
    let text = '';
    const cells = [];
    for (let k = 0; k < o.c.length; k++) {
      const c = o.c[k];
      if (!c || typeof c.tx !== 'string') continue;
      text += c.tx;
      if (typeof c.t === 'number') cells.push({ t: c.t / 1000, s: c.tx });
    }
    if (!text.trim()) continue;
    let worded = false;
    if (cells.length > 1) {
      // 字级时间通常相对行首，也可能是绝对值；取更小的一组作为基准
      if (cells[0].t + 0.5 < lineT) cells.forEach(c => { c.t += lineT; });
      worded = cells.some(c => c.t > lineT + 0.02);
    }
    if (worded) {
      out.push({ t: lineT, s: '[' + fmt3(lineT) + ']' + cells.map(c => '<' + fmt3(c.t) + '>' + c.s).join('') });
    } else {
      out.push({ t: lineT, s: '[' + fmt3(lineT) + ']' + text });
    }
  }
  out.sort((a, b) => a.t - b.t);
  return { lrc: out.map(x => x.s).join('\n'), word: out.some(x => /<\d{1,3}:\d{2}/.test(x.s)) };
}

async function eapiLyric(id) {
  const payload = { id: Number(id), cp: false, lv: 0, kv: 0, tv: 0, yv: 0, ytv: 0, yrv: 0 };
  const body = 'params=' + encodeURIComponent(eapiEncrypt(EAPI_PATH, payload));
  const r = await postForm(EAPI_HOST + '/eapi' + EAPI_PATH, body);
  let j;
  try { j = JSON.parse(r.body); } catch (e) { throw new Error('eapi 返回非 JSON'); }
  if (j.code !== 200) throw new Error('eapi code=' + j.code + (j.message ? ' ' + j.message : ''));
  // yrc 优先（可能带字级），其次 klyric，再次 lrc
  const cands = [j.yrc, j.klyric, j.lrc].filter(x => x && x.lyric);
  if (!cands.length) throw new Error('eapi 没有歌词字段');
  const convs = [];
  for (const c of cands) {
    const conv = ndjsonToLrc(c.lyric);
    if (conv.lrc) convs.push(conv);
  }
  if (!convs.length) throw new Error('eapi 歌词为空');
  // 有字级的优先；都没有则取行数最多的那份（yrc 有时会缺行）
  const worded = convs.find(c => c.word);
  const best = worded || convs.reduce((a, b) =>
    (b.lrc.split('\n').length >= a.lrc.split('\n').length ? b : a));
  return { lrc: best.lrc, word: best.word, via: 'eapi' };
}

/* QRC -> LRC。QRC 结构：[行开始ms,行长ms]字(字开始ms,字时长ms)字(...) */
function qrcToLrc(qrc) {
  const lines = [];
  const re = /\[(\d+),(\d+)\]([^\[]*)/g;
  let m;
  while ((m = re.exec(qrc))) {
    const lineStart = parseInt(m[1], 10) / 1000;
    const words = [];
    const wre = /([^()]*)\((\d+),(\d+)\)/g;
    let w;
    while ((w = wre.exec(m[3]))) {
      if (!w[1]) continue;
      words.push({ c: w[1], t: parseInt(w[2], 10) / 1000 });
    }
    if (!words.length) continue;
    if (words[0].t + 0.5 < lineStart) words.forEach(x => x.t += lineStart);
    lines.push({ t: lineStart, words: words });
  }
  return lines
    .sort((a, b) => a.t - b.t)
    .map(l => '[' + fmt(l.t) + ']' + l.words.map(w => '<' + fmt(w.t) + '>' + w.c).join(''))
    .join('\n');
}

async function qqLyric(input, asKeyword) {
  const q = asKeyword ? 'keyword=' + encodeURIComponent(input) : 'id=' + encodeURIComponent(input);
  const r = await get('https://oiapi.net/api/QQMusicLyric?' + q + '&format=qrc&n=1');
  let j;
  try { j = JSON.parse(r.body); } catch (e) { throw new Error('QQ 接口返回非 JSON'); }
  if (!j || j.code !== 1 || !j.message) throw new Error(j && j.message ? String(j.message) : 'QQ 未返回歌词');
  const text = String(j.message);
  if (/\[\d+,\d+\]/.test(text)) return { lrc: qrcToLrc(text), word: true };
  return { lrc: text, word: /<\d{1,2}:\d{2}/.test(text) };
}

async function neteaseSearchId(kw) {
  const r = await get('https://music.163.com/api/search/get/web?s=' + encodeURIComponent(kw) + '&type=1&limit=8',
    { Referer: 'https://music.163.com/' });
  const j = JSON.parse(r.body);
  const arr = (j.result && j.result.songs) || [];
  if (!arr.length) throw new Error('网易云搜索无结果');
  const exact = arr.find(s => s.name === kw);
  return (exact || arr[0]).id;
}

async function legacyLyric(id) {
  const r = await get('https://music.163.com/api/song/lyric?id=' + encodeURIComponent(id) + '&lv=-1&kv=-1&tv=-1',
    { Referer: 'https://music.163.com/' });
  const j = JSON.parse(r.body);
  if (j.klyric && j.klyric.lyric) return { lrc: j.klyric.lyric, word: true, via: 'legacy' };
  if (j.lrc && j.lrc.lyric) {
    const t = j.lrc.lyric;
    return { lrc: t, word: /<\d{1,2}:\d{2}/.test(t), via: 'legacy' };
  }
  throw new Error('网易云旧接口没有歌词字段');
}

function lyricLineCount(r) {
  if (!r || !r.lrc) return 0;
  return r.lrc.split('\n').filter(s => s.trim()).length;
}

async function neteaseLyric(id) {
  /* eapi 与旧接口并行取，两个都试：
     - eapi 精度到毫秒，但匿名态下可能被版权过滤成残缺歌词（只剩制作名单）
     - 旧接口百分秒精度，通常给完整正文
     所以：有字级且行数不少时用 eapi，否则取行数多的那份。 */
  const results = await Promise.allSettled([eapiLyric(id), legacyLyric(id)]);
  const eapi = results[0].status === 'fulfilled' ? results[0].value : null;
  const legacy = results[1].status === 'fulfilled' ? results[1].value : null;
  if (results[0].status === 'rejected') console.log('[lyric] eapi 失败：', results[0].reason && results[0].reason.message);
  if (results[1].status === 'rejected') console.log('[lyric] legacy 失败：', results[1].reason && results[1].reason.message);
  if (!eapi && !legacy) throw new Error('网易云两个接口都没拿到歌词');

  const ec = lyricLineCount(eapi);
  const lc = lyricLineCount(legacy);

  if (eapi && eapi.word && (ec >= lc * 0.7 || !legacy)) {
    return { lrc: eapi.lrc, word: true, via: 'eapi' };
  }
  if (ec >= lc && !legacy) return { lrc: eapi.lrc, word: eapi.word, via: 'eapi' };
  if (ec > lc) return { lrc: eapi.lrc, word: eapi.word, via: 'eapi' };
  return { lrc: legacy.lrc, word: legacy.word, via: 'legacy' };
}

/* =====================================================================
   LTC 生成（双相标记编码 → 16bit 单声道 WAV）
   ---------------------------------------------------------------------
   位域与前端的 LtcDecoder 完全一致，生成的码可以直接喂回本程序解码：
     bit 0-3   帧个位      8-9    帧十位
     16-19   秒个位     24-26  秒十位
     32-35   分个位     40-42  分十位
     48-51   时个位     56-57  时十位
     64-79   同步字 0011111111111101
   编码规则：每个 bit 占两个 cell，cell = sr/(fps*160)；
   bit 边界必翻转，bit=1 在中点再翻转一次。
   ===================================================================== */
const LTC_SYNC = '0011111111111101';
const LTC_MAX_SEC = 600;

function ltcBits(hh, mm, ss, ff, fps) {
  const b = new Uint8Array(80);
  const set = (from, len, val) => { for (let i = 0; i < len; i++) b[from + i] = (val >> i) & 1; };
  set(0, 4, ff % 10);
  set(8, 2, Math.floor(ff / 10));
  set(16, 4, ss % 10);
  set(24, 3, Math.floor(ss / 10));
  set(32, 4, mm % 10);
  set(40, 3, Math.floor(mm / 10));
  set(48, 4, hh % 10);
  set(56, 2, Math.floor(hh / 10));
  for (let i = 0; i < 16; i++) b[64 + i] = +LTC_SYNC[i];
  return b;
}

/* 返回 { buf, sr, frames }，buf 为完整 WAV（含 44 字节头） */
function buildLtcWav(o) {
  const sr = o.sr, fps = o.fps, lvl = Math.max(0.02, Math.min(1, o.lvl));
  const startFrame = Math.round(o.start * fps);
  const frames = Math.max(1, Math.round(o.dur * fps));
  const total = Math.round(frames * sr / fps);
  const pcm = Buffer.alloc(total * 2);

  const cell = sr / (fps * 160);      // 一个 cell 的样本数（浮点，累积取整）
  let acc = 0, pos = 0, pol = 1;
  const amp = Math.round(lvl * 32767);
  const write = pol => { if (pos < total) { pcm.writeInt16LE(pol * amp, pos * 2); pos++; } };

  for (let f = 0; f < frames; f++) {
    const n = startFrame + f;
    const ff = n % fps, t2 = Math.floor(n / fps);
    const ss = t2 % 60, mm = Math.floor(t2 / 60) % 60, hh = Math.floor(t2 / 3600) % 24;
    const bits = ltcBits(hh, mm, ss, ff, fps);
    for (let k = 0; k < 80; k++) {
      pol = -pol;                      // cell 边界必翻转
      if (bits[k] === 1) {
        acc += cell; const e1 = Math.round(acc);
        while (pos < e1) write(pol);
        pol = -pol;                    // 中点再翻转
        acc += cell; const e2 = Math.round(acc);
        while (pos < e2) write(pol);
      } else {
        acc += cell * 2; const e = Math.round(acc);
        while (pos < e) write(pol);
      }
    }
  }
  /* 取整误差会在末尾留下几个空样本，补成静音 */
  while (pos < total) write(0);

  const hdr = Buffer.alloc(44);
  hdr.write('RIFF', 0);
  hdr.writeUInt32LE(36 + total * 2, 4);
  hdr.write('WAVE', 8);
  hdr.write('fmt ', 12);
  hdr.writeUInt32LE(16, 16);
  hdr.writeUInt16LE(1, 20);           // PCM
  hdr.writeUInt16LE(1, 22);           // mono
  hdr.writeUInt32LE(sr, 24);
  hdr.writeUInt32LE(sr * 2, 28);
  hdr.writeUInt16LE(2, 32);
  hdr.writeUInt16LE(16, 34);
  hdr.write('data', 36);
  hdr.writeUInt32LE(total * 2, 40);
  return { buf: Buffer.concat([hdr, pcm]), sr, frames, total };
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function servePage(res) {
  fs.readFile(PAGE, (err, buf) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('找不到 LiveLyric.html，请把本脚本与它放在同一目录。');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://' + HOST);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' });
    return res.end();
  }

  if (u.pathname === '/health') {
    return json(res, 200, { ok: 1, app: 'livelyric', port: PORT });
  }

  if (u.pathname === '/ltc') {
    const fps = parseInt(u.searchParams.get('fps') || '25', 10);
    const startRaw = u.searchParams.get('start') || '01:00:00:00';
    const p = String(startRaw).split(':').map(Number);
    const start = p.length === 4
      ? p[0] * 3600 + p[1] * 60 + p[2] + p[3] / (fps || 25)
      : (p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : (parseFloat(startRaw) || 0));
    const dur = Math.min(LTC_MAX_SEC, Math.max(1, parseFloat(u.searchParams.get('dur') || '180')));
    const sr = parseInt(u.searchParams.get('sr') || '48000', 10);
    const lvl = parseFloat(u.searchParams.get('lvl') || '0.5');
    if (![24, 25, 30].includes(fps)) {
      return json(res, 400, { ok: 0, err: 'fps 只支持 24 / 25 / 30' });
    }
    try {
      const w = buildLtcWav({ start: start, dur: dur, fps: fps, sr: sr, lvl: lvl });
      const name = 'LTC_' + fps + 'fps_' + Math.round(dur) + 's.wav';
      res.writeHead(200, {
        'Content-Type': 'audio/wav',
        'Content-Length': w.buf.length,
        'Content-Disposition': 'attachment; filename="' + name + '"',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store'
      });
      res.end(w.buf);
      console.log('[ltc] fps=' + fps + ' dur=' + dur + 's start=' + startRaw + ' frames=' + w.frames);
    } catch (e) {
      console.log('[ltc] 生成失败', e.message);
      return json(res, 500, { ok: 0, err: '生成失败：' + e.message });
    }
    return;
  }

  if (u.pathname === '/lyric') {
    const src = (u.searchParams.get('src') || 'netease').toLowerCase();
    const kw = u.searchParams.get('kw');
    const id = u.searchParams.get('id');
    const input = kw || id;
    if (!input) return json(res, 400, { ok: 0, err: '缺少 kw 或 id 参数' });
    try {
      let out;
      if (src === 'qq') {
        out = Object.assign({ src: 'qq', title: input }, await qqLyric(input, !!kw && !id));
      } else {
        const sid = id || await neteaseSearchId(input);
        out = Object.assign({ src: 'netease', id: sid, title: input }, await neteaseLyric(sid));
      }
      out.ok = 1;
      console.log('[lyric]', src, input, 'word=' + out.word, 'lines=' + out.lrc.split('\n').length);
      return json(res, 200, out);
    } catch (e) {
      console.log('[lyric] 失败', src, input, e.message);
      return json(res, 502, { ok: 0, err: e.message });
    }
  }

  if (u.pathname === '/' || u.pathname === '/index.html' || u.pathname === '/LiveLyric.html') {
    return servePage(res);
  }

  if (u.pathname === '/favicon.ico') {
    res.writeHead(204);
    return res.end();
  }

  json(res, 404, { ok: 0, err: 'not found' });
});

server.listen(PORT, HOST, () => {
  const url = 'http://' + HOST + ':' + PORT + '/';
  console.log('LiveLyric 已启动：' + url);
  console.log('歌词代理：' + url + 'lyric?kw=歌名&src=qq|netease');
  if (NO_OPEN) return;
  setTimeout(() => {
    try {
      if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
      else if (process.platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
      else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    } catch (e) { console.log('请手动打开：' + url); }
  }, 400);
});
