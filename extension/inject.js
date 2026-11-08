// Runs in the page's MAIN world. Replaces the microphone that the meeting app
// receives with a Web Audio graph: real mic (bypass) or synthesized English voice.
(() => {
  if (window.__vozEnInstalled) return;
  window.__vozEnInstalled = true;
  const TAG = '__vozen';
  const md = navigator.mediaDevices;
  if (!md || !md.getUserMedia) return;
  const origGUM = md.getUserMedia.bind(md);
  const graphs = new Set();
  let translate = false;

  const post = (msg) => window.postMessage({ [TAG]: true, ...msg }, '*');
  const applyMode = () => {
    for (const g of graphs) {
      const t = g.ctx.currentTime;
      g.real.gain.setTargetAtTime(translate ? 0 : 1, t, 0.03);
    }
  };

  md.getUserMedia = async function (constraints) {
    const real = await origGUM(constraints);
    const realAudio = real.getAudioTracks()[0];
    if (!realAudio) return real;
    try {
      const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
      const src = ctx.createMediaStreamSource(new MediaStream([realAudio]));
      const realGain = ctx.createGain();
      const voiceGain = ctx.createGain();
      const dest = ctx.createMediaStreamDestination();
      src.connect(realGain).connect(dest);
      voiceGain.connect(dest);
      realGain.gain.value = translate ? 0 : 1;
      const g = { ctx, real: realGain, voice: voiceGain, next: 0 };
      graphs.add(g);
      ctx.resume().catch(() => {});

      const out = dest.stream.getAudioTracks()[0];
      const stop = out.stop.bind(out);
      out.stop = () => {
        stop();
        realAudio.stop();
        graphs.delete(g);
        ctx.close().catch(() => {});
        post({ type: 'active', active: graphs.size > 0 });
      };
      out.getSettings = () => ({ ...realAudio.getSettings() });
      Object.defineProperty(out, 'label', { get: () => realAudio.label });
      realAudio.addEventListener('ended', () => out.stop());

      post({ type: 'active', active: true });
      return new MediaStream([...real.getVideoTracks(), out]);
    } catch (e) {
      console.warn('[Voz EN] could not wrap microphone, using the real one', e);
      return real;
    }
  };

  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (ev.source !== window || !m || !m[TAG]) return;
    if (m.type === 'mode') {
      translate = !!m.translate;
      applyMode();
    } else if (m.type === 'audio') {
      if (!translate) return post({ type: 'dropped', id: m.id });
      const pcm = m.pcm;
      let lag = 0;
      for (const g of graphs) {
        if (g.ctx.state === 'suspended') g.ctx.resume().catch(() => {});
        const buf = g.ctx.createBuffer(1, pcm.length, m.rate);
        buf.copyToChannel(pcm, 0);
        const s = g.ctx.createBufferSource();
        s.buffer = buf;
        s.connect(g.voice);
        const at = Math.max(g.ctx.currentTime + 0.02, g.next);
        s.start(at);
        g.next = at + buf.duration;
        lag = Math.max(lag, at - g.ctx.currentTime);
      }
      post({ type: 'played', id: m.id, lag: Math.round(lag * 1000), dur: pcm.length / m.rate, graphs: graphs.size });
    }
  });
  post({ type: 'ready' });
})();
