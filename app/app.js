'use strict';
/* Chely · app del piloto.
   Paciente: ve los estudios que su médico publicó, explicados en palabras simples.
   Médico: invita pacientes, sube estudios, genera el borrador con IA, lo revisa y lo publica.
   La seguridad real está en la base (RLS): esta app solo muestra lo que la base permite. */

const CFG = window.CHELY_CONFIG || {};
const CONSENT = {
  patient: { version: 'paciente-v2', title: 'Consentimiento para pacientes' },
  doctor: { version: 'medico-v1', title: 'Condiciones para profesionales' },
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
  const wrap = h('div', { class: 'row', style: 'position:relative;flex-wrap:nowrap' });
  const input = h('input', { type: 'text', id, inputmode: 'numeric', placeholder: 'dd/mm/aaaa', autocomplete: 'off', value: value ? fmtDate(value) : '' });
  const btn = h('button', { type: 'button', class: 'btn quiet', 'aria-label': 'Abrir calendario' }, 'Calendario');
  let pop = null;
  const set = iso => { input.value = iso ? fmtDate(iso) : ''; onChange(iso); };
  input.addEventListener('input', () => {
    let v = input.value.replace(/[^\d]/g, '').slice(0, 8);
    if (v.length > 4) v = v.slice(0, 2) + '/' + v.slice(2, 4) + '/' + v.slice(4); else if (v.length > 2) v = v.slice(0, 2) + '/' + v.slice(2);
    input.value = v; onChange(parseDMY(v));
  });
  const close = () => { if (pop) { pop.remove(); pop = null; document.removeEventListener('pointerdown', outside, true); } };
  const outside = e => { if (pop && !wrap.contains(e.target)) close(); };
  btn.addEventListener('click', () => {
    if (pop) return close();
    const cur = parseDMY(input.value) || todayISO();
    let y = +cur.slice(0, 4), m = +cur.slice(5, 7) - 1;
    pop = h('div', { class: 'card', role: 'dialog', 'aria-label': 'Calendario', style: 'position:absolute;z-index:20;top:calc(100% + .4rem);left:0;width:min(21rem,calc(100vw - 32px));box-shadow:0 10px 30px rgba(0,0,0,.2);gap:.5rem' });
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
    draw(); wrap.append(pop); setTimeout(() => document.addEventListener('pointerdown', outside, true));
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

function shell(nav) {
  const top = $('#top'); top.innerHTML = '';
  const brand = h('a', { class: 'brand', href: '#', onclick: e => { e.preventDefault(); go(state.me && state.me.role === 'doctor' ? 'pacientes' : 'estudios'); } },
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
  state.page = page; state.studyId = extra.studyId || null; state.patientId = extra.patientId ?? (page === 'paciente' || page === 'estudio-medico' ? state.patientId : null);
  render(); window.scrollTo({ top: 0 });
}
async function signOut() { await sb.auth.signOut(); state.me = null; state.page = null; render(); }
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
    if (event === 'SIGNED_OUT') state.me = null;
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
    const c = CONSENT[state.me.role];
    if (state.me.consent_version !== c.version) return viewConsent();
    const invite = pendingInvite();
    if (invite && state.me.role === 'patient') {
      clearInvite();
      const { error } = await sb.rpc('redeem_invitation', { p_code: invite });
      if (error) toast(errorText(error)); else toast('Listo: tu médico ya puede enviarte estudios.');
    } else if (invite) clearInvite();
    if (state.me.role === 'doctor') return renderDoctor();
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
    const info = h('div', { class: 'alert info' }, 'Revisando tu invitación…');
    box.append(info);
    sb.rpc('invitation_info', { p_code: invite }).then(({ data }) => {
      const row = data && data[0];
      info.textContent = !row ? 'El código de invitación no existe. Revisalo con tu médico.'
        : !row.valid ? 'Esta invitación venció o ya se usó. Pedile una nueva a tu médico.'
        : `${row.doctor_name || 'Tu médico'} te invitó a Chely para recibir tus estudios explicados. Creá tu cuenta o entrá si ya tenés una.`;
      if (!row || !row.valid) { info.className = 'alert warn'; clearInvite(); }
    });
  } else {
    box.append(h('div', { class: 'stack' }, h('h1', {}, 'Tus estudios, en criollo'), h('p', { class: 'muted' }, 'Entrá para ver tus estudios explicados por tu médico.')));
  }
  const tabs = h('div', { class: 'tabs', role: 'tablist' },
    h('button', { role: 'tab', 'aria-selected': String(authTab === 'entrar'), onclick: () => { authTab = 'entrar'; viewAuth(); } }, 'Entrar'),
    h('button', { role: 'tab', 'aria-selected': String(authTab === 'crear'), onclick: () => { authTab = 'crear'; viewAuth(); } }, 'Crear cuenta'));
  box.append(tabs);
  const msg = h('div', { role: 'alert' });
  const email = h('input', { type: 'email', id: 'auth-email', autocomplete: 'email', required: true });
  const pass = h('input', { type: 'password', id: 'auth-pass', autocomplete: authTab === 'crear' ? 'new-password' : 'current-password', required: true, minlength: authTab === 'crear' ? 8 : null });
  const showPass = h('label', { class: 'check small' }, h('input', { type: 'checkbox', onchange: e => { pass.type = e.target.checked ? 'text' : 'password'; } }), 'Mostrar contraseña');
  const form = h('form', { class: 'stack', novalidate: true });
  let name = null;
  if (authTab === 'crear') {
    name = h('input', { type: 'text', id: 'auth-name', autocomplete: 'name', required: true });
    form.append(h('label', { class: 'field', for: 'auth-name' }, 'Nombre y apellido', name));
  }
  form.append(h('label', { class: 'field', for: 'auth-email' }, 'Correo electrónico', email),
    h('label', { class: 'field', for: 'auth-pass' }, 'Contraseña', authTab === 'crear' ? h('span', { class: 'hint' }, 'Al menos 8 caracteres.') : null, pass), showPass, msg);
  const submit = h('button', { class: 'btn primary big', type: 'submit' }, authTab === 'crear' ? 'Crear cuenta' : 'Entrar');
  form.append(submit);
  form.addEventListener('submit', async e => {
    e.preventDefault(); msg.className = ''; msg.textContent = '';
    const em = email.value.trim(), pw = pass.value;
    if (!/^\S+@\S+\.\S+$/.test(em)) { msg.className = 'alert bad'; msg.textContent = 'Revisá el correo electrónico.'; return; }
    if (authTab === 'crear' && (!name.value.trim() || pw.length < 8)) { msg.className = 'alert bad'; msg.textContent = !name.value.trim() ? 'Escribí tu nombre y apellido.' : 'La contraseña tiene que tener al menos 8 caracteres.'; return; }
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
  const pass = h('input', { type: 'password', id: 'new-pass', autocomplete: 'new-password', minlength: 8 });
  const msg = h('div', { role: 'alert' });
  const form = h('form', { class: 'stack' }, h('label', { class: 'field', for: 'new-pass' }, 'Contraseña nueva', h('span', { class: 'hint' }, 'Al menos 8 caracteres.'), pass), msg, h('button', { class: 'btn primary big', type: 'submit' }, 'Guardar contraseña'));
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (pass.value.length < 8) { msg.className = 'alert bad'; msg.textContent = 'La contraseña tiene que tener al menos 8 caracteres.'; return; }
    const { error } = await sb.auth.updateUser({ password: pass.value });
    if (error) { msg.className = 'alert bad'; msg.textContent = errorText(error); return; }
    state.recovery = false; toast('Contraseña actualizada.'); render();
  });
  m.append(h('div', { class: 'card auth' }, h('h1', {}, 'Elegí una contraseña nueva'), form));
}

/* ---------------- consentimiento ---------------- */
function consentBody(role) {
  const ul = items => h('ul', {}, ...items.map(t => h('li', {}, t)));
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
    h('label', { class: 'check', for: 'consent-ok' }, ok, state.me.role === 'doctor' ? 'Leí y acepto estas condiciones.' : 'Leí la información y acepto participar del piloto de Chely.'),
    h('div', { class: 'row' }, btn, h('button', { class: 'btn quiet', onclick: signOut }, 'No acepto'))));
}

