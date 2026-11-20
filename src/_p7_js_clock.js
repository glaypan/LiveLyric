/* =====================================================================
   时钟引擎
   ===================================================================== */
const Clock = {
  src: 'internal',
  running: false,
  tcSec: 0,
  locked: false,
  lastExt: 0,
  extSong: 0,
  extStamp: 0,
  freewheel: 0,
  audio: null,
  wallStart: 0,
  wallOffset: 0,
  useWall: false,
  /* 多首：当前曲目索引与切歌回调 */
  songIdx: 0,
  onSong: null,

  setSrc(v) {
    this.src = v;
    if (v !== 'internal') this.useWall = false;
  },

  /* 全局微调 + 本首偏移的合计（秒）。正数 = 歌词提前 */
  songShift() {
    return (Number(S.offset) || 0) / 1000 + (perSongOffMs() / 1000);
  },

  /* 原始歌曲位置：不含任何偏移。HUD 时间码、进度读数都该用它 */
  songRaw() {
    if (this.src === 'internal') {
      /* 只要有音频就用音频自己的播放位置，与元数据是否就绪无关。
         旧逻辑在 duration 未就绪时会退回无音频时的 wall 时钟，
         于是「先空载点过播放、再载入音频」时歌词会从旧的 wall 位置起跳，
         和音频整段错开几十秒到几分钟。 */
      if (this.audio) return this.audio.currentTime || 0;
      if (this.useWall && this.running) return (Date.now() - this.wallStart) / 1000 + this.wallOffset;
      return this.wallOffset;
    }
    if (!this.extStamp) return 0;
    return this.extSong + (Date.now() - this.extStamp) / 1000;
  },

  /* 歌词索引位置：内部源必须叠加全局微调与本首偏移，
     否则现场播音频时「微调 offset」是个死控件 —— 这是调了没反应的根因。
     外部源的 extSong 已在 feed() 里带过 offset，不能再叠一次。 */
  nowSong() {
    if (this.src === 'internal') return this.songRaw() + this.songShift();
    return this.songRaw();
  },

  nowTc() {
    if (this.src === 'internal') return S.anchor + this.songRaw();
    if (!this.extStamp) return 0;
    return this.tcSec + (Date.now() - this.lastExt) / 1000 + this.freewheel;
  },

  /* 时间码 → 当前曲目的基准与偏移
     单首时直接用全局 anchor / offset；
     setlist 非空时按 tcIn 升序落到某一首，切歌通过 onSong 回调通知外部。 */
  locate(tc) {
    const list = slotList();
    if (!list || !list.length) {
      return { anchor: S.anchor, offset: S.offset, idx: 0, entry: null };
    }
    let idx = -1;
    for (let i = 0; i < list.length; i++) {
      if (tc >= list[i].tcIn) idx = i;
      else break;
    }
    if (idx < 0) {
      /* 还没到第一首：停在第一首开头，避免歌词空白或负数 */
      return { anchor: list[0].anchor, offset: list[0].offset, idx: 0, entry: list[0], before: true };
    }
    const e = list[idx];
    return { anchor: e.anchor, offset: e.offset, idx: idx, entry: e };
  },

  /* 外部时间码到达 */
  feed(tc, meta) {
    const now = Date.now();
    const geo = this.locate(tc);
    if (geo.idx !== this.songIdx) {
      const prev = this.songIdx;
      this.songIdx = geo.idx;
      if (prev !== geo.idx && typeof this.onSong === 'function') {
        try { this.onSong(geo.idx, geo.entry, prev); } catch (e) { console.warn(e); }
      }
    }
    const target = tc - geo.anchor + geo.offset / 1000 + perSongOffMs() / 1000;
    if (!this.extStamp) {
      this.extSong = target; this.extStamp = now;
    } else {
      const predicted = this.extSong + (now - this.extStamp) / 1000;
      const diff = target - predicted;
      if (Math.abs(diff) > 0.5) {
        this.extSong = target; this.extStamp = now;
      } else {
        const k = S.smooth ? 0.08 : 1;
        this.extSong = predicted + diff * k;
        this.extStamp = now;
      }
    }
    this.tcSec = tc;
    this.lastExt = now;
    this.locked = true;
    this.running = true;
  },

  tick() {
    if (this.src !== 'internal') {
      const idle = (Date.now() - this.lastExt) / 1000;
      if (this.lastExt && idle > 1.2) this.locked = false;
    }
  },

  startInternal() {
    this.running = true;
    if (this.audio) {
      /* 有音频就不该再有 wall 时钟并行，否则两条时间源会互相抢 */
      this.useWall = false;
      this.audio.play().catch(() => { });
    } else {
      this.wallStart = Date.now();
      this.wallOffset = 0;
      this.useWall = true;
    }
  },
  stopInternal() {
    this.running = false;
    if (this.audio) this.audio.pause();
    if (this.useWall) this.wallOffset = (Date.now() - this.wallStart) / 1000 + this.wallOffset;
  },
  seekInternal(t) {
    t = Math.max(0, t);
    if (this.audio) { try { this.audio.currentTime = t; } catch (e) { } }
    else { this.wallOffset = t; this.wallStart = Date.now(); }
  }
};

