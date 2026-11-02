-- Hecho por ChatGPT · 2026-11-02
-- Varias obras sociales/prepagas en fichas adultas y de menores.
-- Se conserva health_coverage para compatibilidad con versiones antiguas de Chely.
-- La RLS existente sigue protegiendo los datos de cada paciente y menor.

ALTER TABLE public.patient_health_details
  ADD COLUMN IF NOT EXISTS health_coverages text[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE public.minor_health_details
  ADD COLUMN IF NOT EXISTS health_coverages text[] NOT NULL DEFAULT '{}'::text[];

UPDATE public.patient_health_details
SET health_coverages = ARRAY[btrim(health_coverage)]
WHERE cardinality(health_coverages) = 0
  AND nullif(btrim(health_coverage), '') IS NOT NULL;

UPDATE public.minor_health_details
SET health_coverages = ARRAY[btrim(health_coverage)]
WHERE cardinality(health_coverages) = 0
  AND nullif(btrim(health_coverage), '') IS NOT NULL;

ALTER TABLE public.patient_health_details
  ADD CONSTRAINT patient_health_coverages_limit
  CHECK (cardinality(health_coverages) <= 8
         AND char_length(array_to_string(health_coverages, '|')) <= 1287);
ALTER TABLE public.minor_health_details
  ADD CONSTRAINT minor_health_coverages_limit
  CHECK (cardinality(health_coverages) <= 8
         AND char_length(array_to_string(health_coverages, '|')) <= 1287);

COMMENT ON COLUMN public.patient_health_details.health_coverages IS
  'Hecho por ChatGPT 2026-11-02: hasta ocho coberturas por paciente; RLS propia.';
COMMENT ON COLUMN public.minor_health_details.health_coverages IS
  'Hecho por ChatGPT 2026-11-02: hasta ocho coberturas por menor; RLS por adulto vinculado.';

DO $$
BEGIN
  IF has_table_privilege('anon', 'public.patient_health_details', 'SELECT')
    OR has_table_privilege('anon', 'public.minor_health_details', 'SELECT')
    OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.patient_health_details'::regclass)
    OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.minor_health_details'::regclass)
  THEN
    RAISE EXCEPTION 'No se habilitan coberturas sin RLS privado.';
  END IF;
END $$;
