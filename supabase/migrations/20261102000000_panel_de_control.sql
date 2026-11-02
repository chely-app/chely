-- Panel de control del equipo de Chely: rol 'admin', resumen y lista de cuentas.
-- El panel muestra cuentas y números; nunca el texto de los estudios ni sus explicaciones.
-- El rol 'admin' se asigna a mano desde el SQL Editor de Supabase, como el de médico.

alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('patient', 'doctor', 'admin'));

-- Lo que hace el equipo desde el panel queda registrado. Solo se lee y escribe desde las funciones de abajo.
create table public.admin_log (
  id bigint generated always as identity primary key,
  admin_id uuid references public.profiles (id) on delete set null,
  action text not null,
  target_id uuid,
  detail text not null default '',
  at timestamptz not null default now()
);
alter table public.admin_log enable row level security;
revoke all on public.admin_log from anon, authenticated;

create or replace function public.is_admin(uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = uid and p.role = 'admin');
$$;

create or replace function public.admin_overview()
returns table (
  pacientes bigint, medicos bigint, equipo bigint, cuentas_7d bigint, sin_consentimiento bigint,
  estudios bigint, estudios_propios bigint, estudios_explicados bigint, estudios_7d bigint, vinculos bigint,
  ia_usos_30d bigint, ia_tokens_entrada_30d bigint, ia_tokens_salida_30d bigint
) language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Solo el equipo de Chely puede ver el panel.'; end if;
  return query select
    (select count(*) from public.profiles where role = 'patient'),
    (select count(*) from public.profiles where role = 'doctor'),
    (select count(*) from public.profiles where role = 'admin'),
    (select count(*) from public.profiles where created_at > now() - interval '7 days'),
    (select count(*) from public.profiles where consent_at is null),
    (select count(*) from public.studies),
    (select count(*) from public.studies where self_uploaded),
    (select count(*) from public.studies where status = 'publicado'),
    (select count(*) from public.studies where created_at > now() - interval '7 days'),
    (select count(*) from public.care_links where active),
    (select count(*) from public.ai_usage where at > now() - interval '30 days'),
    (select coalesce(sum(input_tokens), 0)::bigint from public.ai_usage where at > now() - interval '30 days'),
    (select coalesce(sum(output_tokens), 0)::bigint from public.ai_usage where at > now() - interval '30 days');
end $$;

create or replace function public.admin_users()
returns table (
  id uuid, email text, full_name text, role text, created_at timestamptz, last_sign_in_at timestamptz,
  consent_at timestamptz, estudios bigint, estudios_explicados bigint, vinculos bigint, ia_usos_30d bigint
) language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Solo el equipo de Chely puede ver el panel.'; end if;
  return query select p.id, p.email, p.full_name, p.role, p.created_at, u.last_sign_in_at, p.consent_at,
    (select count(*) from public.studies s where s.patient_id = p.id or s.doctor_id = p.id),
    (select count(*) from public.studies s where (s.patient_id = p.id or s.doctor_id = p.id) and s.status = 'publicado'),
    (select count(*) from public.care_links c where c.active and (c.patient_id = p.id or c.doctor_id = p.id)),
    (select count(*) from public.ai_usage a where a.doctor_id = p.id and a.at > now() - interval '30 days')
  from public.profiles p left join auth.users u on u.id = p.id
  order by p.created_at desc;
end $$;

-- Pasar una cuenta a médico o de vuelta a paciente. Vuelve a pedir que acepte las condiciones de su nuevo rol.
create or replace function public.admin_set_role(p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_old text;
begin
  if not public.is_admin() then raise exception 'Solo el equipo de Chely puede cambiar roles.'; end if;
  if p_role not in ('patient', 'doctor') then raise exception 'Rol inválido.'; end if;
  if p_user = auth.uid() then raise exception 'No podés cambiar tu propio rol.'; end if;
  select role into v_old from public.profiles where id = p_user;
  if v_old is null then raise exception 'No existe esa cuenta.'; end if;
  if v_old = 'admin' then raise exception 'Las cuentas del equipo se cambian desde Supabase.'; end if;
  if v_old = p_role then return; end if;
  update public.profiles set role = p_role, consent_version = null, consent_at = null where id = p_user;
  insert into public.admin_log (admin_id, action, target_id, detail) values (auth.uid(), 'cambiar_rol', p_user, v_old || ' -> ' || p_role);
end $$;

create or replace function public.admin_recent_log()
returns table (at timestamptz, admin_email text, action text, target_email text, detail text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Solo el equipo de Chely puede ver el panel.'; end if;
  return query select l.at, a.email, l.action, t.email, l.detail
  from public.admin_log l left join public.profiles a on a.id = l.admin_id left join public.profiles t on t.id = l.target_id
  order by l.at desc limit 50;
end $$;

revoke execute on function public.is_admin(uuid), public.admin_overview(), public.admin_users(),
  public.admin_set_role(uuid, text), public.admin_recent_log() from public, anon;
grant execute on function public.is_admin(uuid), public.admin_overview(), public.admin_users(),
  public.admin_set_role(uuid, text), public.admin_recent_log() to authenticated;
