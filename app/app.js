'use strict';
/* Chely · app del piloto.
   Paciente: ve los estudios que su médico publicó, explicados en palabras simples.
   Médico: invita pacientes, sube estudios, genera el borrador con IA, lo revisa y lo publica.
   La seguridad real está en la base (RLS): esta app solo muestra lo que la base permite. */

const CFG = window.CHELY_CONFIG || {};
const CONSENT = {
  patient: { version: 'paciente-v2', title: 'Consentimiento para pacientes' },
  doctor: { version: 'medico-v1', title: 'Condiciones para profesionales' },
  admin: { version: 'equipo-v1', title: 'Compromiso del equipo de Chely' },
};
const CONTACT = 'info@chely.app';
const MAX_UPLOAD = 20 * 1024 * 1024;
const UPLOAD_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

/* ---------------- utilidades ---------------- */
const $ = (sel, el = document) => el.querySelector(sel);
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const fmtDate = iso => { if (!iso) return ''; const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${y}`; };
const fmtDateTime = iso => { if (!iso) return ''; const d = new Date(iso); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
function parseDMY(s) {
  const m = String(s).trim().match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (!m) return null;
  const [d, mo, y] = [+m[1], +m[2], +m[3]];
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}
function ageFrom(iso) {
  if (!iso) return null;
  const b = new Date(iso + 'T00:00:00'), n = new Date();
  let a = n.getFullYear() - b.getFullYear();
  if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--;
  return a;
}
const fmtNum = n => String(n).replace('.', ',');
const normalize = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const safeFileName = name => name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_').slice(-80) || 'archivo';

/* ---------------- preferencias de lectura ---------------- */
const prefs = { size: 2, theme: null };
try { Object.assign(prefs, JSON.parse(localStorage.getItem('chely-prefs') || '{}')); } catch { /* sin almacenamiento */ }
function applyPrefs() {
  const r = document.documentElement;
  r.dataset.size = prefs.size;
  const dark = prefs.theme ? prefs.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  r.dataset.theme = dark ? 'dark' : 'light';
  try { localStorage.setItem('chely-prefs', JSON.stringify(prefs)); } catch { /* sin almacenamiento */ }
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyPrefs);
applyPrefs();

/* ---------------- avisos ---------------- */
let toastTimer;
function toast(msg) {
  const host = $('#toast'); host.innerHTML = '';
  host.append(h('div', { class: 'toast', role: 'status' }, msg));
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { host.innerHTML = ''; }, 5000);
}
function confirmBox({ title, text, ok, danger, typed }) {
  return new Promise(resolve => {
    const host = $('#overlay');
    const close = v => { host.innerHTML = ''; resolve(v); };
    const input = typed ? h('input', { type: 'text', id: 'confirm-typed', autocomplete: 'off', placeholder: typed }) : null;
    const okBtn = h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), disabled: !!typed, onclick: () => close(true) }, ok);
    if (input) input.addEventListener('input', () => { okBtn.disabled = input.value.trim().toUpperCase() !== typed; });
    host.append(h('div', { class: 'overlay', onclick: e => { if (e.target.classList.contains('overlay')) close(false); } },
      h('div', { class: 'card', role: 'dialog', 'aria-modal': 'true' }, h('h2', {}, title), h('p', {}, text),
        input ? h('label', { class: 'field', for: 'confirm-typed' }, `Escribí ${typed} para confirmar`, input) : null,
        h('div', { class: 'row' }, h('button', { class: 'btn quiet', onclick: () => close(false) }, 'Cancelar'), okBtn))));
    (input || okBtn).focus();
  });
}
function errorText(error) {
  if (!error) return 'Ocurrió un error.';
  const m = error.message || String(error);
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'No hay conexión. Revisá internet y probá de nuevo.';
  if (/Invalid login credentials/i.test(m)) return 'El correo o la contraseña no coinciden.';
  if (/Email not confirmed/i.test(m)) return 'Todavía no confirmaste tu correo. Buscá el mensaje de Chely en tu bandeja de entrada (y en spam).';
  if (/User already registered/i.test(m)) return 'Ya existe una cuenta con ese correo. Entrá con tu contraseña.';
  // Hecho por Claude · 2026-11-02 · el error de correo mal escrito llegaba en inglés.
  if (/validate email address|invalid format/i.test(m)) return 'El correo no está bien escrito. Revisá que no tenga espacios ni un punto al final.';
  if (/Password should be at least/i.test(m)) return 'La contraseña tiene que tener al menos 8 caracteres.';
  if (/rate limit|too many/i.test(m)) return 'Hubo demasiados intentos. Esperá unos minutos.';
  if (/JWT|session/i.test(m)) return 'Tu sesión venció. Volvé a entrar.';
  return m;
}
async function fnError(error) {
  // Mensaje que devuelve una función (ia / borrar-cuenta) en su cuerpo JSON.
  try { const body = await error.context.json(); if (body && body.error) return body.error; } catch { /* sin cuerpo */ }
  return errorText(error);
}

/* ---------------- selector de fecha (dd/mm/aaaa con calendario) ---------------- */
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
function datePicker({ id, value, onChange, minYear = 1910 }) {
  // Hecho por ChatGPT · 2026-11-02 · Ícono integrado a todos los campos de fecha.
  const wrap = h('div', { class: 'date-picker' });
  const input = h('input', { type: 'text', id, inputmode: 'numeric', placeholder: 'dd/mm/aaaa', autocomplete: 'off', value: value ? fmtDate(value) : '' });
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-width', '1.8');
  icon.setAttribute('stroke-linecap', 'round');
  icon.setAttribute('stroke-linejoin', 'round');
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = '<rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M16 3v4M8 3v4M3 10h18"></path>';
  const btn = h('button', { type: 'button', class: 'date-picker-toggle', 'aria-label': 'Abrir calendario', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' }, icon);
  let pop = null;
  const set = iso => { input.value = iso ? fmtDate(iso) : ''; onChange(iso); };
  input.addEventListener('input', () => {
    let v = input.value.replace(/[^\d]/g, '').slice(0, 8);
    if (v.length > 4) v = v.slice(0, 2) + '/' + v.slice(2, 4) + '/' + v.slice(4); else if (v.length > 2) v = v.slice(0, 2) + '/' + v.slice(2);
    input.value = v; onChange(parseDMY(v));
  });
  const close = () => {
    if (!pop) return;
    pop.remove(); pop = null;
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', onEscape, true);
  };
  const outside = e => { if (pop && !wrap.contains(e.target)) close(); };
  const onEscape = e => { if (e.key === 'Escape' && pop) { e.preventDefault(); close(); btn.focus(); } };
  btn.addEventListener('click', () => {
    if (pop) return close();
    btn.setAttribute('aria-expanded', 'true');
    const cur = parseDMY(input.value) || todayISO();
    let y = +cur.slice(0, 4), m = +cur.slice(5, 7) - 1;
    pop = h('div', { class: 'card date-picker-popup', role: 'dialog', 'aria-label': 'Calendario' });
    const draw = () => {
      pop.innerHTML = '';
      const ySel = h('select', { 'aria-label': 'Año', style: 'min-height:2.5rem;padding:.2rem' });
      for (let yy = new Date().getFullYear(); yy >= minYear; yy--) ySel.append(h('option', { value: yy, selected: yy === y }, yy));
      const mSel = h('select', { 'aria-label': 'Mes', style: 'min-height:2.5rem;padding:.2rem' });
      MESES.forEach((n, i) => mSel.append(h('option', { value: i, selected: i === m }, n)));
      ySel.onchange = () => { y = +ySel.value; draw(); };
      mSel.onchange = () => { m = +mSel.value; draw(); };
      pop.append(h('div', { class: 'row', style: 'flex-wrap:nowrap;gap:.3rem' },
        h('button', { type: 'button', class: 'btn quiet sm', 'aria-label': 'Mes anterior', onclick: () => { m--; if (m < 0) { m = 11; y--; } draw(); } }, '‹'),
        mSel, ySel,
        h('button', { type: 'button', class: 'btn quiet sm', 'aria-label': 'Mes siguiente', onclick: () => { m++; if (m > 11) { m = 0; y++; } draw(); } }, '›')));
      const g = h('div', { style: 'display:grid;grid-template-columns:repeat(7,1fr);gap:.15rem;text-align:center' });
      ['L', 'M', 'M', 'J', 'V', 'S', 'D'].forEach(d => g.append(h('span', { class: 'small muted' }, d)));
      const first = (new Date(y, m, 1).getDay() + 6) % 7, days = new Date(y, m + 1, 0).getDate();
      for (let i = 0; i < first; i++) g.append(h('span'));
      const sel = parseDMY(input.value);
      for (let d = 1; d <= days; d++) {
        const iso = `${y}-${pad(m + 1)}-${pad(d)}`;
        g.append(h('button', { type: 'button', 'aria-label': `${d} de ${MESES[m]} de ${y}`,
          style: `aspect-ratio:1;border:0;border-radius:.5rem;cursor:pointer;font-weight:700;background:${iso === sel ? 'var(--accent)' : 'transparent'};color:${iso === sel ? 'var(--accent-ink)' : 'inherit'}`,
          onclick: () => { set(iso); close(); input.focus(); } }, d));
      }
      pop.append(g, h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn quiet sm', onclick: () => { set(todayISO()); close(); } }, 'Hoy'), h('button', { type: 'button', class: 'btn quiet sm', onclick: close }, 'Cerrar')));
    };
    draw(); wrap.append(pop);
    setTimeout(() => { if (pop) { document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', onEscape, true); } });
  });
  wrap.append(input, btn);
  return wrap;
}

/* ---------------- explicación: texto, glosario, valores, evolución ---------------- */
function renderExplanation(text, glossary = []) {
  const out = h('div', { class: 'explanation' });
  const terms = (glossary || []).filter(g => g && g.termino && g.definicion);
  const seen = new Set();
  const re = terms.length ? new RegExp('(^|[^\\p{L}])(' + terms.map(t => t.termino.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((a, b) => b.length - a.length).join('|') + ')(?![\\p{L}])', 'giu') : null;
  const inline = s => {
    let html = esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    if (re) html = html.replace(re, (m, pre, word) => {
      const k = normalize(word); if (seen.has(k)) return m; seen.add(k);
      return `${pre}<button type="button" class="term" data-term="${esc(k)}">${word}</button>`;
    });
    return html;
  };
  let ul = null;
  for (const raw of String(text || '').split('\n')) {
    const l = raw.trim();
    if (!l) { ul = null; continue; }
    if (/^#{1,4}\s/.test(l)) { ul = null; const t = l.replace(/^#+\s*/, ''); out.append(h('h3', { class: /aviso importante/i.test(t) ? 'urgent' : null, html: esc(t) })); continue; }
    if (/^[-*•]\s+/.test(l) || /^\d+[.)]\s+/.test(l)) { if (!ul) { ul = h('ul'); out.append(ul); } ul.append(h('li', { html: inline(l.replace(/^([-*•]|\d+[.)])\s+/, '')) })); continue; }
    ul = null; out.append(h('p', { html: inline(l) }));
  }
  out.addEventListener('click', e => {
    const b = e.target.closest('.term'); if (!b) return;
    const g = terms.find(t => normalize(t.termino) === b.dataset.term);
    if (g) showTerm(g.termino, g.definicion);
  });
  return out;
}
function showTerm(term, def) {
  const host = $('#toast'); host.innerHTML = '';
  const close = h('button', { class: 'btn quiet sm', onclick: () => { host.innerHTML = ''; } }, 'Cerrar');
  host.append(h('div', { class: 'sheet', role: 'dialog', 'aria-label': 'Significado' }, h('div', { class: 'row' }, h('h3', { class: 'grow' }, term), close), h('p', {}, def)));
  close.focus();
}
function valueStatus(v) {
  if (typeof v.valor !== 'number') return null;
  if (typeof v.ref_min === 'number' && v.valor < v.ref_min) return 'Por debajo del rango';
  if (typeof v.ref_max === 'number' && v.valor > v.ref_max) return 'Por encima del rango';
  if (typeof v.ref_min === 'number' || typeof v.ref_max === 'number') return 'Dentro del rango';
  return null;
}
function renderValues(values) {
  const list = (values || []).filter(v => v && v.nombre);
  if (!list.length) return null;
  const rows = list.map(v => {
    const st = valueStatus(v);
    const num = typeof v.valor === 'number' ? v.valor : null;
    let track = null;
    if (num !== null && (typeof v.ref_min === 'number' || typeof v.ref_max === 'number')) {
      const top = Math.max(v.ref_max ?? num, num) * 1.35 || 1, pct = n => Math.min(100, Math.max(0, n / top * 100));
      const from = v.ref_min ?? 0, to = v.ref_max ?? top;
      track = h('span', { class: 'track', 'aria-hidden': 'true' }, h('span', { class: 'rband', style: `left:${pct(from)}%;width:${pct(to) - pct(from)}%` }), h('span', { class: 'dot', style: `left:${pct(num)}%` }));
    }
    return h('div', { class: 'val' }, h('strong', {}, v.nombre), h('span', { class: 'num' }, v.valor_texto || (num !== null ? fmtNum(num) : ''), ' ', h('small', { class: 'muted' }, v.unidad || '')),
      h('div', { class: 'rng' }, track, v.referencia_texto ? h('span', {}, 'Referencia: ' + v.referencia_texto) : null,
        st ? h('span', { class: 'pill ' + (st === 'Dentro del rango' ? 'ok' : 'warn') }, st) : null));
  });
  return h('div', { class: 'card' }, h('h2', {}, 'Tus valores'),
    h('p', { class: 'muted small' }, 'La franja verde es el rango de referencia del laboratorio. Estar fuera del rango no es un diagnóstico: lo interpreta tu médico.'),
    h('div', { class: 'vals' }, rows));
}
function chartSVG(points, unit, refMin, refMax) {
  const W = 340, H = 160, L = 34, R = 14, T = 16, B = 28;
  const vals = points.map(p => p.v);
  const lo = Math.min(...vals, refMin ?? Infinity, refMax ?? Infinity), hi = Math.max(...vals, refMax ?? -Infinity);
  const raw = ((hi - lo) * 1.4 || 20) / 4, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(x => x * mag).find(x => x >= raw);
  const y0 = Math.floor((lo - step * 0.5) / step) * step, y1 = Math.ceil((hi + step * 0.5) / step) * step;
  const sx = i => points.length === 1 ? (L + W - R) / 2 : L + 18 + i * (W - L - R - 36) / (points.length - 1);
  const sy = v => T + (y1 - v) * (H - T - B) / (y1 - y0);
  const ticks = []; for (let t = y0; t <= y1 + 1e-9; t += step) ticks.push(+t.toFixed(4));
  const band = (refMin != null || refMax != null) ? `<rect x="${L}" y="${sy(Math.min(refMax ?? y1, y1))}" width="${W - L - R}" height="${Math.max(0, sy(Math.max(refMin ?? y0, y0)) - sy(Math.min(refMax ?? y1, y1)))}" fill="var(--ok)" opacity=".15"/>` : '';
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolución en ${esc(unit)}: ${points.map(p => fmtDate(p.date) + ' ' + fmtNum(p.v)).join(', ')}">${band}
    ${ticks.map(t => `<line x1="${L}" x2="${W - R}" y1="${sy(t)}" y2="${sy(t)}" stroke="var(--line)"/><text x="${L - 5}" y="${sy(t) + 3}" font-size="9" text-anchor="end" fill="var(--muted)">${fmtNum(t)}</text>`).join('')}
    <polyline points="${points.map((p, i) => `${sx(i)},${sy(p.v)}`).join(' ')}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round"/>
    ${points.map((p, i) => { const last = i === points.length - 1; return `<circle cx="${sx(i)}" cy="${sy(p.v)}" r="${last ? 5 : 3.5}" fill="${last ? 'var(--accent)' : 'var(--surface)'}" stroke="var(--accent)" stroke-width="2"/>
      <text x="${sx(i)}" y="${sy(p.v) - 9}" font-size="10" font-weight="700" text-anchor="middle" fill="var(--fg)">${fmtNum(p.v)}</text>
      <text x="${sx(i)}" y="${H - 9}" font-size="9" text-anchor="middle" fill="var(--muted)">${fmtDate(p.date).slice(0, 5) + '/' + p.date.slice(2, 4)}</text>`; }).join('')}</svg>`;
}
function renderEvolution(studies) {
  // Valores con el mismo nombre en dos o más estudios publicados.
  const series = new Map();
  for (const s of [...studies].sort((a, b) => a.study_date.localeCompare(b.study_date))) {
    for (const v of s.lab_values || []) {
      if (typeof v.valor !== 'number' || !v.nombre) continue;
      const k = normalize(v.nombre);
      if (!series.has(k)) series.set(k, { name: v.nombre, unit: v.unidad || '', refMin: null, refMax: null, points: [] });
      const se = series.get(k);
      se.points.push({ date: s.study_date, v: v.valor });
      if (typeof v.ref_min === 'number') se.refMin = v.ref_min;
      if (typeof v.ref_max === 'number') se.refMax = v.ref_max;
    }
  }
  const usable = [...series.values()].filter(s => s.points.length >= 2);
  if (!usable.length) return null;
  const card = h('div', { class: 'card chart' }, h('h2', {}, 'Cómo vienen tus valores'));
  const chips = h('div', { class: 'chips' });
  const box = h('div');
  const note = h('p', { class: 'muted small' });
  const show = i => {
    const s = usable[i];
    chips.querySelectorAll('button').forEach((b, j) => b.setAttribute('aria-pressed', String(i === j)));
    box.innerHTML = chartSVG(s.points, s.unit, s.refMin, s.refMax);
    note.textContent = `${s.unit} · ${s.refMin != null || s.refMax != null ? 'Franja verde: rango de referencia. ' : ''}Si cambió algo, lo valora tu médico.`;
  };
  usable.forEach((s, i) => chips.append(h('button', { type: 'button', onclick: () => show(i) }, s.name)));
  card.append(chips, box, note);
  show(0);
  return card;
}

/* ---------------- estado y arranque ---------------- */
const state = { session: null, me: null, page: null, studyId: null, patientId: null, recovery: false, busy: false };
let sb = null;
// Hecho por ChatGPT · 2026-11-02 · Los borradores clínicos y archivos sólo se
// mantienen en RAM de esta pestaña, nunca en localStorage ni sessionStorage.
let uploadDraft = null;
const minorUploadDrafts = new Map();
const studyEditDrafts = new Map();
// Última pestaña de estudios elegida, sólo en memoria de la sesión.
let patientStudiesTab = null;
const runningStudyReads = new Map(); // Evita transcripciones duplicadas.
const runningStudyExplanations = new Map(); // Evita análisis duplicados.
const runningHistoryEvaluations = new Map(); // Evitar pedidos dobles de evaluación.
// Hecho por ChatGPT · 2026-11-02 · Indicador de actividad real y tiempo transcurrido.
// Claude devuelve la evaluación cuando termina, sin porcentaje ni avance parcial.
const historyEvaluationProgress = new Map();
let historyEvaluationTimer = null;
let updateHistoryEvaluationDisplay = null;
function tickHistoryEvaluation() {
  if (typeof updateHistoryEvaluationDisplay === 'function')
    updateHistoryEvaluationDisplay();
}
function startHistoryEvaluationTimer() {
  if (historyEvaluationTimer !== null) return;
  historyEvaluationTimer = setInterval(tickHistoryEvaluation, 1000);
}
function stopHistoryEvaluationTimerIfIdle() {
  if (historyEvaluationProgress.size || historyEvaluationTimer === null) return;
  clearInterval(historyEvaluationTimer);
  historyEvaluationTimer = null;
}
function formatHistoryElapsed(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
}
// Hecho por ChatGPT · 2026-11-02 · Lecturas en lote: nunca genera explicaciones.
// El estado se conserva sólo mientras esta pestaña está abierta.
let batchReadJob = null;
let updateBatchReadDisplay = null;
function refreshBatchReadDisplay() {
  if (typeof updateBatchReadDisplay === 'function') updateBatchReadDisplay();
}
function cancelBatchRead() {
  if (batchReadJob?.running) {
    batchReadJob.cancelRequested = true;
    refreshBatchReadDisplay();
  }
}
function pendingOnce(map, key, task) {
  let pending=map.get(key);
  if (!pending) {
    pending=task();
    map.set(key,pending);
    const cleanup=()=>{if(map.get(key)===pending)map.delete(key);};
    pending.then(cleanup,cleanup);
  }
  return pending;
}
let navigationEpoch = 0;
let restoredRouteUser = null;
function clearUploadDraft() { uploadDraft = null; }
function clearPrivateDrafts() {
  cancelBatchRead();
  uploadDraft = null; minorUploadDrafts.clear(); studyEditDrafts.clear(); patientStudiesTab = null;
}

// Hecho por ChatGPT · 2026-11-02 · Restaurar la sección actual con F5.
// history.state sólo contiene identificadores y sección, no datos clínicos.
const NAV_PAGES = new Set(['estudios','estudio','mi-estudio','subir','medicos','menores',
  'cuenta','pacientes','paciente','estudio-medico','panel','registro']);
const VALID_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const routeId = id => typeof id === 'string' && VALID_ID.test(id) ? id : null;
function saveRoute() {
  if (!state.me || !state.session?.user?.id || !NAV_PAGES.has(state.page)) return;
  const prior = history.state && typeof history.state === 'object' ? history.state : {};
  history.replaceState({ ...prior, chelyRoute: {
    userId: state.session.user.id, role: state.me.role, page: state.page,
    studyId: routeId(state.studyId), patientId: routeId(state.patientId),
    minorId: routeId(state.minorId), minorStudyId: routeId(state.minorStudyId)
  } }, '', location.href);
}
function clearRoute() {
  const prior = history.state && typeof history.state === 'object' ? history.state : {};
  const { chelyRoute: discarded, ...rest } = prior;
  history.replaceState(rest, '', location.href);
}
function restoreRoute() {
  const uid = state.session?.user?.id;
  if (!uid || restoredRouteUser === uid) return;
  restoredRouteUser = uid;
  const saved = history.state?.chelyRoute;
  if (!saved || saved.userId !== uid || saved.role !== state.me?.role
      || !NAV_PAGES.has(saved.page)) return;
  state.page = saved.page;
  state.studyId = routeId(saved.studyId);
  state.patientId = routeId(saved.patientId);
  state.minorId = routeId(saved.minorId);
  state.minorStudyId = routeId(saved.minorStudyId);
  state.autoExplain = false; // No repetir una petición de IA tras F5.
}


function shell(nav) {
  const top = $('#top'); top.innerHTML = '';
  // Hecho por ChatGPT · 2026-11-01 · El logo de la aplicación siempre vuelve a https://chely.app/.
  const brand = h('a', { class: 'brand', href: 'https://chely.app/', 'aria-label': 'Chely, ir a la página principal' },
    h('img', { src: 'icon-192.png', alt: '' }), h('b', {}, 'Chely'));
  const look = h('div', { class: 'look' },
    h('button', { 'aria-label': 'Letra más chica', onclick: () => { prefs.size = Math.max(1, prefs.size - 1); applyPrefs(); } }, 'A−'),
    h('button', { 'aria-label': 'Letra más grande', onclick: () => { prefs.size = Math.min(4, prefs.size + 1); applyPrefs(); } }, 'A+'),
    h('button', { 'aria-label': 'Cambiar modo claro u oscuro', title: 'Modo claro u oscuro', html: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
      onclick: () => { prefs.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; applyPrefs(); } }));
  top.append(h('div', { class: 'top-in' }, brand, nav || null, look));
}
function navFor(items) {
  const nav = h('nav', { class: 'nav', 'aria-label': 'Secciones' });
  for (const [page, label] of items) nav.append(h('button', { 'aria-current': state.page === page ? 'page' : null, onclick: () => go(page) }, label));
  nav.append(h('button', { onclick: signOut }, 'Salir'));
  return nav;
}
function go(page, extra = {}) {
  window.onbeforeunload = null;
  navigationEpoch++;
  state.page = page; state.studyId = extra.studyId || null; state.autoExplain = !!extra.autoExplain;
  state.patientId = extra.patientId ?? (page === 'paciente' || page === 'estudio-medico' ? state.patientId : null);
  saveRoute();
  render(); window.scrollTo({ top: 0 });
}
async function signOut() {
  clearPrivateDrafts(); clearRoute(); restoredRouteUser = null;
  await sb.auth.signOut(); state.me = null; state.page = null; render();
}
function mainEl() { const m = $('#main'); m.innerHTML = ''; return m; }
function loading(msg = 'Cargando…') { const m = mainEl(); m.append(h('div', { class: 'card row' }, h('span', { class: 'spinner' }), msg)); }

async function boot() {
  if (!CFG.supabaseUrl || !CFG.supabaseKey) {
    shell(); mainEl().append(h('div', { class: 'card' }, h('h1', {}, 'Falta configurar Chely'), h('p', {}, 'Completá config.js con la dirección y la clave pública de Supabase.')));
    return;
  }
  sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, { auth: { persistSession: true, detectSessionInUrl: true } });
  const params = new URLSearchParams(location.search);
  const code = params.get('invitacion');
  if (code) {
    try { localStorage.setItem('chely-invite', code.toUpperCase()); } catch { /* sin almacenamiento */ }
    params.delete('invitacion');
    history.replaceState(null, '', location.pathname + (params.toString() ? '?' + params : '') + location.hash);
  }
  sb.auth.onAuthStateChange((event, session) => {
    state.session = session;
    if (event === 'PASSWORD_RECOVERY') state.recovery = true;
    if (event === 'SIGNED_OUT') {
      state.me = null; state.page = null; clearPrivateDrafts();
      clearRoute(); restoredRouteUser = null;
    }
    if (session?.user?.id && state.me?.id && session.user.id !== state.me.id) {
      state.me = null; state.page = null; clearPrivateDrafts();
      clearRoute(); restoredRouteUser = null;
    }
    // No consultar la base dentro de este callback: se agenda.
    setTimeout(render, 0);
  });
  const { data } = await sb.auth.getSession();
  state.session = data.session;
  render();
}
function pendingInvite() { try { return localStorage.getItem('chely-invite'); } catch { return null; } }
function clearInvite() { try { localStorage.removeItem('chely-invite'); } catch { /* sin almacenamiento */ } }

