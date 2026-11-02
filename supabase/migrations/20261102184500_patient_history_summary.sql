-- Hecho por ChatGPT · 2026-11-02 · Archivo de migración versionado.
create table if not exists public.patient_history_summaries (
  patient_id uuid primary key references public.profiles(id) on delete cascade,
  explanation text not null check(length(explanation) between 50 and 30000),
  source_signature text not null check(length(source_signature)=64),
  total_studies integer not null check(total_studies between 1 and 250),
  unique_reports integer not null check(unique_reports between 1 and 250),
  unconfirmed_studies integer not null default 0 check(unconfirmed_studies>=0),
  latest_confirmed_date date,
  model text not null,
  input_tokens integer,
  output_tokens integer,
  generated_at timestamptz not null default now()
);
alter table public.patient_history_summaries enable row level security;
revoke all on public.patient_history_summaries from public,anon,authenticated;
grant select on public.patient_history_summaries to authenticated;
grant all on public.patient_history_summaries to service_role;
create policy patient_history_summaries_owner_select
  on public.patient_history_summaries for select to authenticated
  using (patient_id=(select auth.uid()));

create or replace function public.chely_invalidate_history_summary_on_change()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  delete from public.patient_history_summaries where patient_id=coalesce(new.patient_id,old.patient_id);
  return coalesce(new,old);
end;$$;
revoke all on function public.chely_invalidate_history_summary_on_change()
  from public, anon, authenticated;
create trigger chely_studies_invalidate_history_summary
 after delete or update of report_text,title,study_date on public.studies
 for each row execute function public.chely_invalidate_history_summary_on_change();
alter table public.ai_usage drop constraint if exists ai_usage_kind_check;
alter table public.ai_usage add constraint ai_usage_kind_check
 check (kind in ('transcribir','explicar','resumen_integral'));