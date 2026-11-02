// Hecho por ChatGPT · 2026-11-02 · Borrado de replica previa al borrado de un estudio.
// NUNCA acepta una ruta o un paciente enviados por el navegador.
import { cors, fail, withCors, json, userClient } from "../_shared/http.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
Deno.serve(withCors(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("Método no permitido.", 405);
  const session = await userClient(req);
  if (!session) return fail("Sesión vencida.", 401);
  const { supabase, userId } = session;
  let body: { study_id?: string } = {};
  try { body = await req.json(); } catch { return fail("Pedido inválido."); }
  if (!body.study_id || !UUID.test(body.study_id)) return fail("Estudio inválido.", 400);
  const { data: study, error } = await supabase.from("studies")
    .select("id,patient_id,self_uploaded").eq("id", body.study_id).maybeSingle();
  if (error || !study || study.patient_id !== userId || !study.self_uploaded) {
    return fail("El estudio no existe o no te pertenece.", 403);
  }
  const clientId = Deno.env.get("CF_ACCESS_CLIENT_ID");
  const clientSecret = Deno.env.get("CF_ACCESS_CLIENT_SECRET");
  if (!clientId || !clientSecret) return fail("Falta configurar el acceso al servidor.", 503);
  const bearer = req.headers.get("authorization") || "";
  try {
    const response = await fetch(
      "https://api.chely.app/sync/patient-latest?study_id=" + encodeURIComponent(study.id),
      {
        method: "DELETE",
        headers: {
          "Authorization": bearer,
          "CF-Access-Client-Id": clientId,
          "CF-Access-Client-Secret": clientSecret,
        },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok) {
      return fail("No se pudo verificar el borrado del respaldo Debian. El estudio no se eliminó; intentá de nuevo.", 503);
    }
    const payload = await response.json().catch(() => null);
    if (!payload || !["deleted", "absent", "other_study"].includes(payload.status)) {
      return fail("Debian no confirmó el borrado. El estudio se conservó.", 503);
    }
    return json({ ok: true, status: payload.status });
  } catch {
    return fail("Debian no está disponible; el estudio se conservó para evitar una eliminación incompleta.", 503);
  }
}));
