// Hecho por ChatGPT · 2026-11-02 · Motor IA para menores, aislado del motor de adultos.
// Cada petición usa la sesión verificada y permisos RLS de minor_studies.
// El archivo se descarga sólo desde storage.estudios-menores, nunca desde Debian.
import Anthropic from "@anthropic-ai/sdk";
import { ChelyAIError, explain, MODEL, transcribe, type StudyForAI } from "./_shared/claude.ts";
import { cors, fail, withCors, json, serviceClient, userClient } from "./_shared/http.ts";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_PREVIOUS_CHARS = 40000;
const anthropic = new Anthropic({
  apiKey: Deno.env.get("ANTHROPIC_API_KEY"), timeout: 140_000, maxRetries: 1
});
function ageFrom(birth: string | null): number | null {
  if (!birth) return null;
  const b = new Date(birth + "T00:00:00Z"), now = new Date();
  let age = now.getUTCFullYear() - b.getUTCFullYear();
  if (now.getUTCMonth() < b.getUTCMonth() || (now.getUTCMonth()===b.getUTCMonth() && now.getUTCDate()<b.getUTCDate())) age--;
  return age >= 0 && age < 18 ? age : null;
}
Deno.serve(withCors(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("Método no permitido.",405);
  const session = await userClient(req);
  if (!session) return fail("Iniciá sesión para consultar este estudio.",401);
  const { supabase, userId } = session;
  const payload: { action?: string, study_id?: string } = await req.json().catch(() => ({}));
  if (!["transcribir","explicar"].includes(payload.action || "") || !payload.study_id ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.study_id))
    return fail("Solicitud inválida.",400);
  // La RLS del informe exige pertenecer a los adultos vinculados con el menor.
  const { data: study, error: studyErr } = await supabase.from("minor_studies")
    .select("id,minor_id,title,study_date,report_text,file_path,file_type").eq("id",payload.study_id).maybeSingle();
  if (studyErr || !study) return fail("No encontramos ese estudio o no tenés autorización.",404);
  const { data: minor, error: minorErr } = await supabase.from("minor_profiles")
    .select("birth_date").eq("id",study.minor_id).maybeSingle();
  if (minorErr || !minor || ageFrom(minor.birth_date) === null)
    return fail("El acceso a este perfil de menor no está disponible.",403);
  if (!Deno.env.get("ANTHROPIC_API_KEY")) return fail("IA no configurada.",503);
  const admin = serviceClient();
  try {
    if (payload.action === "transcribir") {
      if (!study.file_path) return fail("Este estudio no tiene archivo adjunto.",400);
      // No aceptar rutas fuera del estudio autorizado.
      if (!study.file_path.startsWith(study.minor_id + "/" + study.id + "/"))
        return fail("Referencia de archivo inválida.",403);
      const { data: file, error: fileError } = await supabase.storage.from("estudios-menores").download(study.file_path);
      if (fileError || !file || file.size > MAX_FILE_BYTES || !file.size)
        return fail("No se pudo acceder al archivo del menor.",404);
      if (!["application/pdf","image/jpeg","image/png","image/webp"].includes(study.file_type || ""))
        return fail("Formato de estudio no permitido.",415);
      const { text, usage } = await transcribe(anthropic,new Uint8Array(await file.arrayBuffer()),study.file_type!);
      await admin.from("ai_usage").insert({ doctor_id: userId, kind:"transcribir",input_tokens:usage.input_tokens,output_tokens:usage.output_tokens });
      return json({ text });
    }
    const report = String(study.report_text || "").trim();
    if (!report) return fail("Primero completá el texto del estudio o leé el archivo.",400);
    const { data: prev, error: prevErr } = await supabase.from("minor_studies")
      .select("title,study_date,report_text").eq("minor_id",study.minor_id).neq("id",study.id)
      .order("study_date",{ascending:false}).limit(6);
    if (prevErr) return fail("No se pudo verificar el historial del menor.",503);
    const previous: StudyForAI[] = [];
    let used = 0;
    for (const record of prev || []) {
      const str=String(record.report_text || "");
      if (used+str.length>MAX_PREVIOUS_CHARS) break;
      used+=str.length;
      if (str.trim()) previous.push({titulo:record.title,fecha:record.study_date,texto:str});
    }
    const { result, usage } = await explain(anthropic,{
      estudio:{ titulo:study.title,fecha:study.study_date,texto:report },
      anteriores:previous.reverse(),
      edad:ageFrom(minor.birth_date),
      revisadoPorMedico:false
    });
    await admin.from("ai_usage").insert({ doctor_id:userId,kind:"explicar",input_tokens:usage.input_tokens,output_tokens:usage.output_tokens });
    return json({ ...result,model:MODEL,previous_used:previous.length });
  } catch (e) {
    if (e instanceof ChelyAIError) return fail(e.message,e.status);
    console.error("ia-menores: error", e instanceof Error ? e.name : typeof e);
    return fail("No pudimos procesar este estudio. Intentá nuevamente.",500);
  }
}));
