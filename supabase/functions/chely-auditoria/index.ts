// Chely: listado privado de archivos registrados para auditoría de almacenamiento.
// Solo lectura. Requiere clave de mantenimiento enviada en X-Chely-Audit-Key.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const encoder = new TextEncoder();
function equalConstantTime(a: string, b: string): boolean {
  const x = encoder.encode(a), y = encoder.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  }
  return diff === 0;
}
function reply(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

Deno.serve(async (req) => {
  if (req.method !== 'GET') return reply({ error: 'Metodo no permitido' }, 405);
  const expected = Deno.env.get('CHELY_AUDIT_KEY');
  const provided = req.headers.get('X-Chely-Audit-Key') ?? '';
  if (!expected || expected.length < 32) return reply({ error: 'Auditoria no configurada' }, 503);
  if (!provided || !equalConstantTime(provided, expected)) return reply({ error: 'No autorizado' }, 401);

  const url = Deno.env.get('SUPABASE_URL');
  const roleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !roleKey) return reply({ error: 'Conexion de base no configurada' }, 503);

  // El service role se usa solo dentro de esta función privada para listar UUID.
  const db = createClient(url, roleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const rows: { study_id: string; file_id: string }[] = [];
  const PAGE = 500;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from('studies')
      .select('id,storage_file_id')
      .eq('storage_backend', 'debian')
      .not('storage_file_id', 'is', null)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return reply({ error: 'No se pudo consultar el inventario' }, 503);
    const batch = data ?? [];
    for (const row of batch) {
      if (row.storage_file_id) rows.push({ study_id: row.id, file_id: row.storage_file_id });
    }
    if (batch.length < PAGE) break;
    if (rows.length > 100000) return reply({ error: 'Inventario demasiado grande' }, 503);
  }
  return reply({ status: 'ok', files: rows, count: rows.length });
});