let rendering = false, renderAgain = false;
async function render() {
  // Si llega un pedido mientras se dibuja, se vuelve a dibujar al terminar.
  if (rendering) { renderAgain = true; return; }
  rendering = true;
  try {
    if (state.recovery) return viewNewPassword();
    if (!state.session) return viewAuth();
    if (!state.me) {
      loading();
      const { data, error } = await sb.from('profiles').select('*').eq('id', state.session.user.id).maybeSingle();
      if (error || !data) { shell(); mainEl().append(h('div', { class: 'card' }, h('div', { class: 'alert bad' }, 'No pudimos cargar tu cuenta. ' + errorText(error)), h('button', { class: 'btn', onclick: () => location.reload() }, 'Reintentar'))); return; }
      state.me = data;
    }
    restoreRoute();
    const c = CONSENT[state.me.role];
    if (state.me.consent_version !== c.version) return viewConsent();
    const invite = pendingInvite();
    if (invite && state.me.role === 'patient') {
      clearInvite();
      const { error } = await sb.rpc('redeem_invitation', { p_code: invite });
      if (error) toast(errorText(error)); else toast('Listo: tu médico ya puede enviarte estudios.');
    } else if (invite) clearInvite();
    if (state.me.role === 'doctor') return renderDoctor();
    if (state.me.role === 'admin') return renderAdmin();
    return renderPatient();
  } finally {
    rendering = false;
    if (renderAgain) { renderAgain = false; setTimeout(render, 0); }
  }
}

/* ---------------- entrar / crear cuenta ---------------- */
let authTab = null;
async function viewAuth() {
  shell();
  const m = mainEl();
  const invite = pendingInvite();
  if (!authTab) authTab = invite || location.hash === '#crear' ? 'crear' : 'entrar';
  const box = h('div', { class: 'card auth' });
  if (invite) {
    // Hecho por ChatGPT · 2026-11-01 · La consulta de invitaciones se reserva a usuarios autenticados.
    // La validez del código se verifica en redeem_invitation después de iniciar sesión y aceptar el consentimiento.
    box.append(h('div', { class: 'alert info' },
      'Recibimos tu código de invitación. Creá tu cuenta o entrá para vincularte con tu médico. Vamos a comprobar el código cuando inicies sesión.'));
  } else {
    box.append(h('div', { class: 'stack' }, h('h1', {}, 'Tus estudios, explicados en palabras claras'), h('p', { class: 'muted' }, 'Entrá para ver tus estudios explicados en palabras claras.')));
  }
  const tabs = h('div', { class: 'tabs', role: 'tablist' },
    h('button', { role: 'tab', 'aria-selected': String(authTab === 'entrar'), onclick: () => { authTab = 'entrar'; viewAuth(); } }, 'Entrar'),
    h('button', { role: 'tab', 'aria-selected': String(authTab === 'crear'), onclick: () => { authTab = 'crear'; viewAuth(); } }, 'Crear cuenta'));
  box.append(tabs);
  const msg = h('div', { role: 'alert' });
  const email = h('input', { type: 'email', id: 'auth-email', autocomplete: 'email', required: true });
  const pass = h('input', { type: 'password', id: 'auth-pass', autocomplete: authTab === 'crear' ? 'new-password' : 'current-password', required: true, minlength: authTab === 'crear' ? 8 : null });
  const confirmPass = authTab === 'crear' ? h('input', { type: 'password', id: 'auth-pass-confirm', autocomplete: 'new-password', required: true, minlength: 8 }) : null;
  const showPass = h('label', { class: 'check small' }, h('input', { type: 'checkbox', onchange: e => { pass.type = e.target.checked ? 'text' : 'password'; if (confirmPass) confirmPass.type = pass.type; } }), 'Mostrar contraseña');
  const form = h('form', { class: 'stack', novalidate: true });
  let name = null;
  if (authTab === 'crear') {
    name = h('input', { type: 'text', id: 'auth-name', autocomplete: 'name', required: true });
    form.append(h('label', { class: 'field', for: 'auth-name' }, 'Nombre y apellido', name));
  }
  form.append(h('label', { class: 'field', for: 'auth-email' }, 'Correo electrónico', email),
    h('label', { class: 'field', for: 'auth-pass' }, 'Contraseña', authTab === 'crear' ? h('span', { class: 'hint' }, 'Al menos 8 caracteres.') : null, pass));
  if (confirmPass) form.append(h('label', { class: 'field', for: 'auth-pass-confirm' }, 'Confirmar contraseña', confirmPass));
  form.append(showPass, msg);
  const submit = h('button', { class: 'btn primary big', type: 'submit' }, authTab === 'crear' ? 'Crear cuenta' : 'Entrar');
  form.append(submit);
  form.addEventListener('submit', async e => {
    e.preventDefault(); msg.className = ''; msg.textContent = '';
    const em = email.value.trim(), pw = pass.value;
    if (!/^\S+@\S+\.\S+$/.test(em)) { msg.className = 'alert bad'; msg.textContent = 'Revisá el correo electrónico.'; return; }
    if (authTab === 'crear' && (!name.value.trim() || pw.length < 8)) { msg.className = 'alert bad'; msg.textContent = !name.value.trim() ? 'Escribí tu nombre y apellido.' : 'La contraseña tiene que tener al menos 8 caracteres.'; return; }
    if (confirmPass && pw !== confirmPass.value) { msg.className = 'alert bad'; msg.textContent = 'Las contraseñas no coinciden. Revisalas e intentá de nuevo.'; return; }
    submit.disabled = true; submit.textContent = 'Un momento…';
    let error, data;
    if (authTab === 'crear') {
      ({ data, error } = await sb.auth.signUp({ email: em, password: pw, options: { data: { full_name: name.value.trim() }, emailRedirectTo: location.origin + location.pathname } }));
      if (!error && !data.session) { msg.className = 'alert ok'; msg.textContent = `Te enviamos un correo a ${em}. Abrilo y tocá el enlace para confirmar tu cuenta. Si no llega, revisá spam.`; submit.disabled = false; submit.textContent = 'Crear cuenta'; return; }
    } else {
      ({ error } = await sb.auth.signInWithPassword({ email: em, password: pw }));
    }
    submit.disabled = false; submit.textContent = authTab === 'crear' ? 'Crear cuenta' : 'Entrar';
    if (error) { msg.className = 'alert bad'; msg.textContent = errorText(error); }
  });
  box.append(form);
  if (authTab === 'entrar') box.append(h('button', { class: 'link', onclick: viewForgot }, 'Me olvidé la contraseña'));
  box.append(h('p', { class: 'muted small' }, 'Chely explica estudios; no reemplaza la consulta médica. Ante una urgencia, llamá al 107 o al 911.'));
  m.append(box);
}
function viewForgot() {
  const m = mainEl();
  const email = h('input', { type: 'email', id: 'forgot-email', autocomplete: 'email' });
  const msg = h('div', { role: 'alert' });
  const form = h('form', { class: 'stack' }, h('label', { class: 'field', for: 'forgot-email' }, 'Tu correo electrónico', email), msg, h('button', { class: 'btn primary big', type: 'submit' }, 'Enviar enlace'));
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const { error } = await sb.auth.resetPasswordForEmail(email.value.trim(), { redirectTo: location.origin + location.pathname });
    msg.className = error ? 'alert bad' : 'alert ok';
    msg.textContent = error ? errorText(error) : 'Si hay una cuenta con ese correo, te enviamos un enlace para crear una contraseña nueva.';
  });
  m.append(h('div', { class: 'card auth' }, h('h1', {}, 'Recuperar la contraseña'), form, h('button', { class: 'link', onclick: () => { authTab = 'entrar'; viewAuth(); } }, 'Volver')));
}
function viewNewPassword() {
  shell();
  const m = mainEl();
  // Hecho por ChatGPT · 2026-11-02 · Confirmación de contraseña también en recuperación.
  const pass = h('input', { type: 'password', id: 'new-pass', autocomplete: 'new-password', minlength: 8 });
  const confirmPass = h('input', { type: 'password', id: 'new-pass-confirm', autocomplete: 'new-password', minlength: 8 });
  const msg = h('div', { role: 'alert' });
  const form = h('form', { class: 'stack' },
    h('label', { class: 'field', for: 'new-pass' }, 'Contraseña nueva', h('span', { class: 'hint' }, 'Al menos 8 caracteres.'), pass),
    h('label', { class: 'field', for: 'new-pass-confirm' }, 'Confirmar contraseña nueva', confirmPass),
    msg, h('button', { class: 'btn primary big', type: 'submit' }, 'Guardar contraseña'));
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (pass.value.length < 8) { msg.className = 'alert bad'; msg.textContent = 'La contraseña tiene que tener al menos 8 caracteres.'; return; }
    if (pass.value !== confirmPass.value) { msg.className = 'alert bad'; msg.textContent = 'Las contraseñas no coinciden.'; return; }
    const { error } = await sb.auth.updateUser({ password: pass.value });
    if (error) { msg.className = 'alert bad'; msg.textContent = errorText(error); return; }
    state.recovery = false; toast('Contraseña actualizada.'); render();
  });
  m.append(h('div', { class: 'card auth' }, h('h1', {}, 'Elegí una contraseña nueva'), form));
}

/* ---------------- consentimiento ---------------- */
function consentBody(role) {
  const ul = items => h('ul', {}, ...items.map(t => h('li', {}, t)));
  if (role === 'admin') return [
    h('p', {}, 'Como parte del equipo de Chely vas a ver las cuentas de pacientes y médicos. Te comprometés a:'),
    ul(['Usar estos datos solo para administrar Chely y ayudar a quien lo pida.',
      'No copiarlos ni compartirlos fuera del equipo.',
      'No usar tu acceso para ver estudios de nadie: el panel muestra cuentas y números, no el contenido de los estudios.',
      'Usar una contraseña larga y única, y no compartir tu cuenta.']),
    h('p', { class: 'muted small' }, 'Los cambios que hagas desde el panel quedan registrados.'),
  ];
  if (role === 'doctor') return [
    h('p', {}, 'Chely está en prueba piloto. Al usarla como profesional aceptás:'),
    ul(['Usarla solo con pacientes que atendés y que aceptaron participar.',
      'Revisar y corregir cada explicación antes de publicarla. La IA puede equivocarse: lo que publicás queda bajo tu criterio profesional.',
      'Que el texto de los informes que cargás se procese con un servicio de inteligencia artificial para transcribir archivos y redactar el borrador. Ese servicio no usa los datos para entrenarse.',
      'Mantener la confidencialidad de los datos de tus pacientes y no compartir tu contraseña.',
      'Que tu nombre y tu correo sean visibles para los pacientes vinculados.',
      `Avisarnos a ${CONTACT} si detectás un error o un problema de seguridad.`]),
  ];
  return [
    h('p', {}, 'Chely está en prueba piloto. Antes de empezar, leé cómo funciona y qué pasa con tus datos.'),
    h('h3', {}, 'Qué hace Chely'),
    ul(['Podés subir tus estudios (un PDF, una foto o el texto del informe) y Chely te los explica en palabras simples con inteligencia artificial.',
      'Esas explicaciones NO las revisa un médico: pueden tener errores. Usalas para entender y para preparar tus preguntas, y llevalas siempre a tu consulta.',
      'Si tu médico usa Chely, también puede enviarte estudios con una explicación revisada por él.',
      'Chely no diagnostica ni reemplaza la consulta. Ante una urgencia, llamá al 107 o al 911.']),
    h('h3', {}, 'Tus datos'),
    ul(['Guardamos tu nombre, tu correo, tu fecha de nacimiento si la cargás, tus estudios y sus explicaciones. Son datos de salud y se tratan como datos sensibles.',
      'Los estudios que subís vos solo los ves vos. Los que te envía un médico los ven vos y ese médico. Podés dejar de compartir con un médico cuando quieras.',
      'Para preparar la explicación usamos un servicio de inteligencia artificial. Recibe solo el texto del informe, lo usa únicamente para generar la explicación y no lo usa para entrenarse.',
      'Los datos se guardan cifrados en servidores en la nube ubicados en Brasil. Queda registro de quién vio o publicó cada estudio, y vos podés consultarlo.',
      `Si querés saber qué proveedores usamos, escribinos a ${CONTACT}.`,
      'Podés pedir ver, corregir o borrar tus datos, y borrar tu cuenta desde «Mi cuenta». Tus derechos están protegidos por la Ley 25.326 de Protección de Datos Personales.',
      'Participar es voluntario. Podés dejar de usar Chely en cualquier momento sin que cambie tu atención médica.',
      `Contacto: ${CONTACT}`]),
  ];
}
function viewConsent() {
  shell(h('nav', { class: 'nav' }, h('button', { onclick: signOut }, 'Salir')));
  const m = mainEl();
  const c = CONSENT[state.me.role];
  const ok = h('input', { type: 'checkbox', id: 'consent-ok' });
  const btn = h('button', { class: 'btn primary big', disabled: true }, 'Acepto y continúo');
  ok.addEventListener('change', () => { btn.disabled = !ok.checked; });
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const { error } = await sb.rpc('accept_consent', { p_version: c.version });
    if (error) { toast(errorText(error)); btn.disabled = false; return; }
    state.me.consent_version = c.version; render();
  });
  m.append(h('div', { class: 'card' }, h('h1', {}, c.title), h('div', { class: 'consent' }, ...consentBody(state.me.role)),
    h('label', { class: 'check', for: 'consent-ok' }, ok, state.me.role !== 'patient' ? 'Leí y acepto estas condiciones.' : 'Leí la información y acepto participar del piloto de Chely.'),
    h('div', { class: 'row' }, btn, h('button', { class: 'btn quiet', onclick: signOut }, 'No acepto'))));
}

/* ---------------- panel del equipo ---------------- */
// Hecho por Claude · 2026-11-02 · panel de control del equipo (resumen, cuentas, cambio de rol y registro).
// Precios de Claude Haiku 5.5 por millón de tokens, para estimar el gasto.
const AI_PRICE = { input: 0.10, output: 0.50 };
const ROLE_LABEL = { patient: 'Paciente', doctor: 'Médico', admin: 'Equipo' };
let adminFilter = 'patient', adminSearch = '';

async function renderAdmin() {
  if (!['panel', 'registro', 'cuenta'].includes(state.page)) state.page = 'panel';
  saveRoute();
  shell(navFor([['panel', 'Panel'], ['registro', 'Registro'], ['cuenta', 'Mi cuenta']]));
  if (state.page === 'registro') return adminLog();
  if (state.page === 'cuenta') return accountView();
  return adminPanel();
}

async function adminPanel() {
  loading();
  const [ov, us] = await Promise.all([sb.rpc('admin_overview'), sb.rpc('admin_users')]);
  if (ov.error || us.error) return showError(ov.error || us.error, adminPanel);
  const o = ov.data[0], users = us.data;
  const cost = (o.ia_tokens_entrada_30d * AI_PRICE.input + o.ia_tokens_salida_30d * AI_PRICE.output) / 1e6;
  const stat = (value, label, hint) => h('div', { class: 'stat' }, h('b', {}, value), h('span', {}, label), hint ? h('span', { class: 'hint' }, hint) : null);
  const m = mainEl();
  m.append(h('div', { class: 'card' }, h('h1', {}, 'Panel de Chely'),
    h('div', { class: 'stats' },
      stat(fmtNum(o.pacientes), 'Pacientes'),
      stat(fmtNum(o.medicos), 'Médicos'),
      stat(fmtNum(o.cuentas_7d), 'Cuentas nuevas', 'últimos 7 días'),
      stat(fmtNum(o.estudios), 'Estudios', `${fmtNum(o.estudios_explicados)} explicados · ${fmtNum(o.estudios_propios)} subidos por pacientes`),
      stat(fmtNum(o.estudios_7d), 'Estudios nuevos', 'últimos 7 días'),
      stat('US$ ' + cost.toFixed(2).replace('.', ','), 'Gasto de IA estimado', `${fmtNum(o.ia_usos_30d)} usos en 30 días`)),
    o.sin_consentimiento ? h('p', { class: 'muted small' }, `${fmtNum(o.sin_consentimiento)} cuenta(s) todavía no aceptaron el consentimiento.`) : null));

  const counts = { patient: 0, doctor: 0, admin: 0 };
  for (const u of users) counts[u.role]++;
  const search = h('input', { type: 'text', inputmode: 'search', id: 'adm-search', placeholder: 'Buscar por nombre o correo', value: adminSearch, autocomplete: 'off' });
  const list = h('div', { class: 'table-wrap' });
  const tabs = h('div', { class: 'tabs', role: 'tablist' }, ...[['patient', 'Pacientes'], ['doctor', 'Médicos'], ['admin', 'Equipo'], ['all', 'Todas']].map(([k, label]) =>
    h('button', { role: 'tab', 'aria-selected': String(adminFilter === k), onclick: () => { adminFilter = k; adminPanel(); } }, `${label} (${k === 'all' ? users.length : counts[k]})`)));
  const draw = () => {
    const q = adminSearch.trim().toLowerCase();
    const rows = users.filter(u => (adminFilter === 'all' || u.role === adminFilter) && (!q || (u.full_name + ' ' + u.email).toLowerCase().includes(q)));
    if (!rows.length) { list.replaceChildren(h('p', { class: 'muted' }, 'No hay cuentas para mostrar.')); return; }
    list.replaceChildren(h('table', { class: 'admin-table' },
      h('thead', {}, h('tr', {}, ...['Cuenta', 'Tipo', 'Alta', 'Último ingreso', 'Estudios', 'IA (30 días)', ''].map(t => h('th', {}, t)))),
      h('tbody', {}, ...rows.map(u => h('tr', {},
        h('td', {}, h('strong', {}, u.full_name || 'Sin nombre'), h('div', { class: 'muted small' }, u.email),
          u.consent_at ? null : h('span', { class: 'pill warn' }, 'Sin consentimiento')),
        h('td', {}, ROLE_LABEL[u.role] || u.role),
        h('td', { class: 'nowrap' }, fmtDate(u.created_at.slice(0, 10))),
        h('td', { class: 'nowrap' }, u.last_sign_in_at ? fmtDateTime(u.last_sign_in_at) : '—'),
        h('td', {}, `${fmtNum(u.estudios)}${u.estudios ? ` (${fmtNum(u.estudios_explicados)} explicados)` : ''}`),
        h('td', {}, fmtNum(u.ia_usos_30d)),
        h('td', {}, roleButton(u)))))));
  };
  search.addEventListener('input', () => { adminSearch = search.value; draw(); });
  draw();
  m.append(h('div', { class: 'card admin-card' }, h('h2', {}, 'Cuentas'), tabs, h('label', { class: 'field', for: 'adm-search' }, 'Buscar', search), list,
    h('p', { class: 'muted small' }, 'El panel muestra cuentas y números. Para proteger a los pacientes, no muestra el contenido de los estudios.')));
}

function roleButton(u) {
  if (u.role === 'admin' || u.id === state.me.id) return null;
  const to = u.role === 'doctor' ? 'patient' : 'doctor';
  return h('button', { class: 'btn quiet sm', onclick: async () => {
    const who = u.full_name || u.email;
    const ok = await confirmBox({ title: to === 'doctor' ? 'Pasar a médico' : 'Pasar a paciente',
      text: to === 'doctor' ? `${who} va a poder invitar pacientes y cargarles estudios. La próxima vez que entre va a tener que aceptar las condiciones para profesionales.`
        : `${who} deja de ser médico: ya no va a poder invitar pacientes ni cargar estudios. La próxima vez que entre va a tener que aceptar el consentimiento de pacientes.`,
      ok: 'Confirmar' });
    if (!ok) return;
    const { error } = await sb.rpc('admin_set_role', { p_user: u.id, p_role: to });
    if (error) return toast(errorText(error));
    toast('Listo, se cambió el tipo de cuenta.'); adminPanel();
  } }, to === 'doctor' ? 'Pasar a médico' : 'Pasar a paciente');
}

async function adminLog() {
  loading();
  const { data, error } = await sb.rpc('admin_recent_log');
  if (error) return showError(error, adminLog);
  const LABEL = { cambiar_rol: 'cambió el tipo de cuenta de' };
  const RL = s => s.replace(/patient/g, 'paciente').replace(/doctor/g, 'médico');
  const m = mainEl();
  m.append(h('div', { class: 'card' }, h('h1', {}, 'Registro del equipo'), h('p', { class: 'muted' }, 'Últimos 50 cambios hechos desde el panel.'),
    !data.length ? h('p', { class: 'muted' }, 'Todavía no hay cambios.')
      : h('div', { class: 'list' }, ...data.map(l => h('div', { class: 'small' }, h('strong', {}, fmtDateTime(l.at)), ' · ', l.admin_email || 'Alguien del equipo', ' ',
        LABEL[l.action] || l.action, ' ', l.target_email || 'una cuenta borrada', l.detail ? ` (${RL(l.detail)})` : '')))));

  // Hecho por ChatGPT · 2026-11-02 · Registro de estudios visible sólo al admin;
  // la función RPC aplica autorización en Supabase y la tabla no permite SELECT al paciente.
  const { data: access, error: accessError } = await sb.rpc('admin_study_access_log');
  if (accessError) {
    m.append(h('div', { class: 'card' }, h('p', { class: 'alert bad' }, errorText(accessError))));
    return;
  }
  const ACTIONS = { estudio_creado: 'cargó un estudio', estudio_publicado: 'publicó un estudio',
    estudio_retirado: 'retiró un estudio', visto_por_paciente: 'abrió un estudio',
    visto_por_medico: 'abrió un estudio', original_descargado: 'abrió un informe original',
    medico_vinculado: 'vinculó un médico', medico_desvinculado: 'desvinculó un médico' };
  const rows = access || [];
  const auditCard = h('div', { class: 'card' },
    h('h2', {}, 'Auditoría de estudios'),
    h('p', { class: 'muted small' }, 'Últimas 100 acciones. Acceso restringido a administradores. No se muestran textos médicos.'));
  if (!rows.length) {
    auditCard.append(h('p', { class: 'muted' }, 'Todavía no hay movimientos.'));
  } else {
    const list = h('div', { class: 'list' });
    for (const item of rows) {
      list.append(h('div', { class: 'small' },
        h('strong', {}, fmtDateTime(item.at)), ' · ', item.actor_email || 'Sistema', ' ',
        ACTIONS[item.action] || item.action, ' · Paciente: ', item.patient_email || 'Cuenta eliminada'));
    }
    auditCard.append(list);
  }
  m.append(auditCard);
}

