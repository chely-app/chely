-- Hecho por ChatGPT · 2026-11-02
-- Permisos mínimos: sólo se habilitan UPDATE de los dos campos nuevos.
-- La política profiles_update existente limita toda edición al propio usuario.
GRANT UPDATE (given_names, family_names) ON public.profiles TO authenticated;

DO $$
BEGIN
  IF NOT has_column_privilege('authenticated','public.profiles','given_names','UPDATE')
     OR NOT has_column_privilege('authenticated','public.profiles','family_names','UPDATE')
     OR has_table_privilege('anon','public.profiles','UPDATE')
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.profiles'::regclass)
  THEN RAISE EXCEPTION 'Permisos de edición de nombres incorrectos.'; END IF;
END $$;