/* =====================================================================
   LTC 解码（双相标记编码，过零间隔判定）
   ===================================================================== */
class LtcDecoder {
  constructor(fps, sr) {
    this.sr = sr;
    this.setFps(fps);
    this.lastSign = 0;
  }
  setFps(fps) {
    this.fps = fps;
    this.unit = this.sr / (fps * 160);
    this.cell = this.unit * 2;
    this.phase = 0;
    this.edgeCount = 0;
    this.bits = [];
    this.lastSec = null;
    this.frames = 0;
    this.onFrame = this.onFrame || null;
  }
  /* 相位法：每个 bit cell 长 2 unit，cell 中点有跳变即 bit=1 */
  push(buf) {
    const cell = this.cell;
    const loMid = cell * 0.22;
    const loEdge = cell * 0.74;
    for (let i = 0; i < buf.length; i++) {
      this.phase += 1;
      const v = buf[i];
      const sg = v > 0.03 ? 1 : (v < -0.03 ? -1 : 0);
      if (!sg) continue;
      if (this.lastSign === 0) { this.lastSign = sg; continue; }
      if (sg === this.lastSign) continue;
      this.lastSign = sg;
      const p = this.phase;
      if (p >= loEdge) {
        this.pushBit(this.edgeCount ? 1 : 0);
        this.edgeCount = 0;
        this.phase = 0;
      } else if (p >= loMid) {
        this.edgeCount = 1;
      }
    }
  }
  pushBit(b) {
    this.bits.push(b);
    if (this.bits.length > 200) this.bits.splice(0, this.bits.length - 160);
    this.tryParse();
  }
  tryParse() {
    const n = this.bits.length;
    if (n < 16) return;
    const SYNC = '0011111111111101';
    if (this.bits.slice(n - 16).join('') !== SYNC) return;
    if (n < 80) { this.bits = []; return; }
    this.emit(this.bits.slice(n - 80, n - 16));
    this.bits = [];
  }
  emit(b) {
    const get = (from, len) => {
      let v = 0;
      for (let i = 0; i < len; i++) v |= (b[from + i] << i);
      return v;
    };
    const ff = get(0, 4) + 10 * get(8, 2);
    const ss = get(16, 4) + 10 * get(24, 3);
    const mm = get(32, 4) + 10 * get(40, 3);
    const hh = get(48, 4) + 10 * get(56, 2);
    if (ss > 59 || mm > 59 || hh > 23 || ff >= this.fps) return;
    const sec = hh * 3600 + mm * 60 + ss + ff / this.fps;
    if (this.lastSec !== null && Math.abs(sec - this.lastSec) < 1e-6) return;
    this.lastSec = sec;
    this.frames++;
    if (this.onFrame) this.onFrame(sec);
  }
}
const Ltc = {
  ctx: null, stream: null, proc: null, mute: null, dec: null,
  running: false, level: 0,

  async start(deviceId) {
    if (this.running) return;
    const constraints = {
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        autoGainControl: false, echoCancellation: false, noiseSuppression: false,
        channelCount: 1
      }
    };
    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    const src = this.ctx.createMediaStreamSource(this.stream);
    const dec = new LtcDecoder(S.fps, this.ctx.sampleRate);
    dec.onFrame = sec => Clock.feed(sec);
    this.dec = dec;
    const proc = this.ctx.createScriptProcessor(4096, 1, 1);
    proc.onaudioprocess = ev => {
      const buf = ev.inputBuffer.getChannelData(0);
      let peak = 0;
      for (let i = 0; i < buf.length; i++) { const a = buf[i] < 0 ? -buf[i] : buf[i]; if (a > peak) peak = a; }
      this.level = peak;
      dec.push(buf);
    };
    src.connect(proc);
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    proc.connect(mute);
    mute.connect(this.ctx.destination);
    this.proc = proc; this.mute = mute;
    this.running = true;
  },
  stop() {
    this.running = false;
    try { if (this.proc) this.proc.disconnect(); } catch (e) { }
    try { if (this.mute) this.mute.disconnect(); } catch (e) { }
    try { if (this.stream) this.stream.getTracks().forEach(t => t.stop()); } catch (e) { }
    try { if (this.ctx) this.ctx.close(); } catch (e) { }
    this.ctx = null; this.stream = null; this.proc = null; this.mute = null; this.dec = null;
  },
  async listDevices() {
    const list = await navigator.mediaDevices.enumerateDevices();
    return list.filter(d => d.kind === 'audioinput');
  }
};

