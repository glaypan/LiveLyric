/* =====================================================================
   输出渲染器
   ===================================================================== */
const Renderer = {
  frame: null, stack: null, stage: null,
  domLines: [], curIdx: -2, wordEls: [],
  bgType: '', bgCanvas: null, bgRaf: 0, bgMediaEl: null,
  lastLinesRef: null,

  init() {
    this.frame = $('#frame');
    this.stack = $('#stack');
    this.stage = $('#stage');
    this.layout();
  },

  applyStyle() {
    if (!this.stack) return;
    this.stack.className = 'lyrstack';
    this.frame.className = 'frame s-' + S.style
      + (S.fade === false ? '' : ' fade-mask')
      + (S.focus ? ' focus-zoom' : '');
    const h = this.frame.clientHeight || 800;
    const fs = Math.max(18, h * 0.088 * (S.fs / 100));
    this.stack.style.setProperty('--fs', fs.toFixed(1) + 'px');
    this.stack.style.setProperty('--lh', (S.lh / 100).toFixed(3));
    /* 字距：每种样式有自己的基准，再乘用户倍数（100 = 原样） */
    const baseTr = S.style === 'vertical' ? 0.18
      : (S.style === 'neon' ? 0.03
      : (S.style === 'type' ? 0.04
      : (S.style === 'duo' ? 0.02
      : (S.style === 'marquee' ? 0.03
      : (S.style === 'glow' ? 0.04 : (S.style === 'minimal' ? 0.02 : 0.01))))));
    this.stack.style.letterSpacing = (baseTr * ((+S.tracking || 100) / 100)).toFixed(3) + 'em';
    /* 镜面只翻歌词层；HUD 与背景不动 */
    if (S.mirror === 'x') this.frame.classList.add('mir-x');
    else if (S.mirror === 'y') this.frame.classList.add('mir-y');
  },

  /* 逐行文字效果：描边与阴影。逐字填充的字符是透明字身，阴影不可见，描边仍有效 */
  applyFx(el) {
    if (!el) return;
    const w = +S.strokeW || 0;
    el.style.webkitTextStroke = w > 0 ? (w + 'px ' + (S.strokeC || '#000000')) : '';
    const b = +S.shadowB || 0;
    el.style.textShadow = b > 0 ? ('0 2px ' + b + 'px ' + (S.shadowC || '#000000')) : '';
  },

  layout() {
    if (!this.frame || !this.stage) return;
    const W = this.stage.clientWidth || window.innerWidth;
    const H = this.stage.clientHeight || window.innerHeight;
    let w, h;
    if (S.ratio === 'fit') { w = W; h = H; }
    else {
      const [a, b] = S.ratio.split(':').map(Number);
      if (W / H > a / b) { h = H; w = H * a / b; }
      else { w = W; h = W * b / a; }
    }
    this.frame.style.width = Math.floor(w) + 'px';
    this.frame.style.height = Math.floor(h) + 'px';
    this.applyStyle();
    if (this.bgCanvas) { this.bgCanvas.width = Math.floor(w); this.bgCanvas.height = Math.floor(h); }
  },

  build() {
    if (!this.stack) return;
    this.stack.innerHTML = '';
    this.curEl = null;
    this.curIdx = -2;
  },

  fill(idx) {
    const stack = this.stack;
    stack.innerHTML = '';
    const cap = S.cap;
    const from = cap ? -1 : 0;
    const to = cap ? 1 : 0;
    for (let d = from; d <= to; d++) {
      const i = idx + d;
      const line = (i >= 0 && i < LINES.length) ? LINES[i] : null;
      const div = document.createElement('div');
      div.className = 'lyrline ' + (d === 0 ? 'cur' : (line ? 'ctx' : 'ghost'));
      if (line) { this.fillText(div, line); this.applyFx(div); }
      else div.innerHTML = '&nbsp;';
      if (d === 0) this.curEl = div;
      stack.appendChild(div);
    }
  },

  fillText(div, line) {
    /* 逐字样式都要拆成字符：逐字填充靠 --p 推进，弹入与打字机靠 --i 递延 */
    if (S.style === 'karaoke' || S.style === 'bounce' || S.style === 'type') {
      const frag = document.createDocumentFragment();
      const chars = Array.from(line.text);
      for (let c = 0; c < chars.length; c++) {
        const sp = document.createElement('span');
        sp.className = 'char';
        sp.textContent = chars[c] === ' ' ? '\u00A0' : chars[c];
        sp.style.setProperty('--i', c);
        sp.style.setProperty('--p', '0%');
        frag.appendChild(sp);
      }
      div.appendChild(frag);
    } else {
      div.textContent = line.text;
    }
  },

  render(time, blackout) {
    if (!LINES.length) return;
    if (blackout) {
      if (this.curIdx !== -3) { this.curIdx = -3; this.stack.style.opacity = '0'; }
      return;
    }
    /* 换歌过渡：整首歌词换了引用，先压黑再线性淡入，避免硬切闪跳 */
    if (LINES !== this.lastLinesRef) {
      this.lastLinesRef = LINES;
      this.curIdx = -2;
      this.transAt = Date.now();
    }
    /* 用 Date.now 而不是 performance.now：后者在后台标签/部分内嵌环境里会停走 */
    const since = Date.now() - (this.transAt || -1e9);
    this.stack.style.opacity = since < 240 ? Math.max(0, since / 240).toFixed(3) : '1';
    const idx = indexAt(time);
    const geo = idx < 0 ? -1 : idx;
    if (geo !== this.curIdx) {
      this.curIdx = geo;
      this.fill(geo);
    }
    this.updateWords(time, idx);
  },

  updateWords(time, idx) {
    if (idx < 0 || !this.curEl) return;
    const line = LINES[idx];
    if (!line) return;
    const chars = this.curEl.children;
    if (!chars.length || !chars[0].classList.contains('char')) return;
    if (S.style !== 'karaoke') return;
    const ws = line.words;
    if (!ws || !ws.length) {
      const n = chars.length;
      const p = Math.min(1, Math.max(0, (time - line.t) / Math.max(0.1, line.dur)));
      for (let c = 0; c < n; c++) {
        const local = Math.min(1, Math.max(0, (p * n) - c));
        chars[c].style.setProperty('--p', (local * 100).toFixed(1) + '%');
      }
    } else {
      for (let c = 0; c < chars.length; c++) {
        const w = ws[c];
        if (!w) { chars[c].style.setProperty('--p', '100%'); continue; }
        const local = Math.min(1, Math.max(0, (time - w.t) / Math.max(0.01, w.d)));
        chars[c].style.setProperty('--p', (local * 100).toFixed(1) + '%');
      }
    }
  },

  setBackground() {
    const layer = $('#bgLayer');
    if (!layer) return;
    if (this.bgRaf) { cancelAnimationFrame(this.bgRaf); this.bgRaf = 0; }
    this.bgCanvas = null; this.bgMediaEl = null;
    layer.className = 'bglayer';
    layer.innerHTML = '';
    $('#bgScrim').style.display = (S.bg === 'none') ? 'none' : 'block';

    if (S.bg === 'none') { layer.classList.add('bg-none'); return; }
    if (S.bg === 'grad') { layer.classList.add('bg-grad'); return; }

    if (S.bg === 'media') {
      const src = S.mediaSrc;
      if (!src) { layer.classList.add('bg-none'); return; }
      if (S.mediaType === 'video') {
        const v = document.createElement('video');
        v.src = src; v.loop = true; v.muted = true; v.autoplay = true; v.playsInline = true;
        v.className = 'bg-media';
        layer.appendChild(v);
        v.play().catch(() => { });
        this.bgMediaEl = v;
      } else {
        const img = document.createElement('img');
        img.src = src; img.className = 'bg-media';
        layer.appendChild(img);
        this.bgMediaEl = img;
      }
      return;
    }

    const cv = document.createElement('canvas');
    cv.className = 'bg-canvas';
    cv.width = this.frame.clientWidth || 1280;
    cv.height = this.frame.clientHeight || 720;
    layer.appendChild(cv);
    this.bgCanvas = cv;
    const ctx = cv.getContext('2d');
    const kind = S.bg;
    let t0 = performance.now();

    const draw = (now) => {
      const W = cv.width, H = cv.height;
      const t = (now - t0) / 1000;
      ctx.clearRect(0, 0, W, H);
      if (kind === 'aurora') {
        const g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, '#04070A'); g.addColorStop(1, '#020304');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        for (let k = 0; k < 5; k++) {
          const cx = W * (0.5 + 0.34 * Math.sin(t * 0.18 + k * 1.3));
          const cy = H * (0.55 + 0.2 * Math.cos(t * 0.13 + k * 0.9));
          const r = Math.max(W, H) * (0.34 + 0.05 * Math.sin(t * 0.4 + k));
          const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
          const hue = 168 + k * 12;
          rg.addColorStop(0, 'hsla(' + hue + ',82%,60%,' + (0.34 - k * 0.035) + ')');
          rg.addColorStop(0.5, 'hsla(' + (hue + 26) + ',70%,44%,' + (0.16 - k * 0.016) + ')');
          rg.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = rg;
          ctx.fillRect(0, 0, W, H);
        }
      } else if (kind === 'dust') {
        ctx.fillStyle = '#04060A'; ctx.fillRect(0, 0, W, H);
        const n = 90;
        for (let k = 0; k < n; k++) {
          const seed = k * 37.17;
          const x = ((seed * 13.3 + t * (8 + (k % 7) * 3)) % (W + 80)) - 40;
          const y = (H * ((seed % 97) / 97) + H * 0.07 * Math.sin(t * 0.3 + k)) % H;
          const r = 0.5 + (k % 4) * 0.45;
          const a = 0.10 + 0.3 * Math.abs(Math.sin(t * 0.55 + k * 2.1));
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(150,235,225,' + a.toFixed(3) + ')';
          ctx.fill();
        }
      } else if (kind === 'wave') {
        ctx.fillStyle = '#04060A'; ctx.fillRect(0, 0, W, H);
        const rows = 3;
        for (let r = 0; r < rows; r++) {
          ctx.beginPath();
          for (let x = 0; x <= W; x += 3) {
            const ph = x / W * Math.PI * 4 + t * (0.5 + r * 0.18) + r * 1.7;
            const amp = H * (0.045 + r * 0.012);
            const y = H * 0.5 + Math.sin(ph) * amp + Math.sin(ph * 2.3 + t * 0.4) * amp * 0.36;
            if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.strokeStyle = 'rgba(59,227,198,' + (0.30 - r * 0.06) + ')';
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
        const g = ctx.createRadialGradient(W * 0.5, H * 0.5, 0, W * 0.5, H * 0.5, Math.max(W, H) * 0.6);
        g.addColorStop(0, 'rgba(59,227,198,0.05)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      }
      this.bgRaf = requestAnimationFrame(draw);
    };
    this.bgRaf = requestAnimationFrame(draw);
  },

  hud(tc, srcName, stateName, showTc, locked) {
    const tl = $('#hudTL'), br = $('#hudBR');
    if (!tl) return;
    tl.style.display = 'flex';
    br.style.display = showTc ? 'flex' : 'none';
    $('#hudSrc').textContent = srcName || 'INTERNAL';
    const st = $('#hudState');
    st.textContent = stateName || 'STANDBY';
    /* 外部时间码失锁时把状态标红，台上扫一眼就能看见 */
    st.style.color = (locked === false) ? '#ff5a5a' : '';
    $('#hudTc').textContent = tc;
    $('#hudFps').textContent = S.fps + 'FPS';
  },

  /* 倒计时与临时上屏：独立于歌词层，不参与歌词渲染的换行判断 */
  overlay() {
    const wrap = $('#cdWrap');
    if (!wrap) return;
    const left = S.cdEndAt ? Math.max(0, (S.cdEndAt - Date.now()) / 1000) : 0;
    const on = !!S.cdEndAt && left > 0;
    if (wrap.classList.contains('on') !== on) wrap.classList.toggle('on', on);
    const full = !!(on && S.cdFull);
    if (this.frame && this.frame.classList.contains('cdfull') !== full) {
      this.frame.classList.toggle('cdfull', full);
    }
    if (on) {
      const mm = Math.floor(left / 60), ss = Math.floor(left % 60);
      const label = pad2(mm) + ':' + pad2(ss);
      const el = $('#cdVal');
      if (el) {
        if (el.textContent !== label) el.textContent = label;
        const warn = left <= 10;
        if (el.classList.contains('warn') !== warn) el.classList.toggle('warn', warn);
      }
    }
    const sub = $('#subWrap');
    if (sub) {
      const want = !!(S.subOn && S.subText);
      if (sub.classList.contains('on') !== want) sub.classList.toggle('on', want);
      const tx = $('#subTxt');
      if (tx && tx.textContent !== (S.subText || '')) tx.textContent = S.subText || '';
    }
  }
};

/* =====================================================================
   输出窗口主循环
   ===================================================================== */
/* =====================================================================
   全屏能力（v1.4.12）
   浏览器要求 requestFullscreen 由「本窗口内的用户手势」触发，控制台隔窗调用会被拒。
   所以输出层自己保留一个入口：先试标准 API，再试 webkit 前缀，全部失败则退化为「铺满当前屏」。
   ===================================================================== */
const FS = {
  isNative() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
  },
  async enter() {
    if (this.isNative()) return true;
    const el = document.documentElement;
    const fn = el.requestFullscreen || el.webkitRequestFullscreen || el.webkitRequestFullScreen || el.msRequestFullscreen;
    if (!fn) return false;
    try {
      const r = fn.call(el, { navigationUI: 'hide' });
      if (r && typeof r.then === 'function') await r;
      return true;
    } catch (e) {
      return false;
    }
  },
  async exit() {
    const fn = document.exitFullscreen || document.webkitExitFullscreen || document.webkitCancelFullScreen || document.msExitFullscreen;
    if (!fn) return;
    try { await fn.call(document); } catch (e) { /* 已退出或权限问题，忽略 */ }
  },
  /* 伪全屏：把窗口撑到所在屏幕的可用区。脚本不能隐藏浏览器标题栏，但内容区能铺满 */
  fill() {
    const s = window.screen || {};
    const left = Number.isFinite(s.availLeft) ? s.availLeft : 0;
    const top = Number.isFinite(s.availTop) ? s.availTop : 0;
    try {
      window.moveTo(left, top);
      window.resizeTo(s.availWidth || s.width, s.availHeight || s.height);
      return true;
    } catch (e) { return false; }
  }
};

const OutApp = {
  snap: { song: 0, tc: 0, running: false, locked: false, at: 0 },
  blackout: false,
  linesRef: null,

  init() {
    Renderer.init();
    window.addEventListener('resize', () => Renderer.layout());
    Renderer.build();
    Renderer.setBackground();
    Bus.listen(msg => this.onBus(msg));
    Bus.send('hello', { from: 'output' });
    const frame = () => {
      const t = this.now();
      Renderer.render(t, this.blackout);
      Renderer.overlay();
      const tc = secToTc(this.nowTc(t), S.fps);
      const ext = S.src !== 'internal';
      const st = !this.snap.running ? 'STANDBY' : (ext && this.snap.locked ? 'RUN · LOCK' : (ext ? 'RUN · FREE' : 'RUN'));
      Renderer.hud(tc, S.src.toUpperCase(), st, S.showTc, ext ? !!this.snap.locked : null);
    };
    const loop = () => {
      this.lastRaf = Date.now();
      frame();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    /* 投屏窗口被切到后台时 rAF 会被节流甚至停摆，定时器兜底保证画面继续走 */
    setInterval(() => {
      if (Date.now() - (this.lastRaf || 0) > 200) frame();
    }, 100);
    document.addEventListener('keydown', e => {
      if (e.key === 'f' || e.key === 'F') this.toggleFullscreen();
      if (e.key === 'Escape') Bus.send('cmd', { cmd: 'clear' });
    });
    /* 输出窗口自己的全屏入口：只在鼠标活动时浮现，避免常驻在投屏画面上 */
    const fsBtn = document.getElementById('btnOutFs');
    if (fsBtn) {
      fsBtn.onclick = () => this.toggleFullscreen();
      const show = () => {
        if (FS.isNative()) return;
        fsBtn.classList.add('show');
        clearTimeout(this._fsBtnT);
        this._fsBtnT = setTimeout(() => fsBtn.classList.remove('show'), 3400);
      };
      document.addEventListener('mousemove', show);
      show();
    }
    const onFsChange = () => {
      const on = FS.isNative();
      document.body.classList.toggle('fs-on', on);
      if (on) document.body.classList.remove('fs-fill');
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
  },

  now() {
    if (!this.snap.running) return this.snap.song;
    return this.snap.song + (Date.now() - this.snap.at) / 1000;
  },
  /* 时间码只跟「真实位置」走：snap.tc 是控制台用 songRaw 算出的真时间码，
     song 已含偏移，所以差值仍是流逝量，HUD 不会因为调 offset 而跳 */
  nowTc(song) {
    return this.snap.tc + (song - this.snap.song);
  },

  onBus(msg) {
    if (msg.type === 'fsreq') {
      /* 控制台点「输出全屏」：指令过来，由本窗口执行（跨窗口直接调会被浏览器拒） */
      this.enterFullscreen('auto');
      return;
    }
    if (msg.type === 'clock') {
      this.snap.song = msg.song || 0;
      this.snap.tc = msg.tc || 0;
      this.snap.running = !!msg.running;
      this.snap.locked = !!msg.locked;
      this.snap.at = msg.t || Date.now();
    } else if (msg.type === 'state') {
      const prevStyle = S.style, prevBg = S.bg, prevRatio = S.ratio;
      if (msg.S) S = Object.assign({}, DEF_STATE, msg.S);
      if (msg.lineCount !== undefined) { /* lines come via full */ }
      if (Array.isArray(msg.lines)) {
        LINES = msg.lines;
        META = msg.meta || META;
        Renderer.build();
      }
      if (prevStyle !== S.style) { Renderer.build(); }
      if (prevBg !== S.bg) Renderer.setBackground();
      if (prevRatio !== S.ratio) Renderer.layout();
      Renderer.applyStyle();
    } else if (msg.type === 'lines') {
      LINES = msg.lines || [];
      META = msg.meta || META;
      Renderer.build();
    } else if (msg.type === 'blackout') {
      this.blackout = !!msg.on;
    }
  },

  toggleFullscreen() {
    return this.enterFullscreen('manual');
  },

  /* kind: manual（用户点按钮/按键）| auto（带 fs=1 打开或控制台请求） */
  async enterFullscreen(kind) {
    if (FS.isNative()) { await FS.exit(); document.body.classList.remove('fs-on'); return { ok: 1, action: 'exit' }; }
    const native = await FS.enter();
    if (native) {
      document.body.classList.add('fs-on');
      Bus.send('fs', { ok: 1, action: 'native' });
      return { ok: 1, action: 'native' };
    }
    /* 原生被拒：不硬失败，退到「窗口铺满」，至少内容区能占满屏幕 */
    const filled = FS.fill();
    document.body.classList.toggle('fs-fill', filled);
    this.showFsHint(filled
      ? '已铺满当前屏幕。要隐藏标题栏的真全屏：macOS 按 ⌃⌘F，Windows 按 F11'
      : '此浏览器不允许脚本全屏：macOS 请按 ⌃⌘F，Windows 请按 F11');
    Bus.send('fs', { ok: 0, action: filled ? 'window' : 'none', kind: kind || 'manual' });
    return { ok: 0, action: filled ? 'window' : 'none' };
  },

  showFsHint(text) {
    const el = document.getElementById('fsHint');
    if (!el) return;
    el.textContent = text;
    el.classList.add('on');
    clearTimeout(this._fsHintT);
    this._fsHintT = setTimeout(() => el.classList.remove('on'), 5200);
  }
};

/* 控制台要能隔着窗口调用这个能力：顶层 const 不会挂到 window 上，必须显式暴露 */
window.LyricOut = {
  fullscreen: () => OutApp.enterFullscreen('auto'),
  fill: () => { const ok = FS.fill(); document.body.classList.toggle('fs-fill', ok); return ok; },
  isFullscreen: () => FS.isNative(),
  showHint: (t) => OutApp.showFsHint(t)
};
