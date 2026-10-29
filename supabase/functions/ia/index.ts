// Función "ia": transcribe el archivo de un estudio o redacta el borrador de explicación.
// La usan médicos (estudios de pacientes vinculados) y pacientes (estudios que subieron ellos).
import Anthropic from "@anthropic-ai/sdk";
import { ChelyAIError, explain, MODEL, transcribe, type StudyForAI } from "../_shared/claude.ts";
import { cors, fail, json, serviceClient, userClient } from "../_shared/http.ts";

const DAILY_LIMIT = Number(Deno.env.get("AI_DAILY_LIMIT") ?? "60");
const PATIENT_DAILY_LIMIT = Number(Deno.env.get("AI_DAILY_LIMIT_PACIENTE") ?? "10");
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("Método no permitido.", 405);
  if (!Deno.env.get("ANTHROPIC_API_KEY")) return fail("Falta configurar la clave de la IA. Avisale al equipo de Chely.", 500);

  const session = await userClient(req);
  if (!session) return fail("Tu sesión venció. Volvé a iniciar sesión.", 401);
  const { supabase, userId } = session;

  const { data: isDoctor } = await supabase.rpc("is_doctor", { uid: userId });

  let body: { action?: string; study_id?: string };
  try {
    body = await req.json();
  } catch {
    return fail("Pedido inválido.");
  }
  if (body.action !== "transcribir" && body.action !== "explicar") return fail("Acción desconocida.");
  if (!body.study_id) return fail("Falta el estudio.");

  // La lectura pasa por la seguridad de la base: el médico solo ve estudios de pacientes vinculados
  // y el paciente solo los suyos.
  const { data: study, error } = await supabase.from("studies")
    .select("id, patient_id, title, study_date, report_text, file_path, file_type, self_uploaded")
    .eq("id", body.study_id).maybeSingle();
  if (error || !study) return fail("No encontramos ese estudio.", 404);
  // Un paciente solo usa la IA sobre los estudios que subió él.
  if (!isDoctor && !(study.self_uploaded && study.patient_id === userId)) {
    return fail("Solo podés usar la IA con los estudios que subiste vos.", 403);
  }

  // Tope diario por persona (en ai_usage, doctor_id guarda a quien usó la IA), para controlar costos.
  const limit = isDoctor ? DAILY_LIMIT : PATIENT_DAILY_LIMIT;
  const admin = serviceClient();
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count } = await admin.from("ai_usage").select("id", { count: "exact", head: true })
    .eq("doctor_id", userId).gte("at", since);
  if ((count ?? 0) >= limit) {
    return fail(`Llegaste al máximo de ${limit} usos de la IA en 24 horas. Probá de nuevo mañana.`, 429);
  }

  try {
    if (body.action === "transcribir") {
      if (!study.file_path) return fail("Este estudio no tiene archivo. Subí un PDF o una foto.");
      const { data: file, error: dlError } = await supabase.storage.from("estudios").download(study.file_path);
      if (dlError || !file) return fail("No se pudo abrir el archivo del estudio.", 404);
      if (file.size > MAX_FILE_BYTES) return fail("El archivo pesa más de 20 MB. Subí uno más liviano.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { text, usage } = await transcribe(anthropic, bytes, study.file_type ?? file.type);
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
});
