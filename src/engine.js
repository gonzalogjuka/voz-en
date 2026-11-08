import { KokoroTTS } from 'kokoro-js';
import { env, pipeline } from '@huggingface/transformers';

env.allowLocalModels = false;
env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('ort/');

const $ = (id) => document.getElementById(id);
const MEETING_URLS = [
  'https://meet.google.com/*', 'https://*.zoom.us/*', 'https://teams.microsoft.com/*',
  'https://teams.live.com/*', 'https://*.whereby.com/*',
];
const RATE = 24000;
import { cfg, ev, rec, ack, initDebug } from './debug.js';

const state = { running: false, tts: null, translate: null, rec: null, beat: 0, monitorCtx: null, monitorNext: 0 };
const st = { model: 'sin cargar', translator: 'sin cargar', mic: '', meeting: '' };

function renderStatus() {
  const cls = (v) => (v.startsWith('listo') || v.startsWith('enganchado') || v.startsWith('escuchando') ? 'ok' : v.startsWith('sin') || v.startsWith('error') ? 'warn' : '');
  $('status').innerHTML =
    `Voz inglesa: <b class="${cls(st.model)}">${st.model}</b><br>` +
    `Traductor: <b class="${cls(st.translator)}">${st.translator}</b><br>` +
    (st.mic ? `Micrófono: <b class="${cls(st.mic)}">${st.mic}</b><br>` : '') +
    `Reunión: <b class="${cls(st.meeting)}">${st.meeting || 'buscando…'}</b>`;
}

// ---------- loading ----------
async function loadTranslator() {
  if ('Translator' in self) {
    try {
      const opts = { sourceLanguage: 'es', targetLanguage: 'en' };
      if ((await Translator.availability(opts)) !== 'unavailable') {
        const t = await Translator.create({
          ...opts,
          monitor(m) {
            m.addEventListener('downloadprogress', (e) => {
              st.translator = `descargando ${Math.round(e.loaded * 100)}%`;
              renderStatus();
            });
          },
        });
        return { name: 'integrado del navegador', fn: (s) => t.translate(s) };
      }
    } catch (e) {
      console.warn('Translator API failed, falling back', e);
    }
  }
  const p = await pipeline('translation', 'Xenova/opus-mt-es-en', {
    dtype: 'q8',
    device: 'wasm',
    progress_callback: (p) => {
      if (p.status === 'progress') {
        st.translator = `descargando ${Math.round(p.progress)}%`;
        renderStatus();
      }
    },
  });
  return { name: 'modelo local', fn: async (s) => (await p(s, { max_new_tokens: 256 }))[0].translation_text };
}

async function loadTTS() {
  const hasGPU = !!navigator.gpu && !!(await navigator.gpu.requestAdapter().catch(() => null));
  const cfg = hasGPU ? { device: 'webgpu', dtype: 'fp32' } : { device: 'wasm', dtype: 'q8' };
  const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
    ...cfg,
    progress_callback: (p) => {
      if (p.status === 'progress') {
        st.model = `descargando ${Math.round(p.progress)}%`;
        renderStatus();
      }
    },
  });
  await tts.generate('Ready.', { voice: $('voice').value }); // warm-up
  return { tts, backend: cfg.device };
}

async function loadAll() {
  st.translator = 'cargando…';
  st.model = 'cargando…';
  renderStatus();
  // Translator first: its model download may need the click's user activation.
  const tr = await loadTranslator();
  state.translate = tr.fn;
  st.translator = `listo (${tr.name})`;
  renderStatus();
  const { tts, backend } = await loadTTS();
  state.tts = tts;
  st.model = `listo (${backend === 'webgpu' ? 'GPU' : 'CPU'})`;
  renderStatus();
}