/* =====================================================================
   MTC 解码（Web MIDI，quarter frame）
   ===================================================================== */
const Mtc = {
  access: null, input: null, nib: new Array(8).fill(null),
  frames: 0, portName: '', lastSec: null,

  supported() { return !!navigator.requestMIDIAccess; },

  async connect() {
    if (!navigator.requestMIDIAccess) throw new Error('此浏览器不支持 Web MIDI');
    this.access = await navigator.requestMIDIAccess({ sysex: true });
    const inputs = Array.from(this.access.inputs.values());
    if (!inputs.length) throw new Error('未找到 MIDI 输入端口');
    const inp = inputs[0];
    this.input = inp;
    this.portName = inp.name;
    inp.onmidimessage = ev => this.onMsg(ev.data);
    return inp.name;
  },
  disconnect() {
    if (this.input) this.input.onmidimessage = null;
    this.input = null; this.portName = ''; this.nib.fill(null);
  },
  onMsg(d) {
    if (!d || !d.length) return;
    const st = d[0];
    if (st === 0xF1 && d.length >= 2) {
      const type = (d[1] >> 4) & 7;
      this.nib[type] = d[1] & 15;
      if (this.nib.every(x => x !== null)) this.assemble();
    } else if (st === 0xF0 && d[0] === 0xF0 && d[d.length - 1] === 0xF7 && d.length >= 9) {
      if (d[1] === 0x7F && d[3] === 0x01 && d[4] === 0x01) {
        const hh = d[5], mm = d[6], ss = d[7], ff = d[8];
        this.pushTc(hh, mm, ss, ff);
      }
    }
  },
  assemble() {
    const n = this.nib;
    const ff = (n[0] | ((n[1] & 3) << 4));
    const ss = (n[2] | ((n[3] & 7) << 4));
    const mm = (n[4] | ((n[5] & 7) << 4));
    const hh = (n[6] | ((n[7] & 3) << 4));
    if (ff >= S.fps || ss > 59 || mm > 59 || hh > 23) return;
    this.pushTc(hh, mm, ss, ff);
  },
  pushTc(hh, mm, ss, ff) {
    const sec = hh * 3600 + mm * 60 + ss + ff / S.fps;
    if (this.lastSec !== null && Math.abs(sec - this.lastSec) < 1e-6) return;
    this.lastSec = sec;
    this.frames++;
    Clock.feed(sec);
  }
};

/* =====================================================================
   网络桥（WebSocket JSON）
   ===================================================================== */