/* ---------------- paciente ---------------- */
async function renderPatient() {
  // Hecho por ChatGPT · 2026-11-02 · Sólo mostrar Menores a cargo cuando existe un vínculo vigente.
  const { data: linkedMinors, error: minorError } = await sb.rpc('minor_list');
  if (minorError) return showError(minorError, render);
  state.linkedMinors = linkedMinors || [];
  if (!['estudios', 'estudio', 'subir', 'mi-estudio', 'medicos', 'cuenta', 'menores'].includes(state.page)
      || (state.page === 'menores' && !state.linkedMinors.length)) state.page = 'estudios';
  saveRoute();
  const tabs = [['estudios', 'Mis estudios'], ['medicos', 'Mis médicos']];
  if (state.linkedMinors.length) tabs.push(['menores', 'Menores a cargo']);
  tabs.push(['cuenta', 'Mi cuenta']);
  shell(navFor(tabs));
  if (state.page === 'estudio') return patientStudy();
  if (state.page === 'subir') return patientUpload();
  if (state.page === 'mi-estudio') return patientOwnStudy();
  if (state.page === 'medicos') return patientDoctors();
  if (state.page === 'menores') return minorManagement();
  if (state.page === 'cuenta') return accountView();
  return patientStudies();
}
async function loadPatientStudies() {
  const { data, error } = await sb.from('studies')
    .select('id, title, study_date, status, self_uploaded, report_text, published_at, first_viewed_at, doctor_id, explanation, glossary, lab_values, doctor_note, file_path, file_name, file_type, storage_backend, storage_file_id, feedback, ai_generated_at, created_at, updated_at')
    .order('study_date', { ascending: false });
  if (error) throw error;
  return data;
}
async function namesFor(ids) {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return {};
  const { data } = await sb.from('profiles').select('id, full_name').in('id', uniq);
  return Object.fromEntries((data || []).map(p => [p.id, p.full_name]));
}
async function patientStudies() {
  loading();
  let studies, links;
  try {
    studies = await loadPatientStudies();
    ({ data: links } = await sb.from('care_links').select('doctor_id').eq('patient_id', state.me.id).eq('active', true));
  } catch (e) { return showError(e, patientStudies); }
  const names = await namesFor(studies.map(s => s.doctor_id));
  const { data: latest, error: latestError } = await sb.from('patient_latest_explanations')
    .select('source_study_id,explanation,glossary,model,generated_at,previous_studies_used,debian_sync_status')
    .eq('patient_id', state.me.id).maybeSingle();
  // Si Supabase no responde con la copia, mantener accesible la lista de estudios.
  if (latestError) console.warn('No se pudo mostrar la ultima explicacion.');
  const m = mainEl();
  m.append(h('div', { class: 'row' }, h('h1', { class: 'grow' }, `Hola, ${state.me.full_name.split(' ')[0] || ''}`)));
  m.append(h('div', { class: 'card' }, h('h2', {}, 'Entendé tu estudio'),
    h('p', {}, 'Subí un análisis o un informe (PDF, foto o texto) y Chely te lo explica en palabras simples.'),
    h('div', { class: 'row' }, h('button', { class: 'btn primary big', onclick: () => go('subir') }, 'Subir un estudio'))));
  // Hecho por ChatGPT · 2026-11-02 · Evaluación integral a pedido.
  const ownHistory = studies.filter(st => st.self_uploaded);
  const unreadHistory = ownHistory.filter(st => !String(st.report_text || '').trim()).length;
  const { data: overall, error: overallError } = await sb.from('patient_history_summaries')
    .select('explanation,total_studies,unique_reports,unconfirmed_studies,generated_at,latest_confirmed_date')
    .eq('patient_id', state.me.id).maybeSingle();
  if (overallError) console.warn('No se pudo leer la evaluación integral guardada.');
  const changedHistory = !!overall && (ownHistory.length !== overall.total_studies ||
    ownHistory.some(st => st.updated_at && new Date(st.updated_at) > new Date(overall.generated_at)));
  const overviewCard = h('div', { class: 'card' },
    h('h2', {}, 'Evaluación integral del historial'),
    h('p', {}, 'Chely puede comparar los estudios escritos y explicar su evolución. No puede conocer el estado actual de salud solamente por informes históricos.'),
    h('p', { class: 'hint' },
      ownHistory.length + ' estudios registrados · ' +
      (ownHistory.length - unreadHistory) + ' con texto guardado. La IA se usa solo si lo solicitás.'));
  if (overall?.explanation) {
    overviewCard.append(h('p', { class: 'muted small' },
      'Última evaluación: ' + fmtDateTime(overall.generated_at) +
      ' · ' + overall.unique_reports + ' informes diferentes examinados.'));
    if (changedHistory) overviewCard.append(h('p', { class: 'hint' },
      'Agregaste o modificaste estudios desde esta evaluación. Podés actualizarla.'));
    overviewCard.append(h('details', { class: 'stack' },
      h('summary', {}, 'Leer la evaluación guardada'),
      renderExplanation(overall.explanation)));
  }
  const overviewStatus = h('p', { class: 'hint', role: 'status', 'aria-live': 'polite' });
  const overviewButton = h('button', { type: 'button', class: 'btn primary' },
    overall?.explanation ? 'Actualizar evaluación integral' : 'Evaluar todo mi historial');
  const overviewOwner = state.me.id;
  // No simular un porcentaje: la API no informa pasos internos de Claude.
  // Mostrar actividad y un reloj que funciona incluso al cambiar de sección.
  const evalProgress = h('div', { class: 'history-eval-progress', hidden: true },
    h('div', { class: 'row' },
      h('span', { class: 'spinner', 'aria-hidden': 'true' }),
      h('strong', {}, 'Evaluación integral en curso')),
    h('p', { class: 'history-eval-progress-detail' },
      'Los informes están siendo procesados.'),
    h('div', { class: 'history-eval-progress-track', 'aria-hidden': 'true' },
      h('div', { class: 'history-eval-progress-indeterminate' })),
    h('p', { class: 'muted small' },
      'La IA no informa un porcentaje real. La evaluación se guardará al finalizar. No recargues ni cierres esta pestaña.'));
  const progressDetail = evalProgress.querySelector('.history-eval-progress-detail');
  const showHistoryProgress = () => {
    if (!overviewCard.isConnected || state.me?.id !== overviewOwner) return;
    const job = historyEvaluationProgress.get(overviewOwner);
    const activeJob = !!job && runningHistoryEvaluations.has(overviewOwner);
    evalProgress.hidden = !activeJob;
    overviewButton.disabled = activeJob || ownHistory.length === 0 || unreadHistory > 0;
    if (!activeJob) return;
    progressDetail.textContent = job.total + ' informes con texto disponibles · ' +
      'Tiempo transcurrido: ' + formatHistoryElapsed(Date.now() - job.startedAt) +
      '. La IA está preparando la evaluación.';
  };
  updateHistoryEvaluationDisplay = showHistoryProgress;
  if (unreadHistory > 0) overviewStatus.textContent = 'Quedan ' + unreadHistory +
    ' informes por leer. Preparalos antes de pedir la evaluación integral.';
  overviewButton.addEventListener('click', async () => {
    if (runningHistoryEvaluations.has(overviewOwner)) return toast('Ya hay una evaluación integral en curso.');
    const allowed = await confirmBox({
      title: 'Evaluar todo mi historial',
      text: 'Chely enviará los informes escritos y los datos de salud declarados para preparar una evaluación cronológica. Esta consulta a la IA puede tener costo. No permite diagnosticar ni conocer con certeza tu estado de salud hoy. Si los datos no cambiaron, reutilizará la última evaluación.',
      ok: 'Generar evaluación'
    });
    if (!allowed || runningHistoryEvaluations.has(overviewOwner)) return;
    historyEvaluationProgress.set(overviewOwner, {
      startedAt: Date.now(), total: ownHistory.length - unreadHistory
    });
    startHistoryEvaluationTimer();
    overviewStatus.className = 'alert info';
    overviewStatus.textContent = 'Solicitud enviada. La evaluación está en curso.';
    overviewButton.disabled = true;
    showHistoryProgress();
    try {
      const { data, error } = await pendingOnce(runningHistoryEvaluations, overviewOwner,
        () => sb.functions.invoke('resumen-integral', { body: { action: 'evaluar' } }));
      if (error) throw new Error(await fnError(error));
      if (!data?.explanation) throw new Error('No se recibió la evaluación.');
      overviewStatus.className = 'alert ok';
      overviewStatus.textContent = data.reused
        ? 'Se recuperó la evaluación guardada, sin consumir IA.'
        : 'La evaluación integral quedó guardada en tu cuenta.';
      if (state.me?.id === overviewOwner && state.page === 'estudios') render();
      else if (state.me?.id === overviewOwner)
        toast('La evaluación integral está guardada en Mis estudios.');
    } catch (error) {
      overviewStatus.className = 'alert bad';
      overviewStatus.textContent = errorText(error);
    } finally {
      historyEvaluationProgress.delete(overviewOwner);
      stopHistoryEvaluationTimerIfIdle();
      showHistoryProgress();
    }
  });
  overviewCard.append(h('div', { class: 'row' }, overviewButton), overviewStatus, evalProgress);
  m.append(overviewCard);
  showHistoryProgress();

  // Hecho por ChatGPT · 2026-11-02 · Ultima explicacion consultable sin gastar IA.
  if (latest?.explanation) {
    const origin = studies.find(st => st.id === latest.source_study_id);
    const content = h('details', { class: 'stack' },
      h('summary', {}, 'Leer la última explicación guardada'),
      renderExplanation(latest.explanation, latest.glossary || []));
    m.append(h('div', { class: 'card' },
      h('h2', {}, 'Última explicación disponible'),
      h('p', { class: 'muted small' }, (origin ? 'Estudio: ' + origin.title + ' · ' : '') +
        'Generada el ' + fmtDateTime(latest.generated_at) + '. ' +
        'Usó ' + latest.previous_studies_used + ' antecedentes con texto.'),
      content));
  }
  // Hecho por ChatGPT · 2026-11-02 · Leer todos los estudios pendientes a pedido.
  // No modifica explicaciones, no publica, no llama a la acción «explicar».
  const ownStudies = studies.filter(st => st.self_uploaded);
  const hasOriginal = st => (st.storage_backend === 'debian' && !!st.storage_file_id)
    || !!st.file_path;
  const pendingReads = ownStudies.filter(st =>
    !String(st.report_text || '').trim() && hasOriginal(st));
  const readCard = h('div', { class: 'card' },
    h('h2', {}, 'Preparar el historial sin explicar'),
    h('p', { class: 'muted' },
      'Leé los PDF pendientes y guardá sus textos para utilizarlos como antecedentes cuando pidas una explicación. Los que ya tienen texto se omiten.'),
    h('p', { class: 'hint' },
      'Los PDF escaneados pueden requerir IA para leer su texto, y cada lectura puede generar un costo. No se generará ninguna explicación.'),
    h('p', { class: 'muted small' },
      ownStudies.filter(st => !!String(st.report_text || '').trim()).length +
      ' estudios con texto guardado · ' + pendingReads.length + ' pendientes de lectura'));
  const readProgress = h('p', { role: 'status', 'aria-live': 'polite', class: 'hint' });
  const readStart = h('button', { class: 'btn primary', type: 'button' },
    pendingReads.length ? 'Leer ' + pendingReads.length + ' pendientes sin explicar' : 'Todos los estudios están leídos');
  const readStop = h('button', { class: 'btn', type: 'button' }, 'Detener después del actual');
  readStop.addEventListener('click', cancelBatchRead);
  const showReadJob = () => {
    if (!readCard.isConnected) return;
    const job = batchReadJob?.ownerId === state.me.id ? batchReadJob : null;
    const running = !!job?.running;
    readStart.disabled = running || pendingReads.length === 0;
    readStop.hidden = !running;
    readStop.disabled = !running || job.cancelRequested;
    if (!job) { readProgress.textContent = ''; return; }
    readProgress.textContent = (running ? 'Lectura en curso. ' : 'Última lectura. ') +
      (job.processed + '/' + job.total) + ' procesados, ' +
      job.completed + ' guardados, ' + job.failed + ' con error.' +
      (running && job.cancelRequested ? ' Se detendrá después del actual.' :
        running ? ' Podés cambiar de sección, pero no cierres ni actualices la pestaña.' :
        job.cancelRequested ? ' Lectura detenida; podés retomarla.' : ' Proceso terminado.') +
      (job.lastError ? ' Último error: ' + job.lastError : '');
  };
  updateBatchReadDisplay = showReadJob;
  readStart.addEventListener('click', async () => {
    if (batchReadJob?.running) return toast('Ya hay una lectura de estudios en curso.');
    if (!pendingReads.length) return;
    const approved = await confirmBox({
      title: 'Leer sin generar explicaciones',
      text: 'Chely intentará leer ' + pendingReads.length + ' archivos pendientes, uno por uno. ' +
        'Cada documento sin texto puede requerir una llamada paga a la IA. ' +
        'Solo se guardará el texto y, cuando se identifiquen con suficiente claridad, el nombre y la fecha. ' +
        'No se generarán explicaciones. Escribí LEER para iniciar.',
      ok: 'Iniciar lectura', typed: 'LEER'
    });
    if (!approved || batchReadJob?.running) return;
    const ownerId = state.me.id;
    const job = {
      ownerId, running: true, cancelRequested: false, total: pendingReads.length,
      processed: 0, completed: 0, failed: 0, lastError: ''
    };
    batchReadJob = job;
    showReadJob();
    for (const study of pendingReads) {
      if (job.cancelRequested || state.me?.id !== ownerId ||
          state.session?.user?.id !== ownerId) {
        job.cancelRequested = true;
        break;
      }
      try {
        const { data, error } = await pendingOnce(runningStudyReads, 'adult:' + study.id,
          () => sb.functions.invoke('ia', {
            body: { action: 'transcribir', study_id: study.id, force: false }
          }));
        if (error) throw new Error(await fnError(error));
        const text = typeof data?.text === 'string' ? data.text.trim() : '';
        // Si la lectura es incompleta, no hacerla pasar por un antecedente fiable.
        if (text.length < 25 || text.length > 60000)
          throw new Error('No se obtuvo un texto completo y válido. Revisá este archivo individualmente.');
        // Si el usuario pidió detenerse, guardar igual la lectura actual
        // que ya consumió IA; detener recién ANTES del próximo estudio.
        if (state.me?.id !== ownerId || state.session?.user?.id !== ownerId) {
          job.cancelRequested = true;
          break;
        }
        const payload = { report_text: text };
        if (study.title === STUDY_PENDING_TITLE) {
          const detected = metadataFromReport(text);
          const nameGuess = pdfFilenameSuggestion(study.file_name || '');
          const titleGuess = detected.title || nameGuess.title;
          const dateGuess = detected.date || nameGuess.date;
          if (titleGuess && dateGuess) {
            payload.title = titleGuess.slice(0, 150);
            payload.study_date = dateGuess;
          }
        }
        const { error: writeError } = await sb.from('studies').update(payload)
          .eq('id', study.id).eq('patient_id', ownerId).eq('self_uploaded', true);
        if (writeError) throw writeError;
        study.report_text = text;
        if (payload.title) study.title = payload.title;
        if (payload.study_date) study.study_date = payload.study_date;
        job.completed++;
      } catch (e) {
        job.failed++;
        // El texto del estudio no aparece en los errores.
        job.lastError = errorText(e).slice(0, 180);
        if (/máximo|24 horas|límite de IA|sesión vencida|429|503/i.test(job.lastError)) {
          job.cancelRequested = true;
        }
      } finally {
        job.processed++;
        refreshBatchReadDisplay();
      }
      if (job.cancelRequested) break;
    }
    job.running = false;
    refreshBatchReadDisplay();
    if (state.me?.id === ownerId && state.page === 'estudios') render();
    else if (state.me?.id === ownerId)
      toast(job.completed + ' estudios leídos y guardados sin explicación.');
  });
  readCard.append(h('div', { class: 'row' }, readStart, readStop), readProgress);
  readStop.hidden = true;
  m.append(readCard);
  showReadJob();

  // Hecho por ChatGPT · 2026-11-02 · Priorización por estado de preparación.
  // Grupos excluyentes: completar datos > sin explicar > explicados.
  // Una fecha de carga provisional NO se considera fecha médica confirmada.
  const preparedStudies = studies.map(s => {
    const needsDetails = s.self_uploaded &&
      (s.title === STUDY_PENDING_TITLE || !s.study_date);
    const explained = !!String(s.explanation || '').trim();
    const group = needsDetails ? 'completar' : explained ? 'explicados' : 'sin-explicar';
    const inferred = needsDetails ? metadataFromReport(s.report_text || '') : null;
    const filenameHint = needsDetails ? pdfFilenameSuggestion(s.file_name || '') : null;
    const title = needsDetails
      ? (inferred?.title || filenameHint?.title || s.title)
      : s.title;
    const suggestedDate = inferred?.date || filenameHint?.date || null;
    return { study: s, needsDetails, group, title, suggestedDate };
  });
  const completion = preparedStudies.filter(v => v.group === 'completar');
  const unexplained = preparedStudies.filter(v => v.group === 'sin-explicar');
  const explained = preparedStudies.filter(v => v.group === 'explicados');
  const groups = [
    { id: 'completar', name: 'Completar datos', description: 'Prioridad: estudios sin fecha o nombre confirmado.', data: completion },
    { id: 'sin-explicar', name: 'Sin explicar', description: 'Estudios listos para pedir una explicación cuando quieras.', data: unexplained },
    { id: 'explicados', name: 'Explicados', description: 'Estudios que ya tienen explicación guardada.', data: explained },
    { id: 'todos', name: 'Todos', description: 'Todos los estudios, primero los que requieren completar datos.',
      data: [...completion, ...unexplained, ...explained] }
  ];
  // Primera apertura: empezar por los que necesitan intervención.
  // Al volver de corregir un estudio, conservar la pestaña mientras haya
  // elementos; si se vació, avanzar a la próxima que tenga pendientes.
  const preferred = patientStudiesTab && groups.find(g => g.id === patientStudiesTab);
  let active = preferred && (preferred.data.length || preferred.id === 'todos')
    ? preferred.id
    : completion.length ? 'completar' : unexplained.length ? 'sin-explicar'
      : explained.length ? 'explicados' : 'todos';
  patientStudiesTab = active;

  const card = h('div', { class: 'card' },
    h('h2', {}, 'Mis estudios (' + studies.length + ')'));
  if (!studies.length) card.append(h('p', { class: 'muted' },
    'Todavía no tenés estudios. Tocá «Subir un estudio» para empezar.'));
  const filterTabs = h('div', {
    class: 'study-filter-tabs', role: 'group', 'aria-label': 'Filtrar mis estudios'
  });
  const description = h('p', { class: 'muted small', role: 'status', 'aria-live': 'polite' });
  const list = h('div', {
    class: 'list studies-scroll-list',
    role: 'region',
    'aria-label': 'Mis estudios, lista desplazable',
    tabindex: '0'
  });
  const drawList = () => {
    const chosen = groups.find(g => g.id === active);
    filterTabs.querySelectorAll('button').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.filter === active));
    });
    description.textContent = chosen.description +
      (chosen.data.length > 4 ? ' Deslizá dentro de la lista para ver los demás.' : '');
    list.replaceChildren();
    list.scrollTop = 0;
    if (!chosen.data.length) {
      list.append(h('p', { class: 'muted study-list-empty' },
        chosen.id === 'completar'
          ? '¡Excelente! No hay estudios pendientes de nombre o fecha.'
          : chosen.id === 'sin-explicar'
            ? 'No hay estudios pendientes de explicación.'
            : chosen.id === 'explicados'
              ? 'Todavía no hay estudios con explicaciones.'
              : 'Todavía no tenés estudios.'));
      return;
    }
    for (const item of chosen.data) {
      const s = item.study;
      const pending = s.self_uploaded && s.status !== 'publicado';
      const goTo = pending ? 'mi-estudio' : 'estudio';
      list.append(h('button', { class: 'item', onclick: () => go(goTo, { studyId: s.id }) },
        h('div', { class: 'row' }, h('h3', {}, item.title),
          item.needsDetails
            ? h('span', { class: 'pill warn' }, 'Completar datos')
            : null,
          pending ? h('span', { class: 'pill warn' }, 'Sin explicar')
            : !s.self_uploaded && !s.first_viewed_at
              ? h('span', { class: 'pill bad' }, 'Nuevo') : null,
          s.self_uploaded && s.report_text?.trim()
            ? h('span', { class: 'pill' }, 'Leído')
            : s.self_uploaded && (s.file_path || s.storage_file_id)
              ? h('span', { class: 'pill warn' }, 'Sin leer') : null,
          h('span', { class: 'pill' }, item.needsDetails
            ? (item.suggestedDate ? 'Fecha sugerida: ' + fmtDate(item.suggestedDate)
              : 'Fecha por confirmar') : fmtDate(s.study_date))),
        h('span', { class: 'muted small' }, s.self_uploaded ? 'Subido por vos'
          : 'Enviado por ' + (names[s.doctor_id] || 'tu médico') +
            ' el ' + fmtDate(s.published_at))));
    }
  };
  for (const group of groups) {
    const button = h('button', { type: 'button', class: 'study-filter-tab' },
      group.name + ' (' + group.data.length + ')');
    button.dataset.filter = group.id;
    button.addEventListener('click', () => {
      active = group.id;
      patientStudiesTab = active;
      drawList();
    });
    filterTabs.append(button);
  }
  card.append(filterTabs, description, list);
  m.append(card);
  drawList();
  if (!links || !links.length) m.append(redeemCard('¿Tu médico usa Chely? Pedile el código de invitación para que también pueda enviarte estudios revisados por él.'));
}
function redeemCard(text) {
  const input = h('input', { type: 'text', id: 'redeem-code', autocomplete: 'off', placeholder: 'Ej.: ABCD2345EF', style: 'text-transform:uppercase' });
  const btn = h('button', { class: 'btn primary' }, 'Vincular');
  btn.addEventListener('click', async () => {
    const code = input.value.trim().toUpperCase(); if (!code) return;
    btn.disabled = true;
    const { error } = await sb.rpc('redeem_invitation', { p_code: code });
    btn.disabled = false;
    if (error) return toast(errorText(error));
    toast('Listo: ya estás vinculado con tu médico.'); render();
  });
  return h('div', { class: 'card' }, h('p', {}, text), h('label', { class: 'field', for: 'redeem-code' }, 'Código de invitación', h('div', { class: 'row', style: 'flex-wrap:nowrap' }, input, btn)));
}
async function patientStudy() {
  loading();
  let studies;
  try { studies = await loadPatientStudies(); } catch (e) { return showError(e, patientStudy); }
  const s = studies.find(x => x.id === state.studyId);
  if (!s) { toast('No encontramos ese estudio.'); return go('estudios'); }
  if (s.self_uploaded && s.status !== 'publicado') return go('mi-estudio', { studyId: s.id });
  if (!s.first_viewed_at) sb.rpc('mark_study_viewed', { p_study: s.id });
  const names = await namesFor([s.doctor_id]);
  const m = mainEl();
  m.append(h('div', { class: 'row' }, h('button', { class: 'btn quiet sm', onclick: () => go('estudios') }, '‹ Mis estudios')));
  m.append(...studyView(s, names[s.doctor_id], studies.filter(x => x.status === 'publicado'), false));
  if (s.self_uploaded) m.append(h('div', { class: 'card' }, h('h2', {}, 'Este estudio'),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => go('mi-estudio', { studyId: s.id }) }, 'Corregir el texto y volver a explicar'),
      h('button', { class: 'btn danger', onclick: () => deleteOwnStudy(s) }, 'Borrar este estudio'))));
}
async function deleteOwnStudy(s) {
  if (!await confirmBox({ title: 'Borrar el estudio', text: 'Se borran el estudio, su explicación y el archivo. No se puede deshacer.', ok: 'Borrar', danger: true })) return;
  try {
    // La marca en file_path permite detectar archivos Debian incluso si un campo
    // de ubicación no llegó al navegador. Nunca enviar una ruta debian: a Storage.
    const path = String(s.file_path || '');
    const markedDebian = path.startsWith('debian:');
    const backend = s.storage_backend;
    const isDebian = backend === 'debian' || markedDebian;
    if (isDebian) {
      const fromPath = markedDebian ? path.slice('debian:'.length) : null;
      const fileId = s.storage_file_id || fromPath;
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!fileId || !uuid.test(fileId) || (s.storage_file_id && fromPath && s.storage_file_id !== fromPath)) {
        throw new Error('La referencia del archivo en Debian es inválida o inconsistente. No se borró el estudio.');
      }
      await archivoDebian('delete', s.id, fileId);
    } else if (backend === 'supabase' || (!backend && !markedDebian)) {
      if (path) {
        const { error: fileError } = await sb.storage.from('estudios').remove([path]);
        if (fileError) throw fileError;
      }
    } else {
      throw new Error('Almacenamiento del estudio desconocido. No se borró el estudio.');
    }
    const { error } = await sb.from('studies').delete().eq('id', s.id);
    if (error) throw error;
    toast('Estudio borrado.');
    go('estudios');
  } catch (error) {
    toast('No se pudo completar la eliminación: ' + errorText(error));
  }
}


// Las solicitudes de archivos pasan por una Edge Function autenticada.
async function archivoDebian(action, studyId, fileId = null, file = null) {
  const body = new FormData();
  body.append('action', action);
  body.append('study_id', studyId);
  if (fileId) body.append('file_id', fileId);
  if (file) body.append('file', file, file.name);
  const { data, error } = await sb.functions.invoke('archivo', { body });
  if (error) throw new Error(await fnError(error));
  return data;
}


/* ---------------- cuatro formas simples de subir un estudio ---------------- */
/* Hecho por ChatGPT · 2026-11-02 · Foto primero, luego PDF, texto o enlace.
   Los enlaces se importan desde el navegador sin cookies ni credenciales; si
   el portal requiere sesión o bloquea CORS, se pide descargar el archivo. */
