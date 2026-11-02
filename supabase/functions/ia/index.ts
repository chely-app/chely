// Función "ia": transcribe archivos o explica estudios, con dos almacenamientos.
import Anthropic from "@anthropic-ai/sdk";
import { ChelyAIError, explain, MODEL, transcribe, type StudyForAI } from "../_shared/claude.ts";
import { cors, fail, withCors, json, serviceClient, userClient } from "../_shared/http.ts";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
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

// Hecho por ChatGPT · 2026-11-02 · IA a pedido con antecedentes y reutilizacion.
const MAX_CONTEXT_STUDIES = 150;
const MAX_CONTEXT_CHARS = 210000;
function compactPrevious(rawValue: unknown, labValues: unknown): string {
  const value = String(rawValue || "").trim();
  if (!value) return "";
  const short = value.length <= 2400 ? value
    : value.slice(0, 1500) + "\n[Fragmento del informe omitido para controlar los tokens]\n" + value.slice(-550);
  const structured = Array.isArray(labValues) ? JSON.stringify(labValues.slice(0, 25)).slice(0, 1500) : "";
  return short + (structured && value.length > 2400 ? "\nValores estructurados: " + structured : "");
}
async function contextHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map(x => x.toString(16).padStart(2, "0")).join("");
}
// Hecho por ChatGPT · 2026-11-02 · Replica opt-in: NUNCA activar antes de
// asegurar instalación, borrado y reconciliación en Debian.
async function tryMirrorLatest(
  admin: ReturnType<typeof serviceClient>, bearer: string,
  patientId: string, signature: string,
): Promise<void> {
  if (Deno.env.get("CHELY_DEBIAN_SUMMARY_SYNC_ENABLED") !== "1") return;
  const clientId = Deno.env.get("CF_ACCESS_CLIENT_ID");
  const clientSecret = Deno.env.get("CF_ACCESS_CLIENT_SECRET");
  if (!clientId || !clientSecret) return;
  try {
    const response = await fetch("https://api.chely.app/sync/patient-latest", {
      method: "POST",
      headers: {
        "Authorization": bearer,
        "CF-Access-Client-Id": clientId,
        "CF-Access-Client-Secret": clientSecret,
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return; // Pendiente para reintento, nunca fingir exito.
    const ack = await response.json();
    if (ack?.status !== "stored" || ack?.source_signature !== signature) return;
    // Comparar la firma evita marcar 'synced' una explicación reemplazada
    // por otra durante la transferencia.
    const { error } = await admin.from("patient_latest_explanations")
      .update({ debian_sync_status: "synced", debian_synced_at: new Date().toISOString() })
      .eq("patient_id", patientId).eq("source_signature", signature);
    if (error) console.warn("No pudimos confirmar la replica Debian");
  } catch {
    // El original en Supabase sigue disponible; no cobrar otra llamada IA.
  }
}

Deno.serve(withCors(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("Método no permitido.", 405);
  if (!Deno.env.get("ANTHROPIC_API_KEY")) return fail("Falta configurar la clave de la IA.", 500);
  const session = await userClient(req);
  if (!session) return fail("Tu sesión venció. Volvé a iniciar sesión.", 401);
  const { supabase, userId } = session;
  const bearer = req.headers.get("authorization") ?? "";
  if (!/^Bearer\s+\S+$/i.test(bearer)) return fail("Sesión inválida.", 401);
  const { data: isDoctor, error: roleError } = await supabase.rpc("is_doctor", { uid: userId });
  if (roleError) return fail("No pudimos comprobar tu cuenta.", 503);

  let body: { action?: string; study_id?: string; force?: boolean };
  try { body = await req.json(); } catch { return fail("Pedido inválido."); }
  if (!["transcribir", "explicar"].includes(body.action || "")) return fail("Acción desconocida.");
  if (!body.study_id || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(body.study_id)) return fail("Estudio inválido.");
  const { data: study, error } = await supabase.from("studies")
    .select("id, patient_id, title, study_date, report_text, file_path, file_type, self_uploaded, status, storage_backend, storage_file_id, explanation, glossary, lab_values, ai_context_sha256")
    .eq("id", body.study_id).maybeSingle();
  if (error || !study) return fail("No encontramos ese estudio.", 404);
  if (!isDoctor && !(study.self_uploaded && study.patient_id === userId)) {
    return fail("Solo podés usar la IA con los estudios que subiste vos.", 403);
  }
  const admin = serviceClient();
  // Un paciente que carga 102 PDF puede leer y explicar 102 archivos en el dia.
  // Se mantiene un techo elevado en vez de llamadas ilimitadas, incluso si
  // la configuracion anterior estaba fijada en 10.
  const configuredLimit = isDoctor
    ? Math.max(1, Number(Deno.env.get("AI_DAILY_LIMIT") || 60))
    : Math.max(250, Number(Deno.env.get("AI_DAILY_LIMIT_PACIENTE") || 250));
  const limit = Number.isFinite(configuredLimit) ? configuredLimit : (isDoctor ? 60 : 250);
  const checkUsage = async (): Promise<Response | null> => {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count, error: countError } = await admin.from("ai_usage")
      .select("id", { count: "exact", head: true }).eq("doctor_id", userId).gte("at", since);
    if (countError || count === null) return fail("No pudimos comprobar el cupo de IA. Probá de nuevo.", 503);
    if (count >= limit) return fail("Alcanzaste el máximo de " + limit + " operaciones de IA en 24 horas.", 429);
    return null;
  };
  try {
    if (body.action === "transcribir") {
      // Reutilizar transcripcion previa sin pagar otra vez. "force" solo se
      // usa cuando el paciente solicita expresamente volver a leer el original.
      if (!body.force && String(study.report_text || "").trim()) return json({ text: study.report_text, reused: true });
      const denied = await checkUsage();
      if (denied) return denied;
      const file = await loadStudyFile(supabase, study, bearer);
      const { text, usage } = await transcribe(anthropic, file.bytes, file.type);
      const { error: usageError } = await admin.from("ai_usage").insert({
        doctor_id: userId, kind: "transcribir",
        input_tokens: usage.input_tokens, output_tokens: usage.output_tokens
      });
      if (usageError) console.error("No se pudo registrar el gasto de transcripcion");
      return json({ text, reused: false });
    }

    if (!String(study.report_text || "").trim()) return fail("Primero leé el PDF o pegá el texto del informe.", 400);
    const { data: profile, error: profileError } = await supabase.from("profiles")
      .select("birth_date").eq("id", study.patient_id).maybeSingle();
    if (profileError || !profile) return fail("No pudimos comprobar la fecha de nacimiento.", 503);
    // Los datos de salud privados solo se consultan con la cuenta del paciente.
    let salud: {
      altura_cm: number | null; peso_kg: number | null;
      alergias: string[]; grupo_sanguineo: string | null;
    } | undefined;
    if (userId === study.patient_id) {
      const { data: health, error: healthError } = await supabase.from("patient_health_details")
        .select("height_cm,weight_kg,allergies,blood_type").eq("id", study.patient_id).maybeSingle();
      if (healthError) return fail("No pudimos obtener los datos de salud del paciente.", 503);
      if (health) salud = {
        altura_cm: health.height_cm === null ? null : Number(health.height_cm),
        peso_kg: health.weight_kg === null ? null : Number(health.weight_kg),
        alergias: Array.isArray(health.allergies) ? health.allergies.slice(0, 20) : [],
        grupo_sanguineo: health.blood_type || null,
      };
    }
    // Todo antecedente visible para el usuario, no solo seis estudios.
    // Los estudios sin texto aún requieren lectura del archivo a pedido.
    const { data: previous, error: previousError } = await supabase.from("studies")
      .select("title,study_date,report_text,lab_values")
      .eq("patient_id", study.patient_id).neq("id", study.id)
      .order("study_date", { ascending: false }).limit(MAX_CONTEXT_STUDIES);
    if (previousError) return fail("No pudimos cargar los antecedentes autorizados.", 503);
    const available = (previous || []).filter(s => String(s.report_text || "").trim()).length;
    const missing = (previous || []).length - available;
    const anteriores: StudyForAI[] = [];
    let chars = 0;
    for (const prev of previous || []) {
      const texto = compactPrevious(prev.report_text, prev.lab_values);
      if (!texto || chars + texto.length > MAX_CONTEXT_CHARS) continue;
      chars += texto.length;
      anteriores.push({ titulo: prev.title, fecha: prev.study_date, texto });
    }
    // La IA compara fechas y no debe interpretar texto recortado como
    // si fuera un informe completo.
    const input = {
      estudio: { titulo: study.title, fecha: study.study_date, texto: study.report_text },
      anteriores: anteriores.reverse(),
      edad: ageFrom(profile.birth_date || null),
      revisadoPorMedico: !study.self_uploaded,
      salud,
    };
    const signature = await contextHash({ version: "context-20261102-v1", input, model: MODEL });
    const shouldShareWithPatient = Boolean(study.self_uploaded); // Las explicaciones de medicos deben revisarse antes de exponerse.
    const existingText = String(study.explanation || "").trim();
    // Garantiza una sola explicacion vigente por paciente en Supabase.
    const saveLatest = async (text: string, glossary: unknown, vals: unknown) => {
      if (!shouldShareWithPatient) return;
      const { data: previousLatest, error: latestReadErr } = await admin.from("patient_latest_explanations")
        .select("source_study_id,source_signature").eq("patient_id", study.patient_id).maybeSingle();
      if (latestReadErr) throw new ChelyAIError("No pudimos consultar la copia vigente.", 503);
      if (previousLatest?.source_study_id === study.id && previousLatest?.source_signature === signature) {
        await tryMirrorLatest(admin, bearer, study.patient_id, signature);
        return;
      }
      const now = new Date().toISOString();
      const { error: latestError } = await admin.from("patient_latest_explanations").upsert({
        patient_id: study.patient_id, source_study_id: study.id, explanation: text,
        glossary: glossary || [], lab_values: vals || [], model: MODEL,
        previous_studies_used: anteriores.length, previous_studies_available: available,
        source_signature: signature, generated_at: now, updated_at: now,
        debian_sync_status: "pending", debian_synced_at: null
      }, { onConflict: "patient_id" });
      if (latestError) throw new ChelyAIError("La explicacion se guardo en el estudio, pero no en la copia de respaldo.", 503);
      await tryMirrorLatest(admin, bearer, study.patient_id, signature);
    };
    if (!body.force && study.ai_context_sha256 === signature && existingText) {
      await saveLatest(existingText, study.glossary, study.lab_values);
      return json({
        explicacion: existingText, aviso_urgente: "", glosario: study.glossary || [],
        valores: study.lab_values || [], model: MODEL,
        previous_used: anteriores.length, previous_available: available,
        previous_unread: missing, reused: true
      });
    }
    const denied = await checkUsage();
    if (denied) return denied;
    const { result, usage } = await explain(anthropic, input);
    const explanation = (result.aviso_urgente
      ? "## Aviso importante del informe\n" + result.aviso_urgente + "\n\n" : "") + result.explicacion;
    const now = new Date().toISOString();
    // Persistir del lado del servidor: si el navegador se cierra, no se pierde
    // la respuesta ya pagada. Nunca publicar automaticamente un borrador medico.
    const updateData = study.self_uploaded
      ? {
          explanation, glossary: result.glosario, lab_values: result.valores,
          ai_model: MODEL, ai_generated_at: now, ai_context_sha256: signature,
          status: "publicado"
        }
      : { ai_context_sha256: signature }; // El medico debe guardar y publicar su revision.
    const { error: updateError } = await admin.from("studies").update(updateData)
      .eq("id", study.id).eq("patient_id", study.patient_id);
    if (updateError) throw new ChelyAIError("La IA respondió, pero no pudimos guardar la explicación.", 503);
    const { error: usageError } = await admin.from("ai_usage").insert({
      doctor_id: userId, kind: "explicar",
      input_tokens: usage.input_tokens, output_tokens: usage.output_tokens
    });
    if (usageError) console.error("No se pudo registrar el gasto de explicacion");
    await saveLatest(explanation, result.glosario, result.valores);
    return json({
      ...result, model: MODEL, previous_used: anteriores.length,
      previous_available: available, previous_unread: missing, reused: false
    });
  } catch (e) {
    if (e instanceof ChelyAIError) return fail(e.message, e.status);
    console.error("ia: error inesperado", e instanceof Error ? e.name : typeof e);
    return fail("Ocurrió un error inesperado. Probá de nuevo.", 500);
  }
}));