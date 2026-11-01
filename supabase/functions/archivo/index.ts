// Intermediario autenticado Chely -> Cloudflare Access -> Debian.
// Publicar junto con la actualización del frontend y el backend; no usar aislado.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const PROJECT = 'https://ypxmqaseqslswotcffdu.supabase.co';
const ORIGIN = 'https://chely.app';
const MAX = 20 * 1024 * 1024;
const cors: Record<string, string> = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
};
const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);


const ALLOWED = new Set(['application/pdf', 'image/jpeg', 'image/png']);
async function emergencyUpload(sb: ReturnType<typeof createClient>, userId: string, studyId: string, file: File): Promise<Response> {
  // Respaldo de archivos nuevos únicamente: respetar titularidad y RLS.
  if (!ALLOWED.has(file.type)) return answer({ error: 'Formato de archivo no admitido' }, 415);
  const { data: study, error: lookupError } = await sb.from('studies')
    .select('id,patient_id,doctor_id,self_uploaded,file_path,storage_file_id,storage_backend')
    .eq('id', studyId).maybeSingle();
  if (lookupError) return answer({ error: 'No se pudo comprobar el estudio para el respaldo' }, 503);
  if (!study || study.patient_id !== userId || !study.self_uploaded || study.doctor_id) {
    return answer({ error: 'Carga no autorizada' }, 403);
  }
  if (study.file_path || study.storage_file_id) {
    return answer({ error: 'El estudio ya tiene un archivo registrado' }, 409);
  }
  const objectPath = userId + '/' + studyId + '/' + crypto.randomUUID();
  const { error: uploadError } = await sb.storage.from('estudios').upload(objectPath, file, {
    contentType: file.type, upsert: false, cacheControl: '0',
  });
  if (uploadError) return answer({ error: 'No se pudo guardar el respaldo temporal en Supabase' }, 503);
  // Actualización condicional: no sustituir una carga Debian concurrente.
  const { data: changed, error: updateError } = await sb.from('studies')
    .update({ storage_backend: 'supabase', storage_file_id: null, file_path: objectPath,
      file_name: file.name.slice(0, 255), file_type: file.type })
    .eq('id', studyId).eq('patient_id', userId).eq('self_uploaded', true)
    .is('file_path', null).is('storage_file_id', null)
    .select('id');
  if (updateError || !changed || changed.length !== 1) {
    // No eliminar si no se puede demostrar que la actualización no ocurrió:
    // un huérfano es recuperable; un archivo borrado no lo es.
    return answer({ error: 'Archivo temporal guardado, pero no se pudo confirmar su registro. Contactá soporte antes de volver a subirlo.' }, 503);
  }
  return answer({ study_id: studyId, storage_backend: 'supabase', temporary: true }, 201);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return answer({ error: 'Método no permitido' }, 405);
  // Verificación de sesión vía Auth, no confiar en claims enviados por el navegador.
  const bearer = req.headers.get('authorization') || '';
  if (!/^Bearer\s+\S+$/i.test(bearer)) return answer({ error: 'Sesión requerida' }, 401);
  const publicKey = Deno.env.get('CHELY_PUBLIC_KEY');
  const cfId = Deno.env.get('CF_ACCESS_CLIENT_ID');
  const cfSecret = Deno.env.get('CF_ACCESS_CLIENT_SECRET');
  if (!publicKey || !cfId || !cfSecret) return answer({ error: 'Configuración incompleta' }, 503);
  const sb = createClient(PROJECT, publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user }, error: authError } = await sb.auth.getUser(bearer.replace(/^Bearer\s+/i, ''));
  if (authError || !user) return answer({ error: 'Sesión inválida' }, 401);

  let form: FormData;
  try { form = await req.formData(); } catch { return answer({ error: 'Formulario inválido' }, 400); }
  const action = form.get('action');
  const studyId = form.get('study_id');
  const fileId = form.get('file_id');
  if (!isUuid(studyId)) return answer({ error: 'Estudio inválido' }, 400);
  if (action !== 'upload' && action !== 'download' && action !== 'delete') return answer({ error: 'Acción inválida' }, 400);
  if (action !== 'upload' && !isUuid(fileId)) return answer({ error: 'Archivo inválido' }, 400);
  const file = form.get('file');
  if (action === 'upload') {
    if (!(file instanceof File) || !file.size || file.size > MAX) return answer({ error: 'Archivo inválido o superior a 20 MB' }, 413);
  }
  const sessionSb = createClient(PROJECT, publicKey, {
    global: { headers: { Authorization: bearer } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const endpoint = `https://api.chely.app/storage/studies/${studyId}/files${action === 'upload' ? '' : `/${fileId}`}`;
  const headers: Record<string, string> = {
    Authorization: bearer,
    'CF-Access-Client-Id': cfId,
    'CF-Access-Client-Secret': cfSecret,
  };
  const uploadBody = new FormData();
  if (action === 'upload') uploadBody.append('file', file as File);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: action === 'upload' ? 'POST' : action === 'download' ? 'GET' : 'DELETE',
      headers, body: action === 'upload' ? uploadBody : undefined,
      signal: AbortSignal.timeout(action === 'upload' ? 15000 : 60000),
    });
  } catch {
    if (action === 'upload') return emergencyUpload(sessionSb, user.id, studyId, file as File);
    return answer({ error: 'Servidor de archivos no disponible' }, 503);
  }
  if (!response.ok) {
    if (action === 'upload' && response.status >= 500) {
      return emergencyUpload(sessionSb, user.id, studyId, file as File);
    }
    const safe: Record<number, string> = {
      400: 'Solicitud inválida', 401: 'Sesión no válida', 403: 'Acceso no autorizado',
      404: 'Archivo o estudio no disponible', 409: 'El archivo ya existe o cambió de estado',
      413: 'Archivo demasiado grande', 415: 'Formato de archivo no admitido',
      503: 'Almacenamiento temporalmente no disponible',
    };
    return answer({ error: safe[response.status] || 'No se pudo procesar el archivo' }, response.status >= 500 ? 503 : response.status);
  }
  if (action === 'download') {
    const length = Number(response.headers.get('content-length') || '0');
    if (length > MAX) return answer({ error: 'Archivo demasiado grande' }, 413);
    const data = await response.arrayBuffer();
    if (data.byteLength > MAX) return answer({ error: 'Archivo demasiado grande' }, 413);
    return new Response(data, { status: 200, headers: {
      ...cors, 'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="estudio-original"',
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    } });
  }
  try { return answer(await response.json(), response.status); }
  catch { return answer({ error: 'Respuesta inválida del servidor' }, 502); }
});