/* ---------------- paciente ---------------- */
async function renderPatient() {
  if (!['estudios', 'estudio', 'subir', 'mi-estudio', 'medicos', 'cuenta'].includes(state.page)) state.page = 'estudios';
  shell(navFor([['estudios', 'Mis estudios'], ['medicos', 'Mis médicos'], ['cuenta', 'Mi cuenta']]));
  if (state.page === 'estudio') return patientStudy();
  if (state.page === 'subir') return patientUpload();
  if (state.page === 'mi-estudio') return patientOwnStudy();
  if (state.page === 'medicos') return patientDoctors();
  if (state.page === 'cuenta') return accountView();
  return patientStudies();
}
async function loadPatientStudies() {
  const { data, error } = await sb.from('studies')
    .select('id, title, study_date, status, self_uploaded, report_text, published_at, first_viewed_at, doctor_id, explanation, glossary, lab_values, doctor_note, file_path, file_name, file_type, feedback, ai_generated_at')
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
  const m = mainEl();
  m.append(h('div', { class: 'row' }, h('h1', { class: 'grow' }, `Hola, ${state.me.full_name.split(' ')[0] || ''}`)));
  m.append(h('div', { class: 'card' }, h('h2', {}, 'Entendé tu estudio'),
    h('p', {}, 'Subí un análisis o un informe (PDF, foto o texto) y Chely te lo explica en palabras simples.'),
    h('div', { class: 'row' }, h('button', { class: 'btn primary big', onclick: () => go('subir') }, 'Subir un estudio'))));
  const card = h('div', { class: 'card' }, h('h2', {}, 'Mis estudios'));
  if (!studies.length) card.append(h('p', { class: 'muted' }, 'Todavía no tenés estudios. Tocá «Subir un estudio» para empezar.'));
  const list = h('div', { class: 'list' });
  for (const s of studies) {
    const pending = s.self_uploaded && s.status !== 'publicado';
    list.append(h('button', { class: 'item', onclick: () => go(pending ? 'mi-estudio' : 'estudio', { studyId: s.id }) },
      h('div', { class: 'row' }, h('h3', {}, s.title),
        pending ? h('span', { class: 'pill warn' }, 'Sin explicar') : !s.self_uploaded && !s.first_viewed_at ? h('span', { class: 'pill bad' }, 'Nuevo') : null,
        h('span', { class: 'pill' }, fmtDate(s.study_date))),
      h('span', { class: 'muted small' }, s.self_uploaded ? 'Subido por vos' : `Enviado por ${names[s.doctor_id] || 'tu médico'} el ${fmtDate(s.published_at)}`)));
  }
  card.append(list);
  m.append(card);
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
  if (s.file_path) await sb.storage.from('estudios').remove([s.file_path]);
  const { error } = await sb.from('studies').delete().eq('id', s.id);
  if (error) return toast(errorText(error));
  toast('Estudio borrado.'); go('estudios');
}

