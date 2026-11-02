-- Hecho por ChatGPT · 2026-11-02
-- Grupo y factor sanguíneo ABO/Rh, dato opcional y autodeclarado.
-- Sólo se almacena en fichas privadas bajo RLS ya existente;
-- no se modifican estudios, permisos o datos previos.

ALTER TABLE public.patient_health_details
  ADD COLUMN IF NOT EXISTS blood_type text
    CONSTRAINT patient_health_blood_type_check
      CHECK (blood_type IS NULL OR blood_type IN ('A+','A-','B+','B-','AB+','AB-','O+','O-'));

ALTER TABLE public.minor_health_details
  ADD COLUMN IF NOT EXISTS blood_type text
    CONSTRAINT minor_health_blood_type_check
      CHECK (blood_type IS NULL OR blood_type IN ('A+','A-','B+','B-','AB+','AB-','O+','O-'));

COMMENT ON COLUMN public.patient_health_details.blood_type IS
  'Hecho por ChatGPT 2026-11-02: grupo ABO y factor Rh autodeclarados, no verificados; no aptos para decisiones transfusionales.';
COMMENT ON COLUMN public.minor_health_details.blood_type IS
  'Hecho por ChatGPT 2026-11-02: grupo ABO y factor Rh autodeclarados, no verificados; no aptos para decisiones transfusionales.';

DO $$
BEGIN
  IF has_table_privilege('anon', 'public.patient_health_details', 'SELECT')
    OR has_table_privilege('anon', 'public.minor_health_details', 'SELECT')
    OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.patient_health_details'::regclass)
    OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.minor_health_details'::regclass)
  THEN RAISE EXCEPTION 'Las fichas de salud no están protegidas por RLS.'; END IF;
END $$;