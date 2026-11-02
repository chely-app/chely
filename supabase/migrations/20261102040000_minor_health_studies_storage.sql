-- Hecho por ChatGPT · 2026-11-02
-- Estudios pediátricos aislados de studies / storage.estudios (pacientes adultos).
-- Los adultos vinculados pueden consultar y modificar; terceros no obtienen permisos.
-- Todos los accesos caducan a los 18 años, pendientes de traspaso a cuenta propia.

CREATE TABLE public.minor_health_details (
  minor_id uuid PRIMARY KEY REFERENCES public.minor_profiles(id) ON DELETE CASCADE,
  document_type text CHECK (document_type IS NULL OR document_type IN ('DNI','CUIL','CUIT')),
  document_number text CHECK (
    document_number IS NULL OR
    (document_type='DNI' AND document_number ~ '^[0-9]{7,8}$') OR
    (document_type IN ('CUIL','CUIT') AND document_number ~ '^[0-9]{11}$')
  ),
  height_cm numeric(5,1) CHECK (height_cm IS NULL OR height_cm BETWEEN 40 AND 250),
  weight_kg numeric(5,1) CHECK (weight_kg IS NULL OR weight_kg BETWEEN 1 AND 400),
  allergies text[] NOT NULL DEFAULT '{}'
    CHECK (cardinality(allergies)<=20 AND char_length(array_to_string(allergies,'|'))<=2500),
  health_coverage text CHECK (health_coverage IS NULL OR char_length(health_coverage)<=160),
  updated_by uuid REFERENCES public.profiles(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.minor_studies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  minor_id uuid NOT NULL REFERENCES public.minor_profiles(id) ON DELETE CASCADE,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id),
  title text NOT NULL CHECK (char_length(trim(title)) BETWEEN 2 AND 180),
  study_date date NOT NULL CHECK (study_date<=current_date),
  report_text text NOT NULL DEFAULT '' CHECK (char_length(report_text)<=100000),
  explanation text NOT NULL DEFAULT '' CHECK (char_length(explanation)<=100000),
  glossary jsonb NOT NULL DEFAULT '[]'::jsonb,
  lab_values jsonb NOT NULL DEFAULT '[]'::jsonb,
  ai_model text,
  ai_generated_at timestamptz,
  file_path text,
  file_name text CHECK (file_name IS NULL OR char_length(file_name)<=255),
  file_type text CHECK (file_type IS NULL OR file_type IN ('application/pdf','image/jpeg','image/png','image/webp')),
  updated_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT minor_file_path_scoped CHECK (
    file_path IS NULL OR
    (split_part(file_path,'/',1)=minor_id::text
      AND split_part(file_path,'/',2)=id::text
      AND split_part(file_path,'/',3)<>''
      AND file_path NOT LIKE '%..%')
  )
);
CREATE INDEX minor_studies_lookup ON public.minor_studies(minor_id,study_date DESC);
CREATE INDEX minor_health_updated_idx ON public.minor_health_details(updated_at);

-- Impide mover un informe de un menor a otro o suplantar el creador después del alta.
CREATE FUNCTION public.minor_study_immutable_owner() RETURNS trigger LANGUAGE plpgsql
SET search_path='' AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.minor_id IS DISTINCT FROM OLD.minor_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN RAISE EXCEPTION 'No se puede modificar la identidad del estudio.'; END IF;
  NEW.updated_at = now();
  NEW.updated_by = auth.uid();
  RETURN NEW;
END $$;
CREATE TRIGGER minor_study_preserve_identity BEFORE UPDATE ON public.minor_studies
FOR EACH ROW EXECUTE FUNCTION public.minor_study_immutable_owner();

-- RLS: una membresía vigente del adulto + menor con menos de 18 años.
-- Los permisos no se basan en parámetros ni email enviados desde el navegador.
ALTER TABLE public.minor_health_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.minor_studies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.minor_health_details, public.minor_studies FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.minor_health_details TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.minor_studies TO authenticated;

