// Función "ia": transcribe archivos o explica estudios, con dos almacenamientos.
import Anthropic from "@anthropic-ai/sdk";
import { ChelyAIError, explain, MODEL, transcribe, type StudyForAI } from "../_shared/claude.ts";
import { cors, fail, withCors, json, serviceClient, userClient } from "../_shared/http.ts";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_PREVIOUS_CHARS = 40000;
const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY"), timeout: 140_000, maxRetries: 1 });

function ageFrom(birth: string | null): number | null {
  if (!birth) return null;
  const b = new Date(birth + "T00:00:00Z"), now = new Date();
  let age = now.getUTCFullYear() - b.getUTCFullYear();
  if (now.getUTCMonth() < b.getUTCMonth() || (now.getUTCMonth() === b.getUTCMonth() && now.getUTCDate() < b.getUTCDate())) age--;
  return age >= 0 && age < 130 ? age : null;
}

async function loadStudyFile(
  supabase: NonNullable<Awaited<ReturnType<typeof userClient>>>["supabase"],
  study: { id: string; file_path: string | null; file_type: string | null; storage_backend: string | null; storage_file_id: string | null },
  bearer: string,
): Promise<{ bytes: Uint8Array; type: string }> {
  if (study.storage_backend === "debian") {
    if (!study.storage_file_id) throw new ChelyAIError("El estudio no tiene un archivo registrado en Debian.", 404);
    const clientId = Deno.env.get("CF_ACCESS_CLIENT_ID");
    const clientSecret = Deno.env.get("CF_ACCESS_CLIENT_SECRET");
    if (!clientId || !clientSecret) throw new ChelyAIError("Falta configurar el acceso al servidor de Chely.", 503);
    const url = `https://api.chely.app/storage/studies/${encodeURIComponent(study.id)}/files/${encodeURIComponent(study.storage_file_id)}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: {
          "Authorization": bearer,
          "CF-Access-Client-Id": clientId,
          "CF-Access-Client-Secret": clientSecret,
        },
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new ChelyAIError("El servidor de archivos no está disponible. Probá más tarde.", 503);
    }
    if (response.status === 401 || response.status === 403) throw new ChelyAIError("No tenés permiso para abrir este archivo.", 403);
    if (response.status === 404) throw new ChelyAIError("No encontramos el archivo original.", 404);
    if (!response.ok) throw new ChelyAIError("No se pudo leer el archivo del servidor.", 503);
    const length = Number(response.headers.get("content-length") ?? "0");
    if (length > MAX_FILE_BYTES) { await response.body?.cancel(); throw new ChelyAIError("El archivo supera los 20 MB.", 413); }
    // Limitar también mientras se recibe: no confiar solo en Content-Length.
    const reader = response.body?.getReader();
    if (!reader) throw new ChelyAIError("No se pudo leer el archivo.", 503);
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_FILE_BYTES) { await reader.cancel(); throw new ChelyAIError("El archivo supera los 20 MB.", 413); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    if (!total) throw new ChelyAIError("El archivo está vacío.", 404);
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return { bytes, type: study.file_type || "application/octet-stream" };
  }
  if (study.storage_backend && study.storage_backend !== "supabase") {
    throw new ChelyAIError("Almacenamiento desconocido.", 503);
  }
  if (!study.file_path) throw new ChelyAIError("Este estudio no tiene archivo. Subí un PDF o una foto.", 404);
  const { data: file, error: dlError } = await supabase.storage.from("estudios").download(study.file_path);
  if (dlError || !file) throw new ChelyAIError("No se pudo abrir el archivo del estudio.", 404);
  if (file.size > MAX_FILE_BYTES) throw new ChelyAIError("El archivo supera los 20 MB.", 413);
  return { bytes: new Uint8Array(await file.arrayBuffer()), type: study.file_type ?? file.type };
}

Deno.serve(withCors(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("Método no permitido.", 405);
  if (!Deno.env.get("ANTHROPIC_API_KEY")) return fail("Falta configurar la clave de la IA. Avisale al equipo de Chely.", 500);
  const session = await userClient(req);
  if (!session) return fail("Tu sesión venció. Volvé a iniciar sesión.", 401);
  const { supabase, userId } = session;
  const bearer = req.headers.get("authorization") ?? "";
  if (!/^Bearer\s+\S+$/i.test(bearer)) return fail("Sesión inválida.", 401);
  const { data: isDoctor } = await supabase.rpc("is_doctor", { uid: userId });

  let body: { action?: string; study_id?: string };
  try { body = await req.json(); } catch { return fail("Pedido inválido."); }
  if (body.action !== "transcribir" && body.action !== "explicar") return fail("Acción desconocida.");
  if (!body.study_id) return fail("Falta el estudio.");

  // Supabase RLS determina si el estudio es visible para este usuario.
  const { data: study, error } = await supabase.from("studies")
    .select("id, patient_id, title, study_date, report_text, file_path, file_type, self_uploaded, storage_backend, storage_file_id")
    .eq("id", body.study_id).maybeSingle();
  if (error || !study) return fail("No encontramos ese estudio.", 404);
  if (!isDoctor && !(study.self_uploaded && study.patient_id === userId)) {
    return fail("Solo podés usar la IA con los estudios que subiste vos.", 403);
  }
  // Hecho por ChatGPT · 2026-11-02 · Protección de gasto por usuario.
  // Cada operación de lectura y de explicación cuenta por separado.
  const admin = serviceClient();
  const limit = isDoctor ? Math.max(1, Number(Deno.env.get("AI_DAILY_LIMIT") || 60))
    : Math.max(1, Number(Deno.env.get("AI_DAILY_LIMIT_PACIENTE") || 10));
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count, error: countError } = await admin.from("ai_usage")
    .select("id", { count: "exact", head: true }).eq("doctor_id", userId).gte("at", since);
  if (countError || count === null) return fail("No pudimos verificar el límite de IA. Probá de nuevo.", 503);
  if (count >= limit) return fail(`Alcanzaste el máximo de ${limit} consultas de IA en 24 horas. Volvé a probar más tarde.`, 429);

  try {
    if (body.action === "transcribir") {
      if (study.storage_backend !== "debian" && !study.file_path) return fail("Este estudio no tiene archivo. Subí un PDF o una foto.");
      const file = await loadStudyFile(supabase, study, bearer);
      const { text, usage } = await transcribe(anthropic, file.bytes, file.type);
      await admin.from("ai_usage").insert({ doctor_id: userId, kind: "transcribir", input_tokens: usage.input_tokens, output_tokens: usage.output_tokens });
      return json({ text });
    }
    const { data: profile } = await supabase.from("profiles").select("birth_date").eq("id", study.patient_id).maybeSingle();
    const { data: previous } = await supabase.from("studies")
      .select("title, study_date, report_text")
      .eq("patient_id", study.patient_id).eq("status", "publicado").neq("id", study.id)
      .order("study_date", { ascending: false }).limit(6);
    const anteriores: StudyForAI[] = [];
    let used = 0;
    for (const s of previous ?? []) {
      if (used + s.report_text.length > MAX_PREVIOUS_CHARS) break;
      used += s.report_text.length;
      anteriores.push({ titulo: s.title, fecha: s.study_date, texto: s.report_text });
    }
    const { result, usage } = await explain(anthropic, {
      estudio: { titulo: study.title, fecha: study.study_date, texto: study.report_text },
      anteriores: anteriores.reverse(),
      edad: ageFrom(profile?.birth_date ?? null),
      revisadoPorMedico: !study.self_uploaded,
    });
    await admin.from("ai_usage").insert({ doctor_id: userId, kind: "explicar", input_tokens: usage.input_tokens, output_tokens: usage.output_tokens });
    return json({ ...result, model: MODEL, previous_used: anteriores.length });
  } catch (e) {
    if (e instanceof ChelyAIError) return fail(e.message, e.status);
    console.error("ia: error inesperado", e instanceof Error ? e.name : typeof e);
    return fail("Ocurrió un error inesperado. Probá de nuevo.", 500);
  }
}));
