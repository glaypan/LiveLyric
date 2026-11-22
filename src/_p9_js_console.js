/* =====================================================================
   运输控制
   ===================================================================== */
/* 「找当前行」用的歌曲位置。
   只有外部源需要减回本首偏移——feed() 把 perSongOff 加进了 extSong；
   内部音频源的 nowSong() 就是 audio.currentTime，本来不含偏移，再减一次会让
   控制台高亮行比投屏提前、且上一首/下一首判定落到错误的行。 */
function rawSong() {
  if (S.src === 'internal') return Clock.nowSong();
  return Clock.nowSong() - (perSongOffMs ? perSongOffMs() / 1000 : 0);
}
const Transport = {
  blackout: false,
  go() {
    if (this.blackout) { this.blackout = false; Bus.send('blackout', { on: false }); }
    /* GO 是启动/暂停同一个键：演出中按一下就停，没有第二个按钮可找 */
    if (Clock.running) {
      if (S.src === 'internal') Clock.stopInternal();
      else Clock.running = false;
      UI.sync();
      return;
    }
    if (S.src === 'internal') {
      Clock.startInternal();
    } else {
      Clock.running = true;
    }
    UI.sync();
  },
  pause() {
    if (S.src === 'internal') Clock.stopInternal();
    else Clock.running = false;
    UI.sync();
  },
  next() {
    const cur = rawSong();
    const idx = indexAt(cur);
    const target = idx + 1 < LINES.length ? idx + 1 : LINES.length - 1;
    if (target >= 0) this.alignTo(target, true);
  },
  prev() {
    const cur = rawSong();
    const idx = indexAt(cur);
    let target = idx - 1;
    if (target < 0) target = 0;
    this.alignTo(target);
  },
  clear() {
    this.blackout = !this.blackout;
    Bus.send('blackout', { on: this.blackout });
    UI.sync();
  },
  alignTo(idx, forward) {
    if (!LINES[idx]) return;
    const lineT = LINES[idx].t;
    if (S.src === 'internal') {
      /* 索引时间含偏移，seek 要减掉它，否则对齐完这一行又整体偏走 */
      Clock.seekInternal(lineT - Clock.songShift());
    } else {
      /* 外部源还没收到任何时间码时 nowSong() 恒为 0，
         此时对齐会把「目标行时间」整段塞进 offset，一次就偏掉几分钟到几十分钟 */
      if (!Clock.extStamp) { toast('还没收到时间码，先让外部时间码进来再对齐'); return; }
      /* 外部源的歌曲位置含本首偏移，目标也要带上它，否则对齐一次就把偏移吃掉 */
      const seek = lineT + perSongOffMs() / 1000;
      const cur = Clock.nowSong();
      let delta = seek - cur;
      if (forward && delta < 0) delta = 0;
      S.offset = clampOffset(S.offset + delta * 1000);
      Clock.extSong = seek;
      Clock.extStamp = Date.now();
      Clock.tcSec = lineT + S.anchor - S.offset / 1000;
    }
    UI.sync();
    UI.renderList();
    Bus.send('state', UI.payload());
  },
  seekSong(t) {
    if (S.src === 'internal') Clock.seekInternal(t - Clock.songShift());
    else {
      if (!Clock.extStamp) { toast('还没收到时间码，先让外部时间码进来再定位'); return; }
      const seek = t + perSongOffMs() / 1000;
      const delta = seek - Clock.nowSong();
      S.offset = clampOffset(S.offset + delta * 1000);
      Clock.extSong = seek; Clock.extStamp = Date.now();
    }
    UI.sync();
  }
};

/* =====================================================================
   控制台 UI
   ===================================================================== */
