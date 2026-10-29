// Supabase simulado en memoria para probar la interfaz sin servidor. No aplica seguridad real.
(function () {
  const db = JSON.parse(localStorage.getItem('mockdb') || 'null') || {
    users: [
      { id: 'doc', email: 'medica@ej.com', password: 'clave1234' },
      { id: 'pac', email: 'paciente@ej.com', password: 'clave1234' },
    ],
    profiles: [
      { id: 'doc', email: 'medica@ej.com', full_name: 'Dra. Laura Prueba', role: 'doctor', birth_date: null, consent_version: null },
      { id: 'pac', email: 'paciente@ej.com', full_name: 'Marta Prueba', role: 'patient', birth_date: '1954-03-02', consent_version: null },
    ],
    invitations: [], care_links: [], access_log: [],
    studies: [{ id: 'old1', patient_id: 'pac', doctor_id: 'doc', title: 'Análisis anterior', study_date: '2026-03-10', status: 'publicado', report_text: 'Glucemia 104 mg/dL',
      explanation: '## Qué dice tu estudio\n- Glucemia 104 mg/dL.', glossary: [], lab_values: [{ nombre: 'Glucemia en ayunas', valor: 104, valor_texto: '104', unidad: 'mg/dL', referencia_texto: '70 - 100', ref_min: 70, ref_max: 100 }],
      doctor_note: '', published_at: '2026-03-12T10:00:00Z', first_viewed_at: '2026-03-12T12:00:00Z', feedback: 'si', file_path: null, created_at: '2026-03-10T10:00:00Z' }],
  };
  const persist = () => localStorage.setItem('mockdb', JSON.stringify(db));
  let session = JSON.parse(localStorage.getItem('mocksession') || 'null');
  const listeners = [];
  const setSession = (s, ev) => { session = s; localStorage.setItem('mocksession', JSON.stringify(s)); listeners.forEach(f => f(ev, s)); };
  const uid = () => session && session.user.id;
  const me = () => db.profiles.find(p => p.id === uid());
  const linked = (d, p) => db.care_links.some(c => c.doctor_id === d && c.patient_id === p && c.active);
  const visible = (table) => {
    const u = uid(); const role = me() && me().role;
    if (table === 'studies') return db.studies.filter(s => role === 'doctor' ? (s.doctor_id === u && linked(u, s.patient_id)) : (s.patient_id === u && (s.status === 'publicado' || s.self_uploaded)));
    if (table === 'profiles') return db.profiles.filter(p => p.id === u || linked(u, p.id) || linked(p.id, u));
    if (table === 'care_links') return db.care_links.filter(c => c.doctor_id === u || c.patient_id === u);
    if (table === 'invitations') return db.invitations.filter(i => i.doctor_id === u);
    if (table === 'access_log') return db.access_log.filter(l => l.patient_id === u);
    return db[table];
  };
  const log = (patient, study, action) => db.access_log.push({ actor_id: uid(), patient_id: patient, study_id: study, action, at: new Date().toISOString() });
  function query(table) {
    const q = { filters: [], op: 'select', order: null, lim: null, single: null, payload: null, head: false };
    const api = {
      select(cols, opts) { if (opts && opts.head) q.head = true; return api; },
      eq(k, v) { q.filters.push(r => r[k] === v); return api; },
      neq(k, v) { q.filters.push(r => r[k] !== v); return api; },
      in(k, vs) { q.filters.push(r => vs.includes(r[k])); return api; },
      is(k, v) { q.filters.push(r => (r[k] ?? null) === v); return api; },
      gt(k, v) { q.filters.push(r => r[k] > v); return api; },
      gte(k, v) { q.filters.push(r => r[k] >= v); return api; },
      order(k, o = {}) { q.order = [k, o.ascending !== false]; return api; },
      limit(n) { q.lim = n; return api; },
      maybeSingle() { q.single = 'maybe'; return api; },
      single() { q.single = 'one'; return api; },
      insert(obj) { q.op = 'insert'; q.payload = obj; return api; },
      update(obj) { q.op = 'update'; q.payload = obj; return api; },
      delete() { q.op = 'delete'; return api; },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); },
    };
    function run() {
      let rows;
      if (q.op === 'insert') {
        const row = { id: 'st' + Math.random().toString(16).slice(2, 8), status: 'borrador', self_uploaded: false, explanation: '', glossary: [], lab_values: [], doctor_note: '', file_path: null, published_at: null, first_viewed_at: null, feedback: null, created_at: new Date().toISOString(), ...q.payload };
        db[table].push(row); log(row.patient_id, row.id, 'estudio_creado'); persist(); rows = [row];
      } else {
        rows = visible(table).filter(r => q.filters.every(f => f(r)));
        if (q.op === 'update') {
          for (const r of rows) {
            if (table === 'studies' && q.payload.status === 'publicado' && r.status !== 'publicado') { r.published_at = new Date().toISOString(); log(r.patient_id, r.id, 'estudio_publicado'); }
            Object.assign(r, q.payload);
          }
          persist();
        }
        if (q.op === 'delete') { db[table] = db[table].filter(r => !rows.includes(r)); persist(); return { data: null, error: null }; }
      }
      if (q.order) rows = [...rows].sort((a, b) => (a[q.order[0]] > b[q.order[0]] ? 1 : -1) * (q.order[1] ? 1 : -1));
      if (q.lim) rows = rows.slice(0, q.lim);
      if (q.head) return { data: null, count: rows.length, error: null };
      if (q.single) { if (!rows.length) return { data: null, error: q.single === 'one' ? { message: 'not found' } : null }; return { data: { ...rows[0] }, error: null }; }
      return { data: rows.map(r => ({ ...r })), error: null };
    }
    return api;
  }
  const rpcs = {
    accept_consent({ p_version }) { me().consent_version = p_version; },
    invitation_info({ p_code }) { const i = db.invitations.find(x => x.code === p_code); if (!i) return []; return [{ doctor_name: db.profiles.find(p => p.id === i.doctor_id).full_name, valid: !i.used_by }]; },
    create_invitation({ p_hint }) { const code = 'ABCD' + Math.floor(Math.random() * 1e6).toString().padStart(6, '2'); db.invitations.push({ code, doctor_id: uid(), patient_hint: p_hint, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 14 * 864e5).toISOString(), used_by: null }); return code; },
    redeem_invitation({ p_code }) { const i = db.invitations.find(x => x.code === p_code); if (!i) throw new Error('El código de invitación no existe. Revisalo con tu médico.'); i.used_by = uid(); db.care_links.push({ doctor_id: i.doctor_id, patient_id: uid(), active: true, created_at: new Date().toISOString() }); log(uid(), null, 'medico_vinculado'); },
    end_care_link({ p_doctor }) { db.care_links.filter(c => c.doctor_id === p_doctor && c.patient_id === uid()).forEach(c => { c.active = false; }); },
    mark_study_viewed({ p_study }) { const s = db.studies.find(x => x.id === p_study); s.first_viewed_at = s.first_viewed_at || new Date().toISOString(); log(uid(), p_study, 'visto_por_paciente'); },
    give_feedback({ p_study, p_value }) { db.studies.find(x => x.id === p_study).feedback = p_value; },
    log_study_access({ p_study, p_action }) { const s = db.studies.find(x => x.id === p_study); log(s.patient_id, p_study, p_action); },
  };
  window.supabase = {
    createClient() {
      return {
        auth: {
          async getSession() { return { data: { session } }; },
          onAuthStateChange(f) { listeners.push(f); setTimeout(() => f('INITIAL_SESSION', session)); return { data: { subscription: { unsubscribe() {} } } }; },
          async signInWithPassword({ email, password }) { const u = db.users.find(x => x.email === email && x.password === password); if (!u) return { error: { message: 'Invalid login credentials' } }; setSession({ user: { id: u.id, email } }, 'SIGNED_IN'); return { data: {}, error: null }; },
          async signUp({ email, password, options }) { if (db.users.some(u => u.email === email)) return { error: { message: 'User already registered' } }; const id = 'u' + Date.now(); db.users.push({ id, email, password }); db.profiles.push({ id, email, full_name: options.data.full_name, role: 'patient', consent_version: null }); persist(); setSession({ user: { id, email } }, 'SIGNED_IN'); return { data: { session }, error: null }; },
          async signOut() { setSession(null, 'SIGNED_OUT'); return { error: null }; },
          async resetPasswordForEmail() { return { error: null }; },
          async updateUser() { return { error: null }; },
        },
        from: query,
        async rpc(name, args) { try { const data = rpcs[name](args || {}); persist(); return { data: data ?? null, error: null }; } catch (e) { return { data: null, error: { message: e.message } }; } },
        storage: { from() { return {
          async upload() { return { error: null }; }, async remove() { return { error: null }; },
          async createSignedUrl() { return { data: { signedUrl: 'about:blank' }, error: null }; } }; } },
        functions: { async invoke(name, { body }) {
          await new Promise(r => setTimeout(r, 300));
          if (name === 'ia' && body.action === 'explicar') return { data: { aviso_urgente: '', model: 'claude-opus-5-5',
            explicacion: '## Qué dice tu estudio\n- La **glucemia en ayunas** dio 112 mg/dL. El laboratorio marca como normal de 70 a 100.\n- La hemoglobina dio 12,9 g/dL, dentro de lo normal.\n\n## Qué significa, en palabras simples\nLa glucemia es el azúcar en la sangre. Está un poco alta.\n\n## Relación con tus estudios anteriores\nEn marzo de 2026 la glucemia había dado 104 mg/dL.\n\n## Lo que no queda claro\nUn solo valor alto no alcanza para sacar conclusiones.\n\n## Preguntas para llevar a la consulta\n- ¿Tengo que repetir el análisis?\n- ¿Qué puedo cambiar en la comida?',
            glosario: [{ termino: 'glucemia', definicion: 'Cantidad de azúcar en la sangre.' }, { termino: 'hemoglobina', definicion: 'Proteína de los glóbulos rojos que lleva el oxígeno.' }],
            valores: [{ nombre: 'Glucemia en ayunas', valor: 112, valor_texto: '112', unidad: 'mg/dL', referencia_texto: '70 - 100', ref_min: 70, ref_max: 100 },
              { nombre: 'Hemoglobina', valor: 12.9, valor_texto: '12,9', unidad: 'g/dL', referencia_texto: '12 - 16', ref_min: 12, ref_max: 16 }] }, error: null };
          if (name === 'ia') return { data: { text: 'Glucemia en ayunas: 112 mg/dL (VR 70 - 100)\nHemoglobina: 12,9 g/dL (VR 12 - 16)' }, error: null };
          return { data: { ok: true }, error: null };
        } },
      };
    },
  };
})();
