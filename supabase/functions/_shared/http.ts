// Respuestas HTTP y cliente de Supabase con la sesión de quien llama.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const ORIGIN = Deno.env.get("APP_ORIGIN") ?? "*";
export const cors = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

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