const STUDY_PENDING_TITLE = 'Estudio por identificar';
const STUDY_UPLOAD_MODES = [
  { id: 'foto', icon: '📷', name: 'Sacar una foto', help: 'Fotografiá el informe con el celular.' },
  { id: 'pdf', icon: '📄', name: 'Subir PDF', help: 'Elegí un PDF que tengas guardado.' },
  { id: 'texto', icon: '📝', name: 'Pegar texto', help: 'Copiá y pegá el informe escrito.' },
  { id: 'enlace', icon: '🔗', name: 'Usar un enlace', help: 'Importá un PDF o una imagen desde un vínculo público.' }
];
function studyUploadFileValid(file, mode) {
  if (!file || !file.size || file.size > MAX_UPLOAD || !UPLOAD_TYPES.includes(file.type)) return false;
  if (mode === 'foto' && !file.type.startsWith('image/')) return false;
  if (mode === 'pdf' && file.type !== 'application/pdf') return false;
  return true;
}
function urlIsImportable(value) {
  try {
    const u = new URL(String(value).trim());
    const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (u.protocol !== 'https:' || u.username || u.password || u.port && u.port !== '443'
      || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')
      || host.endsWith('.internal') || !host.includes('.')
      || /^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes(':')) return false;
    return true;
  } catch { return false; }
}
async function fileFromPublicLink(value) {
  if (!urlIsImportable(value)) throw new Error('Ingresá un enlace HTTPS público válido, sin contraseñas ni direcciones locales.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(String(value).trim(), {
      credentials: 'omit', mode: 'cors', referrerPolicy: 'no-referrer',
      redirect: 'follow', signal: controller.signal
    });
    if (!response.ok || !urlIsImportable(response.url)) throw new Error('El portal no permitió importar el archivo.');
    const headerSize = Number(response.headers.get('content-length') || 0);
    if (headerSize > MAX_UPLOAD) throw new Error('El archivo supera el límite de 20 MB.');
    if (!response.body) throw new Error('El enlace no contiene un archivo que Chely pueda leer.');
    let size = 0;
    const chunks = [], reader = response.body.getReader();
    try {
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        size += chunk.byteLength;
        if (size > MAX_UPLOAD) { await reader.cancel(); throw new Error('El archivo supera el límite de 20 MB.'); }
        chunks.push(chunk);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let pos = 0; for (const chunk of chunks) { bytes.set(chunk,pos);pos+=chunk.length; }
    const isPdf = bytes.length > 5 && String.fromCharCode(...bytes.slice(0,5)) === '%PDF-';
    const isPng = bytes.length > 8 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71;
    const isJpg = bytes.length > 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const isWebp = bytes.length > 12 && String.fromCharCode(...bytes.slice(0,4)) === 'RIFF'
      && String.fromCharCode(...bytes.slice(8,12)) === 'WEBP';
    const mime = isPdf ? 'application/pdf' : isPng ? 'image/png' : isJpg ? 'image/jpeg' : isWebp ? 'image/webp' : null;
    if (!mime) throw new Error('El enlace no entrega directamente un PDF o una foto. Abrí el portal, descargá el informe y subilo desde «Subir PDF» o «Sacar una foto».');
    const ext = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[mime];
    return new File([bytes], 'informe-importado.' + ext, { type: mime });
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('El enlace tardó demasiado en responder. Descargá el archivo desde el portal.');
    if (error instanceof TypeError) throw new Error('Este portal no permite importar directamente el archivo. Abrilo, descargá el PDF o imagen y subilo a Chely.');
    throw error;
  } finally { clearTimeout(timeout); }
}
function studySourceChooser(prefix, draft = {}) {
  let mode = STUDY_UPLOAD_MODES.some(x => x.id === draft.mode) ? draft.mode : 'foto';
  let imported = draft.imported instanceof File ? draft.imported : null;
  const options = h('div', { class: 'study-method-grid', role: 'group', 'aria-label': 'Cómo querés subir tu estudio' });
  const body = h('div', { class: 'study-method-body' });
  const photo = h('input', { type: 'file', id: prefix + '-photo', accept: 'image/jpeg,image/png,image/webp', capture: 'environment' });
  const gallery = h('input', { type: 'file', id: prefix + '-gallery', accept: 'image/jpeg,image/png,image/webp' });
  const pdf = h('input', { type: 'file', id: prefix + '-pdf', accept: '.pdf,application/pdf' });
  const report = h('textarea', { id: prefix + '-text', class: 'report', placeholder: 'Pegá acá el texto del informe…' }, draft.text || '');
  report.addEventListener('input', () => { draft.text = report.value; root.dispatchEvent(new CustomEvent('study-report-input', { detail: { text: report.value } })); });
  const url = h('input', { type: 'url', id: prefix + '-url', placeholder: 'https://portal-medico.com/estudio.pdf', autocomplete: 'off', value: draft.url || '' });
  url.addEventListener('input', () => { imported = null; draft.imported = null; draft.url = url.value; updateFileInfo(); });
  const importInfo = h('div', { class: 'hint', role: 'status', 'aria-live': 'polite' });
  const importButton = h('button', { type: 'button', class: 'btn primary' }, 'Importar archivo del enlace');
  importButton.addEventListener('click', async () => {
    if (!urlIsImportable(url.value)) return toast('Pegá un enlace HTTPS público válido.');
    importButton.disabled = true;
    importInfo.textContent = 'Intentando importar el informe…';
    try {
      imported = await fileFromPublicLink(url.value);
      draft.imported = imported;
      importInfo.textContent = 'Archivo importado: ' + imported.name + '. Ahora podés continuar.';
      updateFileInfo();
    } catch (e) { imported = null; draft.imported = null; importInfo.textContent = errorText(e); }
    finally { importButton.disabled = false; }
  });
  const open = h('button', { type: 'button', class: 'btn quiet sm',
    onclick: () => {
      if (!urlIsImportable(url.value)) return toast('Primero pegá un enlace HTTPS válido.');
      window.open(url.value.trim(), '_blank', 'noopener,noreferrer');
    } }, 'Abrir portal para descargar');
  const buttons = [];
  const panels = {
    foto: h('div', { class: 'study-source-panel' },
      h('p', { class: 'muted' }, 'Usá la cámara para fotografiar el informe o elegí una foto ya guardada. Procurá que se lea todo el texto.'),
      h('div', { class: 'study-photo-options' },
        h('label', { class: 'field', for: prefix + '-photo' }, 'Sacar foto con la cámara', filePicker(photo, 'Abrir cámara')),
        h('label', { class: 'field', for: prefix + '-gallery' }, 'Elegir una foto guardada', filePicker(gallery, 'Elegir foto')))),
    pdf: h('div', { class: 'study-source-panel' },
      h('p', { class: 'muted' }, 'Elegí el informe en PDF. Chely intentará leer su título y fecha automáticamente.'),
      h('label', { class: 'field', for: prefix + '-pdf' }, 'Archivo PDF', filePicker(pdf, 'Elegir PDF'))),
    texto: h('div', { class: 'study-source-panel' },
      h('p', { class: 'muted' }, 'Si pegás solamente el cuerpo del informe, completá el nombre y la fecha debajo.'),
      h('label', { class: 'field', for: prefix + '-text' }, 'Texto del informe', report)),
    enlace: h('div', { class: 'study-source-panel' },
      h('p', { class: 'muted' }, 'Pegá un enlace directo a un PDF o imagen. Si el portal pide usuario o contraseña, abrilo y descargá el archivo desde allí.'),
      h('label', { class: 'field', for: prefix + '-url' }, 'Enlace del portal médico', url),
      h('div', { class: 'row' }, importButton, open), importInfo,
      h('p', { class: 'hint' }, 'Solo se pueden importar enlaces públicos que permitan la descarga. No ingreses contraseñas de portales médicos en Chely.'))
  };
  const selectedInfo = h('p', { class: 'hint', role: 'status', 'aria-live': 'polite' });
  const root = h('div', { class: 'study-source' }, h('h2', {}, '¿Cómo querés enviar tu estudio?'), options, body, selectedInfo);
  const updateFileInfo = () => {
    const selected = mode === 'enlace' ? imported
      : mode === 'foto' ? photo.files?.[0] || gallery.files?.[0] || draft.file
      : mode === 'pdf' ? pdf.files?.[0] || draft.file : null;
    selectedInfo.textContent = selected && mode !== 'texto'
      ? 'Archivo seleccionado: ' + selected.name + '. Se conserva al cambiar de sección en esta pestaña.' : '';
  };
  const render = () => {
    buttons.forEach((button, i) => {
      const active = STUDY_UPLOAD_MODES[i].id === mode;
      button.setAttribute('aria-pressed', String(active));
      button.classList.toggle('active', active);
    });
    body.replaceChildren(panels[mode]);
    draft.mode = mode;
    updateFileInfo();
    root.dispatchEvent(new CustomEvent('study-method-change', { detail: { mode } }));
  };
  STUDY_UPLOAD_MODES.forEach(item => {
    const button = h('button', { type: 'button', class: 'study-method',
      onclick: () => {
        if (mode !== item.id) {
          mode = item.id; imported = null; draft.imported = null; draft.file = null;
          photo.value = ''; gallery.value = ''; pdf.value = '';
        }
        render();
      } },
      h('span', { class: 'study-method-icon', 'aria-hidden': 'true' }, item.icon),
      h('strong', {}, item.name),
      h('span', { class: 'muted small' }, item.help));
    buttons.push(button); options.append(button);
  });
  photo.addEventListener('change', () => {
    if (photo.files?.length) gallery.value = '';
    draft.file = photo.files?.[0] || null; updateFileInfo();
  });
  gallery.addEventListener('change', () => {
    if (gallery.files?.length) photo.value = '';
    draft.file = gallery.files?.[0] || null; updateFileInfo();
  });
  pdf.addEventListener('change', () => { draft.file = pdf.files?.[0] || null; updateFileInfo(); });
  render();
  return {
    root, getMode: () => mode, getText: () => report.value.trim(),
    getFile: () => mode === 'foto' ? (photo.files?.[0] || gallery.files?.[0] || draft.file || null)
      : mode === 'pdf' ? (pdf.files?.[0] || draft.file || null)
      : mode === 'enlace' ? imported : null,
    getLink: () => url.value.trim()
  };
}
/* Hecho por ChatGPT · 2026-11-02 · Metadatos sugeridos tras leer el documento.
   Se solicita confirmación cuando los datos no aparecen explícitos. */
function metadataFromReport(text) {
  // Hecho por ChatGPT · 2026-11-02 · Reconocer nombre y fecha por separado.
  // El encabezado puede identificar el órgano y el procedimiento aunque
  // falte la fecha; NO inferir fecha clínica a partir del día de carga.
  const header = String(text || '').slice(0, 12000);
  const lines = header.split(/\r?\n/).map(x => x.trim()).filter(Boolean).slice(0, 100);
  const top = lines.slice(0, 55).join('\n');
  let title = null;

  // Las etiquetas pueden aparecer en líneas separadas por el OCR.
  const labeled = (label, max = 100) => {
    for (let i = 0; i < Math.min(lines.length, 70); i++) {
      const match = lines[i].match(label);
      if (!match) continue;
      let value = String(match[1] || '').trim();
      if (!value && i + 1 < lines.length) value = lines[i + 1].trim();
      if (value && value.length <= max && !/^(?:observaciones|macroscop[ií]a|microscop[ií]a|diagn[oó]stico|fecha)\s*:/i.test(value))
        return value;
    }
    return '';
  };
  const explicit = labeled(/^(?:tipo de estudio|estudio realizado|pr[aá]ctica|examen|tipo de informe|estudio solicitado)\s*[:\-]\s*(.*)$/i);
  if (explicit) title = explicit;

  // Anatomía patológica: "ÓRGANO: CIEGO / PROCEDIMIENTO: BIOPSIA"
  // no era reconocido por el lector anterior.
  if (!title) {
    const organ = labeled(/^(?:[oó]rgano|localizaci[oó]n anat[oó]mica|sitio de biopsia|tejido)\s*[:\-]\s*(.*)$/i, 65);
    const procedure = labeled(/^(?:procedimiento|tipo de muestra|muestra)\s*[:\-]\s*(.*)$/i, 100);
    const hasBiopsy = /\bbiopsia\b/i.test(procedure) ||
      /\bbiopsia\b/i.test(top);
    const hasPathology = /\b(anatom[ií]a patol[oó]gica|histopatolog[ií]a|anatomopatol[oó]gico)\b/i.test(top);
    if (hasBiopsy) {
      let organName = organ.replace(/^(?:de|del)\s+/i, '')
        .replace(/\s*[,;].*$/, '').trim();
      if (!/^[\p{L}\s-]{2,55}$/u.test(organName)) organName = '';
      title = organName ? 'Biopsia de ' + organName.toLocaleLowerCase('es') : 'Biopsia';
    } else if (hasPathology) title = 'Anatomía patológica';
  }
  if (!title) {
    const types = [
      ['Hemograma',/\bhemograma\b/i],
      ['Análisis de laboratorio',/\b(laboratorio|bioqu[ií]mica|glucemia|perfil lip[ií]dico|colesterol|hematolog[ií]a)\b/i],
      ['Ecografía',/\b(ecograf[ií]a|ecogr[aá]fico|ultrasonido)\b/i],
      ['Radiografía',/\b(radiograf[ií]a|rayos\s*x)\b/i],
      ['Tomografía',/\b(tomograf[ií]a|tomogr[aá]fico|tac)\b/i],
      ['Resonancia magnética',/\b(resonancia magn[eé]tica|rmn)\b/i],
      ['Electrocardiograma',/\b(electrocardiograma|electrocardiogr[aá]fico|ecg)\b/i]
    ];
    title = types.find(([, re]) => re.test(top))?.[0] || null;
  }
  // Priorizar fechas de estudio/realización/informe, no fecha de nacimiento.
  let date = null;
  const pattern = /(?:\bfecha\s*(?:de(?:l)?\s*)?(?:estudio|informe|extracci[oó]n|realizaci[oó]n|an[aá]lisis|toma(?:\s+de\s+muestra)?|emisi[oó]n|procedimiento|muestra|recolecci[oó]n)|\brealizado\s+el|\bfecha\s*[:\-])\s*[:\-]?\s*(\d{1,2}[/.\\-]\d{1,2}[/.\\-]\d{4}|\d{4}-\d{1,2}-\d{1,2})/i;
  for (const line of lines) {
    if (/\bnacimiento\b|f\.?\s*nac\.?/i.test(line)) continue;
    const matched = line.match(pattern);
    if (!matched) continue;
    const candidate = matched[1];
    const iso = candidate.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    const formatted = iso
      ? iso[3].padStart(2, '0') + '/' + iso[2].padStart(2, '0') + '/' + iso[1]
      : candidate.replace(/[.-]/g, '/');
    const parsed = parseDMY(formatted);
    if (parsed && parsed <= todayISO() && parsed >= '1910-01-01') {
      date = parsed; break;
    }
  }
  return { title: title ? title.slice(0, 180) : null, date };
}

/* Hecho por ChatGPT · 2026-11-02 · Sugerencias gratuitas desde el PDF.
   Siempre se puede corregir la sugerencia antes de solicitar la IA. */
function pdfFilenameSuggestion(name) {
  const base = String(name || '').replace(/\.pdf$/i, '');
  const iso = base.match(/(?:^|[_.\s-])(20\d{2})[-_.](0?[1-9]|1[012])[-_.]([0-2]?\d|3[01])(?=$|[_.\s-])/);
  const dmy = base.match(/(?:^|[_.\s-])([0-2]?\d|3[01])[-_.]([01]?\d)[-_.](20\d{2})(?=$|[_.\s-])/);
  const dateText = iso ? iso[3]+'/'+iso[2]+'/'+iso[1] : dmy ? dmy[1]+'/'+dmy[2]+'/'+dmy[3] : '';
  const parsed = parseDMY(dateText);
  const safeDate = parsed && parsed <= todayISO() ? parsed : null;
  let rawTitle = base.replace(/\d{4}[-_.]\d{1,2}[-_.]\d{1,2}|\d{1,2}[-_.]\d{1,2}[-_.]\d{4}/g, ' ')
    .replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (/^(scan|escaneo|documento|archivo|image|img|whatsapp|cam|file|pdf|informe)[\s\d-]*$/i.test(rawTitle)
    || !/[a-záéíóúñ]{3,}/i.test(rawTitle)) rawTitle = '';
  return { title: rawTitle ? rawTitle.slice(0, 150) : null, date: safeDate };
}
async function pdfAutoMetadata(file) {
  const nameData = pdfFilenameSuggestion(file?.name);
  let detected = { title: null, date: null }, text = '';
  let note = 'Chely no pudo leer texto de este PDF. Podrás usar «Leer el archivo» cuando quieras.';
  try {
    if (!window.ChelyPdf) throw new Error('No está disponible el lector local.');
    const local = await window.ChelyPdf.read(file);
    detected = metadataFromReport(local.header);
    // No rellenar con títulos genéricos de exportación ni con metadatos dudosos.
    const pdfTitle = String(local.pdfTitle || '').trim();
    if (!detected.title && pdfTitle.length > 4 &&
        !/^(scan|escaneo|documento|untitled|microsoft word|adobe|informe)\b/i.test(pdfTitle))
      detected.title = pdfTitle.slice(0, 150);
    text = local.complete && local.hasSelectableText ? local.text : '';
    note = local.hasSelectableText
      ? local.complete
        ? 'Chely obtuvo el texto del PDF en tu navegador, sin gastar IA. Revisá los datos.'
        : 'Este PDF es extenso: se sugieren datos, pero necesitarás comprobar el informe completo.'
      : 'El PDF parece escaneado: se guardó sin usar IA. Para leer su texto elegí «Leer el archivo».';
  } catch {
    note = 'No se pudo leer el PDF localmente. Quedará guardado sin IA; podés leerlo más adelante.';
  }
  return {
    title: (detected.title || nameData.title || '').slice(0, 150) || null,
    date: detected.date || nameData.date,
    reportText: text, note
  };
}


// Hecho por ChatGPT · 2026-11-02 · Comprobación exacta de PDF por SHA-256.
// Se calcula localmente en el navegador; no se envía contenido a ninguna IA.
// Sólo se comparan archivos que el propio paciente está autorizado a abrir.
async function chelyFileSha256(blob) {
  if (!(blob instanceof Blob)) throw new Error('No se pudo descargar uno de los archivos.');
  const bytes = await blob.arrayBuffer();
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}
async function chelyStoredOriginal(study) {
  if (study.storage_backend === 'debian') {
    if (!study.storage_file_id) throw new Error('Uno de los estudios en Debian no tiene identificador de archivo.');
    return await archivoDebian('download', study.id, study.storage_file_id);
  }
  if (study.file_path && !String(study.file_path).startsWith('debian:')) {
    const { data, error } = await sb.storage.from('estudios').download(study.file_path);
    if (error || !data) throw error || new Error('No se pudo descargar uno de los estudios.');
    return data;
  }
  throw new Error('Un estudio no tiene un archivo original disponible para comparar.');
}

// El paciente sube un estudio propio.
// Selector de archivo propio: el del navegador muestra sus textos en el idioma del sistema.
function filePicker(input, buttonLabel = 'Elegir archivo') {
  input.className = 'file-input';
  const none = 'Ningún archivo elegido';
  const name = h('span', { class: 'hint' }, none);
  input.addEventListener('change', () => { name.textContent = input.files[0]?.name || none; });
  return h('span', { class: 'filepick' }, input, h('span', { class: 'btn', 'aria-hidden': 'true' }, buttonLabel), name);
}

// Función reservada para futuras cargas masivas; está desactivada en la UI.
// Cambiar a true permite recuperar selección múltiple, carpetas y comparación
// sin perder la implementación existente ni modificar estudios ya cargados.
const CHELY_SHOW_BULK_PDF_UPLOAD = false;

