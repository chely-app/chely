// Función "borrar-cuenta": borra la cuenta de quien la llama, sus archivos y (por cascada) sus estudios.
import { cors, fail, json, serviceClient, userClient } from "../_shared/http.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("Método no permitido.", 405);
  const session = await userClient(req);
  if (!session) return fail("Tu sesión venció. Volvé a iniciar sesión.", 401);
  const { userId } = session;

  let body: { confirm?: string } = {};
  try { body = await req.json(); } catch { /* sin cuerpo */ }
  if (body.confirm !== "BORRAR") return fail("Falta confirmar el borrado.");

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
});
