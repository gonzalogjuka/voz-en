// Isolated-world relay: extension <-> page (inject.js).
const TAG = '__vozen';
const BEAT_MAX_AGE = 6000;
const post = (msg, transfer) => window.postMessage({ [TAG]: true, ...msg }, '*', transfer || []);

let lastMode = null;
const pushMode = async () => {
  const { translate, beat } = await chrome.storage.local.get(['translate', 'beat']);
  const on = !!translate && Date.now() - (beat || 0) < BEAT_MAX_AGE;
  if (on !== lastMode) {
    lastMode = on;
    post({ type: 'mode', translate: on });
  }
};

window.addEventListener('message', (ev) => {
  const m = ev.data;
  if (ev.source !== window || !m || !m[TAG]) return;
  if (m.type === 'active') chrome.runtime.sendMessage({ type: 'mic-active', active: m.active }).catch(() => {});
  if (m.type === 'ready') {
    lastMode = null;
    pushMode();
  }
});

setInterval(pushMode, 1000);
chrome.storage.onChanged.addListener(pushMode);
pushMode();

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== 'audio') return;
  const bin = atob(msg.b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const i16 = new Int16Array(bytes.buffer);
  const pcm = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) pcm[i] = i16[i] / 32768;
  post({ type: 'audio', pcm, rate: msg.rate }, [pcm.buffer]);
});