// ---------- output ----------
function toBase64(i16) {
  const bytes = new Uint8Array(i16.buffer, i16.byteOffset, i16.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

let meetingTabs = [];
async function refreshTabs() {
  meetingTabs = (await chrome.tabs.query({ url: MEETING_URLS })).map((t) => t.id);
  const hooked = await chrome.runtime.sendMessage({ type: 'status' });
  const n = new Set((hooked || []).map((k) => k.split(':')[0])).size;
  st.meeting = n ? `enganchado en ${n} pestaña${n > 1 ? 's' : ''}` : meetingTabs.length
    ? 'pestaña abierta pero sin micrófono: recargala y entrá a la reunión con el micrófono activo'
    : 'sin pestaña de reunión: abrí Meet/Zoom/Teams';
  renderStatus();
}

function sendAudio(f32, id) {
  const i16 = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) i16[i] = Math.max(-1, Math.min(1, f32[i])) * 32767;
  const msg = { type: 'audio', id, b64: toBase64(i16), rate: RATE };
  for (const id of meetingTabs) chrome.tabs.sendMessage(id, msg).catch(() => {});
  if ($('monitor').checked) {
    const c = (state.monitorCtx ||= new AudioContext());
    const b = c.createBuffer(1, f32.length, RATE);
    b.copyToChannel(f32, 0);
    const s = c.createBufferSource();
    s.buffer = b;
    s.connect(c.destination);
    const at = Math.max(c.currentTime + 0.02, state.monitorNext);
    s.start(at);
    state.monitorNext = at + b.duration;
  }
}

// ---------- pipeline: es text -> en text -> en audio ----------
const trQueue = [];
const ttsQueue = [];
let trBusy = false;
let ttsBusy = false;
let seq = 0;

function enqueue(es, { tLast, reason }) {
  es = es.trim();
  if (!es) return;
  const id = ++seq;
  rec(id, { es, tLast, tCommit: performance.now(), reason, trDepth: trQueue.length, ttsDepth: ttsQueue.length });
  ev('corte', `#${id} (${reason}) ${es}`);
  trQueue.push({ id, es });
  pumpTranslate();
}

async function pumpTranslate() {
  if (trBusy) return;
  trBusy = true;
  try {
    while (trQueue.length && state.running) {
      const { id, es } = trQueue.shift();
      rec(id, { tTr0: performance.now() });
      const en = (await state.translate(es)).trim();
      rec(id, { tTr1: performance.now(), en });
      if (!en) continue;
      addLog(es, en);
      ttsQueue.push({ id, en });
      pumpTTS();
    }
  } finally {
    trBusy = false;
  }
}

async function pumpTTS() {
  if (ttsBusy) return;
  ttsBusy = true;
  try {
    while (ttsQueue.length && state.running) {
      // Fell behind: speak the backlog as one utterance instead of queueing latency.
      const items = ttsQueue.length > 2 ? ttsQueue.splice(0) : [ttsQueue.shift()];
      const ids = items.map((x) => x.id);
      const text = items.map((x) => x.en).join(' ');
      if (ids.length > 1) ev('fusion', `#${ids.join(',#')}`);
      const tTts0 = performance.now();
      for (const id of ids) rec(id, { tTts0, group: ids });
      const audio = await state.tts.generate(text, { voice: $('voice').value, speed: +$('speed').value });
      const tTts1 = performance.now();
      sendAudio(audio.audio, ids[0]);
      const tSent = performance.now();
      for (const id of ids) rec(id, { tTts1, tSent, dur: audio.audio.length / RATE });
    }
  } finally {
    ttsBusy = false;
  }
}

function addLog(es, en) {
  const d = document.createElement('div');
  d.innerHTML = '<div class="es"></div><div class="en"></div>';
  d.firstChild.textContent = es;
  d.lastChild.textContent = en;
  $('log').append(d);
  $('log').scrollTop = $('log').scrollHeight;
}

// ---------- speech recognition ----------
function startRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    st.mic = 'error: este navegador no tiene reconocimiento de voz (usá Chrome o Edge)';
    renderStatus();
    return false;
  }
  const rec = new SR();
  rec.lang = 'es-AR';
  rec.continuous = true;
  rec.interimResults = true;
  const committed = {};
  const lastT = {}; // result index -> time the recognizer last extended its text
  let timer = null;

  const commitRemainder = (i, text, reason) => {
    const rest = text.slice(committed[i] || 0);
    if (rest.trim()) enqueue(rest, { tLast: lastT[i] ?? performance.now(), reason });
    committed[i] = reason === 'final' ? Infinity : text.length;
  };

  rec.onresult = (e) => {
    clearTimeout(timer);
    let live = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      const text = r[0].transcript;
      if (committed[i] === Infinity) continue;
      ev(r.isFinal ? 'final' : 'interim', text.slice(committed[i] || 0));
      if (r.isFinal) {
        commitRemainder(i, text, 'final');
        continue;
      }
      const rest = text.slice(committed[i] || 0);
      live = rest;
      const words = rest.trim() ? rest.trim().split(/\s+/).length : 0;
      if (words) lastT[i] = performance.now();
      if (words >= cfg.maxWords) {
        commitRemainder(i, text, 'palabras');
      } else if (words >= cfg.minWords) {
        timer = setTimeout(() => commitRemainder(i, text, 'pausa'), cfg.pause);
      }
    }
    $('live').textContent = live || '…';
  };
  rec.onerror = (e) => {
    ev('rec-err', e.error);
    if (e.error === 'no-speech' || e.error === 'aborted') return;
    st.mic = e.error === 'not-allowed' ? 'error: permiso de micrófono denegado' : `error: ${e.error}`;
    renderStatus();
  };
  rec.onend = () => {
    clearTimeout(timer);
    ev('rec-end', state.running ? 'reiniciando' : '');
    if (state.running) {
      try { rec.start(); } catch {}
    }
  };
  rec.onstart = () => {
    st.mic = 'escuchando (es-AR)';
    ev('rec-start');
    renderStatus();
  };
  rec.start();
  state.rec = rec;
  return true;
}

