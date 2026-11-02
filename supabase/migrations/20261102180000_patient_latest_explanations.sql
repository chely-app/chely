-- Hecho por ChatGPT · 2026-11-02 · Explicacion vigente por paciente adulto.
-- Conservar todos los originales; solo una copia agregada por patient_id.
create table if not exists public.patient_latest_explanations (
  patient_id uuid primary key references public.profiles(id) on delete cascade,
  source_study_id uuid references public.studies(id) on delete cascade,
  explanation text not null check (char_length(explanation) between 1 and 60000),
  glossary jsonb not null default '[]'::jsonb,
  lab_values jsonb not null default '[]'::jsonb,
  model text,
  previous_studies_used integer not null default 0 check (previous_studies_used >= 0),
  previous_studies_available integer not null default 0 check (previous_studies_available >= 0),
  source_signature text,
  generated_at timestamptz not null default now(),
  debian_sync_status text not null default 'pending'
    check (debian_sync_status in ('pending','synced')),
  debian_synced_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.patient_latest_explanations enable row level security;
revoke all on public.patient_latest_explanations from public, anon, authenticated;
grant select on public.patient_latest_explanations to authenticated;
grant all on public.patient_latest_explanations to service_role;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='patient_latest_explanations'
      and policyname='patient_latest_explanations_owner_read'
  ) then
    create policy patient_latest_explanations_owner_read
      on public.patient_latest_explanations for select to authenticated
      using (patient_id = (select auth.uid()));
  end if;
end $$;
alter table public.studies add column if not exists ai_context_sha256 text;
comment on column public.studies.ai_context_sha256 is
  'Hecho por ChatGPT: huella SHA-256 de entrada del analisis para reutilizar respuestas.';
comment on table public.patient_latest_explanations is
  'Hecho por ChatGPT: ultima explicacion visible al paciente; status pending hasta confirmar replica real en Debian.';