// Respuestas HTTP y cliente de Supabase con la sesión de quien llama.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// APP_ORIGIN admite varias direcciones separadas por comas. La app vive en chely.app/app.
const ORIGINS = (Deno.env.get("APP_ORIGIN") ?? "*").split(",").map((o) => o.trim()).filter(Boolean);
if (!ORIGINS.includes("*") && !ORIGINS.includes("https://chely.app")) ORIGINS.push("https://chely.app");

export const cors = {
  "Access-Control-Allow-Origin": ORIGINS[0],
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

// Responde con el origen de quien llama si está permitido.
export function withCors(handler: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    const res = await handler(req);
    const origin = req.headers.get("Origin");
    if (ORIGINS.includes("*")) res.headers.set("Access-Control-Allow-Origin", "*");
    else if (origin && ORIGINS.includes(origin)) res.headers.set("Access-Control-Allow-Origin", origin);
    return res;
  };
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

export function fail(message: string, status = 400) {
  return json({ error: message }, status);
}

export async function userClient(req: Request): Promise<{ supabase: SupabaseClient; userId: string } | null> {
  const auth = req.headers.get("Authorization");
  if (!auth) return null;
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { supabase, userId: data.user.id };
}

export function serviceClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}