function patientUpload() {
  const m = mainEl();
  if (!uploadDraft) uploadDraft = { title: '', date: null, text: '', file: null, mode: 'foto', url: '' };
  let date = uploadDraft.date || null;
  const currentDraft = uploadDraft;
  const source = studySourceChooser('up', uploadDraft);
  const title = h('input', { type: 'text', id: 'up-title', maxlength: 180,
    placeholder: 'Ej.: Análisis de sangre', value: uploadDraft.title || '' });
  const meta = h('div', { class: 'study-manual-meta grid2' },
    h('label', { class: 'field', for: 'up-title' }, '¿Qué estudio es?', title),
    h('div', { class: 'field' }, h('label', { for: 'up-date', style: 'font-weight:700' }, 'Fecha del estudio'),
      datePicker({ id: 'up-date', value: date, onChange: iso => { date = iso; uploadDraft.date = iso; } })));
  const msg = h('div', { role: 'alert' });
  if (currentDraft.pending) { msg.className = 'alert info'; msg.textContent = 'El estudio sigue cargándose en segundo plano. Podés volver a esta sección para ver el resultado.'; }
  title.addEventListener('input', () => { uploadDraft.title = title.value; });
  const refresh = () => { meta.hidden = source.getMode() !== 'texto'; };
  source.root.addEventListener('study-method-change', refresh);
  source.root.addEventListener('study-report-input', e => {
    const info = metadataFromReport(e.detail.text);
    if (!title.value.trim() && info.title) { title.value = info.title; uploadDraft.title = info.title; }
    if (!date && info.date) {
      date = info.date; uploadDraft.date = info.date;
      meta.querySelector('#up-date').value = fmtDate(info.date);
    }
  });
  refresh();
  const btn = h('button', { class: 'btn primary big', type: 'button' }, 'Continuar con el estudio');
  btn.disabled = !!currentDraft.pending;
  btn.addEventListener('click', async () => {
    if (currentDraft.pending) return toast('Ya hay una carga en curso. Esperá a que termine.');
    msg.className = ''; msg.textContent = '';
    const mode = source.getMode();
    const f = source.getFile();
    const pasted = source.getText();
    if (mode === 'texto') {
      if (!pasted) { msg.className = 'alert bad'; msg.textContent = 'Pegá el texto del informe.'; return; }
      if (title.value.trim().length < 2 || !date) {
        msg.className = 'alert bad'; msg.textContent = 'Completá el nombre y la fecha del informe.'; return;
      }
    } else {
      if (!f) {
        msg.className = 'alert bad';
        msg.textContent = mode === 'enlace' ? 'Primero importá el archivo desde el enlace o descargalo desde el portal.'
          : 'Elegí una foto o archivo PDF para continuar.';
        return;
      }
      if (!studyUploadFileValid(f,mode)) {
        msg.className = 'alert bad'; msg.textContent = 'El archivo debe ser PDF o una imagen válida de hasta 20 MB.'; return;
      }
    }
    currentDraft.pending = true;
    const navAtStart = navigationEpoch;
    const ownerAtStart = state.me.id;
    btn.disabled = true; btn.replaceChildren(h('span', { class: 'spinner' }), ' Guardando…');
    try {
      const autoMetadata = mode !== 'texto';
      if (autoMetadata && /\.pdf$/i.test(f.name)) {
        msg.className = 'alert info';
        msg.textContent = 'Revisando el PDF en este dispositivo para identificar nombre y fecha, sin IA…';
      }
      const guess = autoMetadata && /\.pdf$/i.test(f.name)
        ? await pdfAutoMetadata(f) : null;
      const detectedBoth = !!(guess?.title && guess?.date);
      // Nunca colocar una fecha inventada como si fuera la fecha del análisis.
      // El marcador de título pendiente obliga a revisarlos si falta cualquiera.
      const { data: st, error } = await sb.from('studies').insert({
        patient_id: state.me.id, doctor_id: null, self_uploaded: true,
        title: autoMetadata && !detectedBoth ? STUDY_PENDING_TITLE
          : autoMetadata ? guess.title : title.value.trim(),
        study_date: autoMetadata ? (guess?.date || todayISO()) : date,
        report_text: autoMetadata ? (guess?.reportText || '') : pasted
      }).select('id').single();
      if (error || !st) throw error || new Error('No se pudo crear el estudio.');
      if (autoMetadata) {
        try { await archivoDebian('upload', st.id, null, f); }
        catch (e) { throw new Error('El estudio fue creado, pero falló la carga del archivo: ' +
          errorText(e) + '. Podés volver a la lista y corregirlo.'); }
      }
      if (uploadDraft === currentDraft) clearUploadDraft();
      if (state.me?.id === ownerAtStart && state.page === 'subir'
          && navigationEpoch === navAtStart) {
        go('mi-estudio', { studyId: st.id, autoExplain: false });
      } else {
        if (state.me?.id === ownerAtStart)
          toast('El estudio terminó de subirse y está disponible en Mis estudios.');
        if (state.page === 'subir') render();
      }
    } catch (e) {
      msg.className = 'alert bad'; msg.textContent = errorText(e);
      if (state.page !== 'subir' || navigationEpoch !== navAtStart) toast('No se pudo completar la carga: ' + errorText(e));
    } finally {
      currentDraft.pending = false;
      btn.disabled = false; btn.textContent = 'Continuar con el estudio';
      if (state.page === 'subir' && navigationEpoch !== navAtStart) render();
    }
  });
  m.append(h('div', { class: 'row' },
    h('button', { class: 'btn quiet sm', onclick: () => go('estudios') }, '‹ Mis estudios')));
  m.append(h('div', { class: 'card' },
    h('h1', {}, 'Subir un estudio'),
    h('p', { class: 'muted' }, 'Elegí la forma más fácil para vos. Chely lee informes escritos, no interpreta imágenes diagnósticas como radiografías o placas.'),
    source.root, meta,
    h('p', { class: 'hint study-file-guidance' },
      'Para PDF con texto, Chely intentará obtener nombre, fecha e informe al subirlo, sin IA. Si el documento es una imagen escaneada, podés usar «Leer el archivo» después.'),
    msg, h('div', { class: 'row' }, btn)));

  // La importación masiva se conserva inactiva hasta volver a necesitarla.
  if (CHELY_SHOW_BULK_PDF_UPLOAD) {
  // Hecho por ChatGPT · 2026-11-02 · Importacion de muchos PDF.
  // Cada archivo queda independiente y NO se ejecuta transcripcion ni explicacion.
  const bulkFiles = h('input', { type: 'file', accept: 'application/pdf,.pdf', multiple: true,
    id: 'bulk-pdf-files' });
  // webkitdirectory está disponible en Chrome/Edge y la mayoría de navegadores
  // modernos; filtrar por extensión después de seleccionar la carpeta.
  const bulkFolder = h('input', { type: 'file', multiple: true, webkitdirectory: true,
    directory: true, id: 'bulk-pdf-folder' });
  let selectedBatch = [];
  let verifiedMissing = null;
  let comparisonAttempted = false;
  let comparisonRunning = false;
  let stopComparisonRequested = false;
  const comparisonInfo = h('p', { role: 'status', 'aria-live': 'polite', class: 'hint' });
  const missingList = h('div', { class: 'stack', 'aria-label': 'PDF faltantes' });
  const bulkState = h('p', { role: 'status', 'aria-live': 'polite', class: 'hint' },
    'Elegí varios PDF o una carpeta. Hasta 150 documentos, de máximo 20 MB cada uno.');
  const chooseBatch = files => {
    const all = Array.from(files || []);
    verifiedMissing = null;
    comparisonAttempted = false;
    missingList.replaceChildren();
    comparisonInfo.textContent = '';
    bulkButton.textContent = 'Guardar todos los PDF seleccionados';
    bulkButton.disabled = false;
    selectedBatch = all.filter(file => /\.pdf$/i.test(file.name));
    bulkState.textContent = selectedBatch.length + ' PDF seleccionados' +
      (all.length > selectedBatch.length ? ' (' + (all.length-selectedBatch.length) + ' archivos no PDF omitidos)' : '') +
      '. Al guardar, Chely intentará obtener nombre, fecha y texto del PDF sin IA.';
  };
  bulkFiles.addEventListener('change', () => { bulkFolder.value = ''; chooseBatch(bulkFiles.files); });
  bulkFolder.addEventListener('change', () => { bulkFiles.value = ''; chooseBatch(bulkFolder.files); });
  const bulkButton = h('button', { type: 'button', class: 'btn primary' }, 'Guardar todos los PDF seleccionados');
  const compareButton = h('button', { type: 'button', class: 'btn' },
    'Comparar carpeta con lo que ya subí');
  const stopCompareButton = h('button', { type: 'button', class: 'btn quiet', hidden: true },
    'Detener comparación');
  stopCompareButton.addEventListener('click', () => {
    stopComparisonRequested = true;
    stopCompareButton.disabled = true;
    comparisonInfo.textContent = 'Se detendrá la comparación después del archivo actual.';
  });
  compareButton.addEventListener('click', async () => {
    if (comparisonRunning || activeBatch) return;
    const chosen = selectedBatch.slice();
    if (!chosen.length) return toast('Primero elegí la carpeta original o los PDF que querés comparar.');
    if (chosen.length > 150 || chosen.some(f => !studyUploadFileValid(f, 'pdf')))
      return toast('Seleccioná hasta 150 PDF válidos de 20 MB como máximo cada uno.');
    const allowed = await confirmBox({
      title: 'Comparar archivos sin usar IA',
      text: 'Chely descargará temporalmente los originales que ya tenés guardados para comparar sus huellas SHA-256 con esta carpeta. No gastará IA, no borrará ni subirá archivos. Puede tardar unos minutos.',
      ok: 'Comparar ahora'
    });
    if (!allowed) return;
    comparisonRunning = true;
    comparisonAttempted = true;
    stopComparisonRequested = false;
    verifiedMissing = null;
    missingList.replaceChildren();
    bulkButton.textContent = 'Guardar todos los PDF seleccionados';
    bulkButton.disabled = true;
    compareButton.disabled = true;
    bulkFiles.disabled = true;
    bulkFolder.disabled = true;
    stopCompareButton.hidden = false;
    stopCompareButton.disabled = false;
    const ownerId = state.me?.id;
    const navigationAtStart = navigationEpoch;
    try {
      const { data: stored, error } = await sb.from('studies')
        .select('id,file_path,storage_backend,storage_file_id,file_name')
        .eq('patient_id', ownerId).eq('self_uploaded', true).limit(1000);
      if (error) throw error;
      if (!Array.isArray(stored) || stored.length >= 1000)
        throw new Error('Hay demasiados estudios para comparar en una sola operación.');
      const savedHashes = new Map();
      for (let i = 0; i < stored.length; i++) {
        if (stopComparisonRequested || state.me?.id !== ownerId || state.page !== 'subir'
            || navigationEpoch !== navigationAtStart)
          throw new Error('Comparación detenida sin modificar ningún archivo.');
        comparisonInfo.textContent = 'Comprobando archivo guardado ' +
          (i + 1) + ' de ' + stored.length + '…';
        // Si no se puede leer siquiera uno, no afirmar que los demás faltan.
        const hash = await chelyFileSha256(await chelyStoredOriginal(stored[i]));
        savedHashes.set(hash, (savedHashes.get(hash) || 0) + 1);
      }
      const missing = [];
      for (let i = 0; i < chosen.length; i++) {
        if (stopComparisonRequested || state.me?.id !== ownerId || state.page !== 'subir'
            || navigationEpoch !== navigationAtStart)
          throw new Error('Comparación detenida sin modificar ningún archivo.');
        comparisonInfo.textContent = 'Comparando PDF de tu carpeta ' +
          (i + 1) + ' de ' + chosen.length + '…';
        const hash = await chelyFileSha256(chosen[i]);
        const remaining = savedHashes.get(hash) || 0;
        if (remaining > 0) savedHashes.set(hash, remaining - 1);
        else missing.push(chosen[i]);
      }
      // Se mantiene el multiconjunto de huellas: distingue PDF con el mismo
      // nombre, y también dos copias con el mismo contenido.
      verifiedMissing = missing;
      compareButton.disabled = false;
      bulkButton.disabled = missing.length === 0;
      bulkButton.textContent = missing.length
        ? 'Guardar solo los ' + missing.length + ' faltantes'
        : 'No hay PDF faltantes';
      comparisonInfo.textContent = 'Comparación exacta terminada: ' +
        chosen.length + ' PDF seleccionados, ' + stored.length + ' archivos guardados, ' +
        missing.length + ' PDF faltantes en Chely. No se utilizó IA.';
      if (missing.length) {
        missingList.append(h('h3', {}, 'Archivos que faltan (' + missing.length + ')'));
        missing.forEach(file => missingList.append(h('p', { class: 'muted small' },
          file.webkitRelativePath || file.name)));
      } else missingList.append(h('p', { class: 'muted' },
        'Todos los archivos seleccionados tienen una copia idéntica registrada en Chely.'));
    } catch (error) {
      verifiedMissing = null;
      bulkButton.textContent = 'Volvé a comparar antes de guardar';
      // No ofrecer una lista incompleta si falla algún archivo o la conexión.
      comparisonInfo.textContent = 'No se pudo completar la comparación: ' +
        errorText(error) + ' No se modificaron ni subieron archivos.';
    } finally {
      comparisonRunning = false;
      stopCompareButton.hidden = true;
      compareButton.disabled = false;
      bulkFiles.disabled = false;
      bulkFolder.disabled = false;
      // Nunca habilitar la carga masiva original si falla la comprobación.
      if (verifiedMissing === null) bulkButton.disabled = comparisonAttempted;
    }
  });
  let activeBatch = false;
  bulkButton.addEventListener('click', async () => {
    if (activeBatch) return;
    if (comparisonRunning) return toast('Primero esperá a que termine la comparación.');
    const files = verifiedMissing !== null ? verifiedMissing.slice() : selectedBatch.slice();
    if (!files.length || files.length > 150) return toast('Seleccioná entre 1 y 150 archivos PDF.');
    if (files.some(file => !studyUploadFileValid(file, 'pdf')))
      return toast('Cada documento debe ser un PDF válido de hasta 20 MB.');
    activeBatch = true; bulkButton.disabled = true; bulkFiles.disabled = true; bulkFolder.disabled = true;
    let completed = 0;
    let failed = 0;
    let temporaryFallback = false;
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        bulkState.textContent = 'Guardando PDF ' + (i + 1) + ' de ' + files.length +
          ': ' + file.name + '. No cierres ni actualices esta pestaña.';
        try {
          bulkState.textContent = 'Leyendo PDF ' + (i + 1) + ' de ' + files.length +
            ': ' + file.name + ' (sin IA)…';
          const guess = await pdfAutoMetadata(file);
          const detectedBoth = !!(guess.title && guess.date);
          const { data: st, error } = await sb.from('studies').insert({
            patient_id: state.me.id, doctor_id: null, self_uploaded: true,
            title: detectedBoth ? guess.title : STUDY_PENDING_TITLE,
            study_date: guess.date || todayISO(), report_text: guess.reportText || ''
          }).select('id').single();
          if (error || !st) throw error || new Error('No se pudo crear el estudio.');
          // Si falla el guardado, se conserva el registro para recuperarlo;
          // no reintentar automaticamente ni duplicar un PDF.
          const uploadResult = await archivoDebian('upload', st.id, null, file);
          completed++;
          // Si el servidor Debian deja de responder, no llenar Storage de
          // Supabase con todo el lote por el respaldo automatico de emergencia.
          if (uploadResult?.temporary && uploadResult?.storage_backend === 'supabase') {
            temporaryFallback = true;
            break;
          }
        } catch (error) {
          failed++;
          console.warn('Fallo una carga PDF del lote:', file.name, errorText(error));
        }
      }
      bulkState.textContent = (temporaryFallback
        ? 'Se detuvo el lote porque Debian no está disponible. Un PDF quedó guardado temporalmente en Supabase. '
        : 'Terminó la carga. ') +
        completed + ' PDF guardados y ' + failed + ' con errores. No se utilizó IA. ' +
        (temporaryFallback ? 'Revisá la conexión a Debian antes de continuar.' :
          failed ? 'Revisá Mis estudios antes de volver a intentar los fallidos.' :
          'Podés consultar cada estudio en Mis estudios.');
      if (completed) toast(completed + ' PDF guardados sin usar IA.');
    } finally {
      activeBatch = false;
      // Para volver a subir archivos, seleccionar otra vez y comparar.
      verifiedMissing = null; selectedBatch = [];
      bulkFiles.value = ''; bulkFolder.value = '';
      bulkButton.textContent = 'Guardar todos los PDF seleccionados';
      comparisonAttempted = false;
      bulkButton.disabled = false;
      bulkFiles.disabled = false; bulkFolder.disabled = false;
      compareButton.disabled = false;
    }
  });
  const batchCard = h('div', { class: 'card' },
    h('h2', {}, 'Subir varios PDF o una carpeta'),
    h('p', { class: 'muted small' }, 'Si ya subiste parte de una carpeta, seleccioná la carpeta completa y tocá «Comparar carpeta». Chely identificará los PDF faltantes por su contenido, aunque tengan nombres repetidos. No gastará IA ni volverá a subir los existentes. Para cargas nuevas, podés guardar todos los seleccionados.'),
    h('div', { class: 'grid2' },
      h('label', { class: 'field', for: 'bulk-pdf-files' }, 'Elegir varios PDF', bulkFiles),
      h('label', { class: 'field', for: 'bulk-pdf-folder' }, 'Elegir una carpeta completa', bulkFolder)),
    bulkState,
    h('div', { class: 'row' }, compareButton, stopCompareButton, bulkButton),
    comparisonInfo, missingList);
  // Mostrar el lote antes del formulario individual para que sea fácil encontrarlo.
  m.insertBefore(batchCard, m.children[1] || null);
  }
}

// Estudio propio sin explicar: revisar el texto y pedir la explicación.
async function patientOwnStudy() {
  // Se toma y se apaga antes de esperar nada: si la pantalla se vuelve a dibujar, no explica dos veces.
  const autoExplain = state.autoExplain; state.autoExplain = false;
  loading();
  let studies;
  try { studies = await loadPatientStudies(); } catch (e) { return showError(e, patientOwnStudy); }
  const s = studies.find(x => x.id === state.studyId && x.self_uploaded);
  if (!s) { toast('No encontramos ese estudio.'); return go('estudios'); }
  const m = mainEl();
  // Hecho por ChatGPT · 2026-11-02 · Conservar correcciones no guardadas
  // cuando se pasa a otra sección, sólo en memoria de la pestaña.
  const editKey = 'self:' + s.id;
  const savedDraft = studyEditDrafts.get(editKey);
  const suggestion = s.title === STUDY_PENDING_TITLE
    ? metadataFromReport(s.report_text || '') : null;
  const fallback = s.title === STUDY_PENDING_TITLE
    ? pdfFilenameSuggestion(s.file_name || '') : null;
  const editDraft = savedDraft || { report: s.report_text || '',
    title: s.title === STUDY_PENDING_TITLE
      ? (suggestion?.title || fallback?.title || '') : s.title,
    date: s.title === STUDY_PENDING_TITLE
      ? (suggestion?.date || fallback?.date || (s.study_date !== todayISO() ? s.study_date : null))
      : s.study_date };
  studyEditDrafts.set(editKey, editDraft);
  const report = h('textarea', { id: 'own-report', class: 'report' }, editDraft.report);
  report.addEventListener('input', () => { editDraft.report = report.value; });
  const status = h('div', { role: 'status' });
  // Hecho por ChatGPT · 2026-11-02 · El archivo se lee y propone título y fecha;
  // si no se detectan, se solicitan antes de generar la explicación.
  const pending = s.title === STUDY_PENDING_TITLE;
  const metaTitle = h('input', { type: 'text', id: 'own-title', maxlength: 180,
    value: editDraft.title, placeholder: 'Ej.: Ecografía abdominal' });
  metaTitle.addEventListener('input', () => { editDraft.title = metaTitle.value; });
  let selectedDate = editDraft.date;
  const metaPicker = datePicker({ id: 'own-date', value: selectedDate,
    onChange: iso => { selectedDate = iso; editDraft.date = iso; } });
  const metadataNote = h('p', { class: 'hint', role: 'status' },
    pending ? (editDraft.title && !editDraft.date
      ? 'Chely reconoció el tipo de estudio, pero falta confirmar su fecha. El título ya está propuesto arriba.'
      : 'Chely intentó reconocer los datos del PDF sin gastar IA. Revisá el nombre y la fecha antes de guardar.')
      : 'Podés corregir el nombre y la fecha antes de explicar el estudio.');
  const saveMetadata = async () => {
    const name = metaTitle.value.trim();
    if (name.length < 2 || !selectedDate || selectedDate > todayISO()) {
      status.className = 'alert bad';
      status.textContent = name.length < 2
        ? 'No pudimos identificar el tipo de estudio. Revisá el nombre antes de continuar.'
        : !selectedDate
          ? 'El nombre del estudio ya está reconocido. Falta confirmar la fecha del informe.'
          : 'La fecha del estudio no es válida. Revisala antes de continuar.';
      return false;
    }
    const { error } = await sb.from('studies').update({ title: name, study_date: selectedDate }).eq('id', s.id);
    if (error) { status.className = 'alert bad'; status.textContent = errorText(error); return false; }
    s.title = name; s.study_date = selectedDate;
    editDraft.title = name; editDraft.date = selectedDate;
    return true;
  };
  const busy = (btn, label) => { btn.disabled = true; const old = btn.textContent; btn.replaceChildren(h('span', { class: 'spinner' }), ' ' + label); return () => { btn.disabled = false; btn.textContent = old; }; };
  const saveText = async () => {
    const { error } = await sb.from('studies').update({ report_text: report.value.trim() }).eq('id', s.id);
    if (error) { toast(errorText(error)); return false; }
    s.report_text = report.value.trim();
    editDraft.report = report.value; return true;
  };
  const readBtn = h('button', { class: 'btn' }, 'Leer y guardar sin explicar');
  const explainBtn = h('button', { class: 'btn primary big' }, 'Explicar mi estudio');
  const saveWithoutAI = h('button', { class: 'btn', type: 'button' }, 'Guardar datos sin explicar');
  saveWithoutAI.addEventListener('click', async () => {
    saveWithoutAI.disabled = true;
    try {
      if (!await saveText()) return;
      if (!metaTitle.value.trim() || !selectedDate) {
        status.className = 'alert warn';
        status.textContent = 'El texto quedó guardado sin explicar. ' +
          (!selectedDate ? 'Falta confirmar la fecha del estudio.' : 'Falta confirmar el nombre del estudio.');
        return;
      }
      if (!await saveMetadata()) return;
      status.className = 'alert ok';
      status.textContent = 'Datos y texto guardados sin usar IA. Podés continuar con otro estudio y pedir la explicación cuando quieras.';
    } finally { saveWithoutAI.disabled = false; }
  });
  const readFile = async () => {
    status.className = 'alert info'; status.textContent = 'Chely está leyendo tu archivo. Puede tardar un minuto; no cierres esta pantalla.';
    const done = busy(readBtn, 'Leyendo el archivo…');
    const { data, error } = await pendingOnce(runningStudyReads, 'adult:'+s.id,
      () => sb.functions.invoke('ia', { body: { action: 'transcribir', study_id: s.id, force: !!s.report_text } }));
    done();
    if (error) { status.className = 'alert bad'; status.textContent = await fnError(error); return false; }
    report.value = data.text;
    editDraft.report = report.value;
    if (s.title === STUDY_PENDING_TITLE) {
      const suggested = metadataFromReport(data.text);
      if (suggested.title) { metaTitle.value = suggested.title; editDraft.title = suggested.title; }
      if (suggested.date) {
        selectedDate = suggested.date; editDraft.date = selectedDate;
        metaPicker.querySelector('input').value = fmtDate(suggested.date);
      }
      metadataNote.textContent = suggested.title && suggested.date
        ? 'Chely sugirió estos datos del informe. Confirmá que sean correctos antes de explicar.'
        : 'No encontramos con seguridad todos los datos. Completá el nombre y la fecha antes de explicar.';
    }
    return saveText();
  };
  readBtn.addEventListener('click', async () => {
    if (!await readFile()) return;
    status.className = 'alert ok'; status.textContent = 'Listo, Chely leyó y guardó el texto. Revisá el nombre y la fecha del estudio. Podés pedir la explicación cuando quieras.';
  });
  const explainStudy = async () => {
    const navAtStart = navigationEpoch;
    if (!report.value.trim()) { status.className = 'alert bad'; status.textContent = 'Falta el texto del informe. Tocá «Leer el archivo» o pegalo.'; return; }
    // Con archivo y un texto tan corto, seguramente falta leer el archivo.
    if (s.file_path && report.value.trim().length < 40) { status.className = 'alert bad'; status.textContent = 'El texto es muy corto para ser el informe completo. Tocá «Leer el archivo» y después «Explicar mi estudio».'; return; }
    if (!await saveText() || !await saveMetadata()) return;
    status.className = 'alert info'; status.textContent = 'Chely está escribiendo la explicación de tu estudio. Puede tardar hasta dos minutos; no cierres esta pantalla.';
    const done = busy(explainBtn, 'Escribiendo la explicación…');
    const { data, error } = await pendingOnce(runningStudyExplanations, 'adult:'+s.id,
      () => sb.functions.invoke('ia', { body: { action: 'explicar', study_id: s.id, force: false } }));
    if (error) { done(); status.className = 'alert bad'; status.textContent = await fnError(error); return; }
    const explanation = (data.aviso_urgente ? `## Aviso importante del informe\n${data.aviso_urgente}\n\n` : '') + data.explicacion;
    const { error: e2 } = await sb.from('studies').update({ explanation, glossary: data.glosario || [], lab_values: data.valores || [],
      ai_model: data.model, ai_generated_at: new Date().toISOString(), status: 'publicado' }).eq('id', s.id);
    done();
    if (e2) { status.className = 'alert bad'; status.textContent = errorText(e2); return; }
    studyEditDrafts.delete(editKey);
    if (state.page === 'mi-estudio' && state.studyId === s.id
      && navigationEpoch === navAtStart) go('estudio', { studyId: s.id });
    else toast('Chely terminó de explicar el estudio. Ya está en Mis estudios.');
  };
  explainBtn.addEventListener('click', explainStudy);
  m.append(h('div', { class: 'row' }, h('button', { class: 'btn quiet sm', onclick: () => go('estudios') }, '‹ Mis estudios')));
  m.append(h('div', { class: 'card' },
    h('h1', {}, pending ? 'Revisar datos del informe' : s.title),
    h('div', { class: 'grid2' },
      h('label', { class: 'field', for: 'own-title' }, 'Nombre del estudio', metaTitle),
      h('div', { class: 'field' }, h('label', { for: 'own-date' }, 'Fecha del estudio'), metaPicker)),
    metadataNote,
    s.file_path ? h('div', { class: 'row' }, h('span', { class: 'grow muted' }, 'Archivo: ' + (s.file_name || 'informe')), h('button', { class: 'btn quiet sm', onclick: () => openOriginal(s) }, 'Ver archivo'), readBtn) : null,
    h('label', { class: 'field', for: 'own-report' }, 'Texto del informe ', h('span', { class: 'hint' }, 'Es lo que lee Chely. Revisá que esté completo y sin errores.'), report),
    status,
    h('div', { class: 'row' }, saveWithoutAI, explainBtn),
    h('p', { class: 'muted small' }, 'La explicación la escribe una inteligencia artificial y no la revisa un médico. Puede tener errores: llevala a tu consulta.'),
    h('div', { class: 'row' }, h('button', { class: 'btn danger sm', onclick: () => deleteOwnStudy(s) }, 'Borrar este estudio'))));
  // Hecho por ChatGPT · 2026-11-02 · Nunca llamar a IA al entrar ni al subir.
  // La lectura y explicación se inician únicamente por sus botones.
  if (autoExplain) status.scrollIntoView({ block: 'center' });
}

/* Hecho por ChatGPT · 2026-11-02 · Compartir un estudio por documento independiente:
   no se incluyen credenciales, referencias privadas de Storage ni enlaces al perfil. */
function studyCopyText(study) {
  const date = study.study_date ? fmtDate(study.study_date) : 'Sin fecha';
  return [
    'CHELY — COPIA DE UN ESTUDIO',
    'Estudio: ' + (study.title || 'Sin título'),
    'Fecha del estudio: ' + date,
    '',
    'INFORME ESCRITO',
    String(study.report_text || 'El informe original está en un archivo adjunto no incluido en esta copia.'),
    '',
    'EXPLICACIÓN EN PALABRAS CLARAS',
    String(study.explanation || 'Sin explicación disponible.'),
    study.doctor_note ? '\nNOTA DEL PROFESIONAL\n' + String(study.doctor_note) : '',
    '',
    'Esta copia no concede acceso a Chely ni incluye archivos originales o el perfil del paciente.',
    'Las explicaciones por inteligencia artificial pueden contener errores y no sustituyen la consulta médica.'
  ].join('\n');
}
async function shareStudyCopy(study) {
  if (!navigator.share) return toast('Tu navegador no permite enviar archivos. Usá «Guardar como PDF» para compartirlo.');
  if (!await confirmBox({ title: 'Compartir una copia del estudio',
    text: 'Se enviarán únicamente el informe escrito y su explicación a la aplicación que elijas. No se incluirá ningún acceso a tu cuenta. Una copia enviada no se puede revocar.',
    ok: 'Elegir destinatario' })) return;
  const content = studyCopyText(study);
  const file = new File([content], 'chely-estudio.txt', { type: 'text/plain;charset=utf-8' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: study.title || 'Estudio de Chely' });
    } else {
      await navigator.share({ title: study.title || 'Estudio de Chely', text: content });
    }
  } catch (error) {
    if (error.name !== 'AbortError') toast('No se pudo compartir. Probá guardar una copia en PDF.');
  }
}
function printStudyCopy(study) {
  const win = window.open('', '_blank');
  if (!win) return toast('El navegador bloqueó la ventana. Permití ventanas emergentes para guardar el PDF.');
  win.opener = null;
  const d = win.document;
  d.open();
  d.write('<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Estudio médico · Chely</title>' +
    '<meta name="referrer" content="no-referrer"><style>' +
    'body{font-family:Arial,sans-serif;line-height:1.55;color:#182c2b;max-width:760px;margin:36px auto;padding:0 24px}' +
    'h1{font-size:24px;color:#087a75}h2{font-size:16px;border-bottom:1px solid #ccc;padding-bottom:5px;margin-top:28px}' +
    'article{white-space:pre-wrap;overflow-wrap:anywhere}small{color:#555}footer{margin-top:36px;border-top:1px solid #ccc;padding-top:12px}' +
    '@media print{body{margin:12mm auto;padding:0}h2{break-after:avoid}}' +
    '</style></head><body></body></html>');
  d.close();
  const add = (tag, value, parent=d.body) => {
    const el = d.createElement(tag);
    el.textContent = String(value || '');
    parent.append(el);
    return el;
  };
  add('h1', 'Chely · Copia de un estudio');
  add('h2', study.title || 'Estudio');
  add('small', 'Fecha del estudio: ' + (study.study_date ? fmtDate(study.study_date) : 'Sin fecha'));
  add('h2', 'Informe escrito');
  add('article', study.report_text || 'El archivo original no está incluido en esta copia. Podés enviarlo por separado.');
  add('h2', 'Explicación en palabras claras');
  add('article', study.explanation || 'Sin explicación disponible.');
  if (study.doctor_note) {
    add('h2', 'Nota del profesional');
    add('article', study.doctor_note);
  }
  const foot = d.createElement('footer');
  add('small', 'Copia independiente del perfil Chely. No incluye acceso a la cuenta ni archivos originales. ' +
    'Una vez enviada, no puede revocarse. La explicación no reemplaza la consulta médica.', foot);
  d.body.append(foot);
  win.focus();
  try { win.print(); } catch {
    toast('Se abrió la copia. Usá Imprimir → Guardar como PDF.');
  }
}

