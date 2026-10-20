// 全部程序生成：WebAudio 合成 SFX + 循环配乐。必须在用户手势中调用 unlock()。
export class AudioSys {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.muted = false;
    this.musicTimer = null;
    this.step = 0;
    this.nextTime = 0;
  }

  get unlocked() { return !!this.ctx; }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.15;
    this.musicGain.connect(this.master);
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.9;
    this.sfxGain.connect(this.master);
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.02);
  }

  // ---------- 基础合成 ----------
  _osc(type, f0, f1, dur, gain, when = 0, dest = null) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(f0, 1), t);
    o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(dest || this.sfxGain);
    o.start(t);
    o.stop(t + dur + 0.03);
  }

  _noise(dur, { type = 'lowpass', f0 = 3000, f1 = 100, gain = 0.4, when = 0, dest = null, q = 1 } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(Math.max(f0, 20), t);
    f.frequency.exponentialRampToValueAtTime(Math.max(f1, 20), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(dest || this.sfxGain);
    src.start(t); src.stop(t + dur + 0.03);
  }

  // ---------- SFX ----------
  fire(own = true) {
    this._osc('square', own ? 340 : 210, own ? 55 : 40, 0.12, 0.3);
    this._noise(0.1, { f0: 4200, f1: 300, gain: 0.22 });
  }
  hitTank() {
    this._osc('triangle', 950, 260, 0.09, 0.32);
    this._noise(0.07, { type: 'bandpass', f0: 1400, f1: 500, gain: 0.22, q: 2.5 });
  }
  hitWall() {
    this._noise(0.08, { f0: 1800, f1: 220, gain: 0.28 });
  }
  explosion(big = false) {
    this._noise(big ? 1.0 : 0.55, { f0: big ? 3600 : 2600, f1: 50, gain: big ? 0.9 : 0.6 });
    this._osc('sine', big ? 95 : 70, 26, big ? 0.7 : 0.45, 0.7);
  }
  hurt() { this._osc('sawtooth', 190, 65, 0.28, 0.4); }
  click() { this._osc('sine', 680, 430, 0.06, 0.18); }
  overheat() { this._osc('sawtooth', 120, 90, 0.5, 0.25); }
  brickHit() { this._osc('square', 150, 90, 0.08, 0.3); this._noise(0.08, 900, 0.25); }
  brickBreak() { this._noise(0.3, 700, 0.5); this._osc('sine', 90, 45, 0.25, 0.5); }
  steelHit() { this._osc('square', 2400, 1900, 0.07, 0.2); this._osc('sine', 5200, 4800, 0.04, 0.12); }
  baseHit() { this._osc('sine', 120, 50, 0.5, 0.6); this._noise(0.35, 500, 0.4); }
  levelClear() {
    [392, 523, 659, 784].forEach((f, i) => this._osc('square', f, f, 0.16, 0.22, i * 0.11));
  }
  setBPM(b) { this.bpm = b; }
  waveStart() {
    this._osc('square', 233, 233, 0.14, 0.24);
    this._osc('square', 349, 349, 0.16, 0.24, 0.16);
    this._osc('square', 466, 466, 0.22, 0.24, 0.32);
  }
  victory() {
    [262, 330, 392, 523].forEach((f, i) => this._osc('square', f, f, 0.22, 0.22, i * 0.15));
  }

  // ---------- 配乐（16 步合成器循环，A-F-C-G 进行） ----------
  startMusic() {
    if (!this.ctx || this.musicTimer) return;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.08;
    this.musicTimer = setInterval(() => this._schedule(), 40);
  }
  stopMusic() {
    if (this.musicTimer) { clearInterval(this.musicTimer); this.musicTimer = null; }
  }
  _schedule() {
    const stepDur = 60 / (this.bpm || 132) / 4; // 十六分，bpm 随关卡变化
    while (this.nextTime < this.ctx.currentTime + 0.18) {
      this._playStep(this.step % 64, this.nextTime, stepDur);
      this.step++;
      this.nextTime += stepDur;
    }
  }
  _noteAt(type, f, t, dur, gain) {
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.value = f;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.musicGain);
    o.start(t); o.stop(t + dur + 0.05);
  }
  _noiseAt(t, dur, f0, f1, gain, q = 1) {
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(f1, 40), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.musicGain);
    src.start(t); src.stop(t + dur + 0.02);
  }
  _playStep(s, t, stepDur) {
    const bar = Math.floor(s / 16) % 4;
    const inBar = s % 16;
    const roots = [110.0, 87.31, 130.81, 98.0]; // A2 F2 C3 G2
    const root = roots[bar];
    // 鼓：底鼓 0/8，军鼓 4/12，踩镲每 8 步
    if (inBar === 0 || inBar === 8) {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(130, t);
      o.frequency.exponentialRampToValueAtTime(38, t + 0.12);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.5, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      o.connect(g); g.connect(this.musicGain);
      o.start(t); o.stop(t + 0.16);
    }
    if (inBar === 4 || inBar === 12) this._noiseAt(t, 0.09, 2200, 800, 0.16, 0.8);
    if (inBar % 8 === 0) this._noiseAt(t, 0.03, 7000, 5000, 0.06, 1);
    // 贝斯
    if (inBar % 4 === 0 || inBar === 14) {
      this._noteAt('sawtooth', root, t, stepDur * 2.4, 0.34);
    }
    // 副旋律（后两小节进入）
    const arp = [root * 2, root * 3, root * 4, root * 3];
    if (bar >= 1 && inBar % 4 === 2) {
      this._noteAt('square', arp[Math.floor(inBar / 4) % 4], t, stepDur * 1.6, 0.11);
    }
    // 长音和弦垫
    if (inBar === 0) {
      this._noteAt('sawtooth', root * 1.5, t, stepDur * 15, 0.05);
    }
  }
}
