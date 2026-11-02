-- Hecho por ChatGPT · 2026-11-02 · Progreso persistente del análisis integral.
-- Ejecutada en Supabase antes de publicar el frontend.
create table if not exists public.patient_history_jobs (
 patient_id uuid primary key references auth.users(id) on delete cascade,
 job_id uuid not null default gen_random_uuid(),
 status text not null default 'queued'
   check (status in ('queued','running','done','failed')),
 attempts integer not null default 0 check (attempts between 0 and 6),
 study_count integer not null default 0 check (study_count >= 0),
 message text,
 last_error text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 started_at timestamptz,
 finished_at timestamptz
);
alter table public.patient_history_jobs enable row level security;
revoke all on public.patient_history_jobs from public,anon,authenticated;
grant select on public.patient_history_jobs to authenticated;
grant all on public.patient_history_jobs to service_role;
create policy patient_history_jobs_read_own on public.patient_history_jobs
 for select to authenticated using (patient_id = (select auth.uid()));
comment on table public.patient_history_jobs is
 'Estado duradero por paciente para evaluaciones integrales, independiente de la sesión del navegador.';