// El paciente sube un estudio propio.
// Selector de archivo propio: el del navegador muestra sus textos en el idioma del sistema.
function filePicker(input) {
  input.className = 'file-input';
  const none = 'Ningún archivo elegido';
  const name = h('span', { class: 'hint' }, none);
  input.addEventListener('change', () => { name.textContent = input.files[0]?.name || none; });
  return h('span', { class: 'filepick' }, input, h('span', { class: 'btn', 'aria-hidden': 'true' }, 'Elegir archivo'), name);
}

function patientUpload() {
  const m = mainEl();
  let date = todayISO();
  const title = h('input', { type: 'text', id: 'up-title', placeholder: 'Ej.: Análisis de sangre' });
  const file = h('input', { type: 'file', id: 'up-file', accept: UPLOAD_TYPES.join(',') });
  const text = h('textarea', { id: 'up-text', class: 'report', placeholder: 'O pegá acá el texto del informe…' });
  const msg = h('div', { role: 'alert' });
  const btn = h('button', { class: 'btn primary big' }, 'Subir estudio');
  btn.addEventListener('click', async () => {
    msg.className = ''; msg.textContent = '';
    const f = file.files[0];
    if (!title.value.trim()) { msg.className = 'alert bad'; msg.textContent = 'Escribí qué estudio es (por ejemplo, «Análisis de sangre»).'; return; }
    if (!date) { msg.className = 'alert bad'; msg.textContent = 'Revisá la fecha: usá día/mes/año.'; return; }
    if (!f && !text.value.trim()) { msg.className = 'alert bad'; msg.textContent = 'Elegí el archivo del informe o pegá su texto.'; return; }
    if (f && (!UPLOAD_TYPES.includes(f.type) || f.size > MAX_UPLOAD)) { msg.className = 'alert bad'; msg.textContent = 'El archivo tiene que ser PDF, JPG o PNG de hasta 20 MB. Si es Word, guardalo como PDF.'; return; }
    btn.disabled = true; btn.replaceChildren(h('span', { class: 'spinner' }), ' Subiendo…');
    const { data: st, error } = await sb.from('studies').insert({ patient_id: state.me.id, doctor_id: null, self_uploaded: true, title: title.value.trim(), study_date: date, report_text: text.value.trim() }).select('id').single();
    if (error) { btn.disabled = false; btn.textContent = 'Subir estudio'; msg.className = 'alert bad'; msg.textContent = errorText(error); return; }
    if (f) {
      const path = `${state.me.id}/${st.id}/${safeFileName(f.name)}`;
      const { error: upErr } = await sb.storage.from('estudios').upload(path, f, { contentType: f.type, upsert: false });
      if (upErr) toast('El estudio se guardó, pero el archivo no se pudo subir. Podés pegar el texto.');
      else await sb.from('studies').update({ file_path: path, file_name: f.name, file_type: f.type }).eq('id', st.id);
    }
    go('mi-estudio', { studyId: st.id });
  });
  m.append(h('div', { class: 'row' }, h('button', { class: 'btn quiet sm', onclick: () => go('estudios') }, '‹ Mis estudios')));
  m.append(h('div', { class: 'card' }, h('h1', {}, 'Subir un estudio'),
    h('p', { class: 'muted' }, 'Solo informes escritos: análisis, ecografías, radiografías, etc. Chely no interpreta las imágenes de las placas.'),
    h('div', { class: 'grid2' }, h('label', { class: 'field', for: 'up-title' }, '¿Qué estudio es?', title),
      h('div', { class: 'field' }, h('label', { for: 'up-date', style: 'font-weight:700' }, 'Fecha del estudio'), datePicker({ id: 'up-date', value: date, onChange: iso => { date = iso; } }))),
    h('label', { class: 'field', for: 'up-file' }, 'Archivo del informe ', h('span', { class: 'hint' }, 'PDF o foto (JPG, PNG), hasta 20 MB.'), filePicker(file)),
    h('label', { class: 'field', for: 'up-text' }, 'O el texto del informe ', h('span', { class: 'hint' }, '(si no tenés el archivo)'), text),
    msg, h('div', { class: 'row' }, btn)));
}