const UI = {
  lastIdx: -99, rafId: 0, lastSend: 0,

  sync() {
    const tag = $('#srcTag');
    if (!tag) return;
    /* 外部源分「已锁」与「失锁续走」两态；失锁要红，不能和正常跑混成 RUN */
    const ext = S.src !== 'internal';
    const st = Clock.running ? (ext ? (Clock.locked ? 'LOCK' : 'FREE') : 'RUN') : 'IDLE';
    this._t(tag, st);
    this._a(tag, 'class', 'tag' + (st === 'LOCK' || st === 'RUN' ? ' ok' : ''));
    this._s(tag, 'color', st === 'FREE' ? 'var(--red, #FF5C6C)' : '');
    this._a($('#ledRun'), 'class', 'led' + (Clock.running ? (ext && !Clock.locked ? ' warn' : ' live') : ''));
    /* GO 键同时是暂停键，图标要跟着运行状态换 */
    const goBtn = $('#btnGo');
    if (goBtn) goBtn.classList.toggle('ico-running', !!Clock.running);
    this._t($('#runState'), this.blackout ? '清屏中'
      : (!Clock.running ? '待命' : (ext ? (Clock.locked ? '锁定运行' : '失锁续走') : '运行')));
    const go = $('#btnGo');
    /* 只切 rec 这一个类，别覆写整个 className（按钮还有别的样式类） */
    if (go && go.classList.contains('rec') !== Clock.running) go.classList.toggle('rec', Clock.running);
    this._t($('#anchorTx'), secToTc(S.anchor, S.fps));
    this._t($('#tcFps'), S.fps + ' FPS · NDF');
    this._t($('#offsetVal'), (S.offset >= 0 ? '+' : '') + S.offset + ' ms');
    this._t($('#fsVal'), S.fs + '%');
    this._t($('#lhVal'), (S.lh / 100).toFixed(2));
    this._t($('#ratioVal'), S.ratio === 'fit' ? '自适应' : S.ratio);
    if ($('#tcModeVal')) {
      /* 显示的是「实际生效」的驱动：歌词自带时间轴时「均摊」会被跳过，
         要让用户看见跳过这件事，而不是以为均摊生效了 */
      const effMode = (S.tcMode === 'clock' && linesHaveTimeline(LINES)) ? 'timeline' : S.tcMode;
      this._t($('#tcModeVal'), effMode === 'timeline' ? '时间轴'
        : (effMode === 'clock' ? '时间码均摊' : 'Cue'));
      this._a($('#tcModeVal'), 'class', 'val');
      $$('#tcModeSeg .btn').forEach(x => {
        const want = x.dataset.tcmode === S.tcMode;
        if (x.classList.contains('on') !== want) x.classList.toggle('on', want);
      });
    }
    this._t($('#styleTag'), S.style.toUpperCase());
    this._t($('#bgTag'), S.bg.toUpperCase());
    this._t($('#tcSrcName'), S.src === 'internal' ? '内部时钟' : S.src.toUpperCase());
    /* 输入控件只在没被用户握着的时候同步，否则每帧覆写会把手拖到一半的滑块弹回去 */
    this._v2($('#offset'), S.offset);
    /* 播放条上的常驻微调，和卡片里的同一个值 */
    this._t($('#offsetMini'), (S.offset >= 0 ? '+' : '') + S.offset + ' ms');
    this._v2($('#fontSize'), S.fs);
    this._v2($('#lineHeight'), S.lh);
    /* 有音频时不碰这行：文件名由载入处写入，被每帧覆写成「已载入」就再也看不到选了哪首 */
    if (!(Clock.audio && Clock.audio.src)) this._t($('#audioName'), '未加载');
    this._t($('#songSub'), LINES.length + ' 行 · ' + (META.source || '本地'));
    this._t($('#songTitle'), META.title || (LINES.length ? '未命名歌词' : '未载入歌词'));
    const idx = indexAt(rawSong());
    this._t($('#cueInfo'), LINES[idx] ? ('#' + (idx + 1) + ' ' + LINES[idx].text.slice(0, 22)) : '—');
    /* 进度条与行对齐要用含偏移的时间；读数「位置 xx.xxs」要显示真实播放位置，
       调 offset 时读数不该跟着跳 */
    const pos = Clock.nowSong();
    const posRaw = Clock.songRaw();
    this._t($('#posVal'), (posRaw >= 0 ? posRaw.toFixed(2) : '0.00') + 's');
    const line = LINES[idx];
    const p = line ? Math.min(1, Math.max(0, (pos - line.t) / Math.max(0.1, line.dur))) : 0;
    this._s($('#progFill'), 'width', (p * 100).toFixed(1) + '%');
    this._s($('#progKnob'), 'left', (p * 100).toFixed(1) + '%');

    /* ---- 1.4.0：字距 / 描边阴影 / 镜面 ---- */
    this._t($('#trVal'), ((+S.tracking || 100) / 100).toFixed(2));
    this._t($('#skVal'), (+S.strokeW || 0) + ' px');
    this._t($('#shVal'), (+S.shadowB || 0) + ' px');
    const fxOn = (+S.strokeW > 0) || (+S.shadowB > 0);
    this._t($('#fxTag'), fxOn ? 'ON' : 'OFF');
    this._a($('#fxTag'), 'class', 'tag' + (fxOn ? ' ok' : ''));
    this._t($('#mirrorVal'), S.mirror === 'x' ? '左右' : (S.mirror === 'y' ? '上下' : '关闭'));
    const mirSeg = $('#mirrorSeg');
    if (mirSeg) {
      for (const b of mirSeg.querySelectorAll('button')) {
        const want = b.dataset.mirror === (S.mirror || 'off');
        if (b.classList.contains('on') !== want) b.classList.toggle('on', want);
      }
    }
    this._v2($('#tracking'), +S.tracking || 100);
    this._v2($('#strokeW'), +S.strokeW || 0);
    this._v2($('#shadowB'), +S.shadowB || 0);
    this._v2($('#strokeC'), S.strokeC || '#000000');
    this._v2($('#shadowC'), S.shadowC || '#000000');

    /* ---- 本首偏移 ---- */
    const sk = songKey();
    const po = clampSongOff((S.perSongOff || {})[sk]);
    this._t($('#psTag'), (po > 0 ? '+' : '') + po + ' ms');
    this._t($('#psTitle'), META.title || '—');

    /* ---- 现场工具 ---- */
    const cdLeft = S.cdEndAt ? Math.max(0, (S.cdEndAt - Date.now()) / 1000) : 0;
    this._t($('#cdTag'), S.cdEndAt ? (cdLeft > 0 ? Math.ceil(cdLeft) + 's' : '结束') : 'IDLE');
    const swCd = $('#swCdFull');
    if (swCd && swCd.classList.contains('on') !== !!S.cdFull) swCd.classList.toggle('on', !!S.cdFull);

    /* ---- 歌单响应方式 ---- */
    this._t($('#slModeVal'), S.setlistMode === 'chain' ? '连续' : '独立');
    const slSeg = $('#slModeSeg');
    if (slSeg) {
      for (const b of slSeg.querySelectorAll('button')) {
        const want = b.dataset.slmode === (S.setlistMode || 'indep');
        if (b.classList.contains('on') !== want) b.classList.toggle('on', want);
      }
    }
    this._v2($('#slGap'), Number(S.setlistGap) || 0);

    this.renderPreview(idx);
  },

  /* 写前比对：值没变就不碰 DOM。
     optStatic=false 时退化成「每帧全量重写」，用于同 revision 的 A/B 对照 */
  optStatic: true,
  _v: {},
  _t(el, txt) {
    if (!el) return;
    if (!this.optStatic) { el.textContent = txt; return; }
    const k = el.id || el.className;
    if (this._v['t' + k] === txt) return;
    this._v['t' + k] = txt; el.textContent = txt;
  },
  _a(el, attr, val) {
    if (!el) return;
    if (!this.optStatic) { el.setAttribute(attr, val); return; }
    const k = (el.id || el.className) + '@' + attr;
    if (this._v['a' + k] === val) return;
    this._v['a' + k] = val; el.setAttribute(attr, val);
  },
  _s(el, prop, val) {
    if (!el) return;
    if (!this.optStatic) { el.style[prop] = val; return; }
    const k = (el.id || el.className) + '@' + prop;
    if (this._v['s' + k] === val) return;
    this._v['s' + k] = val; el.style[prop] = val;
  },
  _v2(el, val) {
    if (!el) return;
    if (document.activeElement === el) return;      // 用户正在拖，别抢
    if (!this.optStatic) { el.value = val; return; }
    const k = (el.id || '') + '@value';
    if (this._v['v' + k] === val) return;
    this._v['v' + k] = val; el.value = val;
  },

  renderPreview(idx) {
    const t = $('#miniText');
    if (!t) return;
    if (this.optStatic && this._prevIdx === idx && this._prevFs === S.fs && this._prevBo === this.blackout) return;
    this._prevIdx = idx; this._prevFs = S.fs; this._prevBo = this.blackout;
    const line = LINES[idx];
    t.textContent = line ? line.text : (this.blackout ? '' : '—');
    t.style.opacity = line ? '1' : '0.35';
    t.style.fontSize = Math.round(15 * (S.fs / 100)) + 'px';
  },

  payload() {
    return {
      S: S, lines: LINES, meta: META,
      song: Clock.nowSong(), tc: Clock.nowTc(), running: Clock.running
    };
  },

  renderList() {
    const box = $('#lyricList');
    if (!box) return;
    if (!LINES.length) {
      box.innerHTML = '<div class="empty">导入歌词后在此编辑时间轴<br>' +
        '<span style="font-family:var(--mono);font-size:11px">双击时间码可手动改写 · 支持逐字歌词</span></div>';
      return;
    }
    const frag = document.createDocumentFragment();
    for (let i = 0; i < LINES.length; i++) {
      const l = LINES[i];
      const row = document.createElement('div');
      row.className = 'lyr';
      row.dataset.i = i;
      const t = document.createElement('div');
      t.className = 't';
      t.textContent = fmtShort(l.t);
      const txt = document.createElement('div');
      txt.className = 'txt';
      txt.textContent = l.text;
      row.appendChild(t); row.appendChild(txt);
      row.addEventListener('click', () => Transport.alignTo(i));
      t.addEventListener('dblclick', ev => {
        ev.stopPropagation();
        const v = prompt('输入新时间（秒 或 mm:ss.xx）', l.t.toFixed(2));
        if (v == null) return;
        const nv = parseTimeStr(v);
        if (isFinite(nv)) { LINES[i].t = nv; LINES = sortLines(LINES); saveState(); this.renderList(); Bus.send('lines', { lines: LINES, meta: META }); }
      });
      frag.appendChild(row);
    }
    box.innerHTML = '';
    box.appendChild(frag);
    this.lastIdx = -99;
  },

  highlight(now) {
    const idx = indexAt(now);
    if (idx === this.lastIdx) return;
    const rows = $('#lyricList') && $('#lyricList').children;
    if (!rows) return;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row.classList || !row.classList.contains('lyr')) continue;
      const n = +row.dataset.i;
      row.classList.toggle('on', n === idx);
      row.classList.toggle('past', n < idx);
    }
    this.lastIdx = idx;
    if (idx >= 0 && rows[idx]) {
      const box = $('#lyricList');
      const r = rows[idx];
      const top = r.offsetTop - box.clientHeight * 0.42;
      box.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }
  },

  loop() {
    this.lastRaf = Date.now();
    this.tick();
    requestAnimationFrame(() => this.loop());
  },

  /* 真正的一帧工作；rAF 与定时器兜底都走这里 */
  tick() {
    try {
      Clock.tick();
      const now = Clock.nowSong();
      const tc = Clock.nowTc();
      const big = $('#tcBig');
      if (big) {
        big.textContent = secToTc(tc, S.fps);
        big.classList.toggle('lock', (S.src !== 'internal' && Clock.locked));
      }
      const led = $('#ledIn');
      if (led) this._a(led, 'class', 'led' + (Clock.locked || S.src === 'internal' ? ' live' : (Clock.running ? ' warn' : '')));
      this.highlight(now);
      this.sync();
      if (S.src === 'ltc' && Ltc.running) {
        const pct = Math.min(100, Ltc.level * 220);
        const meter = $('#ltcMeter');
        if (meter) meter.style.width = pct.toFixed(0) + '%';
        if ($('#ltcLevel')) $('#ltcLevel').textContent = (Ltc.level * 100).toFixed(0) + '%';
        if ($('#ltcLock')) {
          $('#ltcLock').textContent = Clock.locked ? '已锁定' : '未锁定';
          $('#ltcLock').style.color = Clock.locked ? 'var(--acc)' : 'var(--mute)';
        }
      }
      const nowMs = Date.now();
      if (nowMs - this.lastSend > 260) {
        this.lastSend = nowMs;
        Bus.send('clock', { song: now, tc: tc, running: Clock.running, locked: Clock.locked });
      }
    } catch (e) {
      this.loopErr = (e && (e.message || e)) + '';
      if (!this.loopLogged) { this.loopLogged = 1; try { console.error('UILOOP', e); } catch (x) { } }
    }
  },

  /* rAF 掉线（窗口后台、部分内嵌浏览器）时由定时器接着推，保证时间码与推送不停 */
  watchdog() {
    if (Date.now() - (this.lastRaf || 0) > 200) this.tick();
  }
};

function fmtShort(t) {
  const m = Math.floor(t / 60), s = t - m * 60;
  return pad2(m) + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
}
function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
function sortLines(arr) {
  return arr.sort((a, b) => a.t - b.t);
}

/* =====================================================================
   控制台初始化
   ===================================================================== */
/* =====================================================================
   界面主题（v1.4.12）
   日版 / 夜版 / 自动。只给 body 加 th-day，切换 var(--*) 令牌，不改任何组件规则。
   输出窗口永远不加这个类，投屏画面不受影响。
   ===================================================================== */
function themeNow() {
  if (S.uiTheme === 'auto') {
    try { return window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches ? 'day' : 'night'; }
    catch (e) { return 'night'; }
  }
  return S.uiTheme === 'day' ? 'day' : 'night';
}
function applyTheme() {
  if (IS_OUT) return;
  const t = themeNow();
  document.body.classList.toggle('th-day', t === 'day');
  const tag = $('#uiThemeTag');
  if (tag) tag.textContent = t === 'day' ? '日版' : '夜版';
  $$('#themeSeg button').forEach(b => {
    const on = b.dataset.theme === S.uiTheme;
    if (b.classList.contains('on') !== on) b.classList.toggle('on', on);
  });
}
function setTheme(v) {
  if (!['day', 'night', 'auto'].includes(v)) return;
  S.uiTheme = v;
  saveState();
  applyTheme();
}

/* =====================================================================
   投屏（v1.4.12）
   目标屏幕 / 全屏方式 / 手动坐标。屏幕列表依赖 Window Management API
   （Chrome / Edge 支持，Safari 不支持，退化为「跟随窗口所在屏」+ 窗口铺满）。
   ===================================================================== */