CREATE POLICY minor_health_select ON public.minor_health_details FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.minor_guardians g JOIN public.minor_profiles m ON m.id=g.minor_id
  WHERE g.minor_id=minor_health_details.minor_id AND g.adult_id=(SELECT auth.uid())
    AND m.birth_date + interval '18 years' > current_date
));
CREATE POLICY minor_health_insert ON public.minor_health_details FOR INSERT TO authenticated
WITH CHECK (updated_by=(SELECT auth.uid()) AND EXISTS (
  SELECT 1 FROM public.minor_guardians g JOIN public.minor_profiles m ON m.id=g.minor_id
  WHERE g.minor_id=minor_health_details.minor_id AND g.adult_id=(SELECT auth.uid())
    AND m.birth_date + interval '18 years' > current_date
));
CREATE POLICY minor_health_update ON public.minor_health_details FOR UPDATE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.minor_guardians g JOIN public.minor_profiles m ON m.id=g.minor_id
  WHERE g.minor_id=minor_health_details.minor_id AND g.adult_id=(SELECT auth.uid())
    AND m.birth_date + interval '18 years' > current_date
))
WITH CHECK (updated_by=(SELECT auth.uid()) AND EXISTS (
  SELECT 1 FROM public.minor_guardians g JOIN public.minor_profiles m ON m.id=g.minor_id
  WHERE g.minor_id=minor_health_details.minor_id AND g.adult_id=(SELECT auth.uid())
    AND m.birth_date + interval '18 years' > current_date
));
CREATE POLICY minor_studies_read ON public.minor_studies FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.minor_guardians g JOIN public.minor_profiles m ON m.id=g.minor_id
  WHERE g.minor_id=minor_studies.minor_id AND g.adult_id=(SELECT auth.uid())
    AND m.birth_date + interval '18 years' > current_date
));
CREATE POLICY minor_studies_insert ON public.minor_studies FOR INSERT TO authenticated
WITH CHECK (created_by=(SELECT auth.uid()) AND EXISTS (
  SELECT 1 FROM public.minor_guardians g JOIN public.minor_profiles m ON m.id=g.minor_id
  WHERE g.minor_id=minor_studies.minor_id AND g.adult_id=(SELECT auth.uid())
    AND m.birth_date + interval '18 years' > current_date
));
CREATE POLICY minor_studies_update ON public.minor_studies FOR UPDATE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.minor_guardians g JOIN public.minor_profiles m ON m.id=g.minor_id
  WHERE g.minor_id=minor_studies.minor_id AND g.adult_id=(SELECT auth.uid())
    AND m.birth_date + interval '18 years' > current_date
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.minor_guardians g JOIN public.minor_profiles m ON m.id=g.minor_id
  WHERE g.minor_id=minor_studies.minor_id AND g.adult_id=(SELECT auth.uid())
    AND m.birth_date + interval '18 years' > current_date
));
CREATE POLICY minor_studies_delete ON public.minor_studies FOR DELETE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.minor_guardians g JOIN public.minor_profiles m ON m.id=g.minor_id
  WHERE g.minor_id=minor_studies.minor_id AND g.adult_id=(SELECT auth.uid())
    AND m.birth_date + interval '18 years' > current_date
));

-- Archivo de menor en bucket separado y privado. No usa el servidor Debian
-- ni las políticas del bucket adultos; todos los objetos se verifican por estudio.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('estudios-menores','estudios-menores',false,20971520,
  ARRAY['application/pdf','image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY minor_files_read ON storage.objects FOR SELECT TO authenticated
USING (bucket_id='estudios-menores' AND EXISTS(
  SELECT 1 FROM public.minor_studies s
  WHERE s.minor_id::text=(storage.foldername(name))[1]
    AND s.id::text=(storage.foldername(name))[2]
    AND s.file_path=name
));
CREATE POLICY minor_files_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id='estudios-menores' AND EXISTS(
  SELECT 1 FROM public.minor_studies s
  WHERE s.minor_id::text=(storage.foldername(name))[1]
    AND s.id::text=(storage.foldername(name))[2]
));
CREATE POLICY minor_files_delete ON storage.objects FOR DELETE TO authenticated
USING (bucket_id='estudios-menores' AND EXISTS(
  SELECT 1 FROM public.minor_studies s
  WHERE s.minor_id::text=(storage.foldername(name))[1]
    AND s.id::text=(storage.foldername(name))[2]
    AND s.file_path=name
));
COMMENT ON TABLE public.minor_health_details IS 'Hecho por ChatGPT 2026-11-02: ficha de salud del menor privada por vínculo familiar.';
COMMENT ON TABLE public.minor_studies IS 'Hecho por ChatGPT 2026-11-02: informes pediátricos separados de estudios de cuentas adultas.';

DO $$
BEGIN
 IF has_table_privilege('anon','public.minor_studies','SELECT')
   OR has_table_privilege('anon','public.minor_health_details','SELECT')
   OR (SELECT public FROM storage.buckets WHERE id='estudios-menores')
 THEN RAISE EXCEPTION 'Acceso anónimo indebido a datos pediátricos'; END IF;
END $$;