// Estudio propio sin explicar: revisar el texto y pedir la explicación.
async function patientOwnStudy() {
  loading();
  let studies;
  try { studies = await loadPatientStudies(); } catch (e) { return showError(e, patientOwnStudy); }
  const s = studies.find(x => x.id === state.studyId && x.self_uploaded);
  if (!s) { toast('No encontramos ese estudio.'); return go('estudios'); }
  const m = mainEl();
  const report = h('textarea', { id: 'own-report', class: 'report' }, s.report_text);
  const status = h('div', { role: 'status' });
  const busy = (btn, label) => { btn.disabled = true; const old = btn.textContent; btn.replaceChildren(h('span', { class: 'spinner' }), ' ' + label); return () => { btn.disabled = false; btn.textContent = old; }; };
  const saveText = async () => {
    const { error } = await sb.from('studies').update({ report_text: report.value.trim() }).eq('id', s.id);
    if (error) { toast(errorText(error)); return false; }
    s.report_text = report.value.trim(); return true;
  };
  const readBtn = h('button', { class: 'btn' }, 'Leer el archivo');
  readBtn.addEventListener('click', async () => {
    const done = busy(readBtn, 'Leyendo el archivo… puede tardar un minuto');
    const { data, error } = await sb.functions.invoke('ia', { body: { action: 'transcribir', study_id: s.id } });
    done();
    if (error) { status.className = 'alert bad'; status.textContent = await fnError(error); return; }
    report.value = data.text; await saveText();
    status.className = 'alert ok'; status.textContent = 'Listo. Revisá que el texto sea igual al del informe y corregí lo que haga falta.';
  });
  const explainBtn = h('button', { class: 'btn primary big' }, 'Explicar mi estudio');
  explainBtn.addEventListener('click', async () => {
    if (!report.value.trim()) { status.className = 'alert bad'; status.textContent = 'Falta el texto del informe. Tocá «Leer el archivo» o pegalo.'; return; }
    if (!await saveText()) return;
    status.className = 'alert info'; status.textContent = 'Chely está leyendo tu estudio y escribiendo la explicación. Puede tardar hasta dos minutos; no cierres esta pantalla.';
    const done = busy(explainBtn, 'Escribiendo la explicación…');
    const { data, error } = await sb.functions.invoke('ia', { body: { action: 'explicar', study_id: s.id } });
    if (error) { done(); status.className = 'alert bad'; status.textContent = await fnError(error); return; }
    const explanation = (data.aviso_urgente ? `## Aviso importante del informe\n${data.aviso_urgente}\n\n` : '') + data.explicacion;
    const { error: e2 } = await sb.from('studies').update({ explanation, glossary: data.glosario || [], lab_values: data.valores || [],
      ai_model: data.model, ai_generated_at: new Date().toISOString(), status: 'publicado' }).eq('id', s.id);
    done();
    if (e2) { status.className = 'alert bad'; status.textContent = errorText(e2); return; }
    go('estudio', { studyId: s.id });
  });
  m.append(h('div', { class: 'row' }, h('button', { class: 'btn quiet sm', onclick: () => go('estudios') }, '‹ Mis estudios')));
  m.append(h('div', { class: 'card' }, h('div', { class: 'row' }, h('h1', { class: 'grow' }, s.title), h('span', { class: 'pill' }, fmtDate(s.study_date))),
    s.file_path ? h('div', { class: 'row' }, h('span', { class: 'grow muted' }, 'Archivo: ' + (s.file_name || 'informe')), h('button', { class: 'btn quiet sm', onclick: () => openOriginal(s) }, 'Ver archivo'), readBtn) : null,
    h('label', { class: 'field', for: 'own-report' }, 'Texto del informe ', h('span', { class: 'hint' }, 'Es lo que lee Chely. Revisá que esté completo y sin errores.'), report),
    status,
    h('div', { class: 'row' }, explainBtn),
    h('p', { class: 'muted small' }, 'La explicación la escribe una inteligencia artificial y no la revisa un médico. Puede tener errores: llevala a tu consulta.'),
    h('div', { class: 'row' }, h('button', { class: 'btn danger sm', onclick: () => deleteOwnStudy(s) }, 'Borrar este estudio'))));
  if (s.file_path && !s.report_text) readBtn.click();
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
  const vals = renderValues(s.lab_values); if (vals) parts.push(vals);
  const evo = renderEvolution(allStudies.filter(x => x.lab_values && x.lab_values.length)); if (evo) parts.push(evo);
  if (s.file_path && !preview) parts.push(h('div', { class: 'card' }, h('h2', {}, 'Informe original'),
    h('div', { class: 'row' }, h('span', { class: 'grow muted' }, s.file_name || 'Archivo'), h('button', { class: 'btn', onclick: () => openOriginal(s) }, 'Ver el original'))));
  return parts;
}
async function openOriginal(s) {
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
async function accountView() {
  const m = mainEl();
  const me = state.me;
  const name = h('input', { type: 'text', id: 'acc-name', value: me.full_name, autocomplete: 'name' });
  let birth = me.birth_date;
  const saveBtn = h('button', { class: 'btn primary' }, 'Guardar');
  saveBtn.addEventListener('click', async () => {
    if (!name.value.trim()) return toast('Escribí tu nombre.');
    const { error } = await sb.from('profiles').update({ full_name: name.value.trim(), birth_date: birth || null }).eq('id', me.id);
    if (error) return toast(errorText(error));
    me.full_name = name.value.trim(); me.birth_date = birth || null; toast('Datos guardados.');
  });
  m.append(h('div', { class: 'card' }, h('h1', {}, 'Mi cuenta'), h('p', { class: 'muted' }, me.email),
    h('div', { class: 'grid2' }, h('label', { class: 'field', for: 'acc-name' }, 'Nombre y apellido', name),
      me.role === 'patient' ? h('div', { class: 'field' }, h('label', { for: 'acc-birth', style: 'font-weight:700' }, 'Fecha de nacimiento ', h('span', { class: 'hint' }, '(opcional)')),
        datePicker({ id: 'acc-birth', value: me.birth_date, onChange: iso => { birth = iso; } })) : null),
    h('div', { class: 'row' }, saveBtn)));

  const pass = h('input', { type: 'password', id: 'acc-pass', autocomplete: 'new-password', minlength: 8 });
  m.append(h('div', { class: 'card' }, h('h2', {}, 'Cambiar la contraseña'), h('label', { class: 'field', for: 'acc-pass' }, 'Contraseña nueva', h('span', { class: 'hint' }, 'Al menos 8 caracteres.'), pass),
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: async () => {
      if (pass.value.length < 8) return toast('La contraseña tiene que tener al menos 8 caracteres.');
      const { error } = await sb.auth.updateUser({ password: pass.value });
      if (error) return toast(errorText(error));
      pass.value = ''; toast('Contraseña actualizada.');
    } }, 'Cambiar contraseña'))));

  if (me.role === 'patient') {
    const logCard = h('div', { class: 'card' }, h('h2', {}, 'Quién vio tus estudios'), h('p', { class: 'muted small' }, 'Registro de las últimas acciones sobre tus estudios.'));
    m.append(logCard);
    const { data: log } = await sb.from('access_log').select('actor_id, action, at, study_id').order('at', { ascending: false }).limit(30);
    const names = await namesFor((log || []).map(l => l.actor_id));
    const LABEL = { estudio_creado: 'cargó un estudio', estudio_publicado: 'publicó un estudio', estudio_retirado: 'retiró un estudio', visto_por_paciente: 'abrió un estudio', visto_por_medico: 'abrió un estudio',
      original_descargado: 'abrió un informe original', medico_vinculado: 'vinculó un médico', medico_desvinculado: 'dejó de compartir con un médico', 'consentimiento_paciente-v1': 'aceptó el consentimiento', 'consentimiento_paciente-v2': 'aceptó el consentimiento' };
    if (!log || !log.length) logCard.append(h('p', { class: 'muted' }, 'Todavía no hay registros.'));
    else logCard.append(h('div', { class: 'list' }, ...log.map(l => h('div', { class: 'small' }, h('strong', {}, fmtDateTime(l.at)), ' · ', l.actor_id === me.id ? 'Vos' : (names[l.actor_id] || 'Un médico'), ' ', LABEL[l.action] || l.action))));
  }

  m.append(h('div', { class: 'card' }, h('h2', {}, 'Borrar mi cuenta'),
    h('p', {}, me.role === 'patient' ? 'Se borran tu cuenta, tus estudios, sus explicaciones y los archivos originales. No se puede deshacer.' : 'Se borra tu cuenta. Los estudios que publicaste siguen disponibles para tus pacientes.'),
    h('div', { class: 'row' }, h('button', { class: 'btn danger', onclick: async () => {
      if (!await confirmBox({ title: 'Borrar mi cuenta', text: 'Esta acción no se puede deshacer.', ok: 'Borrar definitivamente', danger: true, typed: 'BORRAR' })) return;
      const { error } = await sb.functions.invoke('borrar-cuenta', { body: { confirm: 'BORRAR' } });
      if (error) return toast(await fnError(error));
      await sb.auth.signOut(); toast('Tu cuenta fue borrada.');
    } }, 'Borrar mi cuenta'))));
}