// Lo que ve el paciente. El médico usa la misma vista como vista previa.
function studyView(s, doctorName, allStudies, preview) {
  const parts = [];
  const head = h('div', { class: 'card' },
    h('div', { class: 'row' }, h('h1', { class: 'grow' }, s.title), h('span', { class: 'pill' }, fmtDate(s.study_date))),
    h('p', { class: 'muted small' }, s.self_uploaded ? `Subido por vos · explicado por Chely el ${fmtDate((s.ai_generated_at || s.published_at || '').slice(0, 10))}` : `Revisado por ${doctorName || 'tu médico'}${s.published_at ? ' · ' + fmtDate(s.published_at) : ''}`));
  if (s.self_uploaded) head.append(h('div', { class: 'alert warn' }, h('strong', {}, 'Explicación hecha por inteligencia artificial, sin revisión médica.'), h('span', {}, 'Puede tener errores. Usala para entender tu estudio y preparar tus preguntas, y llevala a tu consulta.')));
  if (s.doctor_note) head.append(h('div', { class: 'note' }, h('strong', {}, (doctorName || 'Tu médico') + ': '), s.doctor_note));
  head.append(renderExplanation(s.explanation, s.glossary));
  head.append(h('p', { class: 'muted small' }, 'Tocá las palabras subrayadas para ver qué significan. Esta explicación no reemplaza la consulta.'));
  if (!preview) {
    const fb = h('div', { class: 'feedback' });
    const paintFb = val => {
      fb.innerHTML = '';
      if (val) { fb.append(h('b', {}, 'Gracias por responder. Nos ayuda a mejorar.')); return; }
      fb.append(h('b', {}, '¿Se entendió la explicación?'));
      for (const [v, l] of [['si', 'Sí'], ['mas_o_menos', 'Más o menos'], ['no', 'No']]) fb.append(h('button', { class: 'btn quiet sm', onclick: async () => {
        const { error } = await sb.rpc('give_feedback', { p_study: s.id, p_value: v });
        if (error) return toast(errorText(error));
        s.feedback = v; paintFb(v);
      } }, l));
    };
    paintFb(s.feedback);
    head.append(fb);
  }
  parts.push(head);
  // Hecho por ChatGPT · 2026-11-02 · El paciente entrega sólo este estudio, nunca acceso a su perfil.
  if (!preview) parts.push(h('div', { class: 'card' },
    h('h2', {}, 'Compartir este estudio'),
    h('p', { class: 'muted small' }, 'Podés mandar una copia de este estudio sin darle acceso a tu cuenta ni al resto de tus informes.'),
    h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'button', onclick: () => printStudyCopy(s) }, 'Guardar como PDF'),
      typeof navigator.share === 'function' ? h('button', { class: 'btn quiet', type: 'button',
        onclick: () => shareStudyCopy(s) }, 'Enviar copia') : null),
    h('p', { class: 'hint' }, 'La copia incluye el informe escrito y la explicación, pero no adjunta automáticamente el archivo original. Para enviar el original usá el botón de abajo.')));
  const vals = renderValues(s.lab_values); if (vals) parts.push(vals);
  const evo = renderEvolution(allStudies.filter(x => x.lab_values && x.lab_values.length)); if (evo) parts.push(evo);
  if (s.file_path && !preview) parts.push(h('div', { class: 'card' }, h('h2', {}, 'Informe original'),
    h('div', { class: 'row' }, h('span', { class: 'grow muted' }, s.file_name || 'Archivo'), h('button', { class: 'btn', onclick: () => openOriginal(s) }, 'Ver el original'))));
  return parts;
}
async function openOriginal(s) {
  if (s.storage_backend === 'debian') {
    if (!s.storage_file_id) return toast('Este estudio no tiene archivo registrado.');
    try {
      const blob = await archivoDebian('download', s.id, s.storage_file_id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = s.file_name || 'estudio-original';
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      sb.rpc('log_study_access', { p_study: s.id, p_action: 'original_descargado' });
    } catch (e) { toast('No se pudo descargar el archivo: ' + errorText(e)); }
    return;
  }
  const win = window.open('', '_blank');
  const { data, error } = await sb.storage.from('estudios').createSignedUrl(s.file_path, 300);
  if (error || !data) { if (win) win.close(); return toast('No se pudo abrir el archivo. Probá de nuevo.'); }
  sb.rpc('log_study_access', { p_study: s.id, p_action: 'original_descargado' });
  if (win) win.location = data.signedUrl; else location.href = data.signedUrl;
}
async function patientDoctors() {
  loading();
  const { data: links, error } = await sb.from('care_links').select('doctor_id, active, created_at, ended_at').eq('patient_id', state.me.id).order('created_at');
  if (error) return showError(error, patientDoctors);
  const names = await namesFor(links.filter(l => l.active).map(l => l.doctor_id));
  const m = mainEl();
  const card = h('div', { class: 'card' }, h('h1', {}, 'Mis médicos'), h('p', { class: 'muted' }, 'Estos médicos pueden enviarte estudios y ver los que te enviaron. Si dejás de compartir, ya no van a poder verlos.'));
  const active = links.filter(l => l.active);
  if (!active.length) card.append(h('p', { class: 'muted' }, 'No tenés médicos vinculados.'));
  for (const l of active) card.append(h('div', { class: 'item', style: 'cursor:default' }, h('div', { class: 'row' }, h('h3', {}, names[l.doctor_id] || 'Médico'), h('span', { class: 'muted small grow' }, 'Desde ' + fmtDate(l.created_at)),
    h('button', { class: 'btn danger sm', onclick: async () => {
      if (!await confirmBox({ title: 'Dejar de compartir', text: `${names[l.doctor_id] || 'Este médico'} ya no va a poder ver tus estudios ni enviarte nuevos. Tus estudios no se borran.`, ok: 'Dejar de compartir', danger: true })) return;
      const { error: e } = await sb.rpc('end_care_link', { p_doctor: l.doctor_id });
      if (e) return toast(errorText(e));
      toast('Listo. Ya no compartís tus estudios con ese médico.'); patientDoctors();
    } }, 'Dejar de compartir'))));
  m.append(card, redeemCard('¿Tenés el código de otro médico? Escribilo acá.'));
}

/* ---------------- mi cuenta (paciente y médico) ---------------- */
/* Hecho por ChatGPT · 2026-11-02 · Ficha de salud privada; registro sólo para administradores. */
const HEALTH_COVERAGE_SUGGESTIONS = [
  'OSDE', 'Swiss Medical', 'Galeno', 'Sancor Salud', 'Medicus',
  'Accord Salud', 'Prevención Salud', 'Unión Personal', 'OSECAC',
  'OSDEPYM', 'OSPEDYC', 'OSPAT', 'OSPRERA', 'PAMI',
  'PAMI Veteranos de Guerra', 'INSSSEP', 'IOMA', 'Jerárquicos Salud',
  'Hospital Italiano', 'Avalian', 'Federada Salud', 'OSPE'
];
function healthCoverageSuggestions() {
  const list = h('datalist', { id: 'health-coverage-options' });
  for (const name of [...new Set(HEALTH_COVERAGE_SUGGESTIONS)].sort((a, b) => a.localeCompare(b, 'es'))) {
    list.append(h('option', { value: name }));
  }
  return list;
}

/* Hecho por ChatGPT · 2026-11-02 · Múltiples coberturas de salud.
   Se mantiene la cobertura anterior, y se evita guardar duplicados o perder
   un texto escrito si el usuario se olvida de tocar «Agregar cobertura». */
function healthCoveragesEditor(prefix, current, legacy) {
  const old = Array.isArray(current) && current.length
    ? current
    : legacy && String(legacy).trim() ? [String(legacy).trim()] : [];
  const coverages = [...new Map(old.filter(v => typeof v === 'string' && v.trim())
    .map(v => [normalize(v.trim()), v.trim()])).values()];
  const input = h('input', { id: prefix + '-coverage', type: 'text',
    list: 'health-coverage-options', autocomplete: 'off', maxlength: 160,
    placeholder: 'Ej.: PAMI Veteranos de Guerra' });
  const tags = h('div', { class: 'allergy-tags', 'aria-live': 'polite' });
  const redraw = () => {
    tags.replaceChildren();
    if (!coverages.length) tags.append(h('span', { class: 'muted small' }, 'Todavía no agregaste coberturas.'));
    coverages.forEach((coverage, index) => tags.append(
      h('span', { class: 'allergy-tag' }, h('span', {}, coverage),
        h('button', { class: 'allergy-remove', type: 'button',
          'aria-label': 'Quitar cobertura: ' + coverage, onclick: () => {
            coverages.splice(index, 1); redraw();
          } }, '×'))));
  };
  const add = () => {
    const val = input.value.trim();
    if (!val) return true;
    if (coverages.some(v => normalize(v) === normalize(val))) {
      input.value = ''; return true;
    }
    if (coverages.length >= 8) { toast('Podés registrar hasta 8 coberturas.'); return false; }
    coverages.push(val); input.value = ''; redraw(); return true;
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  const addBtn = h('button', { class: 'btn quiet sm', type: 'button', onclick: add }, 'Agregar cobertura');
  redraw();
  const root = h('div', { class: 'field coverage-field' },
    h('label', { for: prefix + '-coverage', style: 'font-weight:700' }, 'Obras sociales o prepagas'),
    h('div', { class: 'row coverage-entry' }, input, addBtn),
    tags,
    h('span', { class: 'hint' }, 'Podés agregar varias coberturas y quitarlas cuando quieras.'),
    healthCoverageSuggestions());
  return { root, values: () => add() ? [...coverages] : null };
}

/* Hecho por ChatGPT · 2026-11-02 · Dato sanguíneo opcional en ficha privada.
   La declaración no sustituye tipificación de laboratorio. */
function bloodTypeField(id, selected) {
  const field = h('select', { id });
  field.append(h('option', { value: '' }, 'No sé / Sin especificar'));
  for (const type of ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']) {
    field.append(h('option', { value: type }, type));
  }
  field.value = selected || '';
  return field;
}

/* Hecho por ChatGPT · 2026-11-02 · Separación orientativa solo en pantalla.
   No se modifican nombres antiguos en la base hasta confirmar y guardar. */
function suggestProfileNameParts(fullName) {
  const words = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return { given: '', family: '' };
  if (words.length === 1) return { given: words[0], family: '' };
  let familyCount = words.length >= 4 ? 2 : 1;
  if (words.length >= 3 && /^(de|del|di|da|do|dos|van|von|du)$/i.test(words.at(-2))) familyCount = 2;
  if (words.length >= 4 && /^(de|van)$/i.test(words.at(-3))
      && /^(la|las|los|der|den)$/i.test(words.at(-2))) familyCount = 3;
  return {
    given: words.slice(0, -familyCount).join(' '),
    family: words.slice(-familyCount).join(' ')
  };
}
// Hecho por ChatGPT · 2026-11-02 · Invalidar renderizados previos de Mi cuenta.
let accountViewGeneration = 0;
async function accountView() {
  const generation = ++accountViewGeneration;
  const m = mainEl();
  const me = state.me;
  const suggested = suggestProfileNameParts(me.full_name);
  const namesUnconfirmed = !me.given_names || !me.family_names;
  const givenNames = h('input', { type: 'text', id: 'acc-given-names',
    value: me.given_names || suggested.given, autocomplete: 'given-name', maxlength: 120 });
  const familyNames = h('input', { type: 'text', id: 'acc-family-names',
    value: me.family_names || suggested.family, autocomplete: 'family-name', maxlength: 120 });
  let birth = me.birth_date;
  const saveBtn = h('button', { class: 'btn primary', type: 'button' }, 'Guardar');
  saveBtn.addEventListener('click', async () => {
    const given = givenNames.value.trim().replace(/\s+/g, ' ');
    const family = familyNames.value.trim().replace(/\s+/g, ' ');
    if (!given || !family) return toast('Completá nombre/s y apellido/s.');
    const full = given + ' ' + family;
    if (full.length > 120) return toast('El nombre completo no puede superar los 120 caracteres.');
    saveBtn.disabled = true;
    try {
      const { error } = await sb.from('profiles').update({
        given_names: given, family_names: family, full_name: full,
        birth_date: birth || null
      }).eq('id', me.id);
      if (error) return toast(errorText(error));
      me.given_names = given; me.family_names = family; me.full_name = full;
      me.birth_date = birth || null; toast('Datos guardados.');
    } finally { saveBtn.disabled = false; }
  });
  // Hecho por ChatGPT · 2026-11-02 · Mostrar el correo de la sesión Supabase como dato de cuenta de solo lectura.
  const registeredEmail = h('input', { type: 'email', id: 'acc-email', value: state.session?.user?.email || me.email,
    readonly: true, autocomplete: 'email', 'aria-describedby': 'acc-email-hint' });
  m.append(h('div', { class: 'card' }, h('h1', {}, 'Mi cuenta'),
    h('div', { class: 'account-fields' },
      h('div', { class: 'field' },
        h('label', { for: 'acc-given-names' }, 'Nombre/s'), givenNames),
      h('div', { class: 'field' },
        h('label', { for: 'acc-family-names' }, 'Apellido/s'), familyNames),
      h('div', { class: 'field' },
        h('label', { for: 'acc-email' }, 'Correo electrónico de registro'), registeredEmail,
        h('span', { class: 'hint account-hint', id: 'acc-email-hint' }, 'Este correo es el que usás para entrar a Chely.')),
      me.role === 'patient' ? h('div', { class: 'field' },
        h('label', { for: 'acc-birth' }, 'Fecha de nacimiento ', h('span', { class: 'hint' }, '(opcional)')),
        datePicker({ id: 'acc-birth', value: me.birth_date, onChange: iso => { birth = iso; } })) : null),
    namesUnconfirmed ? h('p', { class: 'hint' },
      'Separamos tu nombre anterior de forma orientativa. Revisá nombre/s y apellido/s antes de guardar.') : null,
    h('div', { class: 'row' }, saveBtn)));

  if (me.role === 'patient') {
    const card = h('div', { class: 'card' }, h('h2', {}, 'Mis datos de salud'),
      h('p', { class: 'muted small' }, 'Todos los campos son opcionales. Esta información se guarda en una ficha privada, distinta del perfil público de tu cuenta.'));
    m.append(card);
    const { data: details, error: detailsError } = await sb.from('patient_health_details')
      .select('document_type,document_number,height_cm,weight_kg,allergies,health_coverage,health_coverages,blood_type').eq('id', me.id).maybeSingle();
    // Evita que una consulta anterior añada nuevamente las tarjetas finales.
    if (generation !== accountViewGeneration || state.page !== 'cuenta' || state.me?.id !== me.id) return;
    if (detailsError) {
      card.append(h('div', { class: 'alert bad' }, 'No pudimos cargar tus datos de salud. ', errorText(detailsError)));
    } else {
      const docType = h('select', { id: 'health-doc-type' },
        h('option', { value: '' }, 'Sin especificar'), h('option', { value: 'DNI' }, 'DNI'), h('option', { value: 'CUIT' }, 'CUIT'));
      docType.value = details?.document_type || '';
      const docNumber = h('input', { id: 'health-document', type: 'text', inputmode: 'numeric', autocomplete: 'off',
        maxlength: 16, placeholder: 'Solo números', value: details?.document_number || '' });
      const height = h('input', { id: 'health-height', type: 'number', min: 40, max: 250, step: '0.1', placeholder: 'Ej.: 170',
        value: details?.height_cm == null ? '' : String(details.height_cm) });
      const weight = h('input', { id: 'health-weight', type: 'number', min: 1, max: 400, step: '0.1', placeholder: 'Ej.: 70',
        value: details?.weight_kg == null ? '' : String(details.weight_kg) });
      const coverageEditor = healthCoveragesEditor('health', details?.health_coverages, details?.health_coverage);
      const bloodType = bloodTypeField('health-blood-type', details?.blood_type);
      const allergies = Array.isArray(details?.allergies) ? [...details.allergies] : [];
      const allergyInput = h('input', { id: 'health-allergy', type: 'text', maxlength: 120, placeholder: 'Ej.: penicilina' });
      const allergyList = h('div', { class: 'allergy-tags', 'aria-live': 'polite' });
      function drawAllergies() {
        allergyList.replaceChildren(...allergies.map((allergy, index) => h('span', { class: 'allergy-tag' },
          h('span', {}, allergy),
          h('button', { type: 'button', class: 'allergy-remove', 'aria-label': 'Quitar alergia: ' + allergy,
            onclick: () => { allergies.splice(index, 1); drawAllergies(); } }, '×'))));
        if (!allergies.length) allergyList.append(h('span', { class: 'muted small' }, 'Todavía no agregaste alergias.'));
      }
      function addAllergy() {
        const a = allergyInput.value.trim();
        if (!a) return;
        if (allergies.length >= 20) return toast('Podés registrar hasta 20 alergias.');
        if (allergies.some(v => normalize(v) === normalize(a))) return toast('Esa alergia ya está registrada.');
        allergies.push(a); allergyInput.value = ''; drawAllergies();
      }
      const addBtn = h('button', { type: 'button', class: 'btn quiet sm', onclick: addAllergy }, 'Agregar alergia');
      allergyInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addAllergy(); } });
      drawAllergies();

      const saveHealthBtn = h('button', { class: 'btn primary', type: 'button' }, 'Guardar datos de salud');
      saveHealthBtn.addEventListener('click', async () => {
        const digits = docNumber.value.replace(/[\s.-]/g, '');
        const dt = docType.value;
        if ((digits && !dt) || (!digits && dt)) return toast('Elegí DNI o CUIT y completá el número, o dejá ambos vacíos.');
        if (dt === 'DNI' && !/^\d{7,8}$/.test(digits)) return toast('El DNI debe tener entre 7 y 8 números.');
        if (dt === 'CUIT' && !/^\d{11}$/.test(digits)) return toast('El CUIT debe tener 11 números.');
        const cm = height.value.trim() ? Number(height.value) : null;
        const kg = weight.value.trim() ? Number(weight.value) : null;
        if (cm != null && (!Number.isFinite(cm) || cm < 40 || cm > 250)) return toast('Revisá la altura en centímetros.');
        if (kg != null && (!Number.isFinite(kg) || kg < 1 || kg > 400)) return toast('Revisá el peso en kilogramos.');
        if (allergies.join('|').length > 2500) return toast('La lista de alergias es demasiado larga.');
        const coverages = coverageEditor.values();
        if (!coverages) return;
        const payload = { id: me.id, document_type: dt || null, document_number: digits || null,
          height_cm: cm, weight_kg: kg, allergies, blood_type: bloodType.value || null,
          health_coverages: coverages, health_coverage: coverages[0] || null,
          updated_at: new Date().toISOString() };
        saveHealthBtn.disabled = true;
        try {
          const { error } = await sb.from('patient_health_details').upsert(payload, { onConflict: 'id' });
          if (error) return toast(errorText(error));
          toast('Tus datos de salud se guardaron correctamente.');
        } finally { saveHealthBtn.disabled = false; }
      });
      card.append(
        h('div', { class: 'health-fields' },
          h('label', { class: 'field', for: 'health-doc-type' }, 'Tipo de documento', docType),
          h('label', { class: 'field', for: 'health-document' }, 'Número de DNI o CUIT', docNumber),
          h('label', { class: 'field', for: 'health-height' }, 'Altura (cm)', height),
          h('label', { class: 'field', for: 'health-weight' }, 'Peso (kg)', weight),
          h('label', { class: 'field', for: 'health-blood-type' }, 'Grupo y factor sanguíneo (ABO/Rh)',
            bloodType)),
        h('p', { class: 'hint' }, 'Completá el grupo sanguíneo solo si lo conocés por un estudio. Chely no verifica este dato.'),
        h('div', { class: 'field health-allergy-field' },
          h('label', { for: 'health-allergy', style: 'font-weight:700' }, 'Alergias'),
          h('div', { class: 'row' }, allergyInput, addBtn), allergyList,
          h('span', { class: 'hint' }, 'Agregá cada alergia por separado. Podés quitarla cuando quieras.')),
        coverageEditor.root,
        h('p', { class: 'hint' }, 'Si no encontrás tu cobertura, escribila igual. ',
          h('a', { href: 'https://www.argentina.gob.ar/agentes-del-seguro-rnas', target: '_blank', rel: 'noopener noreferrer' },
            'Consultar el registro oficial de Agentes del Seguro de Salud.')),
        h('div', { class: 'row' }, saveHealthBtn));
    }
  }

  /* Hecho por ChatGPT · 2026-11-02 · Confirmación también al cambiar contraseña desde Mi cuenta. */
  const pass = h('input', { type: 'password', id: 'acc-pass', autocomplete: 'new-password', minlength: 8 });
  const passConfirm = h('input', { type: 'password', id: 'acc-pass-confirm', autocomplete: 'new-password', minlength: 8 });
  const changePass = h('button', { class: 'btn', type: 'button' }, 'Cambiar contraseña');
  changePass.addEventListener('click', async () => {
    if (pass.value.length < 8) return toast('La contraseña tiene que tener al menos 8 caracteres.');
    if (pass.value !== passConfirm.value) return toast('Las contraseñas no coinciden.');
    changePass.disabled = true;
    try {
      const { error } = await sb.auth.updateUser({ password: pass.value });
      if (error) return toast(errorText(error));
      pass.value = ''; passConfirm.value = ''; toast('Contraseña actualizada.');
    } finally { changePass.disabled = false; }
  });
  m.append(h('div', { class: 'card' }, h('h2', {}, 'Cambiar la contraseña'),
    h('div', { class: 'grid2 password-fields' },
      h('label', { class: 'field', for: 'acc-pass' }, 'Contraseña nueva', pass,
        h('span', { class: 'hint' }, 'Al menos 8 caracteres.')),
      h('label', { class: 'field', for: 'acc-pass-confirm' }, 'Confirmar contraseña nueva', passConfirm)),
    h('div', { class: 'row' }, changePass)));

  // Hecho por ChatGPT · 2026-11-02 · El alta/vínculo de menores es una acción ocasional,
  // al final de Mi cuenta pero inmediatamente ANTES de eliminar la cuenta.
  if (me.role === 'patient') appendMinorAccountOptions(m);

  m.append(h('div', { class: 'card' }, h('h2', {}, 'Borrar mi cuenta'),
    h('p', {}, me.role === 'patient' ? 'Se borran tu cuenta, tus estudios, sus explicaciones y los archivos originales. No se puede deshacer.' : 'Se borra tu cuenta. Los estudios que publicaste siguen disponibles para tus pacientes.'),
    h('div', { class: 'row' }, h('button', { class: 'btn danger', onclick: async () => {
      if (!await confirmBox({ title: 'Borrar mi cuenta', text: 'Esta acción no se puede deshacer.', ok: 'Borrar definitivamente', danger: true, typed: 'BORRAR' })) return;
      const { error } = await sb.functions.invoke('borrar-cuenta', { body: { confirm: 'BORRAR' } });
      if (error) return toast(await fnError(error));
      await sb.auth.signOut(); toast('Tu cuenta fue borrada.');
    } }, 'Borrar mi cuenta'))));
}

/* ---------------- Menores a cargo ---------------- */
/* Hecho por ChatGPT · 2026-11-02 · Primera fase: perfil y adultos vinculados.
   Informes, archivos y análisis con IA requieren permisos especializados: no se activan todavía. */
const MINOR_RELATIONS = [['madre','Madre'], ['padre','Padre'], ['abuela','Abuela'],
  ['abuelo','Abuelo'], ['tutor','Tutor/a'], ['otro','Otro vínculo']];
function minorRelationshipField(id, firstOnly = false) {
  const allowed = firstOnly ? MINOR_RELATIONS.filter(([v]) => ['madre','padre','tutor'].includes(v)) : MINOR_RELATIONS;
  return h('select', { id }, ...allowed.map(([v,label]) => h('option', { value: v }, label)));
}
function appendMinorAccountOptions(m) {
  const name = h('input', { id: 'minor-new-name', type: 'text', maxlength: 120, autocomplete: 'off', placeholder: 'Nombre y apellido del menor' });
  let birthday = null;
  const born = datePicker({ id: 'minor-new-birth', onChange: iso => { birthday = iso; } });
  const relation = minorRelationshipField('minor-new-relation', true);
  const create = h('button', { class: 'btn primary', type: 'button' }, 'Registrar menor');
  create.addEventListener('click', async () => {
    if (!name.value.trim() || !birthday) return toast('Ingresá el nombre y la fecha de nacimiento.');
    if (!await confirmBox({ title: 'Confirmá tu responsabilidad',
      text: 'Confirmás que sos madre, padre o tutor con autoridad para registrar esta ficha. Otras personas sólo podrán acceder si se las invita a su correo.',
      ok: 'Confirmar' })) return;
    create.disabled = true;
    try {
      const { error } = await sb.rpc('minor_create', { p_name: name.value.trim(),
        p_birth_date: birthday, p_relationship: relation.value });
      if (error) return toast(errorText(error));
      toast('Menor registrado. Ya aparece la pestaña Menores a cargo.');
      go('menores');
    } finally { create.disabled = false; }
  });
  const code = h('input', { type: 'text', id: 'minor-code', maxlength: 48, autocomplete: 'off',
    placeholder: 'Código de invitación recibido' });
  const acceptRelation = minorRelationshipField('minor-link-relation');
  const accept = h('button', { class: 'btn', type: 'button' }, 'Aceptar invitación');
  accept.addEventListener('click', async () => {
    if (!code.value.trim()) return toast('Ingresá el código que recibiste.');
    accept.disabled = true;
    try {
      const { error } = await sb.rpc('minor_accept',
        { p_code: code.value.trim(), p_relationship: acceptRelation.value });
      if (error) return toast(errorText(error));
      toast('Vínculo confirmado. Ya podés ver la ficha del menor.');
      go('menores');
    } finally { accept.disabled = false; }
  });
  // Hecho por ChatGPT · 2026-11-02 · Botón visible en lugar de desplegable discreto.
  // Los formularios internos se muestran sólo cuando el usuario lo solicita.
  const panel = h('div', { class: 'stack', id: 'minor-account-panel', hidden: true },

      h('p', { class: 'hint' }, 'La ficha es privada. Para evitar duplicados, si otro adulto ya registró al menor, pedile una invitación.'),
      h('h3', {}, 'Registrar un menor'),
      h('div', { class: 'grid2' },
        h('label', { class: 'field', for: 'minor-new-name' }, 'Nombre y apellido', name),
        h('div', { class: 'field' }, h('label', { for: 'minor-new-birth' }, 'Fecha de nacimiento'), born),
        h('label', { class: 'field', for: 'minor-new-relation' }, 'Tu relación', relation)),
      h('div', { class: 'row' }, create),
      h('h3', {}, 'Ya tengo una invitación'),
      h('p', { class: 'hint' }, 'La invitación debe estar dirigida a tu correo verificado. Vence a los siete días.'),
      h('div', { class: 'grid2' },
        h('label', { class: 'field', for: 'minor-code' }, 'Código', code),
        h('label', { class: 'field', for: 'minor-link-relation' }, 'Tu relación', acceptRelation)),
      h('div', { class: 'row' }, accept));
  const toggle = h('button', { type: 'button', class: 'btn quiet',
    'aria-controls': 'minor-account-panel', 'aria-expanded': 'false' }, 'Vincular o registrar un menor');
  toggle.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
    toggle.textContent = panel.hidden ? 'Vincular o registrar un menor' : 'Ocultar formulario';
    if (!panel.hidden) name.focus();
  });
  m.append(h('section', { class: 'card minor-account-card' },
    h('h2', {}, 'Menores a cargo'),
    h('p', { class: 'muted small' }, 'Podés vincularte a la ficha de un menor o registrar una nueva.'),
    h('div', { class: 'row' }, toggle), panel));
}
async function minorManagement() {
  const minors = state.linkedMinors || [];
  if (!minors.length) return go('cuenta');
  const m = mainEl();
  m.append(h('h1', {}, 'Menores a cargo'),
    h('p', { class: 'muted small' }, 'Cada adulto tiene una cuenta personal. Sólo los vinculados pueden acceder a la ficha.'));
  const list = h('div', { class: 'list' });
  m.append(h('div', { class: 'card' }, h('h2', {}, 'Fichas vinculadas'), list));
  for (const minor of minors) {
    list.append(h('button', { class: 'item', type: 'button', onclick: () => {
      state.minorId = minor.id; state.minorStudyId = null; saveRoute(); minorManagement();
    } }, h('strong', {}, minor.full_name),
      h('span', { class: 'muted small' }, ' · ' + fmtDate(minor.birth_date) + ' · ' +
        (minor.access_level === 'responsable' ? 'Responsable' : 'Adulto autorizado'))));
  }
  const minor = minors.find(item => item.id === state.minorId) || minors[0];
  state.minorId = minor.id;
  saveRoute();
  const card = h('div', { class: 'card' },
    h('h2', {}, minor.full_name),
    h('p', {}, 'Nacimiento: ' + fmtDate(minor.birth_date) + ' · Relación: ' + minor.relationship),
    h('div', { class: 'alert info' }, 'Podés cargar y explicar estudios de este menor con Chely. Sólo los adultos vinculados tienen acceso. La IA puede cometer errores: verificá siempre los resultados con un profesional médico.'));
  m.append(card);
  // Hecho por ChatGPT · 2026-11-02 · Datos y estudios privados por menor.
  await minorHealthPanel(m, minor);
  await minorStudiesPanel(m, minor);
  if (minor.access_level !== 'responsable') return;
  const { data: members, error } = await sb.rpc('minor_members', { p_minor: minor.id });
  if (error) return card.append(h('div', { class: 'alert bad' }, errorText(error)));
  const adults = h('div', { class: 'card' },
    h('h3', {}, 'Personas con acceso'),
    h('p', { class: 'muted small' }, 'Los adultos vinculados podrán consultar y modificar estudios. Sólo los responsables pueden invitar y quitar personas.'));
  for (const adult of (members || [])) {
    const row = h('div', { class: 'row' },
      h('span', { class: 'grow' }, (adult.full_name || adult.email) + ' · ' +
        adult.relationship + ' · ' + adult.access_level));
    if (!adult.is_creator && adult.adult_id !== state.me.id) {
      row.append(h('button', { class: 'btn danger sm', type: 'button', onclick: async () => {
        if (!await confirmBox({ title: 'Quitar acceso',
          text: 'Esta persona ya no podrá ver la ficha del menor.',
          ok: 'Quitar acceso', danger: true })) return;
        const { error: e } = await sb.rpc('minor_remove_adult',
          { p_minor: minor.id, p_adult: adult.adult_id });
        if (e) return toast(errorText(e));
        toast('Acceso retirado.'); minorManagement();
      } }, 'Quitar acceso'));
    }
    adults.append(row);
  }
  card.append(adults);
  const email = h('input', { id: 'minor-share-email', type: 'email', autocomplete: 'email', placeholder: 'correo@ejemplo.com' });
  const role = h('select', { id: 'minor-share-role' },
    h('option', { value: 'colaborador' }, 'Adulto autorizado (consulta y modifica estudios)'),
    h('option', { value: 'responsable' }, 'Responsable (puede gestionar accesos)'));
  const result = h('div', { role: 'status' });
  const invite = h('button', { type: 'button', class: 'btn primary' }, 'Crear invitación');
  invite.addEventListener('click', async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim()))
      return toast('Ingresá un correo válido.');
    invite.disabled = true;
    try {
      const { data, error: e } = await sb.rpc('minor_invite', {
        p_minor: minor.id, p_email: email.value.trim(), p_access_level: role.value
      });
      if (e) return toast(errorText(e));
      const code = String(data || '');
      const copy = h('button', { type: 'button', class: 'btn quiet sm',
        onclick: () => navigator.clipboard.writeText(code).then(
          () => toast('Código copiado.'), () => toast('Copiá el código manualmente.')) }, 'Copiar código');
      result.replaceChildren(h('p', { class: 'hint' },
        'Compartí este código por un canal privado. Sólo funciona con el correo indicado y vence en siete días.'),
        h('code', {}, code), copy);
    } finally { invite.disabled = false; }
  });
  card.append(h('div', { class: 'card' }, h('h3', {}, 'Invitar a un adulto'),
    h('div', { class: 'grid2' },
      h('label', { class: 'field', for: 'minor-share-email' }, 'Correo de la persona', email),
      h('label', { class: 'field', for: 'minor-share-role' }, 'Permisos', role)),
    h('div', { class: 'row' }, invite), result));
}