const WsBridge = {
  sock: null, state: 'idle', url: '',
  want: false,     // 用户是否希望保持连接
  retry: 0,        // 退避计数
  timer: 0, hb: 0, lastMsg: 0,
  gen: 0,          // 连接代次：旧的 socket 事件不再驱动重连

  connect(url) {
    this.url = url;
    this.want = true;
    this.retry = 0;
    this.gen++;            // 作废之前所有 socket 的回调
    clearTimeout(this.timer);
    this._open();
  },

  _open() {
    if (!this.want || !this.url) return;
    clearTimeout(this.timer);
    const gen = ++this.gen;
    if (this.sock) { try { this.sock.close(); } catch (e) { } }
    let sock = null;
    try { sock = new WebSocket(this.url); }
    catch (e) { this.state = 'retry'; this._ui(); this._schedule(); return; }
    this.sock = sock;
    this.state = 'connecting';
    this._ui();
    sock.onopen = () => {
      if (gen !== this.gen) return;
      this.state = 'open';
      this.retry = 0;
      this.lastMsg = Date.now();
      this._ui();
    };
    sock.onclose = () => {
      if (gen !== this.gen) return;   // 被新连接替换，不算掉线
      this.sock = null;
      if (!this.want) return;
      this.state = 'closed';
      /* 断线只判失锁，不停走：演出中断码宁可续走也不要黑屏，用红字告警 */
      if (S.src !== 'internal') Clock.locked = false;
      this._ui();
      this._schedule();
    };
    sock.onerror = () => { if (gen === this.gen) { this.state = 'error'; this._ui(); } };
    sock.onmessage = ev => {
      if (gen !== this.gen) return;
      this.lastMsg = Date.now();
      this.lastRaw = String(ev.data).slice(0, 80);
      if (this.state !== 'open') { this.state = 'open'; this._ui(); }
      let d = null;
      try { d = JSON.parse(ev.data); } catch (e) { return; }
      if (!d) return;
      /* 心跳应答不当作时间码 */
      if (d.pong || d.ping) return;
      try {
        if (d.fps) S.fps = +d.fps;
        if (typeof d.tc === 'string') Clock.feed(tcToSec(d.tc, S.fps));
        else if (typeof d.tc === 'number') Clock.feed(d.tc);
        else if (typeof d.song === 'number') Clock.feed(S.anchor + d.song);
        else if (d.cmd === 'go') Transport.go();
        else if (d.cmd === 'next') Transport.next();
        else if (d.cmd === 'prev') Transport.prev();
        else if (d.cmd === 'clear') Transport.clear();
      } catch (err) {
        this.lastErr = (err && err.message) || String(err);
      }
    };
    this._heartbeat();
  },

  _schedule() {
    if (!this.want) return;
    this.retry = Math.min(this.retry + 1, 8);
    const wait = Math.min(1000 * Math.pow(1.8, this.retry), 10000);
    clearTimeout(this.timer);
    this.state = 'retry';
    this.timer = setTimeout(() => this._open(), wait);
    this._ui();
  },

  _heartbeat() {
    clearInterval(this.hb);
    this.hb = setInterval(() => {
      if (!this.want) return;
      const rs = this.sock ? this.sock.readyState : 3;
      /* 已断开但没收到 close 事件时，主动收尸并重连 */
      if (rs === 2 || rs === 3) {
        if (this.state !== 'retry') {
          this.state = 'closed';
          if (S.src !== 'internal') Clock.locked = false;
          this._ui();
          this._schedule();
        }
        return;
      }
      try { this.sock.send(JSON.stringify({ ping: 1 })); } catch (e) { }
      /* 长时间没有任何数据只做标记，不主动断开：发送方可能只在变化时发帧 */
      if (Date.now() - this.lastMsg > 30000 && this.state === 'open') {
        this.state = 'stale';
        if (S.src !== 'internal') Clock.locked = false;
        this._ui();
      }
    }, 5000);
  },

  disconnect() {
    this.want = false;
    this.gen++;
    clearTimeout(this.timer);
    clearInterval(this.hb);
    if (this.sock) { try { this.sock.close(); } catch (e) { } }
    this.sock = null;
    this.state = 'idle';
    this._ui();
  },

  _ui() { if (typeof SOCK_UI === 'function') SOCK_UI(); }
};