/* ---------------- médico ---------------- */
async function renderDoctor() {
  if (!['pacientes', 'paciente', 'estudio-medico', 'cuenta'].includes(state.page)) state.page = 'pacientes';
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
  let date = todayISO();
  const title = h('input', { type: 'text', id: 'ns-title', placeholder: 'Ej.: Análisis de sangre' });
  const file = h('input', { type: 'file', id: 'ns-file', accept: UPLOAD_TYPES.join(',') });
  const text = h('textarea', { id: 'ns-text', class: 'report', placeholder: 'O pegá acá el texto del informe…' });
  const msg = h('div', { role: 'alert' });
  const btn = h('button', { class: 'btn primary' }, 'Crear estudio');
  btn.addEventListener('click', async () => {
    msg.className = ''; msg.textContent = '';
    const f = file.files[0];
    if (!title.value.trim()) { msg.className = 'alert bad'; msg.textContent = 'Escribí el nombre del estudio.'; return; }
    if (!date) { msg.className = 'alert bad'; msg.textContent = 'Revisá la fecha: usá día/mes/año.'; return; }
    if (!f && !text.value.trim()) { msg.className = 'alert bad'; msg.textContent = 'Subí el archivo o pegá el texto del informe.'; return; }
    if (f && (!UPLOAD_TYPES.includes(f.type) || f.size > MAX_UPLOAD)) { msg.className = 'alert bad'; msg.textContent = 'El archivo tiene que ser PDF, JPG o PNG de hasta 20 MB. Si es Word, guardalo como PDF.'; return; }
    btn.disabled = true; btn.textContent = 'Creando…';
    const { data: st, error } = await sb.from('studies').insert({ patient_id: p.id, doctor_id: state.me.id, title: title.value.trim(), study_date: date, report_text: text.value.trim() }).select('id').single();
    if (error) { btn.disabled = false; btn.textContent = 'Crear estudio'; msg.className = 'alert bad'; msg.textContent = errorText(error); return; }
    if (f) {
      const path = `${p.id}/${st.id}/${safeFileName(f.name)}`;
      const { error: upErr } = await sb.storage.from('estudios').upload(path, f, { contentType: f.type, upsert: false });
      if (upErr) toast('El estudio se creó, pero el archivo no se pudo subir: ' + errorText(upErr));
      else await sb.from('studies').update({ file_path: path, file_name: f.name, file_type: f.type }).eq('id', st.id);
    }
    go('estudio-medico', { studyId: st.id, patientId: p.id });
  });
  return h('div', { class: 'card' }, h('h2', {}, 'Nuevo estudio'),
    h('div', { class: 'grid2' }, h('label', { class: 'field', for: 'ns-title' }, 'Nombre del estudio', title),
      h('div', { class: 'field' }, h('label', { for: 'ns-date', style: 'font-weight:700' }, 'Fecha del estudio'), datePicker({ id: 'ns-date', value: date, onChange: iso => { date = iso; } }))),
    h('label', { class: 'field', for: 'ns-file' }, 'Archivo del informe ', h('span', { class: 'hint' }, 'PDF o foto (JPG, PNG), hasta 20 MB. Solo informes escritos.'), filePicker(file)),
    h('label', { class: 'field', for: 'ns-text' }, 'Texto del informe ', h('span', { class: 'hint' }, '(si no subís archivo)'), text), msg, h('div', { class: 'row' }, btn));
}

