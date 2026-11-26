/* ============ 拆迁小队 · WebAudio 音效合成 ============ */
window.Snd = (() => {
  let actx = null;
  let muted = false;

  function ensure() {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) actx = new AC();
    }
    if (actx && actx.state === 'suspended') actx.resume();
    return actx;
  }

  function tone(f0, f1, dur, vol = 0.15, type = 'square', delay = 0) {
    if (muted) return;
    const a = ensure();
    if (!a) return;
    const t = a.currentTime + delay;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(1, f0), t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(a.destination);
    o.start(t);
    o.stop(t + dur + 0.03);
  }

  function noise(dur, vol = 0.2, freq = 1000, delay = 0) {
    if (muted) return;
    const a = ensure();
    if (!a) return;
    const t = a.currentTime + delay;
    const n = Math.max(1, Math.floor(a.sampleRate * dur));
    const buf = a.createBuffer(1, n, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = a.createBufferSource();
    src.buffer = buf;
    const f = a.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = freq;
    const g = a.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(a.destination);
    src.start(t);
  }

  return {
    unlock() { ensure(); },
    click() { tone(600, 420, 0.06, 0.07, 'square'); },
    latch() { tone(180, 320, 0.08, 0.12, 'square'); tone(340, 560, 0.06, 0.08, 'square', 0.06); },
    pop() { tone(760, 1250, 0.09, 0.11, 'triangle'); },
    coin() { tone(988, 988, 0.06, 0.09, 'square'); tone(1319, 1319, 0.1, 0.09, 'square', 0.06); },
    rumble() { noise(0.5, 0.32, 320); tone(80, 38, 0.45, 0.18, 'sine'); },
    thud() { noise(0.12, 0.26, 500); tone(130, 55, 0.13, 0.18, 'sine'); },
    whoosh() { noise(0.16, 0.09, 2600); },
    explode() { noise(0.55, 0.45, 900); tone(160, 28, 0.5, 0.3, 'sawtooth'); },
    hit() { tone(320, 140, 0.12, 0.18, 'square'); },
    die() { tone(520, 110, 0.28, 0.14, 'sawtooth'); },
    win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.17, 0.11, 'triangle', i * 0.12)); },
    lose() { [392, 330, 262, 196].forEach((f, i) => tone(f, f, 0.2, 0.11, 'sine', i * 0.16)); },
    toggle() { muted = !muted; return muted; },
    isMuted() { return muted; },
  };
})();
