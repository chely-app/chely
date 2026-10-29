// Prueba la lógica de IA con un servidor simulado (no llama a la API real ni gasta crédito).
// Uso: node tests/ia/claude.test.mjs <ruta a claude.js compilado> <ruta a node_modules>
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const [mod, nodeModules] = process.argv.slice(2);
const require = createRequire(nodeModules + "/");
const Anthropic = require("@anthropic-ai/sdk").default;
const { explain, transcribe, ChelyAIError, MODEL } = await import(pathToFileURL(mod).href);

function fakeClient(respond) {
  const calls = [];
  const client = new Anthropic({
    apiKey: "test", maxRetries: 0,
    fetch: async (url, init) => {
      const body = JSON.parse(init.body);
      calls.push({ url: String(url), headers: new Headers(init.headers), body });
      const [status, payload] = respond(body);
      return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json", "request-id": "req_test" } });
    },
  });
  return { client, calls };
}
const msg = (text, stop = "end_turn") => ({
  id: "msg_1", type: "message", role: "assistant", model: MODEL, stop_reason: stop, stop_sequence: null,
  content: [{ type: "text", text }], usage: { input_tokens: 100, output_tokens: 50 },
});
const ok = (name) => console.log("  OK:", name);

const sample = { aviso_urgente: "", explicacion: "## Qué dice tu estudio\n- Glucemia 112 mg/dL.", glosario: [{ termino: "Glucemia", definicion: "Azúcar en sangre." }],
  valores: [{ nombre: "Glucemia", valor: 112, valor_texto: "112", unidad: "mg/dL", referencia_texto: "70 - 100", ref_min: 70, ref_max: 100 }] };

{ // Explicación: forma del pedido y lectura de la respuesta.
  const { client, calls } = fakeClient(() => [200, msg(JSON.stringify(sample))]);
  const { result } = await explain(client, { estudio: { titulo: "Análisis", fecha: "2026-10-01", texto: "Glucemia 112 mg/dL" },
    anteriores: [{ titulo: "Análisis previo", fecha: "2026-03-01", texto: "Glucemia 101 mg/dL" }], edad: 72, revisadoPorMedico: true });
  const b = calls[0].body;
  assert.equal(b.model, "claude-opus-5-5"); ok("usa claude-opus-5-5");
  assert.equal(b.fallbacks, "default"); assert.match(calls[0].headers.get("anthropic-beta"), /server-side-fallback-2026-07-01/); ok("fallback por política activado");
  assert.equal(b.output_config.format.type, "json_schema"); assert.equal(b.output_config.effort, "high"); ok("pide JSON estructurado con esfuerzo alto");
  assert.equal(b.thinking, undefined); assert.equal(b.temperature, undefined); ok("sin parámetros que el modelo rechaza");
  assert.equal(b.system[0].cache_control.type, "ephemeral"); ok("instrucciones fijas en caché");
  assert.match(b.messages[0].content, /<informe_actual[^>]*fecha="2026-10-01"/); assert.match(b.messages[0].content, /Glucemia 101/); assert.match(b.messages[0].content, /edad="72"/); ok("incluye informe, anteriores y edad");
  assert.equal(result.valores[0].ref_max, 100); assert.equal(result.glosario.length, 1); ok("devuelve explicación, glosario y valores");
}
{ // Estudio subido por el paciente: el pedido avisa que no hay revisión médica.
  const { client, calls } = fakeClient(() => [200, msg(JSON.stringify(sample))]);
  await explain(client, { estudio: { titulo: "Mi análisis", fecha: "2026-10-01", texto: "Glucemia 112 mg/dL" }, anteriores: [], edad: null, revisadoPorMedico: false });
  assert.match(calls[0].body.messages[0].content, /<modo>[^<]*SIN revisión médica/); ok("estudio del paciente: avisa que no hay revisión médica");
}
{ // Rechazo por política.
  const { client } = fakeClient(() => [200, msg("", "refusal")]);
  await assert.rejects(explain(client, { estudio: { titulo: "x", fecha: "2026-10-01", texto: "x" }, anteriores: [], edad: null, revisadoPorMedico: true }),
    (e) => e instanceof ChelyAIError && e.status === 422); ok("rechazo → mensaje para escribir a mano");
}
{ // Respuesta cortada.
  const { client } = fakeClient(() => [200, msg('{"explic', "max_tokens")]);
  await assert.rejects(explain(client, { estudio: { titulo: "x", fecha: "2026-10-01", texto: "x" }, anteriores: [], edad: null, revisadoPorMedico: true }),
    (e) => e instanceof ChelyAIError && /incompleta/.test(e.message)); ok("respuesta incompleta → error claro");
}
{ // Errores HTTP.
  for (const [status, re] of [[401, /clave/], [429, /muchos pedidos/], [400, /no aceptó/], [529, /no respondió/]]) {
    const { client } = fakeClient(() => [status, { type: "error", error: { type: "x", message: "x" } }]);
    await assert.rejects(explain(client, { estudio: { titulo: "x", fecha: "2026-10-01", texto: "x" }, anteriores: [], edad: null, revisadoPorMedico: true }),
      (e) => e instanceof ChelyAIError && re.test(e.message));
  }
  ok("errores 401/429/400/529 → mensajes en español");
}
{ // Texto vacío no llama a la IA.
  const { client, calls } = fakeClient(() => [200, msg("{}")]);
  await assert.rejects(explain(client, { estudio: { titulo: "x", fecha: "2026-10-01", texto: "  " }, anteriores: [], edad: null, revisadoPorMedico: true }));
  assert.equal(calls.length, 0); ok("estudio sin texto no gasta crédito");
}
{ // Transcripción de PDF e imagen.
  const { client, calls } = fakeClient(() => [200, msg("Hemoglobina 12,9 g/dL")]);
  const { text } = await transcribe(client, new TextEncoder().encode("%PDF-1.4 x"), "application/pdf");
  assert.equal(text, "Hemoglobina 12,9 g/dL"); assert.equal(calls[0].body.messages[0].content[0].type, "document"); ok("transcribe PDF como documento");
  await transcribe(client, new Uint8Array([137, 80, 78, 71]), "image/png");
  assert.equal(calls[1].body.messages[0].content[0].source.media_type, "image/png"); ok("transcribe imagen");
  await assert.rejects(transcribe(client, new Uint8Array([1]), "application/zip"), /Formato no admitido/); ok("rechaza formatos no admitidos");
}
{ // Imagen médica sin informe.
  const { client } = fakeClient(() => [200, msg("NO_ES_INFORME")]);
  await assert.rejects(transcribe(client, new Uint8Array([1]), "image/jpeg"), /imagen médica/); ok("detecta radiografías sin texto");
}
console.log("TODAS LAS PRUEBAS DE IA PASARON");
