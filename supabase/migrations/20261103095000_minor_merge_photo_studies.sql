-- Hecho por ChatGPT · 2026-11-03
-- Las imágenes originales se mantienen en minor_studies y en Storage.
-- Solo se agrupan mediante una referencia; nunca se borran en la unión.
alter table public.minor_studies
  add column if not exists merged_into uuid references public.minor_studies(id) on delete set null;
create index if not exists minor_studies_merged_into_idx
  on public.minor_studies (minor_id, merged_into);
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.minor_studies'::regclass
      and conname='minor_studies_no_self_merge'
  ) then
    alter table public.minor_studies add constraint minor_studies_no_self_merge
      check (merged_into is null or merged_into <> id);
  end if;
end $$;

-- Marcado ATÓMICO: no quedan páginas a medio agrupar si algo falla.
-- El autor de la nueva ficha PDF debe ser el usuario autenticado.
create or replace function public.minor_merge_photo_studies(
  p_minor uuid, p_parent uuid, p_parts uuid[]
) returns integer
language plpgsql security definer set search_path='' as $$
declare
  actor uuid := (select auth.uid());
  n integer;
  expected integer := coalesce(array_length(p_parts,1),0);
begin
  if actor is null then
    raise exception 'Iniciá sesión para organizar los estudios.';
  end if;
  if expected < 2 or expected > 12 then
    raise exception 'Elegí entre 2 y 12 fotos del mismo informe.';
  end if;
  if p_parent = any(p_parts) or
     (select count(distinct x) from unnest(p_parts) x) <> expected then
    raise exception 'La selección de páginas no es válida.';
  end if;
  if not exists(
    select 1 from public.minor_guardians g
    join public.minor_profiles m on m.id=g.minor_id
    where g.minor_id=p_minor and g.adult_id=actor
      and (m.birth_date + interval '18 years') > current_date
  ) then
    raise exception 'No tenés autorización para modificar esta ficha.';
  end if;
  if not exists(
    select 1 from public.minor_studies s
    where s.id=p_parent and s.minor_id=p_minor and s.created_by=actor
      and s.merged_into is null and s.file_type='application/pdf'
      and nullif(s.file_path,'') is not null
  ) then
    raise exception 'Primero guardá el PDF con todas las páginas.';
  end if;
  select count(*) into n from (
    select s.id from public.minor_studies s
    where s.id=any(p_parts) and s.minor_id=p_minor
      and s.merged_into is null
      and s.file_type in ('image/jpeg','image/png','image/webp')
      and nullif(s.file_path,'') is not null
      and coalesce(trim(s.report_text),'')=''
      and coalesce(trim(s.explanation),'')=''
    for update
  ) pages;
  if n<>expected then
    raise exception 'Algunas fotos cambiaron. Actualizá la lista y probá nuevamente.';
  end if;
  update public.minor_studies
    set merged_into=p_parent,updated_by=actor,updated_at=now()
    where minor_id=p_minor and id=any(p_parts) and merged_into is null;
  return n;
end;
$$;
revoke all on function public.minor_merge_photo_studies(uuid,uuid,uuid[])
  from public,anon;
grant execute on function public.minor_merge_photo_studies(uuid,uuid,uuid[])
  to authenticated;
comment on column public.minor_studies.merged_into is
  'Fotografía original conservada, unida a un PDF del mismo menor. No implica borrar el archivo.';