const Cast = {
  details: null, win: null, mon: 0,

  init() {
    S.cast = Object.assign({}, DEF_STATE.cast, S.cast || {});
    this.renderSelect();
    this.syncUI();
    /* 之前授权过就静默刷新；没授权会 reject，不打扰用户 */
    if ('getScreenDetails' in window) {
      window.getScreenDetails().then(d => {
        this.details = d;
        this.renderSelect();
        this.syncUI();
      }).catch(() => { });
    }
  },

  screens() { return (this.details && this.details.screens) || []; },

  async scan() {
    if (!('getScreenDetails' in window)) return { ok: 0, why: 'unsupported' };
    try {
      this.details = await Promise.race([
        window.getScreenDetails(),
        /* 授权弹窗可能一直挂着不返回，8 秒后按超时处理，按钮不至于永远转下去 */
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000))
      ]);
      this.renderSelect();
      this.syncUI();
      return { ok: 1, n: this.screens().length };
    } catch (e) {
      return { ok: 0, why: (e && e.message === 'timeout') ? 'timeout' : 'denied' };
    }
  },

  renderSelect() {
    const sel = $('#castScreen');
    if (!sel) return;
    const cur = (S.cast && S.cast.screen) || 'auto';
    sel.innerHTML = '';
    const add = (val, text) => {
      const o = document.createElement('option');
      o.value = val; o.textContent = text;
      sel.appendChild(o);
    };
    add('auto', '跟随窗口所在屏');
    this.screens().forEach((s, i) => {
      add(s.label || ('screen' + i),
        (s.isPrimary ? '主屏' : '副屏') + ' ' + (i + 1) + ' · ' + Math.round(s.width) + '×' + Math.round(s.height));
    });
    add('manual', '手动坐标');
    const known = cur === 'auto' || cur === 'manual' || this.screens().some(s => s.label === cur);
    sel.value = known ? cur : 'auto';
    if (!known) S.cast.screen = 'auto';
  },

  syncUI() {
    const c = S.cast || {};
    const info = $('#castInfo');
    if (info) {
      if (c.manual || c.screen === 'manual') info.textContent = '手动 ' + (c.manualX || '0') + ',' + (c.manualY || '0');
      else if (c.screen && c.screen !== 'auto') {
        const s = this.screens().find(x => x.label === c.screen);
        info.textContent = s ? ((s.isPrimary ? '主屏' : '副屏') + ' · ' + Math.round(s.width) + '×' + Math.round(s.height)) : '已保存的屏幕';
      } else info.textContent = '跟随窗口所在屏';
    }
    const sw = $('#swCastManual');
    if (sw) sw.classList.toggle('on', !!c.manual);
    const box = $('#castManual');
    if (box) box.classList.toggle('hide', !c.manual);
    if ($('#castX')) $('#castX').value = c.manualX || '';
    if ($('#castY')) $('#castY').value = c.manualY || '';
    const mv = { auto: '自动', native: '原生全屏', window: '窗口铺满' }[c.mode] || '自动';
    if ($('#castModeVal')) $('#castModeVal').textContent = mv;
    $$('#castModeSeg button').forEach(b => {
      const on = b.dataset.castmode === c.mode;
      if (b.classList.contains('on') !== on) b.classList.toggle('on', on);
    });
    const tag = $('#castTag');
    if (tag) {
      tag.textContent = this.screens().length ? (this.screens().length + ' 屏') : '单屏';
      tag.className = 'tag' + (this.screens().length > 1 ? ' ok' : '');
    }
    const hint = $('#castHint');
    if (hint) {
      hint.textContent = ('getScreenDetails' in window)
        ? '选好目标屏幕后点「打开并投屏」。macOS 上若浏览器拒绝脚本全屏，会自动退回窗口铺满，真全屏请在输出窗口按 ⌃⌘F。'
        : '此浏览器不提供屏幕列表（Safari 常见）：把输出窗口拖到副屏，点「窗口铺满」，再在窗口内按 ⌃⌘F 或点 ⛶。';
    }
  },

  /* 目标窗口的屏幕矩形；拿不到就用当前窗口所在屏 */
  targetRect() {
    const scr = window.screen || {};
    const c = S.cast || {};
    let left = Number.isFinite(scr.availLeft) ? scr.availLeft : 0;
    let top = Number.isFinite(scr.availTop) ? scr.availTop : 0;
    let width = scr.availWidth || scr.width || 1280;
    let height = scr.availHeight || scr.height || 720;
    if (c.manual || c.screen === 'manual') {
      const x = parseInt(c.manualX, 10), y = parseInt(c.manualY, 10);
      if (Number.isFinite(x)) left = x;
      if (Number.isFinite(y)) top = y;
    } else if (c.screen && c.screen !== 'auto') {
      const s = this.screens().find(x => x.label === c.screen);
      if (s) {
        left = Number.isFinite(s.availLeft) ? s.availLeft : s.left;
        top = Number.isFinite(s.availTop) ? s.availTop : s.top;
        width = s.availWidth || s.width;
        height = s.availHeight || s.height;
      }
    }
    return { left: Math.round(left), top: Math.round(top), width: Math.round(width), height: Math.round(height) };
  },

  open(cast) {
    const url = location.href.replace(/[?&]mode=output/, '').replace(/&viewId=\d+/, '').replace(/[?&]debug=1/, '').replace(/[?&]fs=1/, '').replace(/[?&]cast=1/, '');
    const sep = url.indexOf('?') >= 0 ? '&' : '?';
    const r = this.targetRect();
    const feats = 'popup=yes,width=' + r.width + ',height=' + r.height + ',left=' + r.left + ',top=' + r.top;
    const w = window.open(url + sep + 'mode=output' + (cast ? '&cast=1' : ''), 'livelyric_out', feats);
    if (!w) { toast('弹窗被拦截，请允许此站点弹出窗口'); return null; }
    this.win = w;
    const place = () => {
      try { w.moveTo(r.left, r.top); w.resizeTo(Math.max(320, r.width), Math.max(240, r.height)); } catch (e) { /* 跨屏移动被拒时保持原样 */ }
    };
    setTimeout(place, 80);
    setTimeout(place, 700);
    const push = () => { Bus.send('state', UI.payload()); Bus.send('lines', { lines: LINES, meta: META }); };
    [0, 300, 1000, 2500].forEach(d => setTimeout(push, d));
    this.monitor();
    return w;
  },

  /* 投屏：位置交给 window.open 的 feats，铺满/全屏交给输出窗口自己（带 cast=1 打开）。
     跨窗口替它调 resizeTo/fullscreen 会被浏览器时好时坏地忽略，不如让那边自己来。 */
  apply() {
    const w = this.open(true);
    if (!w) return;
    toast('已按设置送到目标屏幕；若仍带浏览器边框，在输出窗按 F 或点右侧 ⛶ 即真全屏');
  },

  monitor() {
    if (this.mon) clearInterval(this.mon);
    this.mon = setInterval(() => {
      if (!this.win || this.win.closed) {
        clearInterval(this.mon); this.mon = 0; this.win = null;
        ConsoleApp.setOffline();
      }
    }, 2000);
  }
};

