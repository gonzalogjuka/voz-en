// Live diagnostics: per-phrase timings, recognizer event log, tunable parameters, report export.
const $ = (id) => document.getElementById(id);

export const cfg = { pause: 450, maxWords: 14, minWords: 2 };
const CFG_INPUTS = { pause: 'cfg-pause', maxWords: 'cfg-maxwords', minWords: 'cfg-minwords' };

export const recs = new Map();
export const events = [];
const now = () => Math.round(performance.now());

let pending = false;
function schedule() {
  if (pending) return;
  pending = true;
  setTimeout(() => {
    pending = false;
    render();
  }, 100);
}

export function ev(kind, text = '') {
  events.push({ t: now(), kind, text });
  if (events.length > 300) events.shift();
  schedule();
}

export function rec(id, patch) {
  const r = recs.get(id) || { id };
  Object.assign(r, patch);
  recs.set(id, r);
  if (recs.size > 400) recs.delete(recs.keys().next().value);
  schedule();
  return r;
}

export function ack(chunkId, patch) {
  const first = recs.get(chunkId);
  for (const id of first?.group || [chunkId]) rec(id, patch);
}

const diff = (a, b) => (a != null && b != null ? Math.round(b - a) : null);
const fmt = (v) => (v == null ? '·' : String(v));
const median = (xs) => {
  xs = xs.filter((x) => x != null).sort((a, b) => a - b);
  return xs.length ? xs[Math.floor(xs.length / 2)] : null;
};

// "after" = from the last word the recognizer heard to the audio leaving for the meeting;
// "heard" adds the meeting-side playback queue, i.e. what the other person actually experiences.
function rows() {
  return [...recs.values()].map((r) => {
    const after = diff(r.tLast, r.tSent);
    return {
      ...r,
      pausa: diff(r.tLast, r.tCommit),
      tr: diff(r.tTr0, r.tTr1),
      qwait: diff(r.tTr1, r.tTts0),
      tts: diff(r.tTts0, r.tTts1),
      after,
      heard: after != null && r.lag != null ? after + r.lag : null,
    };
  });
}

function summary(rs) {
  const last = rs.slice(-30);
  const rtf = last.filter((r) => r.tts != null && r.dur).map((r) => r.tts / 1000 / r.dur);
  return {
    phrases: rs.length,
    medianPauseMs: median(last.map((r) => r.pausa)),
    medianTranslateMs: median(last.map((r) => r.tr)),
    medianTtsMs: median(last.map((r) => r.tts)),
    medianAfterSpeakingMs: median(last.map((r) => r.after)),
    medianHeardMs: median(last.map((r) => r.heard)),
    maxHeardMs: Math.max(0, ...last.map((r) => r.heard ?? 0)) || null,
    ttsRealtimeFactor: rtf.length ? +median(rtf).toFixed(2) : null,
    mergedPhrases: last.filter((r) => r.group?.length > 1).length,
    droppedByMeeting: last.filter((r) => r.dropped).length,
    noAck: last.filter((r) => r.tSent != null && !r.acked && !r.dropped && now() - r.tSent > 3000).length,
  };
}

const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

function render() {
  const rs = rows();
  const s = summary(rs);
  $('dbg-summary').textContent =
    `frases ${s.phrases} · pausa ${fmt(s.medianPauseMs)} · traducir ${fmt(s.medianTranslateMs)} · ` +
    `voz ${fmt(s.medianTtsMs)} (x${fmt(s.ttsRealtimeFactor)} tiempo real) · ` +
    `desde tu última palabra hasta enviar ${fmt(s.medianAfterSpeakingMs)} ms · hasta que suena ${fmt(s.medianHeardMs)} ms (peor ${fmt(s.maxHeardMs)})` +
    (s.mergedPhrases ? ` · fusionadas ${s.mergedPhrases}` : '') +
    (s.droppedByMeeting ? ` · DESCARTADAS por la reunión ${s.droppedByMeeting}` : '') +
    (s.noAck ? ` · SIN CONFIRMAR ${s.noAck}` : '');

  const head = ['ES → EN', 'pausa', 'trad', 'cola', 'voz', 'enviado', 'cola reunión', 'suena'];
  const body = rs.slice(-12).reverse().map((r) =>
    `<tr><td class="t">${esc(r.es)}<br><span>${esc(r.en || '…')}</span></td>` +
    [r.pausa, r.tr, r.qwait, r.tts, r.after, r.lag, r.heard].map((v) => `<td>${fmt(v)}</td>`).join('') + '</tr>');
  $('dbg-table').innerHTML = `<table><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>${body.join('')}</table>`;

  const t0 = events.length ? events[0].t : 0;
  $('dbg-events').textContent = events.slice(-40).map((e) => `${String(e.t - t0).padStart(7)} ${e.kind.padEnd(8)} ${e.text}`).join('\n');
  $('dbg-events').scrollTop = $('dbg-events').scrollHeight;
}

export function report(extra = {}) {
  const rs = rows();
  return JSON.stringify({ at: new Date().toISOString(), ua: navigator.userAgent, cfg, ...extra, summary: summary(rs), phrases: rs, events }, null, 1);
}

export async function initDebug(extraInfo) {
  Object.assign(cfg, (await chrome.storage.local.get('cfg')).cfg || {});
  for (const [k, id] of Object.entries(CFG_INPUTS)) {
    const input = $(id);
    input.value = cfg[k];
    $(id + '-v').textContent = cfg[k];
    input.oninput = () => {
      cfg[k] = +input.value;
      $(id + '-v').textContent = input.value;
      chrome.storage.local.set({ cfg });
    };
  }
  $('dbg-copy').onclick = async () => {
    await navigator.clipboard.writeText(report(extraInfo()));
    $('dbg-copy').textContent = 'Copiado ✓';
    setTimeout(() => ($('dbg-copy').textContent = 'Copiar informe'), 1500);
  };
  $('dbg-clear').onclick = () => {
    recs.clear();
    events.length = 0;
    render();
  };
  render();
}