// ---------- control ----------
const beat = () => chrome.storage.local.set({ translate: state.running, beat: Date.now() });
setInterval(() => state.running && beat(), 2000);
setInterval(refreshTabs, 2000);
window.addEventListener('beforeunload', () => chrome.storage.local.set({ translate: false }));

$('toggle').onclick = async () => {
  const btn = $('toggle');
  if (state.running) {
    state.running = false;
    ev('stop');
    state.rec?.stop();
    trQueue.length = ttsQueue.length = 0;
    await chrome.storage.local.set({ translate: false });
    btn.textContent = 'Empezar';
    btn.classList.remove('stop');
    st.mic = '';
    renderStatus();
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Cargando…';
  try {
    if (!state.tts) await loadAll();
  } catch (e) {
    console.error(e);
    st.model = `error: ${e.message || e}`;
    renderStatus();
    btn.disabled = false;
    btn.textContent = 'Empezar';
    return;
  }
  state.running = true;
  ev('start');
  if (!startRecognition()) {
    state.running = false;
    btn.disabled = false;
    btn.textContent = 'Empezar';
    return;
  }
  await beat();
  btn.disabled = false;
  btn.textContent = 'Detener';
  btn.classList.add('stop');
};

chrome.storage.local.set({ translate: false });
chrome.runtime.onMessage.addListener((m) => {
  if (m.type === 'ack-played') {
    ack(m.id, { lag: m.lag, acked: true });
    ev('suena', `#${m.id} entra a la cola de la reunión con ${m.lag} ms de espera, ${m.dur.toFixed(1)} s de audio`);
  } else if (m.type === 'ack-dropped') {
    ack(m.id, { dropped: true });
    ev('DESCART', `#${m.id}: la reunión recibió audio con el modo apagado`);
  }
});
initDebug(() => ({ voiceModel: st.model, translator: st.translator, meeting: st.meeting, voice: $('voice').value, speed: +$('speed').value }));
renderStatus();
refreshTabs();