const ConsoleApp = {
  init() {
    loadState();
    /* ?opt=0 关闭「写前比对」，退回每帧全量重写：同 revision 的性能 A/B 对照口 */
    if (QS.get('opt') === '0') UI.optStatic = false;
    Renderer.frame = null;
    /* 状态里存着上次选的时钟源，必须同步给时钟引擎，否则外部帧会被当成内部源忽略 */
    Clock.setSrc(S.src);
    this.bind();
    /* 多首：时间码跨过入点自动切歌 */
    Clock.onSong = (idx) => this.switchToSong(idx);
    Clock.songIdx = S.songIdx || 0;
    applyTheme();
    Cast.init();
    /* 系统深浅色变化时，只有「自动」才需要重算 */
    try {
      window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
        if (S.uiTheme === 'auto') applyTheme();
      });
    } catch (e) { /* 老浏览器没有 addEventListener 版本，忽略 */ }
    UI.renderList();
    UI.sync();
    UI.loop();
    setInterval(() => UI.watchdog(), 100);
    Bus.listen(msg => {
      if (msg.type === 'hello' && msg.from === 'output') this.onOutputConnected();
      /* 输出层进全屏失败会回报：控制台给出可执行的手势指引，而不是静默 */
      else if (msg.type === 'fs' && msg.ok === 0) {
        toast('浏览器拒绝脚本全屏，已改为窗口铺满；真全屏请在输出窗口按 ⌃⌘F（macOS）/ F11');
      }
    });
    this.refreshDevices();
    if (!LINES.length) this.loadSample(true);
    /* 上次停在外部源时，把源切换后的 UI 状态也复现出来 */
    const segBtn = $$('#srcSeg button').find(b => b.dataset.src === S.src);
    if (segBtn) segBtn.click();
    /* 上次用的是网络源，刷新后自动重连，不用再手点一次 */
    if (S.src === 'ws' && S.wsUrl) {
      if ($('#wsUrl')) $('#wsUrl').value = S.wsUrl;
      WsBridge.connect(S.wsUrl);
    } else if ($('#wsUrl')) {
      $('#wsUrl').value = S.wsUrl || '';
    }
  },

  onOutputConnected() {
    const chip = $('#outState');
    chip.innerHTML = '<span class="led live"></span>输出已连接';
    $('#monTag').textContent = 'ONLINE';
    $('#monTag').className = 'tag ok';
    /* 全量推送一次，保证输出窗口拿到当前歌词与样式 */
    Bus.send('state', UI.payload());
    setTimeout(() => Bus.send('lines', { lines: LINES, meta: META }), 60);
    setTimeout(() => Bus.send('state', UI.payload()), 140);
  },

  setOffline() {
    const chip = $('#outState');
    if (chip) chip.innerHTML = '<span class="led"></span>输出未连接';
    $('#monTag').textContent = 'OFFLINE';
    $('#monTag').className = 'tag';
  },

  /* ---------- 歌单（多首时间码） ---------- */
  renderSetlist() {
    const box = $('#slList');
    if (!box) return;
    if (!S.setlist.length) {
      box.innerHTML = '<div class="empty" style="padding:18px 0;text-align:center;color:#6f7a8c;font-size:12px">还没有曲目</div>';
      return;
    }
    box.innerHTML = '';
    const slots = (typeof slotList === 'function') ? slotList() : S.setlist;
    slots.forEach((e, i) => {
      const d = document.createElement('div');
      d.className = 'it' + (i === S.songIdx ? ' on' : '');
      const name = escHtml(e.title || '未命名');
      const n = Array.isArray(e.lines) ? e.lines.length : 0;
      /* 连续模式下显示的是累计推后之后的实际入点，方便核对 */
      const mark = (S.setlistMode === 'chain' && S.setlist[i] && Math.abs((S.setlist[i].tcIn || 0) - e.tcIn) > 0.5)
        ? '<i title="连续模式累计推后" style="color:var(--acc);font-style:normal">⇢ </i>' : '';
      d.innerHTML = '<span class="tc">' + mark + secToTc(e.tcIn, S.fps) + '</span>'
        + '<span class="nm">' + name + '</span>'
        + '<span class="ln">' + n + ' 行</span>'
        + '<button data-sl-go="' + i + '">定位</button>'
        + '<button data-sl-del="' + i + '">移除</button>';
      box.appendChild(d);
    });
    $$('#slList [data-sl-go]').forEach(b => b.onclick = () => this.jumpToSong(+b.dataset.slGo));
    $$('#slList [data-sl-del]').forEach(b => b.onclick = () => {
      S.setlist.splice(+b.dataset.slDel, 1);
      if (S.songIdx >= S.setlist.length) S.songIdx = 0;
      Clock.songIdx = S.songIdx;
      if (!S.setlist.length) { Clock.songIdx = 0; S.songIdx = 0; }
      saveState(); this.renderSetlist();
    });
  },

  nextSlot() {
    const list = S.setlist;
    if (!list.length) return S.anchor;
    const last = list[list.length - 1];
    const dur = Array.isArray(last.lines) && last.lines.length
      ? (last.lines[last.lines.length - 1].t + lineSpan(last.lines.length - 1, last.lines))
      : 300;
    const gap = S.setlistMode === 'chain' ? Math.max(0, Math.min(30, Number(S.setlistGap) || 0)) * 60 : 0;
    const slot = slotList()[list.length - 1];
    return (slot ? slot.tcIn : last.tcIn) + Math.max(30, dur) + gap;
  },

  addToSetlist() {
    if (!LINES.length) return toast('先载入歌词');
    const raw = ($('#slTc').value || '').trim();
    const tcIn = raw ? tcToSec(raw, S.fps) : this.nextSlot();
    const item = {
      tcIn: tcIn,
      anchor: tcIn,
      offset: 0,
      title: META.title || ('曲目 ' + (S.setlist.length + 1)),
      meta: { title: META.title, artist: META.artist, source: META.source },
      lines: JSON.parse(JSON.stringify(LINES))
    };
    if (S.setlistMode === 'chain') {
      /* 连续模式按列表顺序累计，新曲永远排在末尾，不按时间码重排 */
      S.setlist.push(item);
      S.songIdx = S.setlist.length - 1;
      Clock.songIdx = S.songIdx;
    } else {
      const dup = S.setlist.findIndex(e => Math.abs(e.tcIn - tcIn) < 0.02);
      if (dup >= 0) S.setlist[dup] = item; else S.setlist.push(item);
      S.setlist.sort((a, b) => a.tcIn - b.tcIn);
      /* 当前歌词就是这一首，索引要跟上，否则后面按时间码切歌会错位 */
      const at = S.setlist.indexOf(item);
      if (at >= 0) { S.songIdx = at; Clock.songIdx = at; }
    }
    _slotCache = null;
    $('#slTc').value = '';
    saveState();
    this.renderSetlist();
    toast('已加入歌单 · ' + item.title + ' @ ' + secToTc(slotList()[S.songIdx] ? slotList()[S.songIdx].tcIn : tcIn, S.fps));
  },

  jumpToSong(i) {
    const e = S.setlist[i];
    if (!e) return;
    /* 先把时钟推进到该曲入点，再无条件切到该曲
       （不能依赖 feed 的索引变化，同一首时它是静止的） */
    const slot = slotList()[i] || e;
    Clock.feed(slot.tcIn + 0.001);
    this.switchToSong(i);
  },

  switchToSong(idx) {
    const e = S.setlist && S.setlist[idx];
    if (!e) return;
    if (Array.isArray(e.lines) && e.lines.length) {
      LINES = e.lines;
      if (e.meta) META = Object.assign({}, e.meta);
    }
    S.songIdx = idx;
    Clock.songIdx = idx;
    _cueRows = null;
    saveState();
    UI.renderList(); UI.sync();
    Bus.send('lines', { lines: LINES, meta: META });
    toast('切歌 · ' + (e.title || ''));
  },

  bind() {
    /* --- 时间码源 --- */
    $$('#srcSeg button').forEach(b => b.addEventListener('click', () => {
      $$('#srcSeg button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      const v = b.dataset.src;
      S.src = v; Clock.setSrc(v);
      $('#paneInternal').classList.toggle('hide', v !== 'internal');
      $('#paneLtc').classList.toggle('hide', v !== 'ltc');
      $('#paneMtc').classList.toggle('hide', v !== 'mtc');
      $('#paneWs').classList.toggle('hide', v !== 'ws');
      Clock.locked = false;
      saveState();
      Bus.send('state', UI.payload());
      UI.sync();
    }));

    /* --- 音频 --- */
    $('#btnAudio').onclick = () => $('#audioFile').click();
    $('#audioFile').onchange = ev => {
      const f = ev.target.files[0]; if (!f) return;
      if (!Clock.audio) { Clock.audio = new Audio(); Clock.audio.preload = 'auto'; }
      if (Clock.audio.src && Clock.audio.src.startsWith('blob:')) URL.revokeObjectURL(Clock.audio.src);
      /* 换音频要同时清掉无音频时留下的 wall 时钟，否则两条时间源会打架 */
      Clock.useWall = false;
      Clock.wallOffset = 0;
      Clock.wallStart = Date.now();
      Clock.audio.src = URL.createObjectURL(f);
      try { Clock.audio.currentTime = 0; } catch (e) { }
      $('#audioName').textContent = f.name.slice(0, 18);
      /* 载入了音频但时间码源还挂在 LTC / WS 上时，歌词根本不会跟音频走 */
      if (S.src !== 'internal') {
        const nm = { ltc: 'LTC', mtc: 'MTC', ws: '网络' }[S.src] || S.src;
        toast('音频已载入，但时间码源仍是「' + nm + '」；切到「内部」才由音频驱动');
      } else {
        toast('音频已载入');
      }
    };
    $('#btnDemo').onclick = () => this.loadSample(false);

    /* --- LTC --- */
    $('#btnLtcStart').onclick = async () => {
      try {
        await Ltc.start($('#ltcDevice').value);
        toast('LTC 解码已启动');
      } catch (e) { toast('无法打开音频输入：' + e.message); }
    };
    $('#btnLtcStop').onclick = () => { Ltc.stop(); toast('LTC 已停止'); };

    /* --- MTC --- */
    $('#btnMidi').onclick = async () => {
      try {
        const name = await Mtc.connect();
        $('#midiPort').textContent = name;
        toast('MIDI 已连接：' + name);
      } catch (e) { toast('MIDI 连接失败：' + e.message); }
    };
    $('#btnMidiOff').onclick = () => { Mtc.disconnect(); $('#midiPort').textContent = '未连接'; };

    /* --- WS --- */
    $('#btnWs').onclick = () => {
      const url = $('#wsUrl').value.trim();
      if (!url) return toast('请填写 WebSocket 地址');
      S.wsUrl = url;
      saveState();
      WsBridge.connect(url);
      toast('正在连接 ' + url);
    };
    $('#btnWsOff').onclick = () => { WsBridge.disconnect(); $('#wsState').textContent = '未连接'; };

    /* --- fps --- */
    $$('#fpsSeg button').forEach(b => b.addEventListener('click', () => {
      $$('#fpsSeg button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      S.fps = +b.dataset.fps;
      if (Ltc.dec) Ltc.dec.setFps(S.fps);
      saveState(); UI.sync(); Bus.send('state', UI.payload());
    }));

    /* --- anchor --- */
    $('#btnAnchorNow').onclick = () => {
      S.anchor = Math.round(Clock.nowTc());
      saveState(); UI.sync(); Bus.send('state', UI.payload());
      toast('已把当前帧设为歌曲 0s');
    };
    $('#btnAnchorLine').onclick = () => {
      const idx = indexAt(rawSong());
      if (idx < 0) return toast('当前没有激活行');
      /* 内部音频源直接 seek 到这一行开头，不动全局偏移：
         旧逻辑无差别改 offset，点一次就把整首偏移改掉，且越点越偏 */
      if (S.src === 'internal') {
        Clock.seekInternal(LINES[idx].t - Clock.songShift());
        saveState(); UI.sync(); UI.renderList(); Bus.send('state', UI.payload());
        return toast('已对齐第 ' + (idx + 1) + ' 行（音频已跳到行首）');
      }
      const cur = rawSong();
      const delta = LINES[idx].t - cur;
      S.offset += delta * 1000;
      saveState(); UI.sync(); Bus.send('state', UI.payload());
      toast('已对齐第 ' + (idx + 1) + ' 行');
    };

    /* --- offset --- */
    $('#offset').oninput = ev => {
      S.offset = clampOffset(ev.target.value);
      UI.sync();
    };
    $('#offset').onchange = () => { saveState(); Bus.send('state', UI.payload()); };
    $$('[data-off]').forEach(b => b.addEventListener('click', () => {
      const v = +b.dataset.off;
      S.offset = v === 0 ? 0 : clampOffset(S.offset + v);
      saveState(); UI.sync(); Bus.send('state', UI.payload());
    }));

    /* --- switches --- */
    const sw = (id, key, cb) => {
      const el = $(id);
      el.classList.toggle('on', !!S[key]);
      el.onclick = () => {
        S[key] = !S[key];
        el.classList.toggle('on', S[key]);
        saveState(); Bus.send('state', UI.payload());
        if (cb) cb();
      };
    };
    sw('#swSmooth', 'smooth');
    sw('#swShowTc', 'showTc');
    sw('#swCap', 'cap', () => { UI.renderList(); });
    /* 这两个只改 frame 上的类名，重跑 applyStyle 即可，不必重建歌词 DOM */
    sw('#swFade', 'fade', () => { Renderer.applyStyle(); });
    sw('#swFocus', 'focus', () => { Renderer.applyStyle(); });

    /* --- 歌词驱动模式 --- */
    $$('#tcModeSeg .btn').forEach(b => b.addEventListener('click', () => {
      $$('#tcModeSeg .btn').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      S.tcMode = b.dataset.tcmode;
      _cueRows = null;
      saveState(); UI.sync(); UI.renderList();
      Bus.send('state', UI.payload());
      const label = S.tcMode === 'timeline' ? '歌词时间轴' : (S.tcMode === 'clock' ? '时间码均摊' : 'Cue 表');
      toast('歌词驱动：' + label
        + (S.tcMode === 'clock' && linesHaveTimeline(LINES)
          ? '（这份歌词自带时间轴，均摊会整段错位，建议用「时间轴」）' : ''));
    }));

    $('#btnCueMark').onclick = () => {
      if (!LINES.length) return toast('先载入歌词');
      const idx = indexAt(Clock.nowSong());
      if (idx < 0) return toast('当前时间码还没进入歌词范围');
      const tc = Clock.nowTc();
      LINES[idx].cue = tc;
      _cueRows = null;
      saveState();
      UI.renderList(); UI.sync();
      Bus.send('lines', { lines: LINES, meta: META });
      toast('第 ' + (idx + 1) + ' 行 → ' + secToTc(tc, S.fps));
      if (S.tcMode !== 'cue') {
        S.tcMode = 'cue';
        $$('#tcModeSeg .btn').forEach(x => x.classList.toggle('on', x.dataset.tcmode === 'cue'));
        Bus.send('state', UI.payload());
      }
    };

    $('#btnSetlist').onclick = () => { this.renderSetlist(); $('#modalSetlist').classList.add('on'); };
    $('#btnSlFromNow').onclick = () => { $('#slTc').value = secToTc(Clock.nowTc(), S.fps); };
    $('#btnSlAdd').onclick = () => this.addToSetlist();
    $('#btnSlClear').onclick = () => {
      if (!S.setlist.length) return;
      S.setlist = []; S.songIdx = 0; Clock.songIdx = 0;
      saveState(); this.renderSetlist(); UI.renderList();
      Bus.send('state', UI.payload());
      toast('歌单已清空');
    };

    /* --- 歌单响应方式：独立 / 连续累计 --- */
    $$('#slModeSeg button').forEach(b => b.addEventListener('click', () => {
      S.setlistMode = b.dataset.slmode;
      _slotCache = null;
      saveState(); UI.sync(); this.renderSetlist(); Bus.send('state', UI.payload());
      toast(S.setlistMode === 'chain' ? '连续模式：按列表累计推后起点' : '独立模式：各首用自己的入点');
    }));
    $('#slGap').oninput = ev => {
      S.setlistGap = Math.max(0, Math.min(30, +ev.target.value || 0));
      _slotCache = null; UI.sync();
    };
    $('#slGap').onchange = () => {
      saveState(); this.renderSetlist(); Bus.send('state', UI.payload());
    };

    /* --- 工程导出 / 导入 --- */
    $('#btnExport').onclick = () => {
      const st = JSON.parse(JSON.stringify(S));
      /* blob: 是本机的临时句柄，换机就废，导出时剥掉免得导入后空背景 */
      if (st.mediaSrc && String(st.mediaSrc).startsWith('blob:')) {
        delete st.mediaSrc;
        if (st.bg === 'media') st.bg = 'none';
      }
      delete st.api;
      const proj = {
        app: 'livelyric', ver: APP_VER, at: new Date().toISOString(),
        state: st, lines: LINES, meta: META
      };
      const blob = new Blob([JSON.stringify(proj, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'LiveLyric_' + String(META.title || 'project').replace(/[\\/:*?"<>|]/g, '_') + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      toast('工程已导出');
    };
    $('#btnImportProj').onclick = () => $('#projFile').click();

    /* --- 给歌词镶嵌绝对时间码（⌚ 库） --- */
    const tcLibText = () => {
      const txt = buildTcLib(LINES, S.anchor, S.fps);
      if (!txt) toast('先载入带时间轴的歌词');
      return txt;
    };
    $('#btnEmbedTc').onclick = () => {
      const txt = tcLibText(); if (!txt) return;
      const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = String(META.title || 'lyric').replace(/[\\/:*?"<>|]/g, '_') + '_时间码.lrc';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      toast('已镶嵌时间码：' + txt.split('\n').filter(x => x.startsWith('⌚')).length + ' 行，起点 ' + secToTc(S.anchor, S.fps));
    };
    $('#btnCopyTc').onclick = () => {
      const txt = tcLibText(); if (!txt) return;
      const done = () => toast('时间码歌词已复制');
      const fail = () => toast('浏览器拒绝写剪贴板，请改用「镶嵌时间码」导出文件');
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(txt).then(done).catch(fail);
        } else { fail(); }
      } catch (e) { fail(); }
    };
    $('#projFile').onchange = ev => {
      const f = ev.target.files[0];
      ev.target.value = '';
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        let j = null;
        try { j = JSON.parse(String(r.result)); } catch (e) { return toast('不是有效的 JSON'); }
        if (!j || j.app !== 'livelyric') return toast('不是 LiveLyric 工程文件');
        if (j.state) S = Object.assign({}, DEF_STATE, j.state);
        if (Array.isArray(j.lines)) {
          LINES = sortLines(j.lines.map(l => ({
            t: +l.t || 0,
            text: String(l.text == null ? '' : l.text),
            dur: +l.dur || 0,
            words: l.words || null,
            cue: l.cue
          })));
        }
        if (j.meta) META = Object.assign({ title: '', artist: '', source: '' }, j.meta);
        _slotCache = null; _cueRows = null;
        Clock.songIdx = 0;
        saveState(); UI.sync(); UI.renderList(); this.renderSetlist();
        Bus.send('state', UI.payload());
        Bus.send('lines', { lines: LINES, meta: META });
        toast('工程已导入：' + LINES.length + ' 行 · 歌单 ' + (S.setlist || []).length + ' 首');
      };
      r.readAsText(f, 'utf-8');
    };

    /* --- styles --- */
    $$('#styleGrid .chip').forEach(b => b.addEventListener('click', () => {
      $$('#styleGrid .chip').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      S.style = b.dataset.style;
      saveState(); UI.sync(); Bus.send('state', UI.payload());
    }));

    /* --- 组合预设：一套样式 + 参数打包，现场一键切 --- */
    const PRESETS = {
      night:   { label: '夜场霓虹',   style: 'neon',     fade: true,  focus: false, fs: 105, lh: 150, tracking: 100 },
      mono:    { label: '念白打字',   style: 'type',     fade: true,  focus: false, fs: 95,  lh: 168, tracking: 100 },
      launch:  { label: '发布会渐变', style: 'duo',      fade: true,  focus: true,  fs: 110, lh: 145, tracking: 95 },
      guofeng: { label: '国风竖排',   style: 'vertical', fade: false, focus: false, fs: 92,  lh: 170, tracking: 115 }
    };
    const applyPreset = (p, name) => {
      const rest = Object.assign({}, p); delete rest.label;
      Object.assign(S, rest);
      saveState();
      UI.sync();
      $$('#styleGrid .chip').forEach(x => x.classList.toggle('on', x.dataset.style === S.style));
      Renderer.build();
      Bus.send('state', UI.payload());
      if ($('#presetTag')) $('#presetTag').textContent = name || '自定义';
      toast('已应用：' + (name || '我的组合'));
    };
    $$('#presetSeg .btn').forEach(b => b.addEventListener('click', () => {
      const p = PRESETS[b.dataset.preset];
      if (p) applyPreset(p, p.label);
    }));
    $('#btnSavePreset').onclick = () => {
      S.presetMine = { style: S.style, fade: !!S.fade, focus: !!S.focus,
        fs: S.fs, lh: S.lh, tracking: S.tracking };
      saveState();
      toast('已存下当前组合：' + String(S.style).toUpperCase());
    };
    $('#btnMinePreset').onclick = () => {
      if (!S.presetMine) { toast('还没有存过组合，先点「存当前组合」'); return; }
      applyPreset(S.presetMine, '我的组合');
    };

    /* --- backgrounds --- */
    $$('#bgGrid .chip').forEach(b => b.addEventListener('click', () => {
      $$('#bgGrid .chip').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      S.bg = b.dataset.bg;
      if (S.bg === 'media' && !S.mediaSrc) { $('#bgFile').click(); return; }
      saveState(); UI.sync(); Bus.send('state', UI.payload());
    }));
    $('#bgFile').onchange = ev => {
      const f = ev.target.files[0]; if (!f) return;
      if (S.mediaSrc && S.mediaSrc.startsWith('blob:')) URL.revokeObjectURL(S.mediaSrc);
      S.mediaSrc = URL.createObjectURL(f);
      S.mediaType = f.type.startsWith('video') ? 'video' : 'image';
      S.bg = 'media';
      $$('#bgGrid .chip').forEach(x => x.classList.toggle('on', x.dataset.bg === 'media'));
      saveState(); UI.sync(); Bus.send('state', UI.payload());
      toast('背景已载入');
    };

    /* --- ratio --- */
    $$('#ratioSeg button').forEach(b => b.addEventListener('click', () => {
      $$('#ratioSeg button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      S.ratio = b.dataset.ratio;
      saveState(); UI.sync(); Bus.send('state', UI.payload());
    }));

    /* --- font --- */
    $('#fontSize').oninput = ev => { S.fs = +ev.target.value; UI.sync(); };
    $('#fontSize').onchange = () => Bus.send('state', UI.payload());
    $('#lineHeight').oninput = ev => { S.lh = +ev.target.value; UI.sync(); };
    $('#lineHeight').onchange = () => Bus.send('state', UI.payload());

    /* --- 字距 / 描边 / 阴影（1.4.0） --- */
    $('#tracking').oninput = ev => { S.tracking = +ev.target.value; UI.sync(); };
    $('#tracking').onchange = () => { saveState(); Bus.send('state', UI.payload()); };
    $('#strokeW').oninput = ev => { S.strokeW = +ev.target.value; UI.sync(); };
    $('#strokeW').onchange = () => { saveState(); Bus.send('state', UI.payload()); };
    $('#strokeC').oninput = ev => { S.strokeC = ev.target.value; UI.sync(); };
    $('#strokeC').onchange = () => { saveState(); Bus.send('state', UI.payload()); };
    $('#shadowB').oninput = ev => { S.shadowB = +ev.target.value; UI.sync(); };
    $('#shadowB').onchange = () => { saveState(); Bus.send('state', UI.payload()); };
    $('#shadowC').oninput = ev => { S.shadowC = ev.target.value; UI.sync(); };
    $('#shadowC').onchange = () => { saveState(); Bus.send('state', UI.payload()); };

    /* --- 镜面 --- */
    $$('#mirrorSeg button').forEach(b => b.addEventListener('click', () => {
      S.mirror = b.dataset.mirror;
      saveState(); UI.sync(); Bus.send('state', UI.payload());
    }));

    /* --- 本首偏移（独立于全局微调，切歌自动跟随） --- */
    $('#btnPsApply').onclick = () => {
      const v = parseFloat(($('#psSec').value || '').replace(',', '.').trim());
      if (!isFinite(v)) return toast('请填秒数，例如 2.5 或 -1.2');
      const k = songKey();
      if (S.perSongBase[k] == null) {
        S.perSongBase[k] = clampSongOff((S.perSongOff || {})[k]);
      }
      S.perSongOff[k] = clampSongOff(perSongOffMs() + v * 1000);
      $('#psSec').value = '';
      saveState(); UI.sync(); Bus.send('state', UI.payload());
      toast('本首整体平移 ' + (v > 0 ? '+' : '') + v.toFixed(2) + ' 秒');
    };
    $('#btnPsRestore').onclick = () => {
      const k = songKey();
      if (S.perSongBase[k] == null) return toast('本首没有可恢复的偏移');
      S.perSongOff[k] = S.perSongBase[k];
      delete S.perSongBase[k];
      saveState(); UI.sync(); Bus.send('state', UI.payload());
      toast('已恢复本首最初的对齐');
    };

    /* --- 时间码发生器 --- */
    $('#genDur').oninput = ev => { $('#genDurVal').textContent = ev.target.value + ' 秒'; };
    $('#genLvl').oninput = ev => { $('#genLvlVal').textContent = ev.target.value + '%'; };
    const genUrl = base => {
      const start = ($('#genStart').value || '').trim() || '01:00:00:00';
      const dur = Math.min(600, Math.max(10, +($('#genDur').value) || 180));
      const lvl = Math.min(1, Math.max(0.05, (+('#genLvl').value || 50) / 100));
      return base + '/ltc?start=' + encodeURIComponent(start) + '&dur=' + dur +
        '&fps=' + S.fps + '&sr=48000&lvl=' + lvl.toFixed(2);
    };
    $('#btnGenLtc').onclick = async () => {
      const base = await this.probeBuiltin();
      if (!base) return toast('内置服务未运行，双击「启动 LiveLyric.bat」后重试');
      const url = genUrl(base);
      $('#ltcGenTag').textContent = '生成中';
      const a = document.createElement('a');
      a.href = url;
      a.download = 'ltc_' + S.fps + 'fps_' + (new Date()).toISOString().slice(0, 10) + '.wav';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => { $('#ltcGenTag').textContent = 'WAV'; }, 1500);
      toast('已生成 ' + S.fps + 'fps 时间码，开始下载');
    };
    $('#btnGenCopy').onclick = async () => {
      const base = await this.probeBuiltin();
      if (!base) return toast('内置服务未运行');
      const url = genUrl(base);
      try { await navigator.clipboard.writeText(url); toast('链接已复制'); }
      catch (e) { toast('复制失败，请手动选中：' + url); }
    };

    /* --- 现场工具：倒计时 / 临时上屏 --- */
    $('#btnCdStart').onclick = () => {
      const m = parseFloat(($('#cdMin').value || '').replace(',', '.').trim());
      if (!isFinite(m) || m <= 0) return toast('请填分钟数，例如 5');
      S.cdTotal = m * 60;
      S.cdEndAt = Date.now() + m * 60000;
      saveState(); UI.sync(); Bus.send('state', UI.payload());
      toast('倒计时 ' + m + ' 分钟');
    };
    $('#btnCdStop').onclick = () => {
      S.cdEndAt = 0; S.cdTotal = 0;
      saveState(); UI.sync(); Bus.send('state', UI.payload());
    };
    sw('#swCdFull', 'cdFull');
    $('#btnSubShow').onclick = () => {
      const v = ($('#subText').value || '').trim();
      if (!v) return toast('先填要上屏的文字');
      S.subText = v; S.subOn = true;
      saveState(); UI.sync(); Bus.send('state', UI.payload());
    };
    $('#btnSubHide').onclick = () => {
      S.subOn = false;
      saveState(); UI.sync(); Bus.send('state', UI.payload());
    };

    /* --- lyric import --- */
    $('#btnImport').onclick = () => $('#lyricFile').click();
    $('#lyricFile').onchange = ev => {
      const f = ev.target.files[0]; if (!f) return;
      const r = new FileReader();
      r.onload = () => this.loadText(String(r.result), f.name);
      r.readAsText(f, 'utf-8');
    };
    $('#btnPaste').onclick = () => $('#modalPaste').classList.add('on');
    $('#btnPasteOk').onclick = () => {
      const v = $('#pasteArea').value;
      if (!v.trim()) return;
      this.loadText(v, '粘贴文本');
      $('#modalPaste').classList.remove('on');
    };
    $('#btnOnline').onclick = async () => {
      $('#olApi').value = S.api || '';
      $('#modalOnline').classList.add('on');
      const st = $('#olState');
      st.textContent = '检测中…';
      st.style.color = 'var(--st-idle)';
      const base = await this.probeBuiltin(true);
      if (base) {
        st.textContent = '已连接 · 内置服务（' + base + '）';
        st.style.color = 'var(--st-ok)';
      } else {
        st.textContent = '未运行 · 双击「启动 LiveLyric.bat」即可';
        st.style.color = 'var(--st-warn)';
      }
    };
    $('#btnOnlineOk').onclick = () => this.fetchOnline();
    $$('[data-close]').forEach(b => b.addEventListener('click', () => $('#' + b.dataset.close).classList.remove('on')));
    $$('#olSrc button').forEach(b => b.addEventListener('click', () => {
      $$('#olSrc button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
    }));

    /* --- transport --- */
    $('#btnGo').onclick = () => Transport.go();
    $('#btnNext').onclick = () => Transport.next();
    $('#btnPrev').onclick = () => Transport.prev();
    $('#btnPrevCue').onclick = () => Transport.prev();
    $('#btnClear').onclick = () => Transport.clear();
    $('#progressWrap').onclick = ev => {
      if (!LINES.length) return;
      const rect = ev.currentTarget.getBoundingClientRect();
      const r = (ev.clientX - rect.left) / rect.width;
      const idx = Math.round((LINES.length - 1) * r);
      Transport.alignTo(idx);
    };

    /* --- 外观 / 投屏设置（v1.4.12）--- */
    $$('#themeSeg button').forEach(b => b.addEventListener('click', () => setTheme(b.dataset.theme)));
    const saveCast = () => { saveState(); Cast.syncUI(); };
    if ($('#castScreen')) $('#castScreen').onchange = ev => {
      S.cast.screen = ev.target.value;
      if (ev.target.value === 'manual') S.cast.manual = true;
      saveCast();
    };
    $$('#castModeSeg button').forEach(b => b.addEventListener('click', () => {
      S.cast.mode = b.dataset.castmode;
      saveCast();
    }));
    if ($('#swCastManual')) $('#swCastManual').onclick = () => {
      S.cast.manual = !S.cast.manual;
      if (S.cast.manual && S.cast.screen === 'auto') S.cast.screen = 'manual';
      saveCast();
    };
    ['castX', 'castY'].forEach(id => {
      const el = $('#' + id);
      if (!el) return;
      el.oninput = ev => { if (id === 'castX') S.cast.manualX = ev.target.value; else S.cast.manualY = ev.target.value; };
      el.onchange = saveCast;
    });
    if ($('#btnCastScan')) $('#btnCastScan').onclick = async () => {
      const btn = $('#btnCastScan');
      const old = btn.textContent;
      btn.disabled = true;
      btn.textContent = '检测中…';
      const r = await Cast.scan();
      btn.disabled = false;
      btn.textContent = old;
      if (r.ok) toast('已检测到 ' + r.n + ' 块屏幕');
      else if (r.why === 'unsupported') toast('此浏览器不提供屏幕列表：把输出窗口拖到副屏后点「窗口铺满」，再按 ⌃⌘F');
      else if (r.why === 'timeout') toast('等待屏幕授权超时：请在浏览器弹出的授权提示里允许「查看屏幕信息」');
      else toast('未获得屏幕信息授权：可在浏览器站点设置里放开「窗口管理」权限');
      Cast.syncUI();
    };
    if ($('#btnCastOpen')) $('#btnCastOpen').onclick = () => Cast.apply();

    /* --- output --- */
    $('#btnOutput').onclick = () => { Cast.open(false); };
    $('#btnFullscreen').onclick = () => {
      if (Cast.win && !Cast.win.closed) {
        /* 让输出窗口自己开全屏：跨窗口发指令，由它在本窗口执行 */
        Bus.send('fsreq', {});
        toast('已请求输出窗口全屏；若仍带边框请按 F / ⛶');
        return;
      }
      Cast.open(true);
    };

    /* --- keyboard --- */
    document.addEventListener('keydown', ev => {
      if (ev.target && /INPUT|TEXTAREA|SELECT/.test(ev.target.tagName)) return;
      if (ev.code === 'Space') { ev.preventDefault(); Transport.go(); }
      else if (ev.key === 'ArrowRight') { ev.preventDefault(); Transport.next(); }
      else if (ev.key === 'ArrowLeft') { ev.preventDefault(); Transport.prev(); }
      else if (ev.key === 'Escape') { Transport.clear(); }
    });
  },

  refreshDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    Ltc.listDevices().then(list => {
      const sel = $('#ltcDevice');
      const cur = sel.value;
      sel.innerHTML = '<option value="">默认输入</option>';
      list.forEach(d => {
        const o = document.createElement('option');
        o.value = d.deviceId;
        o.textContent = d.label || ('输入 ' + d.deviceId.slice(0, 6));
        sel.appendChild(o);
      });
      sel.value = cur;
    }).catch(() => { });
  },

  loadText(raw, name) {
    _libTitle = '';
    LINES = parseLyric(raw);
    if (!LINES.length) { toast('未解析到有效歌词'); return; }
    META.source = name || '本地';
    /* 带 ⌚ 页标记的歌词库自带曲名时优先用它，文件名会变成「4ROCK-歌词库」这种无关名字 */
    META.title = (_libTitle || '').trim()
      || ((name ? name.replace(/\.(lrc|txt|ttml|xml|srt|ass|json)$/i, '') : META.title) || '未命名');
    _libTitle = '';
    _slotCache = null;
    /* 歌词自带真实时间轴、驱动却停在「时间码均摊」时行号会被均匀铺开、整首错位。
       这里只提示，不替用户改——两种驱动都要能选，是用户的现场判断。 */
    if (S.tcMode === 'clock' && linesHaveTimeline(LINES)) {
      setTimeout(() => toast('当前驱动是「时间码均摊」：这份歌词自带时间轴，均摊会整段错位；精确对齐请切到「时间轴」'), 20);
    }
    saveState();
    UI.renderList();
    UI.sync();
    Bus.send('lines', { lines: LINES, meta: META });
    Bus.send('state', UI.payload());
    toast('已载入 ' + LINES.length + ' 行');
  },

  /* 探测内置歌词服务：同源优先，其次本机默认端口 17321（兼容旧的 3000） */
  async probeBuiltin(force) {
    if (!force && this._base !== undefined) return this._base;
    const cands = [];
    if (/^https?:/.test(location.protocol)) cands.push(location.origin);
    cands.push('http://127.0.0.1:17321');
    cands.push('http://127.0.0.1:3000');
    for (const base of cands) {
      try {
        const r = await fetch(base + '/health', { cache: 'no-store', credentials: 'omit' });
        const j = await r.json();
        if (j && j.app === 'livelyric') { this._base = base; return base; }
      } catch (e) { /* 忽略，试下一个 */ }
    }
    this._base = null;
    return null;
  },

  async fetchOnline() {
    const src = ($('#olSrc .on') || {}).dataset ? $('#olSrc .on').dataset.ol : 'netease';
    const raw = $('#olInput').value.trim();
    if (!raw) return toast('请填写歌名、分享链接或歌曲 ID');
    const api = $('#olApi').value.trim();
    S.api = api;
    saveState();
    const p = parseSongInput(raw);
    const ckey = cacheKeyOf(src, p);
    const list = [];
    const base = await this.probeBuiltin();
    if (base) {
      const q = (p.id && !p.kw) ? 'id=' + encodeURIComponent(p.id) : 'kw=' + encodeURIComponent(p.kw || p.id);
      list.push(base + '/lyric?' + q + '&src=' + src);
    }
    if (api) {
      list.push(api.replace('{id}', encodeURIComponent(p.id || raw)).replace('{kw}', encodeURIComponent(p.kw || raw)));
    }

    /* 服务不可用：直接用本地缓存，演出断了网也不会哑 */
    if (!list.length) {
      const c = cacheGet(ckey);
      if (c) {
        this.loadText(c.lrc, c.title + (c.word ? ' · 逐字' : ''));
        $('#modalOnline').classList.remove('on');
        return toast('内置服务未运行，已用离线缓存（' + c.title + '）');
      }
      return toast('内置服务未运行：双击「启动 LiveLyric.bat」，或填自定义接口');
    }

    let lastErr = '';
    for (const url of list) {
      try {
        const res = await fetch(url, { credentials: 'omit', cache: 'no-store' });
        const data = await res.json();
        if (!res.ok || (data && data.ok === 0)) throw new Error((data && data.err) || ('HTTP ' + res.status));
        const lyric = pickLyric(data);
        if (!lyric || !lyric.trim()) throw new Error('响应里没有歌词');
        const title = (src === 'netease' ? '网易云 ' : 'QQ音乐 ') + (data.title || p.kw || p.id) + (data.word ? ' · 逐字' : '');
        this.loadText(lyric, title);
        cachePut(ckey, { title: title, src: src, word: !!data.word, lrc: lyric });
        $('#modalOnline').classList.remove('on');
        toast(data.word ? '已载入逐字歌词' : '已载入歌词（行级时间轴）');
        return;
      } catch (e) { lastErr = e.message; }
    }

    const c = cacheGet(ckey);
    if (c) {
      this.loadText(c.lrc, c.title + '（缓存）');
      $('#modalOnline').classList.remove('on');
      return toast('联网失败（' + lastErr + '），已用离线缓存');
    }
    toast('获取失败：' + lastErr);
  },

  loadSample(silent) {
    const demo = [
      '[00:00.00]LiveLyric',
      '[00:03.60]把时间码变成歌词的节拍',
      '[00:08.20]<00:08.20>逐<00:08.55>字<00:08.90>同<00:09.25>步<00:09.60>，<00:09.95>帧<00:10.30>级<00:10.65>对<00:11.00>齐',
      '[00:13.40]QLab 送出 LTC 或 MTC',
      '[00:17.60]歌词就跟着演出走',
      '[00:21.80]不需要在台上找进度条',
      '[00:26.20]<00:26.20>这首歌<00:26.90>没有<00:27.60>伴奏<00:28.30>也<00:29.00>能<00:29.70>排练',
      '[00:32.60]把歌词拖进来，对齐一次',
      '[00:36.80]剩下的交给时间码',
      '[00:41.60]LiveLyric · 实时歌词同步'
    ].join('\n');
    this.loadText(demo, '示例歌词');
    if (!silent) {
      Clock.startInternal();
      UI.sync();
    }
  }
};

/* =====================================================================
   工具
   ===================================================================== */
const LYRIC_CACHE_KEY = 'livelyric.cache.v1';
/* 偏移滑块的物理范围，所有写入点都要夹在这个区间内：
   一旦被写成几百万毫秒，整首歌词会整体错位到无法匹配 */
const OFFSET_LIMIT = 3000;
function clampOffset(v) {
  v = Number(v);
  if (!isFinite(v)) return 0;
  v = Math.round(v);
  return Math.max(-OFFSET_LIMIT, Math.min(OFFSET_LIMIT, v));
}
const LYRIC_CACHE_MAX = 24;

function cacheKeyOf(src, p) {
  const id = p && p.id ? p.id : '';
  const kw = p && p.kw ? String(p.kw).trim().toLowerCase() : '';
  return src + ':' + (id || kw);
}
function cacheReadAll() {
  try { return JSON.parse(localStorage.getItem(LYRIC_CACHE_KEY) || '{}') || {}; }
  catch (e) { return {}; }
}
function cacheGet(k) {
  const m = cacheReadAll();
  const e = m[k];
  if (!e || !e.lrc) return null;
  /* 命中就刷新时间戳，做最近最少使用淘汰 */
  e.at = Date.now();
  try { localStorage.setItem(LYRIC_CACHE_KEY, JSON.stringify(m)); } catch (err) { }
  return e;
}
function cachePut(k, o) {
  try {
    const m = cacheReadAll();
    m[k] = Object.assign({ at: Date.now() }, o);
    const keys = Object.keys(m);
    const over = keys.length - LYRIC_CACHE_MAX;
    if (over > 0) {
      keys.sort((a, b) => (m[a].at || 0) - (m[b].at || 0))
        .slice(0, over)
        .forEach(x => { delete m[x]; });
    }
    localStorage.setItem(LYRIC_CACHE_KEY, JSON.stringify(m));
  } catch (e) { /* 配额满或隐私模式，缓存失败不影响主流程 */ }
}

function parseSongInput(s) {
  const m1 = s.match(/[?&#]id=(\d{4,})/) || s.match(/song\/(\d{4,})/);
  if (m1) return { id: m1[1] };
  const m2 = s.match(/songDetail\/([0-9A-Za-z]{8,})/);
  if (m2) return { id: m2[1] };
  if (/^\d{4,}$/.test(s)) return { id: s };
  return { kw: s };
}

function pickLyric(data) {
  if (!data) return '';
  if (typeof data === 'string') return data;
  if (typeof data.lrc === 'string') return data.lrc;
  if (data.lrc && data.lrc.lyric) return data.lrc.lyric;
  if (typeof data.message === 'string') return data.message;
  if (data.lyric) return data.lyric;
  if (data.data) {
    if (typeof data.data === 'string') return data.data;
    if (data.data.lyric) return data.data.lyric;
    if (data.data.conteng) return data.data.conteng;
  }
  if (data.klyric && data.klyric.lyric) return data.klyric.lyric;
  return '';
}
let toastTimer = 0;
function toast(msg) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 2200);
}
function SOCK_UI() {
  const el = $('#wsState');
  if (!el) return;
  const map = {
    open: '已连接', connecting: '连接中', closed: '已断开',
    retry: '重连中', error: '错误', stale: '无数据', idle: '未连接'
  };
  el.textContent = map[WsBridge.state] || WsBridge.state;
  el.style.color = WsBridge.state === 'open' ? 'var(--acc)'
    : (WsBridge.state === 'retry' || WsBridge.state === 'stale' ? 'var(--warn, #ff8a3d)' : 'var(--mute)');
}

/* =====================================================================
   LTC 自检（用于验证解码位域，不依赖真实硬件）
   ===================================================================== */
function ltcBits(hh, mm, ss, ff, fps) {
  const b = new Array(80).fill(0);
  const set = (from, len, val) => { for (let i = 0; i < len; i++) b[from + i] = (val >> i) & 1; };
  set(0, 4, ff % 10);
  set(8, 2, Math.floor(ff / 10));
  set(16, 4, ss % 10);
  set(24, 3, Math.floor(ss / 10));
  set(32, 4, mm % 10);
  set(40, 3, Math.floor(mm / 10));
  set(48, 4, hh % 10);
  set(56, 2, Math.floor(hh / 10));
  const SYNC = '0011111111111101';
  for (let i = 0; i < 16; i++) b[64 + i] = +SYNC[i];
  return b;
}
function ltcWave(bits, fps, sr) {
  const unit = sr / (fps * 160);
  const out = [];
  let pol = 1;
  const half = Math.round(unit);
  const put = (p, n) => { for (let k = 0; k < n; k++) out.push(p); };
  for (let i = 0; i < bits.length; i++) {
    pol = -pol;                       /* bit cell 边界必翻转 */
    if (bits[i] === 1) {
      put(pol, half);
      pol = -pol;                     /* 中点额外翻转 */
      put(pol, half);
    } else {
      put(pol, half * 2);
    }
  }
  return out;
}
function ltcSelfTest() {
  const sr = 48000, fps = 25;
  const frames = [];
  const allBits = [];
  for (let i = 0; i < 6; i++) {
    const b = ltcBits(1, 2, 3, i, fps);
    frames.push(b);
    for (let k = 0; k < 80; k++) allBits.push(b[k]);
  }
  const got = [];
  const d = new LtcDecoder(fps, sr);
  d.onFrame = v => got.push(+v.toFixed(3));
  d.push(new Float32Array(ltcWave(allBits, fps, sr)));
  return {
    expect: '01:02:03:00 ~ 01:02:03:04',
    count: got.length,
    values: got.map(v => secToTc(v, fps))
  };
}

/* =====================================================================
  启动
   ===================================================================== */
function clockTest() {
  const a = S.anchor;
  const bakSong = Clock.songIdx;
  const bakOnSong = Clock.onSong;
  const bakList = S.setlist;
  const bakSrc = Clock.src;
  /* 外部时钟的续走状态，测完原样放回，否则界面上的时间码会跳回 0 */
  const bakExt = { stamp: Clock.extStamp, song: Clock.extSong, tc: Clock.tcSec, last: Clock.lastExt };
  /* 自检不切歌、也不走歌单：喂进来的测试时间码可能落在真实歌单区间里 */
  Clock.onSong = null;
  S.setlist = [];
  Clock.songIdx = 0;
  S.anchor = 3600;
  Clock.extStamp = 0;
  Clock.setSrc('ltc');
  Clock.feed(3600 + 8.4);
  const song = Clock.nowSong();
  const idx = indexAt(song);
  const r = { song: +song.toFixed(2), idx: idx, text: LINES[idx] ? LINES[idx].text : '' };
  /* 恢复原时钟源与续走状态 */
  Clock.setSrc(bakSrc);
  Clock.extStamp = bakExt.stamp;
  Clock.extSong = bakExt.song;
  Clock.tcSec = bakExt.tc;
  Clock.lastExt = bakExt.last;
  Clock.locked = !!bakExt.stamp;
  Clock.running = !!bakExt.stamp;
  S.anchor = a;
  S.setlist = bakList;
  Clock.songIdx = bakSong;
  Clock.onSong = bakOnSong;
  return r;
}
/* 多首 + 三种驱动模式的自检：不依赖外部时间码硬件 */
function setlistTest() {
  const bak = { setlist: S.setlist, songIdx: S.songIdx, anchor: S.anchor, mode: S.tcMode };
  /* 自检期间用记录回调替换真实切歌，避免写回 localStorage 污染状态 */
  const bakOnSong = Clock.onSong;
  const got = [];
  Clock.onSong = (idx) => got.push(idx);
  const bakCue = LINES.length > 3 ? LINES[3].cue : undefined;
  const mk = (title, tc) => ({ tcIn: tc, anchor: tc, offset: 0, title: title, lines: [] });
  S.setlist = [mk('A', 3600), mk('B', 3900)];
  Clock.songIdx = 0;
  Clock.extStamp = 0;
  const c = {};
  Clock.feed(3700); c.inA = Clock.songIdx;
  Clock.feed(4000); c.inB = Clock.songIdx;
  Clock.feed(3500); c.before = Clock.songIdx;
  Clock.feed(3810); c.backA = Clock.songIdx;
  c.hits = got.join(',');
  c.song = +Clock.nowSong().toFixed(2);

  /* 三种模式的取行差异 */
  S.tcMode = 'timeline'; c.tl = indexAt(20, LINES);
  S.tcMode = 'clock'; c.cl = indexAt(20, LINES);
  S.tcMode = 'cue'; c.cue0 = indexAt(0, LINES);
  if (LINES.length > 3) { LINES[3].cue = 15; _cueRows = null; c.cueHit = indexAt(16, LINES); }

  S.setlist = bak.setlist; S.songIdx = bak.songIdx; S.tcMode = bak.mode;
  S.anchor = bak.anchor;
  Clock.songIdx = bak.songIdx; Clock.extStamp = 0;
  Clock.locked = false; Clock.running = false;
  Clock.onSong = bakOnSong;
  if (LINES.length > 3) LINES[3].cue = bakCue;
  _cueRows = null;
  return c;
}
if (QS.get('debug') === '1') {
  window.__LL = {
    Clock: Clock, Ltc: Ltc, Mtc: Mtc, WsBridge: WsBridge, LtcDecoder: LtcDecoder,
    selfTest: ltcSelfTest,
    get S() { return S; }, get LINES() { return LINES; }, get META() { return META; },
    seek: t => Transport.seekSong(t),
    render: () => Renderer.render(Clock.nowSong(), Transport.blackout)
  };
  /* 自检结果写进 title，便于外部读取（页面内变量在隔离环境下不可见） */
  setTimeout(() => {
    try {
      const probe = LINES.slice(0, 40).filter(l => l.words && l.words.length).length;
      document.title = 'SELFTEST ' + JSON.stringify({
        v: APP_VER,
        ltc: ltcSelfTest(), clock: clockTest(),
        src: S.src, csrc: Clock.src, tc: +Clock.nowTc().toFixed(2), ext: Clock.extStamp,
        run: Clock.running, lock: Clock.locked,
        ws: {
          st: WsBridge.state, url: WsBridge.url, gen: WsBridge.gen,
          rs: WsBridge.sock ? WsBridge.sock.readyState : -1,
          last: WsBridge.lastMsg ? Date.now() - WsBridge.lastMsg : -1,
          err: WsBridge.lastErr || '', raw: WsBridge.lastRaw || ''
        },
        parse: { total: LINES.length, withWords: probe, w0: LINES[0] && LINES[0].words ? LINES[0].words.length : -1 },
        setlist: setlistTest()
      });
    } catch (e) { document.title = 'SELFTEST ERR ' + e.message; }
  }, 1200);
}
if (IS_OUT) {
  document.body.classList.add('is-output');
  document.addEventListener('DOMContentLoaded', () => {
    loadState();
    OutApp.init();
    if (QS.get('fs') === '1') setTimeout(() => OutApp.toggleFullscreen(), 300);
    /* 控制台「打开并投屏」带来的 cast=1：由输出窗口自己动手铺满。
       跨窗口调 resizeTo 会被浏览器时好时坏地忽略，自己调最稳。 */
    if (QS.get('cast') === '1') setTimeout(() => {
      const mode = (S.cast && S.cast.mode) || 'auto';
      if (mode === 'window') {
        const ok = LyricOut.fill();
        LyricOut.showHint(ok
          ? '已铺满当前屏幕。要隐藏标题栏的真全屏：macOS 按 ⌃⌘F，Windows 按 F11'
          : '此浏览器不允许脚本全屏：macOS 请按 ⌃⌘F，Windows 请按 F11');
      } else {
        OutApp.enterFullscreen('auto');
      }
    }, 350);
  });
  if (document.readyState !== 'loading') { loadState(); OutApp.init(); }
} else {
  document.addEventListener('DOMContentLoaded', () => ConsoleApp.init());
  if (document.readyState !== 'loading') { ConsoleApp.init(); }
}
</script>
</body>
</html>
