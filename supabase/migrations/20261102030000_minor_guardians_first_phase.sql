-- Hecho por ChatGPT · 2026-11-02
-- Primera fase: perfil del menor y vínculos entre adultos autorizados.
-- NO concede acceso a estudios personales de adultos ni a archivos médicos.
-- La incorporación de informes y de IA para menores necesita controles adicionales antes de publicarse.

create table public.minor_profiles (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (char_length(trim(full_name)) between 2 and 120),
  birth_date date not null check (birth_date <= current_date),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.minor_guardians (
  minor_id uuid not null references public.minor_profiles(id) on delete cascade,
  adult_id uuid not null references public.profiles(id) on delete cascade,
  relationship text not null check (relationship in ('madre','padre','abuela','abuelo','tutor','otro')),
  access_level text not null check (access_level in ('responsable','consulta')),
  added_at timestamptz not null default now(),
  invited_by uuid references public.profiles(id),
  primary key(minor_id, adult_id)
);
create index minor_guardians_adult_idx on public.minor_guardians(adult_id,minor_id);

create table public.minor_invitations (
  id uuid primary key default gen_random_uuid(),
  minor_id uuid not null references public.minor_profiles(id) on delete cascade,
  token_hash text not null unique,
  recipient_email text not null check (char_length(recipient_email) between 3 and 254),
  access_level text not null check (access_level in ('responsable','consulta')),
  created_by uuid not null references public.profiles(id),
  expires_at timestamptz not null default (now() + interval '7 days'),
  used_by uuid references public.profiles(id),
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index minor_invitations_min_idx on public.minor_invitations(minor_id, expires_at);

-- Lectura exclusivamente de la ficha del menor y del vínculo propio.
-- Todas las altas, invitaciones y cambios se canalizan por RPC con auth.uid().
alter table public.minor_profiles enable row level security;
alter table public.minor_guardians enable row level security;
alter table public.minor_invitations enable row level security;
revoke all on public.minor_profiles,public.minor_guardians,public.minor_invitations from public,anon,authenticated;
grant select on public.minor_profiles,public.minor_guardians to authenticated;

create policy minor_guardian_self on public.minor_guardians
  for select to authenticated using (adult_id = (select auth.uid()));
create policy minor_profile_linked on public.minor_profiles
  for select to authenticated using (
    birth_date + interval '18 years' > current_date
    and exists (
      select 1 from public.minor_guardians g
      where g.minor_id = id and g.adult_id = (select auth.uid())
    )
  );

-- El primer responsable se declara padre, madre o tutor; el registro no equivale
-- a verificación de documentación de patria potestad / tutela.
create or replace function public.minor_create(p_name text,p_birth_date date,p_relationship text)
returns uuid language plpgsql security definer set search_path=''
as $fn$
declare v_id uuid;
begin
  if auth.uid() is null or not exists(
    select 1 from public.profiles p where p.id=auth.uid() and p.role='patient' and p.consent_at is not null
  ) then raise exception 'Iniciá sesión como paciente y aceptá el consentimiento.'; end if;
  if p_relationship not in ('madre','padre','tutor') then
    raise exception 'La ficha inicial debe registrarla una madre, padre o tutor responsable.';
  end if;
  if char_length(trim(coalesce(p_name,''))) not between 2 and 120 then
    raise exception 'Revisá el nombre del menor.';
  end if;
  if p_birth_date is null or p_birth_date>current_date or p_birth_date + interval '18 years' <= current_date then
    raise exception 'Esta función es únicamente para menores de 18 años.';
  end if;
  if (select count(*) from public.minor_guardians where adult_id=auth.uid())>=15 then
    raise exception 'Se alcanzó el máximo de menores vinculados a esta cuenta.';
  end if;
  insert into public.minor_profiles(full_name,birth_date,created_by)
    values(trim(p_name),p_birth_date,auth.uid()) returning id into v_id;
  insert into public.minor_guardians(minor_id,adult_id,relationship,access_level,invited_by)
    values(v_id,auth.uid(),p_relationship,'responsable',auth.uid());
  return v_id;
end;
$fn$;

create or replace function public.minor_list()
returns table(id uuid, full_name text, birth_date date, relationship text, access_level text)
language sql stable security invoker set search_path=''
as $fn$
  select m.id,m.full_name,m.birth_date,g.relationship,g.access_level
  from public.minor_guardians g
  join public.minor_profiles m on m.id=g.minor_id
  where g.adult_id=auth.uid() and m.birth_date+interval '18 years'>current_date
  order by m.full_name;
$fn$;

create or replace function public.minor_members(p_minor uuid)
returns table(adult_id uuid,full_name text,email text,relationship text,access_level text,is_creator boolean)
language plpgsql stable security definer set search_path=''
as $fn$
begin
  if auth.uid() is null or not exists (
    select 1 from public.minor_guardians g
    join public.minor_profiles m on m.id=g.minor_id
    where g.minor_id=p_minor and g.adult_id=auth.uid()
      and g.access_level='responsable' and m.birth_date+interval '18 years'>current_date
  ) then raise exception 'No tenés autorización para administrar esta ficha.'; end if;
  return query
    select g.adult_id,p.full_name,p.email,g.relationship,g.access_level,
      (g.adult_id=m.created_by)
    from public.minor_guardians g
    join public.profiles p on p.id=g.adult_id
    join public.minor_profiles m on m.id=g.minor_id
    where g.minor_id=p_minor order by g.added_at;
end;
$fn$;

create or replace function public.minor_invite(p_minor uuid,p_email text,p_access_level text default 'consulta')
returns text language plpgsql security definer set search_path=''
as $fn$
declare v_code text;v_email text;
begin
  if auth.uid() is null or not exists (
    select 1 from public.minor_guardians g
    join public.minor_profiles m on m.id=g.minor_id
    where g.minor_id=p_minor and g.adult_id=auth.uid()
      and g.access_level='responsable' and m.birth_date+interval '18 years'>current_date
  ) then raise exception 'No tenés permiso para invitar adultos.'; end if;
  if p_access_level not in ('responsable','consulta') then raise exception 'Permiso inválido.'; end if;
  v_email:=lower(trim(coalesce(p_email,'')));
  if char_length(v_email) not between 3 and 254 or v_email !~ '^[^ @]+@[^ @]+\.[^ @]+$' then
    raise exception 'Ingresá un correo electrónico válido.';
  end if;
  if (select count(*) from public.minor_guardians where minor_id=p_minor)>=12 then
    raise exception 'Se alcanzó el límite de adultos vinculados.';
  end if;
  if (select count(*) from public.minor_invitations where minor_id=p_minor and used_by is null
      and expires_at>now())>=12 then raise exception 'Hay demasiadas invitaciones pendientes.'; end if;
  v_code:=encode(extensions.gen_random_bytes(24),'hex');
  insert into public.minor_invitations(minor_id,token_hash,recipient_email,access_level,created_by)
  values(p_minor,encode(extensions.digest(v_code,'sha256'),'hex'),v_email,p_access_level,auth.uid());
  return v_code;
end;
$fn$;

create or replace function public.minor_accept(p_code text,p_relationship text)
returns uuid language plpgsql security definer set search_path=''
as $fn$
declare v_inv public.minor_invitations;v_email text;v_id uuid;
begin
  if auth.uid() is null then raise exception 'Primero iniciá sesión.'; end if;
  if p_relationship not in ('madre','padre','abuela','abuelo','tutor','otro') then
    raise exception 'Indicá tu relación con el menor.';
  end if;
  select lower(u.email) into v_email from auth.users u
    where u.id=auth.uid() and u.email_confirmed_at is not null;
  if v_email is null then raise exception 'Primero verificá tu correo electrónico.'; end if;
  select * into v_inv from public.minor_invitations
    where token_hash=encode(extensions.digest(trim(coalesce(p_code,'')),'sha256'),'hex')
    for update;
  if not found or v_inv.used_by is not null or v_inv.expires_at<=now() then
    raise exception 'La invitación es inválida, venció o ya fue utilizada.';
  end if;
  if v_inv.recipient_email<>v_email then
    raise exception 'Esta invitación fue enviada a otro correo.';
  end if;
  if not exists(select 1 from public.minor_profiles m
       where m.id=v_inv.minor_id and m.birth_date+interval '18 years'>current_date)
  then raise exception 'La ficha ya no corresponde a un menor de edad.'; end if;
  if (select count(*) from public.minor_guardians where minor_id=v_inv.minor_id)>=12
    and not exists(select 1 from public.minor_guardians where minor_id=v_inv.minor_id and adult_id=auth.uid())
  then raise exception 'La ficha alcanzó el límite de adultos.'; end if;
  insert into public.minor_guardians(minor_id,adult_id,relationship,access_level,invited_by)
    values(v_inv.minor_id,auth.uid(),p_relationship,v_inv.access_level,v_inv.created_by)
    on conflict(minor_id,adult_id) do update
      set relationship=excluded.relationship,access_level=excluded.access_level,invited_by=excluded.invited_by;
  update public.minor_invitations set used_by=auth.uid(),used_at=now() where id=v_inv.id;
  v_id:=v_inv.minor_id;
  return v_id;
end;
$fn$;

create or replace function public.minor_remove_adult(p_minor uuid,p_adult uuid)
returns void language plpgsql security definer set search_path=''
as $fn$
begin
  if auth.uid() is null or not exists (
    select 1 from public.minor_guardians g
    join public.minor_profiles m on m.id=g.minor_id
    where g.minor_id=p_minor and g.adult_id=auth.uid()
      and g.access_level='responsable' and m.birth_date+interval '18 years'>current_date
  ) then raise exception 'No tenés permiso para administrar esta ficha.'; end if;
  if p_adult=(select created_by from public.minor_profiles where id=p_minor) then
    raise exception 'No se puede quitar al responsable que creó la ficha desde aquí.';
  end if;
  delete from public.minor_guardians where minor_id=p_minor and adult_id=p_adult;
  if not found then raise exception 'No encontramos a esa persona vinculada.'; end if;
end;
$fn$;

-- Tras cumplir 18 años, ninguna de estas funciones ofrece acceso: se deberá
-- implementar traspaso a cuenta propia con consentimiento de la persona adulta.
revoke all on function public.minor_create(text,date,text) from public,anon;
revoke all on function public.minor_list() from public,anon;
revoke all on function public.minor_members(uuid) from public,anon;
revoke all on function public.minor_invite(uuid,text,text) from public,anon;
revoke all on function public.minor_accept(text,text) from public,anon;
revoke all on function public.minor_remove_adult(uuid,uuid) from public,anon;
grant execute on function public.minor_create(text,date,text) to authenticated;
grant execute on function public.minor_list() to authenticated;
grant execute on function public.minor_members(uuid) to authenticated;
grant execute on function public.minor_invite(uuid,text,text) to authenticated;
grant execute on function public.minor_accept(text,text) to authenticated;
grant execute on function public.minor_remove_adult(uuid,uuid) to authenticated;
