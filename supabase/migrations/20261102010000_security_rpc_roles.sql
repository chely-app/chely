-- Hecho por ChatGPT · 2026-11-01 · Revisión de funciones RPC para Chely.
-- Se reserva la información sobre códigos de invitación para uso administrativo.
-- Dos consultas de solo lectura pasan a ejecutarse bajo RLS del usuario,
-- conservando permisos y firmas para no alterar las políticas ni el frontend.
-- IMPORTANTE: no se revocan las RPC privilegiadas de consentimiento, vínculos o estudios:
-- sus comprobaciones de identidad dependen de los privilegios deliberados del dueño.
REVOKE EXECUTE ON FUNCTION public.invitation_info(text) FROM PUBLIC, anon, authenticated;
ALTER FUNCTION public.is_doctor(uuid) SECURITY INVOKER;
ALTER FUNCTION public.is_linked(uuid, uuid) SECURITY INVOKER;

DO $verify_rpc$
BEGIN
  IF has_function_privilege('anon', 'public.invitation_info(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'invitation_info sigue expuesta a anon';
  END IF;
  IF has_function_privilege('authenticated', 'public.invitation_info(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'invitation_info sigue expuesta a authenticated';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.is_doctor(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.is_linked(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Las consultas de RLS perdieron permisos necesarios';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.profiles', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.care_links', 'SELECT') THEN
    RAISE EXCEPTION 'Las consultas invoker no tienen acceso SELECT bajo RLS';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('is_doctor', 'is_linked') AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'Una consulta continúa siendo SECURITY DEFINER';
  END IF;
END;
$verify_rpc$;
