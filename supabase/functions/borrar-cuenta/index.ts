// Función "borrar-cuenta": borra la cuenta de quien la llama, sus archivos y (por cascada) sus estudios.
import { cors, fail, withCors, json, serviceClient, userClient } from "../_shared/http.ts";

Deno.serve(withCors(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("Método no permitido.", 405);
  const session = await userClient(req);
  if (!session) return fail("Tu sesión venció. Volvé a iniciar sesión.", 401);
  const { userId } = session;

  let body: { confirm?: string } = {};
  try { body = await req.json(); } catch { /* sin cuerpo */ }
  if (body.confirm !== "BORRAR") return fail("Falta confirmar el borrado.");

  // Hecho por ChatGPT · 2026-11-02 · Eliminar las copias del volumen
  // cifrado ANTES de borrar la identidad y revocar su JWT.
  // Si Debian está caído no se declara borrada la cuenta.
  const clientId = Deno.env.get("CF_ACCESS_CLIENT_ID");
  const clientSecret = Deno.env.get("CF_ACCESS_CLIENT_SECRET");
  if (!clientId || !clientSecret) return fail("Acceso al servidor no configurado. La cuenta no fue eliminada.", 503);
  try {
    const response = await fetch("https://api.chely.app/sync/patient-all", {
      method: "DELETE",
      headers: {
        Authorization: req.headers.get("authorization") || "",
        "CF-Access-Client-Id": clientId,
        "CF-Access-Client-Secret": clientSecret,
      },
      signal: AbortSignal.timeout(45000),
    });
    if (!response.ok) return fail("Debian no confirmó el borrado de los archivos. Tu cuenta sigue activa; escribinos a info@chely.app.", 503);
    const acknowledgement = await response.json().catch(() => null);
    if (acknowledgement?.status !== "deleted")
      return fail("El servidor no confirmó la eliminación. Tu cuenta sigue activa.", 503);
  } catch {
    return fail("Debian no está disponible. No se borró tu cuenta para evitar conservar archivos médicos allí.", 503);
  }
  const admin = serviceClient();
  // Archivos del paciente: <id>/<estudio>/<archivo>
  const { data: folders } = await admin.storage.from("estudios").list(userId, { limit: 1000 });
  for (const folder of folders ?? []) {
    const prefix = `${userId}/${folder.name}`;
    const { data: files } = await admin.storage.from("estudios").list(prefix, { limit: 1000 });
    const paths = (files ?? []).map((f) => `${prefix}/${f.name}`);
    if (paths.length) {
      const { error } = await admin.storage.from("estudios").remove(paths);
      if (error) return fail("No se pudieron borrar tus archivos. Probá de nuevo.", 500);
    }
  }
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) return fail("No se pudo borrar la cuenta. Escribinos a info@chely.app.", 500);
  return json({ ok: true });
}));
