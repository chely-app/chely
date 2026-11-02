-- Hecho por ChatGPT · 2026-11-02
-- Datos personales de salud aislados de public.profiles (que es visible para médicos vinculados).
-- Sólo el propio paciente puede leer/modificar su ficha. Los administradores NO acceden a esta tabla.
create table if not exists public.patient_health_details (
  id uuid primary key references public.profiles(id) on delete cascade,
  document_type text check (document_type is null or document_type in ('DNI','CUIT')),
  document_number text check (
    document_number is null or
    (document_type = 'DNI' and document_number ~ '^[0-9]{7,8}$') or
    (document_type = 'CUIT' and document_number ~ '^[0-9]{11}$')
  ),
  height_cm numeric(5,1) check (height_cm is null or (height_cm between 40 and 250)),
  weight_kg numeric(5,1) check (weight_kg is null or (weight_kg between 1 and 400)),
  allergies text[] not null default '{}',
  health_coverage text check (health_coverage is null or char_length(health_coverage) <= 160),
  updated_at timestamptz not null default now(),
  constraint allergies_limits check (cardinality(allergies) <= 20 and char_length(array_to_string(allergies, '|')) <= 2500)
);
alter table public.patient_health_details enable row level security;
revoke all on public.patient_health_details from public, anon, authenticated;
grant select, insert, update, delete on public.patient_health_details to authenticated;
create policy patient_health_owner_select on public.patient_health_details for select to authenticated using (id = (select auth.uid()));
create policy patient_health_owner_insert on public.patient_health_details for insert to authenticated with check (
  id = (select auth.uid()) and exists(select 1 from public.profiles where id = (select auth.uid()) and role='patient')
);
create policy patient_health_owner_update on public.patient_health_details for update to authenticated using (id = (select auth.uid())) with check (
  id = (select auth.uid()) and exists(select 1 from public.profiles where id = (select auth.uid()) and role='patient')
);
create policy patient_health_owner_delete on public.patient_health_details for delete to authenticated using (id = (select auth.uid()));
comment on table public.patient_health_details is 'Hecho por ChatGPT 2026-11-02: ficha clínica privada editable únicamente por el paciente.';
-- No mostrar siquiera el registro de accesos al paciente vía PostgREST.
-- El registro sigue existiendo y se escribe por funciones con permisos controlados.
drop policy if exists access_log_select on public.access_log;
revoke select on public.access_log from authenticated;
-- Consulta exclusiva para el equipo administrador. No expone contenido del estudio.
create or replace function public.admin_study_access_log()
returns table(at timestamptz, action text, patient_email text, actor_email text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Sólo los administradores autorizados pueden consultar el registro.';
  end if;
  return query
    select l.at, l.action, patient.email, actor.email
    from public.access_log l
    left join public.profiles patient on patient.id = l.patient_id
    left join public.profiles actor on actor.id = l.actor_id
    order by l.at desc limit 100;
end
$$;
revoke all on function public.admin_study_access_log() from public, anon;
grant execute on function public.admin_study_access_log() to authenticated;
-- Comprobaciones de permisos: abortar la migración si la tabla o los logs quedaron expuestos.
do $$
begin
  if has_table_privilege('anon','public.patient_health_details','SELECT')
    or has_table_privilege('authenticated','public.access_log','SELECT')
    or has_function_privilege('anon','public.admin_study_access_log()','EXECUTE')
  then raise exception 'Permisos incorrectos: revisar acceso de datos privados'; end if;
end $$;
