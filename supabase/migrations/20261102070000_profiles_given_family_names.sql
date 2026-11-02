-- Hecho por ChatGPT · 2026-11-02
-- Nombres y apellidos independientes en perfiles. full_name sigue siendo
-- la representación canónica para las vistas, médicos y funciones existentes.
-- Sin deducción masiva: los nombres compuestos no se pueden dividir con certeza.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS given_names text,
  ADD COLUMN IF NOT EXISTS family_names text;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_given_names_length
    CHECK (given_names IS NULL OR char_length(btrim(given_names)) BETWEEN 1 AND 120),
  ADD CONSTRAINT profiles_family_names_length
    CHECK (family_names IS NULL OR char_length(btrim(family_names)) BETWEEN 1 AND 120);

COMMENT ON COLUMN public.profiles.given_names IS
  'Hecho por ChatGPT 2026-11-02: nombre/s provisto/s y confirmado/s por el titular; null hasta su primera edición.';
COMMENT ON COLUMN public.profiles.family_names IS
  'Hecho por ChatGPT 2026-11-02: apellido/s provisto/s y confirmado/s por el titular; null hasta su primera edición.';

DO $$
BEGIN
  IF has_table_privilege('anon','public.profiles','UPDATE')
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.profiles'::regclass)
  THEN RAISE EXCEPTION 'La tabla profiles debe mantener acceso privado para cambios.'; END IF;
END $$;