/* ---------------- ficha clínica privada del menor ---------------- */
/* Hecho por ChatGPT · 2026-11-02 · El acceso real lo limita Supabase RLS. */
async function minorHealthPanel(host, minor) {
  const card=h('div',{class:'card'},h('h2',{},'Datos de salud de '+minor.full_name),
    h('p',{class:'muted small'},'Datos propios del menor. Los adultos vinculados pueden consultarlos y actualizarlos.'));
  host.append(card);
  const {data,error}=await sb.from('minor_health_details')
    .select('document_type,document_number,height_cm,weight_kg,allergies,health_coverage,health_coverages,blood_type')
    .eq('minor_id',minor.id).maybeSingle();
  if(error)return card.append(h('div',{class:'alert bad'},errorText(error)));
  const type=h('select',{id:'minor-doc-type'},
    ...[['','Sin especificar'],['DNI','DNI'],['CUIL','CUIL'],['CUIT','CUIT']]
      .map(([key,label])=>h('option',{value:key},label)));
  type.value=data?.document_type||'';
  const num=h('input',{id:'minor-doc-num',type:'text',inputmode:'numeric',maxlength:16,
    placeholder:'Solo números',value:data?.document_number||''});
  const height=h('input',{id:'minor-height',type:'number',min:40,max:250,step:'.1',
    placeholder:'Ej.: 110',value:data?.height_cm==null?'':String(data.height_cm)});
  const weight=h('input',{id:'minor-weight',type:'number',min:1,max:400,step:'.1',
    placeholder:'Ej.: 18',value:data?.weight_kg==null?'':String(data.weight_kg)});
  const coverageEditor=healthCoveragesEditor('minor',data?.health_coverages,data?.health_coverage);
  const bloodType=bloodTypeField('minor-blood-type',data?.blood_type);
  const allergyInput=h('input',{id:'minor-allergy',type:'text',maxlength:120,
    placeholder:'Ej.: penicilina'});
  const allergies=Array.isArray(data?.allergies)?[...data.allergies]:[];
  const tags=h('div',{class:'allergy-tags','aria-live':'polite'});
  const refresh=()=>{
    tags.replaceChildren();
    if(!allergies.length)tags.append(h('span',{class:'muted small'},'Sin alergias registradas.'));
    allergies.forEach((name,index)=>tags.append(h('span',{class:'allergy-tag'},name,
      h('button',{type:'button',class:'allergy-remove','aria-label':'Quitar '+name,
        onclick:()=>{allergies.splice(index,1);refresh();}},'×'))));
  };
  const addAllergy=()=>{
    const name=allergyInput.value.trim();if(!name)return;
    if(allergies.length>=20)return toast('Podés registrar hasta 20 alergias.');
    if(allergies.some(a=>normalize(a)===normalize(name)))return toast('La alergia ya existe.');
    allergies.push(name);allergyInput.value='';refresh();
  };
  allergyInput.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();addAllergy();}});
  refresh();
  const save=h('button',{class:'btn primary',type:'button'},'Guardar datos del menor');
  save.addEventListener('click',async()=>{
    const dt=type.value,digits=num.value.replace(/[\s.-]/g,'');
    if((dt&&!digits)||(!dt&&digits))return toast('Completá tipo y número, o dejá ambos vacíos.');
    if(dt==='DNI'&&!/^\d{7,8}$/.test(digits))return toast('El DNI debe tener 7 u 8 dígitos.');
    if(['CUIL','CUIT'].includes(dt)&&!/^\d{11}$/.test(digits))
      return toast('El CUIL/CUIT debe tener 11 dígitos.');
    const cm=height.value.trim()?Number(height.value):null;
    const kg=weight.value.trim()?Number(weight.value):null;
    if(cm!==null&&(!Number.isFinite(cm)||cm<40||cm>250))return toast('Revisá la altura.');
    if(kg!==null&&(!Number.isFinite(kg)||kg<1||kg>400))return toast('Revisá el peso.');
    if(allergies.join('|').length>2500)return toast('La lista de alergias es demasiado larga.');
    const coverages=coverageEditor.values();
    if(!coverages)return;
    save.disabled=true;
    try{
      const {error:e}=await sb.from('minor_health_details').upsert({
        minor_id:minor.id,document_type:dt||null,document_number:digits||null,
        height_cm:cm,weight_kg:kg,allergies,blood_type:bloodType.value||null,
        health_coverages:coverages,health_coverage:coverages[0]||null,
        updated_by:state.me.id,updated_at:new Date().toISOString()
      },{onConflict:'minor_id'});
      if(e)toast(errorText(e));else toast('Datos del menor guardados.');
    }finally{save.disabled=false;}
  });
  card.append(
    h('div',{class:'health-fields'},
      h('label',{class:'field',for:'minor-doc-type'},'Documento',type),
      h('label',{class:'field',for:'minor-doc-num'},'Número de documento',num),
      h('label',{class:'field',for:'minor-height'},'Altura (cm)',height),
      h('label',{class:'field',for:'minor-weight'},'Peso (kg)',weight),
      h('label',{class:'field',for:'minor-blood-type'},'Grupo y factor sanguíneo (ABO/Rh)',bloodType)),
    h('p',{class:'hint'},'Registrá este dato únicamente si se conoce por un estudio. Chely no verifica el grupo sanguíneo.'),
    h('div',{class:'field'},h('label',{for:'minor-allergy',style:'font-weight:700'},'Alergias'),
      h('div',{class:'row'},allergyInput,
        h('button',{class:'btn quiet sm',type:'button',onclick:addAllergy},'Agregar alergia')),tags),
    coverageEditor.root,
    h('div',{class:'row'},save));
}


/* ---------------- estudios privados del menor ---------------- */
/* Hecho por ChatGPT · 2026-11-02 · Estudios + archivos aislados de los pacientes adultos. */
async function minorStudiesPanel(host,minor){
  const card=h('div',{class:'card'},h('h2',{},'Estudios de '+minor.full_name),
    h('p',{class:'muted small'},'Los adultos vinculados pueden subir, ver y modificar estos estudios. Los archivos se guardan en un espacio privado de Chely.'));
  host.append(card);
  const {data:studies,error}=await sb.from('minor_studies').select('*')
    .eq('minor_id',minor.id).order('study_date',{ascending:false});
  if(error)return card.append(h('div',{class:'alert bad'},errorText(error)));
  const upload=h('details',{class:'minor-upload'},
    h('summary',{},'Agregar un estudio'));
  // Hecho por ChatGPT · 2026-11-02 · Misma carga accesible de adultos: foto, PDF, texto o enlace.
  let draft=minorUploadDrafts.get(minor.id);
  if(!draft){ draft={mode:'foto',text:'',file:null,imported:null,url:'',title:'',date:null}; minorUploadDrafts.set(minor.id,draft); }
  const source=studySourceChooser('minor-study',draft);
  const title=h('input',{type:'text',id:'minor-study-title',maxlength:180,
    placeholder:'Ej.: Análisis de sangre',value:draft.title||''});
  title.addEventListener('input',()=>{draft.title=title.value;});
  let date=draft.date||null;
  const picker=datePicker({id:'minor-study-date',value:date,onChange:iso=>{date=iso;draft.date=iso;}});
  const meta=h('div',{class:'study-manual-meta grid2'},
    h('label',{class:'field',for:'minor-study-title'},'¿Qué estudio es?',title),
    h('div',{class:'field'},h('label',{for:'minor-study-date'},'Fecha del estudio'),picker));
  const sync=()=>{meta.hidden=source.getMode()!=='texto';};
  source.root.addEventListener('study-method-change',sync);
  source.root.addEventListener('study-report-input',e=>{
    const info=metadataFromReport(e.detail.text);
    if(!title.value.trim()&&info.title){title.value=info.title;draft.title=info.title;}
    if(!date&&info.date){date=info.date;draft.date=date;picker.querySelector('input').value=fmtDate(info.date);}
  });
  sync();
  const status=h('div',{role:'status'});
  if(draft.pending){ status.className='alert info'; status.textContent='El estudio sigue cargándose. Podés cambiar de sección sin cancelar la operación.'; }
  const save=h('button',{class:'btn primary big',type:'button'},'Continuar con el estudio');
  save.disabled=!!draft.pending;
  save.addEventListener('click',async()=>{
    if(draft.pending)return toast('Este estudio ya se está cargando.');
    const mode=source.getMode(), chosen=source.getFile(), pasted=source.getText();
    if(mode==='texto'){
      if(!pasted)return toast('Pegá el texto del informe.');
      if(title.value.trim().length<2||!date||date>todayISO())return toast('Completá el nombre y la fecha.');
    }else{
      if(!chosen)return toast(mode==='enlace'?'Primero importá el documento del enlace.':'Elegí una foto o PDF.');
      if(!studyUploadFileValid(chosen,mode))return toast('Archivo no admitido o mayor a 20 MB.');
    }
    draft.pending=true;
    const navAtStart=navigationEpoch, ownerAtStart=state.me.id;
    save.disabled=true;status.className='alert info';status.textContent='Guardando el estudio…';
    try{
      const isFile=mode!=='texto';
      const {data:created,error:e}=await sb.from('minor_studies').insert({
        minor_id:minor.id,created_by:state.me.id,
        title:isFile?STUDY_PENDING_TITLE:title.value.trim(),
        study_date:isFile?todayISO():date,report_text:isFile?'':pasted
      }).select('id').single();
      if(e||!created)throw e||new Error('No se pudo crear el estudio.');
      if(isFile){
        const path=minor.id+'/'+created.id+'/'+crypto.randomUUID();
        const {error:uploadError}=await sb.storage.from('estudios-menores').upload(path,chosen,
          {contentType:chosen.type,upsert:false,cacheControl:'0'});
        if(uploadError)throw new Error('Se creó el estudio, pero falló el archivo: '+errorText(uploadError));
        const {error:metaError}=await sb.from('minor_studies').update({
          file_path:path,file_name:chosen.name.slice(0,255),
          file_type:chosen.type,updated_by:state.me.id
        }).eq('id',created.id);
        if(metaError)throw new Error('Archivo cargado sin confirmar el registro: '+errorText(metaError));
      }
      minorUploadDrafts.delete(minor.id);
      if(state.me?.id===ownerAtStart && state.page==='menores'
          && state.minorId===minor.id && navigationEpoch===navAtStart){
        state.minorStudyId=created.id; saveRoute();
        toast(isFile?'Estudio guardado. Podés leerlo cuando quieras con el botón de IA.':'Texto guardado. Podés pedir la explicación.');
        minorManagement();
      }else{
        if(state.me?.id===ownerAtStart)toast('El estudio del menor terminó de guardarse.');
        if(state.page==='menores')minorManagement();
      }
    }catch(e){
      status.className='alert bad';status.textContent=errorText(e);
      if(state.page!=='menores'||navigationEpoch!==navAtStart)toast('No se completó la carga del menor: '+errorText(e));
    }finally{
      draft.pending=false; save.disabled=false;
      if(state.page==='menores'&&navigationEpoch!==navAtStart)minorManagement();
    }
  });
  upload.append(source.root,meta,
    h('p',{class:'hint'},'Con foto, PDF o enlace importado, Chely intentará completar título y fecha después de leer el documento.'),
    status,h('div',{class:'row'},save));
  card.append(upload);
  if(!(studies||[]).length)card.append(h('p',{class:'muted'},'Este menor todavía no tiene estudios registrados.'));
  for(const study of studies||[])card.append(h('button',{class:'item',type:'button',onclick:()=>{
    state.minorStudyId=study.id;saveRoute();minorManagement();
  }},h('span',{class:'grow'},study.title),h('span',{class:'pill'},study.title===STUDY_PENDING_TITLE?'Fecha por confirmar':fmtDate(study.study_date)),
    h('span',{class:'pill '+(study.explanation?'ok':'warn')},study.explanation?'Explicado':'Pendiente')));
  const selected=(studies||[]).find(x=>x.id===state.minorStudyId);
  if(selected)minorStudyEditor(host,selected);
}
async function minorOpenFile(study){
  const {data,error}=await sb.storage.from('estudios-menores').createSignedUrl(study.file_path,120);
  if(error||!data?.signedUrl)return toast('No pudimos acceder al archivo.');
  window.open(data.signedUrl,'_blank','noopener,noreferrer');
}
function minorStudyEditor(host,study){
  const box=h('div',{class:'card'},h('h3',{},'Estudio: '+study.title));
  // Hecho por ChatGPT · 2026-11-02 · Conservar edición de menores en RAM
  // mientras se cambia de sección, sin guardar textos en el navegador.
  const draftKey='minor:'+study.id;
  const pending=study.title===STUDY_PENDING_TITLE;
  const draft=studyEditDrafts.get(draftKey)||{
    title:pending?'':study.title,
    date:pending?null:study.study_date,
    report:study.report_text||''
  };
  studyEditDrafts.set(draftKey,draft);
  const title=h('input',{id:'minor-edit-title',type:'text',maxlength:180,
    placeholder:'Ej.: Ecografía abdominal',value:draft.title});
  title.addEventListener('input',()=>{draft.title=title.value;});
  let date=draft.date;
  const picker=datePicker({id:'minor-edit-date',value:date,onChange:iso=>{date=iso;draft.date=iso;}});
  const report=h('textarea',{id:'minor-edit-report',class:'report'},draft.report);
  report.addEventListener('input',()=>{draft.report=report.value;});
  const status=h('div',{role:'status'});
  const metadataNote=h('p',{class:'hint',role:'status'},
    pending?'Chely intentará reconocer el nombre y la fecha del informe. Revisalos antes de explicar.':'Podés editar el nombre y la fecha del estudio.');
  const saveReport=async()=>{
    const {error}=await sb.from('minor_studies').update({
      report_text:report.value.trim(),updated_by:state.me.id
    }).eq('id',study.id);
    if(error){toast(errorText(error));return false;}
    study.report_text=report.value.trim();draft.report=report.value;
    return true;
  };
  const save=async()=>{
    if(title.value.trim().length<2||!date||date>todayISO())return toast('Revisá el nombre y la fecha del estudio antes de explicar.'),false;
    const {error}=await sb.from('minor_studies').update({
      title:title.value.trim(),study_date:date,report_text:report.value.trim(),updated_by:state.me.id
    }).eq('id',study.id);
    if(error)return toast(errorText(error)),false;
    study.title=title.value.trim();study.study_date=date;study.report_text=report.value.trim();
    draft.title=title.value;draft.date=date;draft.report=report.value;
    return true;
  };
  const read=h('button',{class:'btn',type:'button',onclick:async()=>{
    read.disabled=true;status.className='alert info';status.textContent='Chely está leyendo el archivo…';
    try{
      const {data,error}=await pendingOnce(runningStudyReads,'minor:'+study.id,
        ()=>sb.functions.invoke('ia-menores',{body:{action:'transcribir',study_id:study.id}}));
      if(error)throw new Error(await fnError(error));
      report.value=data.text||'';draft.report=report.value;
      if(!await saveReport())throw new Error('No se pudo guardar el texto transcripto.');
      if(study.title===STUDY_PENDING_TITLE){
        const suggested=metadataFromReport(data.text);
        if(suggested.title){title.value=suggested.title;draft.title=title.value;}
        if(suggested.date){
          date=suggested.date;draft.date=date;picker.querySelector('input').value=fmtDate(suggested.date);
        }
        metadataNote.textContent=suggested.title&&suggested.date
          ? 'Chely sugirió estos datos. Confirmá que sean correctos.'
          : 'Falta identificar el título o la fecha: completalos para poder explicar.';
      }
      status.className='alert ok';status.textContent='Texto leído. Revisá los datos y el informe antes de explicar.';
    }catch(e){status.className='alert bad';status.textContent=errorText(e);}
    finally{read.disabled=false;}
  }},'Leer archivo con IA');
  const explain=h('button',{class:'btn primary',type:'button',onclick:async()=>{
    const navAtStart=navigationEpoch;
    if(!report.value.trim())return toast('Primero pegá el texto o leé el archivo.');
    if(!await save())return;
    explain.disabled=true;status.className='alert info';status.textContent='Chely está preparando la explicación…';
    try{
      const {data,error}=await pendingOnce(runningStudyExplanations,'minor:'+study.id,
        ()=>sb.functions.invoke('ia-menores',{body:{action:'explicar',study_id:study.id}}));
      if(error)throw new Error(await fnError(error));
      const text=(data.aviso_urgente?'## Aviso importante del informe\n'+data.aviso_urgente+'\n\n':'')+data.explicacion;
      const {error:up}=await sb.from('minor_studies').update({
        explanation:text,glossary:data.glosario||[],lab_values:data.valores||[],
        ai_model:data.model||null,ai_generated_at:new Date().toISOString(),updated_by:state.me.id
      }).eq('id',study.id);
      if(up)throw up;
      studyEditDrafts.delete(draftKey);
      toast('Explicación guardada para los adultos vinculados.');
      if(state.page==='menores' && state.minorStudyId===study.id && navigationEpoch===navAtStart)minorManagement();
    }catch(e){status.className='alert bad';status.textContent=errorText(e);}
    finally{explain.disabled=false;}
  }},'Explicar con IA');
  box.append(
    h('div',{class:'grid2'},
      h('label',{class:'field',for:'minor-edit-title'},'Nombre del estudio',title),
      h('div',{class:'field'},h('label',{for:'minor-edit-date'},'Fecha del estudio'),picker)),
    metadataNote,
    study.file_path?h('div',{class:'row'},h('span',{class:'muted grow'},study.file_name||'Archivo'),
      h('button',{class:'btn quiet sm',type:'button',onclick:()=>minorOpenFile(study)},'Ver original')):null,
    h('label',{class:'field',for:'minor-edit-report'},'Texto del informe',report),
    status,h('div',{class:'row'},
      h('button',{class:'btn',type:'button',onclick:async()=>{if(await save())toast('Cambios guardados.');}},'Guardar cambios'),
      study.file_path?read:null,explain),
    h('p',{class:'muted small'},'Explicación generada por inteligencia artificial sin revisión médica. Consultá con un profesional.'));
  if(study.explanation){
    box.append(h('h3',{},'Explicación en palabras claras'),renderExplanation(study.explanation,study.glossary||[]));
    const vals=renderValues(study.lab_values||[]);if(vals)box.append(vals);
  }
  box.append(h('div',{class:'row'},
    h('button',{class:'btn quiet',type:'button',onclick:()=>printStudyCopy(study)},'Guardar copia en PDF'),
    typeof navigator.share==='function'?h('button',{class:'btn quiet',type:'button',onclick:()=>shareStudyCopy(study)},'Enviar copia'):null,
    h('button',{class:'btn danger sm',type:'button',onclick:async()=>{
      if(!await confirmBox({title:'Eliminar estudio del menor',
        text:'Se eliminará para todos los adultos vinculados. No se puede deshacer.',
        ok:'Eliminar estudio',danger:true}))return;
      if(study.file_path){
        const {error:removeError}=await sb.storage.from('estudios-menores').remove([study.file_path]);
        if(removeError)return toast(errorText(removeError));
      }
      const {error}=await sb.from('minor_studies').delete().eq('id',study.id);
      if(error)return toast(errorText(error));
      studyEditDrafts.delete(draftKey);
      state.minorStudyId=null;saveRoute();toast('Estudio eliminado.');minorManagement();
    }},'Eliminar estudio')));
  host.append(box);
}

