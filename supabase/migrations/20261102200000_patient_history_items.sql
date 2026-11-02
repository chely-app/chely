-- Hecho por ChatGPT · 2026-11-02 · Lectura progresiva, revisable y persistente.
create table if not exists public.patient_history_items (
  patient_id uuid not null references auth.users(id) on delete cascade,
  study_id uuid not null references public.studies(id) on delete cascade,
  job_id uuid not null,
  source_hash text not null check(length(source_hash)=64),
  status text not null check(status in ('pending','done','review','excluded')),
  summary text,
  reason text,
  updated_at timestamptz not null default now(),
  primary key(patient_id,study_id),
  constraint patient_history_items_summary_size
    check (summary is null or length(summary)<=1800)
);
create index if not exists patient_history_items_job_status_idx
  on public.patient_history_items(patient_id,job_id,status);
alter table public.patient_history_items enable row level security;
revoke all on public.patient_history_items from public,anon,authenticated;
grant select on public.patient_history_items to authenticated;
grant all on public.patient_history_items to service_role;
create policy patient_history_items_read_own on public.patient_history_items
  for select to authenticated using(patient_id=(select auth.uid()));
comment on table public.patient_history_items is
  'Checkpoint de análisis por estudio, conserva trabajos realizados y aísla problemas para revisión manual';