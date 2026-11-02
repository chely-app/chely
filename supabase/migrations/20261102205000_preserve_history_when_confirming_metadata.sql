-- Hecho por ChatGPT · 2026-11-02
-- No borrar evaluaciones ya abonadas al confirmar fecha/título de un estudio.
-- Sí invalidarlas si se elimina un estudio o cambia realmente el texto clínico.
create or replace function public.chely_invalidate_history_summary_on_change()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if TG_OP = 'UPDATE' and old.report_text IS NOT DISTINCT FROM new.report_text then
    return new;
  end if;
  if TG_OP = 'DELETE' then
    delete from public.patient_history_summaries where patient_id = old.patient_id;
    return old;
  end if;
  delete from public.patient_history_summaries where patient_id = new.patient_id;
  return new;
end;
$$;
drop trigger if exists chely_studies_invalidate_history_summary on public.studies;
create trigger chely_studies_invalidate_history_summary
  after delete or update of report_text on public.studies
  for each row execute function public.chely_invalidate_history_summary_on_change();