/* ---------------- médico ---------------- */
async function renderDoctor() {
  if (!['pacientes', 'paciente', 'estudio-medico', 'cuenta'].includes(state.page)) state.page = 'pacientes';
  saveRoute();
  shell(navFor([['pacientes', 'Pacientes'], ['cuenta', 'Mi cuenta']]));
  if (state.page === 'paciente') return doctorPatient();
  if (state.page === 'estudio-medico') return doctorStudy();
  if (state.page === 'cuenta') return accountView();
  return doctorPatients();
}
async function doctorPatients() {
  loading();
  const { data: links, error } = await sb.from('care_links').select('patient_id, created_at').eq('doctor_id', state.me.id).eq('active', true).order('created_at', { ascending: false });
  if (error) return showError(error, doctorPatients);
  const ids = links.map(l => l.patient_id);
  const profiles = (ids.length ? (await sb.from('profiles').select('id, full_name, email, birth_date').in('id', ids)).data : []) || [];
  const studies = (ids.length ? (await sb.from('studies').select('patient_id, status, feedback').in('patient_id', ids)).data : []) || [];
  const { data: invites } = await sb.from('invitations').select('code, patient_hint, created_at, expires_at').is('used_by', null).gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false });
  const m = mainEl();
  m.append(h('div', { class: 'row' }, h('h1', { class: 'grow' }, 'Mis pacientes'), h('button', { class: 'btn primary', onclick: inviteDialog }, 'Invitar paciente')));
  const card = h('div', { class: 'card' });
  if (!profiles.length) card.append(h('p', { class: 'muted' }, 'Todavía no tenés pacientes. Tocá «Invitar paciente» y mandale el enlace.'));
  const list = h('div', { class: 'list' });
  for (const p of profiles) {
    const st = studies.filter(s => s.patient_id === p.id);
    const age = ageFrom(p.birth_date);
    list.append(h('button', { class: 'item', onclick: () => go('paciente', { patientId: p.id }) },
      h('div', { class: 'row' }, h('h3', {}, p.full_name || p.email), age != null ? h('span', { class: 'pill' }, age + ' años') : null),
      h('span', { class: 'muted small' }, `${st.filter(s => s.status === 'publicado').length} publicado(s) · ${st.filter(s => s.status === 'borrador').length} borrador(es) · ${p.email}`)));
  }
  card.append(list);
  m.append(card);
  if (invites && invites.length) {
    m.append(h('div', { class: 'card' }, h('h2', {}, 'Invitaciones sin usar'),
      ...invites.map(i => h('div', { class: 'row' }, h('span', { class: 'code' }, i.code), h('span', { class: 'grow muted small' }, `${i.patient_hint || 'Sin nombre'} · vence ${fmtDate(i.expires_at)}`),
        h('button', { class: 'btn quiet sm', onclick: () => showInvite(i.code, i.patient_hint) }, 'Ver enlace'),
        h('button', { class: 'btn danger sm', onclick: async () => { const { error: e } = await sb.from('invitations').delete().eq('code', i.code); if (e) return toast(errorText(e)); doctorPatients(); } }, 'Anular')))));
  }
}
function inviteDialog() {
  const host = $('#overlay');
  const hint = h('input', { type: 'text', id: 'invite-hint', placeholder: 'Ej.: Marta Gómez' });
  const close = () => { host.innerHTML = ''; };
  const create = h('button', { class: 'btn primary', onclick: async () => {
    create.disabled = true;
    const { data, error } = await sb.rpc('create_invitation', { p_hint: hint.value.trim() });
    if (error) { create.disabled = false; return toast(errorText(error)); }
    close(); showInvite(data, hint.value.trim());
  } }, 'Crear invitación');
  host.append(h('div', { class: 'overlay' }, h('div', { class: 'card', role: 'dialog', 'aria-modal': 'true' }, h('h2', {}, 'Invitar paciente'),
    h('p', { class: 'muted' }, 'Se genera un enlace personal que vence en 14 días y sirve una sola vez.'),
    h('label', { class: 'field', for: 'invite-hint' }, 'Nombre del paciente ', h('span', { class: 'hint' }, '(para que lo reconozcas vos)'), hint),
    h('div', { class: 'row' }, h('button', { class: 'btn quiet', onclick: close }, 'Cancelar'), create))));
  hint.focus();
}
function showInvite(code, hint) {
  const host = $('#overlay');
  const link = `${location.origin}${location.pathname}?invitacion=${code}`;
  const text = `Hola${hint ? ' ' + hint.split(' ')[0] : ''}. Te invito a Chely para que recibas tus estudios explicados en palabras simples. Creá tu cuenta con este enlace: ${link}`;
  const close = () => { host.innerHTML = ''; doctorPatients(); };
  host.append(h('div', { class: 'overlay' }, h('div', { class: 'card', role: 'dialog', 'aria-modal': 'true' }, h('h2', {}, 'Invitación lista'),
    h('p', {}, 'Mandale este enlace a tu paciente:'), h('div', { class: 'linkbox' }, link),
    h('p', { class: 'muted small' }, 'Si prefiere, puede escribir el código en «Mis médicos»: ', h('span', { class: 'code' }, code)),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', onclick: async () => { try { await navigator.clipboard.writeText(text); toast('Mensaje copiado.'); } catch { toast('Seleccioná el enlace y copialo.'); } } }, 'Copiar mensaje'),
      h('a', { class: 'btn', href: 'https://wa.me/?text=' + encodeURIComponent(text), target: '_blank', rel: 'noopener' }, 'Enviar por WhatsApp'),
      h('button', { class: 'btn quiet', onclick: close }, 'Cerrar')))));
}
async function doctorPatient() {
  loading();
  const pid = state.patientId;
  const { data: p, error } = await sb.from('profiles').select('id, full_name, email, birth_date').eq('id', pid).maybeSingle();
  if (error || !p) { toast('Ese paciente ya no está vinculado con vos.'); return go('pacientes'); }
  const { data: studies, error: e2 } = await sb.from('studies').select('id, title, study_date, status, published_at, first_viewed_at, feedback').eq('patient_id', pid).order('study_date', { ascending: false });
  if (e2) return showError(e2, doctorPatient);
  const m = mainEl();
  const age = ageFrom(p.birth_date);
  m.append(h('div', { class: 'row' }, h('button', { class: 'btn quiet sm', onclick: () => go('pacientes') }, '‹ Pacientes')));
  m.append(h('div', { class: 'card' }, h('div', { class: 'row' }, h('h1', { class: 'grow' }, p.full_name || p.email), age != null ? h('span', { class: 'pill' }, age + ' años') : null), h('p', { class: 'muted small' }, p.email)));
  m.append(newStudyCard(p));
  const card = h('div', { class: 'card' }, h('h2', {}, 'Estudios'));
  if (!studies.length) card.append(h('p', { class: 'muted' }, 'Todavía no cargaste estudios para este paciente.'));
  const FB = { si: 'Lo entendió', mas_o_menos: 'Lo entendió más o menos', no: 'No lo entendió' };
  card.append(h('div', { class: 'list' }, ...studies.map(s => h('button', { class: 'item', onclick: () => go('estudio-medico', { studyId: s.id, patientId: pid }) },
    h('div', { class: 'row' }, h('h3', {}, s.title), h('span', { class: 'pill ' + (s.status === 'publicado' ? 'ok' : 'warn') }, s.status === 'publicado' ? 'Publicado' : 'Borrador'), h('span', { class: 'pill' }, fmtDate(s.study_date))),
    h('span', { class: 'muted small' }, s.status === 'publicado' ? (s.first_viewed_at ? `Visto el ${fmtDate(s.first_viewed_at)}` : 'Todavía no lo abrió') + (s.feedback ? ' · ' + FB[s.feedback] : '') : 'Solo lo ves vos')))));
  m.append(card);
}
function newStudyCard(p) {
  // Hecho por ChatGPT · 2026-11-02 · Borrador de médico por paciente,
  // sólo en memoria de la pestaña y sin repetir envíos al navegar.
  const key='doctor-new:'+p.id;
  const draft=studyEditDrafts.get(key)||{title:'',date:todayISO(),text:'',file:null};
  studyEditDrafts.set(key,draft);
  let date=draft.date;
  const title = h('input', { type: 'text', id: 'ns-title', placeholder: 'Ej.: Análisis de sangre',
    value:draft.title });
  title.addEventListener('input',()=>{draft.title=title.value;});
  const file = h('input', { type: 'file', id: 'ns-file', accept: UPLOAD_TYPES.join(',') });
  file.addEventListener('change',()=>{draft.file=file.files?.[0]||null;});
  const text = h('textarea', { id: 'ns-text', class: 'report',
    placeholder: 'O pegá acá el texto del informe…' },draft.text);
  text.addEventListener('input',()=>{draft.text=text.value;});
  const msg = h('div', { role: 'alert' });
  if(draft.pending){msg.className='alert info';msg.textContent='La carga de este estudio sigue en curso.';}
  const btn = h('button', { class: 'btn primary', disabled:!!draft.pending }, 'Crear estudio');
  btn.addEventListener('click', async () => {
    if(draft.pending)return toast('Ya se está guardando este estudio.');
    msg.className = ''; msg.textContent = '';
    const f = file.files?.[0]||draft.file;
    if (!title.value.trim()) { msg.className = 'alert bad'; msg.textContent = 'Escribí el nombre del estudio.'; return; }
    if (!date) { msg.className = 'alert bad'; msg.textContent = 'Revisá la fecha: usá día/mes/año.'; return; }
    if (!f && !text.value.trim()) { msg.className = 'alert bad'; msg.textContent = 'Subí el archivo o pegá el texto del informe.'; return; }
    if (f && (!UPLOAD_TYPES.includes(f.type) || f.size > MAX_UPLOAD)) { msg.className = 'alert bad'; msg.textContent = 'El archivo tiene que ser PDF, JPG o PNG de hasta 20 MB. Si es Word, guardalo como PDF.'; return; }
    draft.pending=true;
    const epoch=navigationEpoch, owner=state.me.id;
    btn.disabled = true; btn.textContent = 'Creando…';
    try{
      const { data: st, error } = await sb.from('studies').insert({
        patient_id: p.id, doctor_id: owner, title: title.value.trim(),
        study_date: date, report_text: text.value.trim()
      }).select('id').single();
      if (error||!st) throw error||new Error('No se pudo registrar el estudio.');
      if (f) {
        const path = `${p.id}/${st.id}/${safeFileName(f.name)}`;
        const { error: upErr } = await sb.storage.from('estudios').upload(path, f, { contentType: f.type, upsert: false });
        if (upErr) throw new Error('El estudio se creó pero falló la carga del archivo: '+errorText(upErr));
        const {error:metadataError}=await sb.from('studies').update({
          file_path: path, file_name: f.name, file_type: f.type
        }).eq('id', st.id);
        if(metadataError) throw metadataError;
      }
      studyEditDrafts.delete(key);
      if(state.me?.id===owner && state.page==='paciente' && state.patientId===p.id
          && navigationEpoch===epoch)go('estudio-medico',{studyId:st.id,patientId:p.id});
      else{
        if(state.me?.id===owner)toast('El estudio quedó guardado en la ficha del paciente.');
        if(state.page==='paciente' && state.patientId===p.id)doctorPatient();
      }
    }catch(e){
      msg.className='alert bad';msg.textContent=errorText(e);
      if(state.page!=='paciente'||navigationEpoch!==epoch)toast('La carga no terminó: '+errorText(e));
    }finally{
      draft.pending=false;btn.disabled=false;btn.textContent='Crear estudio';
      if(state.page==='paciente'&&state.patientId===p.id&&navigationEpoch!==epoch)doctorPatient();
    }
  });
  return h('div', { class: 'card' }, h('h2', {}, 'Nuevo estudio'),
    h('div', { class: 'grid2' }, h('label', { class: 'field', for: 'ns-title' }, 'Nombre del estudio', title),
      h('div', { class: 'field' }, h('label', { for: 'ns-date', style: 'font-weight:700' }, 'Fecha del estudio'), datePicker({ id: 'ns-date', value: date, onChange: iso => { date = iso; draft.date=iso; } }))),
    h('label', { class: 'field', for: 'ns-file' }, 'Archivo del informe ', h('span', { class: 'hint' }, 'PDF o foto (JPG, PNG), hasta 20 MB. Solo informes escritos.'), filePicker(file)),
    h('label', { class: 'field', for: 'ns-text' }, 'Texto del informe ', h('span', { class: 'hint' }, '(si no subís archivo)'), text),
    draft.file?h('p',{class:'hint'},'Archivo seleccionado: '+draft.file.name):null,
    msg, h('div', { class: 'row' }, btn));
}

async function doctorStudy() {
  loading();
  const { data: s, error } = await sb.from('studies').select('*').eq('id', state.studyId).maybeSingle();
  if (error || !s) { toast('No encontramos ese estudio.'); return go('paciente', { patientId: state.patientId }); }
  const { data: p } = await sb.from('profiles').select('full_name, birth_date').eq('id', s.patient_id).maybeSingle();
  if (s.status === 'publicado') sb.rpc('log_study_access', { p_study: s.id, p_action: 'visto_por_medico' });
  // Hecho por ChatGPT · 2026-11-02 · Conservar cambios médicos no guardados
  // sólo en memoria al cambiar de sección; nunca en localStorage.
  const draftKey='doctor-edit:'+s.id;
  const previous=studyEditDrafts.get(draftKey);
  const ed = { ...s, ...(previous||{}),
    glossary: (previous?.glossary||s.glossary||[]).map(x=>({...x})),
    lab_values: (previous?.lab_values||s.lab_values||[]).map(x=>({...x})) };
  let dirty = !!previous, previewing = false;
  const markDirty = () => {
    dirty = true;
    studyEditDrafts.set(draftKey,{title:ed.title,study_date:ed.study_date,
      report_text:ed.report_text,explanation:ed.explanation,doctor_note:ed.doctor_note,
      glossary:ed.glossary.map(x=>({...x})),lab_values:ed.lab_values.map(x=>({...x}))});
    status.textContent = 'Cambios sin guardar'; status.className = 'pill warn';
  };
  const m = mainEl();
  const status = h('span', { class: 'pill ' + (dirty ? 'warn' : s.status === 'publicado' ? 'ok' : 'warn') },
    dirty ? 'Cambios sin guardar (conservados en esta pestaña)' : s.status === 'publicado' ? 'Publicado' : 'Borrador');
  const back = async () => {
    if(dirty)toast('Tus cambios siguen disponibles al volver a este estudio.');
    go('paciente', { patientId: s.patient_id });
  };
  m.append(h('div', { class: 'row' }, h('button', { class: 'btn quiet sm', onclick: back }, '‹ ' + ((p && p.full_name) || 'Paciente'))));

  async function save(extra = {}) {
    const row = { title: ed.title.trim(), study_date: ed.study_date, report_text: ed.report_text, explanation: ed.explanation, doctor_note: ed.doctor_note,
      glossary: ed.glossary.filter(g => g.termino && g.definicion), lab_values: ed.lab_values.filter(v => v.nombre), ...extra };
    if (!row.title) { toast('Escribí el nombre del estudio.'); return false; }
    if (!row.study_date) { toast('Revisá la fecha del estudio.'); return false; }
    const { data, error: e } = await sb.from('studies').update(row).eq('id', s.id).select('*').single();
    if (e) { toast(errorText(e)); return false; }
    Object.assign(s, data); Object.assign(ed, data, { glossary: [...(data.glossary || [])], lab_values: [...(data.lab_values || [])] });
    dirty = false;studyEditDrafts.delete(draftKey);
    status.textContent = s.status === 'publicado' ? 'Publicado' : 'Borrador'; status.className = 'pill ' + (s.status === 'publicado' ? 'ok' : 'warn');
    return true;
  }
  async function callAI(action, label, btn) {
    btn.disabled = true; const old = btn.textContent;
    btn.replaceChildren(h('span', { class: 'spinner' }), ' ' + label);
    const { data, error: e } = await pendingOnce(
      action === 'transcribir' ? runningStudyReads : runningStudyExplanations,
      'doctor:'+s.id, () => sb.functions.invoke('ia', { body: { action, study_id: s.id, force: action === 'transcribir' ? !!ed.report_text : !!ed.explanation } }));
    btn.disabled = false; btn.textContent = old;
    if (e) { toast(await fnError(e)); return null; }
    return data;
  }

  // 1. Datos e informe
  const title = h('input', { type: 'text', id: 'ed-title', value: ed.title, oninput: e => { ed.title = e.target.value; markDirty(); } });
  const report = h('textarea', { id: 'ed-report', class: 'report', oninput: e => { ed.report_text = e.target.value; markDirty(); } }, ed.report_text);
  const readBtn = h('button', { class: 'btn' }, 'Leer el archivo con IA');
  readBtn.addEventListener('click', async () => {
    if (ed.report_text.trim() && !await confirmBox({ title: 'Reemplazar el texto', text: 'El texto del informe se va a reemplazar por lo que lea la IA del archivo.', ok: 'Reemplazar' })) return;
    const data = await callAI('transcribir', 'Leyendo el archivo… puede tardar un minuto', readBtn);
    if (!data) return;
    ed.report_text = data.text; report.value = data.text; markDirty();
    if (await save()) toast('Texto leído. Revisalo y corregí lo que haga falta.');
  });
  m.append(h('div', { class: 'card' }, h('div', { class: 'row' }, h('h1', { class: 'grow' }, 'Estudio'), status),
    h('div', { class: 'grid2' }, h('label', { class: 'field', for: 'ed-title' }, 'Nombre del estudio', title),
      h('div', { class: 'field' }, h('label', { for: 'ed-date', style: 'font-weight:700' }, 'Fecha del estudio'), datePicker({ id: 'ed-date', value: ed.study_date, onChange: iso => { ed.study_date = iso; markDirty(); } }))),
    s.file_path ? h('div', { class: 'row' }, h('span', { class: 'grow muted' }, 'Archivo: ' + (s.file_name || s.file_path)), h('button', { class: 'btn quiet sm', onclick: () => openOriginal(s) }, 'Ver original'), readBtn) : null,
    h('label', { class: 'field', for: 'ed-report' }, 'Texto del informe ', h('span', { class: 'hint' }, 'Es lo que lee la IA. Revisá que esté completo y bien transcripto.'), report)));

  // 2. Explicación
  const genBtn = h('button', { class: 'btn primary big' }, ed.explanation ? 'Volver a generar con IA' : 'Generar explicación con IA');
  const expl = h('textarea', { id: 'ed-expl', style: 'min-height:18rem', oninput: e => { ed.explanation = e.target.value; markDirty(); } }, ed.explanation);
  const glossBox = h('div', { class: 'edit-table' });
  const valBox = h('div', { class: 'edit-table' });
  const note = h('textarea', { id: 'ed-note', style: 'min-height:5rem', oninput: e => { ed.doctor_note = e.target.value; markDirty(); } }, ed.doctor_note);
  const paintGloss = () => {
    glossBox.innerHTML = '';
    ed.glossary.forEach((g, i) => glossBox.append(h('div', { class: 'edit-row gl' },
      h('input', { type: 'text', 'aria-label': 'Término', value: g.termino, oninput: e => { g.termino = e.target.value; markDirty(); } }),
      h('input', { type: 'text', 'aria-label': 'Definición', value: g.definicion, oninput: e => { g.definicion = e.target.value; markDirty(); } }),
      h('button', { class: 'btn quiet sm', 'aria-label': 'Quitar término', onclick: () => { ed.glossary.splice(i, 1); markDirty(); paintGloss(); } }, '✕'))));
    glossBox.append(h('div', {}, h('button', { class: 'btn quiet sm', onclick: () => { ed.glossary.push({ termino: '', definicion: '' }); paintGloss(); } }, 'Agregar término')));
  };
  const numOrNull = v => { const n = Number(String(v).replace(',', '.')); return String(v).trim() === '' || !Number.isFinite(n) ? null : n; };
  const paintVals = () => {
    valBox.innerHTML = '';
    if (ed.lab_values.length) valBox.append(h('div', { class: 'edit-row small muted' }, h('span', {}, 'Nombre'), h('span', {}, 'Valor'), h('span', {}, 'Unidad'), h('span', {}, 'Mín.'), h('span', {}, 'Máx.'), h('span')));
    ed.lab_values.forEach((v, i) => valBox.append(h('div', { class: 'edit-row' },
      h('input', { type: 'text', 'aria-label': 'Nombre', value: v.nombre, oninput: e => { v.nombre = e.target.value; markDirty(); } }),
      h('input', { type: 'text', inputmode: 'decimal', 'aria-label': 'Valor', value: v.valor ?? '', oninput: e => { v.valor = numOrNull(e.target.value); v.valor_texto = e.target.value; markDirty(); } }),
      h('input', { type: 'text', 'aria-label': 'Unidad', value: v.unidad, oninput: e => { v.unidad = e.target.value; markDirty(); } }),
      h('input', { type: 'text', inputmode: 'decimal', 'aria-label': 'Referencia mínima', value: v.ref_min ?? '', oninput: e => { v.ref_min = numOrNull(e.target.value); markDirty(); } }),
      h('input', { type: 'text', inputmode: 'decimal', 'aria-label': 'Referencia máxima', value: v.ref_max ?? '', oninput: e => { v.ref_max = numOrNull(e.target.value); markDirty(); } }),
      h('button', { class: 'btn quiet sm', 'aria-label': 'Quitar valor', onclick: () => { ed.lab_values.splice(i, 1); markDirty(); paintVals(); } }, '✕'))));
    valBox.append(h('div', {}, h('button', { class: 'btn quiet sm', onclick: () => { ed.lab_values.push({ nombre: '', valor: null, valor_texto: '', unidad: '', referencia_texto: '', ref_min: null, ref_max: null }); paintVals(); } }, 'Agregar valor')));
  };
  paintGloss(); paintVals();
  genBtn.addEventListener('click', async () => {
    if (!ed.report_text.trim()) return toast('Primero cargá o pegá el texto del informe.');
    if (ed.explanation.trim() && !await confirmBox({ title: 'Generar de nuevo', text: 'La explicación, el glosario y los valores actuales se van a reemplazar por un borrador nuevo.', ok: 'Generar' })) return;
    if (dirty && !await save()) return;
    const data = await callAI('explicar', 'Escribiendo la explicación… puede tardar hasta dos minutos', genBtn);
    if (!data) return;
    ed.explanation = (data.aviso_urgente ? `## Aviso importante del informe\n${data.aviso_urgente}\n\n` : '') + data.explicacion;
    ed.glossary = data.glosario || []; ed.lab_values = data.valores || [];
    expl.value = ed.explanation; paintGloss(); paintVals(); markDirty();
    if (await save({ ai_model: data.model, ai_generated_at: new Date().toISOString() })) toast('Borrador listo. Revisalo antes de publicar.');
    genBtn.textContent = 'Volver a generar con IA';
  });
  const previewBox = h('div', { class: 'stack' });
  const previewBtn = h('button', { class: 'btn' }, 'Ver como lo verá el paciente');
  previewBtn.addEventListener('click', async () => {
    previewing = !previewing; previewBox.innerHTML = '';
    previewBtn.textContent = previewing ? 'Ocultar vista previa' : 'Ver como lo verá el paciente';
    if (!previewing) return;
    const { data: others } = await sb.from('studies').select('id, study_date, lab_values').eq('patient_id', s.patient_id).eq('status', 'publicado').neq('id', s.id);
    const current = { ...ed, published_at: s.published_at };
    previewBox.append(h('div', { class: 'alert info' }, 'Vista previa: así lo verá el paciente.'), ...studyView(current, state.me.full_name, [...(others || []), current], true));
  });
  m.append(h('div', { class: 'card' }, h('h2', {}, 'Explicación para el paciente'),
    h('p', { class: 'muted small' }, 'La IA prepara un borrador a partir del texto del informe y de los estudios publicados anteriores. Revisalo y corregilo: lo que publicás queda bajo tu criterio.'),
    h('div', { class: 'row' }, genBtn), s.ai_generated_at ? h('p', { class: 'muted small' }, `Último borrador de IA: ${fmtDateTime(s.ai_generated_at)}`) : null,
    h('label', { class: 'field', for: 'ed-expl' }, 'Explicación ', h('span', { class: 'hint' }, 'Usá «## » para títulos y «- » para viñetas.'), expl),
    h('div', { class: 'stack' }, h('h3', {}, 'Glosario'), h('p', { class: 'muted small' }, 'Estas palabras aparecen subrayadas para el paciente; al tocarlas ve la definición.'), glossBox),
    h('div', { class: 'stack' }, h('h3', {}, 'Valores del informe'), h('p', { class: 'muted small' }, 'Se muestran con su rango de referencia y en el gráfico de evolución. Verificá cada número contra el informe.'), valBox),
    h('label', { class: 'field', for: 'ed-note' }, 'Nota personal para el paciente ', h('span', { class: 'hint' }, '(opcional)'), note),
    h('div', { class: 'row' }, previewBtn), previewBox));

  // 3. Guardar y publicar
  const reviewed = h('input', { type: 'checkbox', id: 'ed-reviewed' });
  const pubBtn = h('button', { class: 'btn primary big', disabled: true }, s.status === 'publicado' ? 'Guardar cambios publicados' : 'Publicar para el paciente');
  reviewed.addEventListener('change', () => { pubBtn.disabled = !reviewed.checked; });
  pubBtn.addEventListener('click', async () => {
    if (!ed.explanation.trim()) return toast('Falta la explicación.');
    const wasPublished = s.status === 'publicado';
    if (await save({ status: 'publicado' })) { toast(wasPublished ? 'Cambios guardados. El paciente ve la versión nueva.' : 'Publicado. El paciente ya lo puede ver.'); go('paciente', { patientId: s.patient_id }); }
  });
  const actions = h('div', { class: 'row' },
    h('button', { class: 'btn', onclick: async () => { if (await save()) toast('Guardado.'); } }, 'Guardar borrador'));
  if (s.status === 'publicado') actions.append(h('button', { class: 'btn danger', onclick: async () => {
    if (!await confirmBox({ title: 'Retirar el estudio', text: 'El paciente deja de verlo hasta que lo vuelvas a publicar.', ok: 'Retirar', danger: true })) return;
    if (await save({ status: 'borrador' })) { toast('Retirado. El paciente ya no lo ve.'); doctorStudy(); }
  } }, 'Retirar'));
  else actions.append(h('button', { class: 'btn danger', onclick: async () => {
    if (!await confirmBox({ title: 'Borrar el borrador', text: 'Se borran el estudio y su archivo. No se puede deshacer.', ok: 'Borrar', danger: true })) return;
    if (s.storage_backend === 'debian' && s.storage_file_id) {
      try { await archivoDebian('delete', s.id, s.storage_file_id); }
      catch (e) { return toast('No se pudo borrar el archivo: ' + errorText(e)); }
    } else if (s.file_path) {
      const { error: delErr } = await sb.storage.from('estudios').remove([s.file_path]);
      if (delErr) return toast(errorText(delErr));
    }
    const { error: e } = await sb.from('studies').delete().eq('id', s.id);
    if (e) return toast(errorText(e));
    dirty = false;studyEditDrafts.delete(draftKey);
    toast('Borrador borrado.'); go('paciente', { patientId: s.patient_id });
  } }, 'Borrar borrador'));
  const FB = { si: 'Respondió que lo entendió.', mas_o_menos: 'Respondió que lo entendió más o menos.', no: 'Respondió que no lo entendió.' };
  m.append(h('div', { class: 'card' }, h('h2', {}, s.status === 'publicado' ? 'Publicado' : 'Publicar'),
    s.status === 'publicado' ? h('p', { class: 'muted' }, `Publicado el ${fmtDateTime(s.published_at)}. ${s.first_viewed_at ? 'El paciente lo abrió el ' + fmtDateTime(s.first_viewed_at) + '.' : 'El paciente todavía no lo abrió.'} ${s.feedback ? FB[s.feedback] : ''}`) : null,
    h('label', { class: 'check', for: 'ed-reviewed' }, reviewed, 'Revisé el texto del informe, la explicación, el glosario y los valores.'),
    h('div', { class: 'row' }, pubBtn), actions));
  window.onbeforeunload = () => (dirty ? true : undefined);
}

function showError(error, retry) {
  const m = mainEl();
  m.append(h('div', { class: 'card' }, h('div', { class: 'alert bad' }, errorText(error)), h('div', { class: 'row' }, h('button', { class: 'btn', onclick: retry }, 'Reintentar'))));
}

boot();