async function doctorStudy() {
  loading();
  const { data: s, error } = await sb.from('studies').select('*').eq('id', state.studyId).maybeSingle();
  if (error || !s) { toast('No encontramos ese estudio.'); return go('paciente', { patientId: state.patientId }); }
  const { data: p } = await sb.from('profiles').select('full_name, birth_date').eq('id', s.patient_id).maybeSingle();
  if (s.status === 'publicado') sb.rpc('log_study_access', { p_study: s.id, p_action: 'visto_por_medico' });
  const ed = { ...s, glossary: [...(s.glossary || [])], lab_values: [...(s.lab_values || [])] };
  let dirty = false, previewing = false;
  const markDirty = () => { dirty = true; status.textContent = 'Cambios sin guardar'; status.className = 'pill warn'; };
  const m = mainEl();
  const status = h('span', { class: 'pill ' + (s.status === 'publicado' ? 'ok' : 'warn') }, s.status === 'publicado' ? 'Publicado' : 'Borrador');
  const back = async () => {
    if (dirty && !await confirmBox({ title: 'Hay cambios sin guardar', text: 'Si salís ahora, se pierden.', ok: 'Salir sin guardar', danger: true })) return;
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
    dirty = false; status.textContent = s.status === 'publicado' ? 'Publicado' : 'Borrador'; status.className = 'pill ' + (s.status === 'publicado' ? 'ok' : 'warn');
    return true;
  }
  async function callAI(action, label, btn) {
    btn.disabled = true; const old = btn.textContent;
    btn.replaceChildren(h('span', { class: 'spinner' }), ' ' + label);
    const { data, error: e } = await sb.functions.invoke('ia', { body: { action, study_id: s.id } });
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
    if (s.file_path) await sb.storage.from('estudios').remove([s.file_path]);
    const { error: e } = await sb.from('studies').delete().eq('id', s.id);
    if (e) return toast(errorText(e));
    dirty = false; toast('Borrador borrado.'); go('paciente', { patientId: s.patient_id });
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
