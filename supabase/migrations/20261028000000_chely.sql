-- Chely · piloto. Esquema, seguridad por filas (RLS) y funciones.
-- Roles: 'patient' (por defecto) y 'doctor' (lo asigna el equipo de Chely).
-- Los datos de salud solo los ven el paciente y los médicos que él vinculó.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null default '' check (char_length(full_name) <= 120),
  role text not null default 'patient' check (role in ('patient', 'doctor')),
  birth_date date,
  consent_version text,
  consent_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.invitations (
  code text primary key,
  doctor_id uuid not null references public.profiles (id) on delete cascade,
  patient_hint text not null default '' check (char_length(patient_hint) <= 120),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  used_by uuid references public.profiles (id) on delete set null,
  used_at timestamptz
);

create table public.care_links (
  doctor_id uuid not null references public.profiles (id) on delete cascade,
  patient_id uuid not null references public.profiles (id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  primary key (doctor_id, patient_id)
);

create table public.studies (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.profiles (id) on delete cascade,
  doctor_id uuid references public.profiles (id) on delete set null,
  title text not null check (char_length(title) between 1 and 160),
  study_date date not null,
  report_text text not null default '' check (char_length(report_text) <= 60000),
  file_path text,
  file_name text,
  file_type text,
  status text not null default 'borrador' check (status in ('borrador', 'publicado')),
  explanation text not null default '' check (char_length(explanation) <= 20000),
  glossary jsonb not null default '[]'::jsonb,
  lab_values jsonb not null default '[]'::jsonb,
  doctor_note text not null default '' check (char_length(doctor_note) <= 2000),
  ai_model text,
  ai_generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  first_viewed_at timestamptz,
  feedback text check (feedback in ('si', 'mas_o_menos', 'no')),
  feedback_at timestamptz
);
create index studies_patient_idx on public.studies (patient_id, study_date desc);
create index studies_doctor_idx on public.studies (doctor_id);

-- Registro de accesos y acciones (lo ve el propio paciente).
create table public.access_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id) on delete set null,
  patient_id uuid references public.profiles (id) on delete cascade,
  study_id uuid references public.studies (id) on delete set null,
  action text not null,
  at timestamptz not null default now()
);
create index access_log_patient_idx on public.access_log (patient_id, at desc);

-- Uso de la IA por médico, para poner un tope diario de costos.
create table public.ai_usage (
  id bigint generated always as identity primary key,
  doctor_id uuid references public.profiles (id) on delete set null,
  kind text not null check (kind in ('transcribir', 'explicar')),
  input_tokens integer,
  output_tokens integer,
  at timestamptz not null default now()
);
create index ai_usage_doctor_idx on public.ai_usage (doctor_id, at desc);

-- ---------------------------------------------------------------------------
-- Funciones auxiliares (security definer, sin search_path)
-- ---------------------------------------------------------------------------
create or replace function public.is_doctor(uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = uid and p.role = 'doctor');
$$;

create or replace function public.is_linked(doc uuid, pat uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.care_links c
                 where c.doctor_id = doc and c.patient_id = pat and c.active);
$$;

create or replace function public.log_action(p_patient uuid, p_study uuid, p_action text)
returns void language sql security definer set search_path = '' as $$
  insert into public.access_log (actor_id, patient_id, study_id, action)
  values (auth.uid(), p_patient, p_study, p_action);
$$;

-- Perfil automático al crear el usuario.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, coalesce(new.email, ''),
          left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 120));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;
create trigger studies_touch before update on public.studies
  for each row execute function public.touch_updated_at();

-- Registra creación y publicación de estudios.
create or replace function public.log_study_changes()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_action(new.patient_id, new.id, 'estudio_creado');
  elsif new.status = 'publicado' and old.status is distinct from 'publicado' then
    perform public.log_action(new.patient_id, new.id, 'estudio_publicado');
  elsif new.status = 'borrador' and old.status = 'publicado' then
    perform public.log_action(new.patient_id, new.id, 'estudio_retirado');
  end if;
  return new;
end $$;
create trigger studies_log after insert or update of status on public.studies
  for each row execute function public.log_study_changes();

-- Un médico solo puede tocar estudios de pacientes vinculados, y publicar fija la fecha.
create or replace function public.guard_study()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v public.studies;
begin
  -- Acciones del paciente (visto / respuesta): solo cambian esos campos.
  if tg_op = 'UPDATE' and current_setting('chely.patient_action', true) = 'on' then
    v := old;
    v.first_viewed_at := new.first_viewed_at;
    v.feedback := new.feedback;
    v.feedback_at := new.feedback_at;
    return v;
  end if;
  if auth.uid() is null then return new; end if;  -- servicio interno
  if not public.is_doctor() then
    raise exception 'Solo los médicos pueden cargar o editar estudios.';
  end if;
  if new.doctor_id is distinct from auth.uid() then
    raise exception 'El estudio debe quedar a tu nombre.';
  end if;
  if not public.is_linked(auth.uid(), new.patient_id) then
    raise exception 'Este paciente no está vinculado con vos.';
  end if;
  if tg_op = 'UPDATE' and new.patient_id <> old.patient_id then
    raise exception 'No se puede cambiar el paciente de un estudio.';
  end if;
  if new.status = 'publicado' then
    if char_length(trim(new.explanation)) = 0 then
      raise exception 'Falta la explicación para publicar.';
    end if;
    if tg_op = 'INSERT' or old.status <> 'publicado' then new.published_at = now(); end if;
  end if;
  -- Lo que hace el paciente no se puede modificar desde el lado del médico.
  if tg_op = 'UPDATE' then
    new.first_viewed_at = old.first_viewed_at;
    new.feedback = old.feedback;
    new.feedback_at = old.feedback_at;
  else
    new.first_viewed_at = null; new.feedback = null; new.feedback_at = null;
  end if;
  return new;
end $$;
create trigger studies_guard before insert or update on public.studies
  for each row execute function public.guard_study();

-- ---------------------------------------------------------------------------
-- Acciones (RPC)
-- ---------------------------------------------------------------------------
create or replace function public.accept_consent(p_version text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Iniciá sesión.'; end if;
  update public.profiles set consent_version = p_version, consent_at = now() where id = auth.uid();
  perform public.log_action(auth.uid(), null, 'consentimiento_' || p_version);
end $$;

-- Datos mínimos de una invitación, visibles antes de registrarse.
create or replace function public.invitation_info(p_code text)
returns table (doctor_name text, valid boolean)
language sql stable security definer set search_path = '' as $$
  select p.full_name,
         (i.used_by is null and i.expires_at > now())
  from public.invitations i join public.profiles p on p.id = i.doctor_id
  where i.code = p_code;
$$;

create or replace function public.create_invitation(p_hint text default '')
returns text language plpgsql security definer set search_path = '' as $$
declare v_code text;
begin
  if not public.is_doctor() then raise exception 'Solo los médicos pueden invitar pacientes.'; end if;
  -- Código legible, sin letras que se confunden.
  select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + (get_byte(b, i) % 31), 1), '')
    into v_code
    from (select extensions.gen_random_bytes(10) as b) r, generate_series(0, 9) i;
  insert into public.invitations (code, doctor_id, patient_hint) values (v_code, auth.uid(), left(coalesce(p_hint, ''), 120));
  return v_code;
end $$;

create or replace function public.redeem_invitation(p_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_inv public.invitations;
begin
  if auth.uid() is null then raise exception 'Iniciá sesión.'; end if;
  select * into v_inv from public.invitations where code = upper(trim(p_code)) for update;
  if not found then raise exception 'El código de invitación no existe. Revisalo con tu médico.'; end if;
  if v_inv.doctor_id = auth.uid() then raise exception 'No podés usar tu propia invitación.'; end if;
  if v_inv.used_by is not null and v_inv.used_by <> auth.uid() then raise exception 'Esta invitación ya fue usada. Pedile una nueva a tu médico.'; end if;
  if v_inv.expires_at < now() then raise exception 'La invitación venció. Pedile una nueva a tu médico.'; end if;
  if (select consent_at from public.profiles where id = auth.uid()) is null then
    raise exception 'Primero aceptá el consentimiento.';
  end if;
  update public.invitations set used_by = auth.uid(), used_at = coalesce(used_at, now()) where code = v_inv.code;
  insert into public.care_links (doctor_id, patient_id) values (v_inv.doctor_id, auth.uid())
    on conflict (doctor_id, patient_id) do update set active = true, ended_at = null;
  perform public.log_action(auth.uid(), null, 'medico_vinculado');
  return v_inv.doctor_id;
end $$;

-- El paciente deja de compartir sus estudios con un médico.
create or replace function public.end_care_link(p_doctor uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.care_links set active = false, ended_at = now()
   where doctor_id = p_doctor and patient_id = auth.uid() and active;
  if not found then raise exception 'No encontramos ese vínculo.'; end if;
  perform public.log_action(auth.uid(), null, 'medico_desvinculado');
end $$;

create or replace function public.mark_study_viewed(p_study uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_patient uuid;
begin
  perform set_config('chely.patient_action', 'on', true);
  update public.studies set first_viewed_at = coalesce(first_viewed_at, now())
   where id = p_study and patient_id = auth.uid() and status = 'publicado'
   returning patient_id into v_patient;
  perform set_config('chely.patient_action', 'off', true);
  if v_patient is not null then perform public.log_action(v_patient, p_study, 'visto_por_paciente'); end if;
end $$;

create or replace function public.give_feedback(p_study uuid, p_value text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_value not in ('si', 'mas_o_menos', 'no') then raise exception 'Respuesta inválida.'; end if;
  perform set_config('chely.patient_action', 'on', true);
  update public.studies set feedback = p_value, feedback_at = now()
   where id = p_study and patient_id = auth.uid() and status = 'publicado';
  if not found then raise exception 'No encontramos ese estudio.'; end if;
  perform set_config('chely.patient_action', 'off', true);
end $$;

-- Registro desde la app (por ejemplo, cuando el médico abre un estudio o descarga un original).
create or replace function public.log_study_access(p_study uuid, p_action text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_patient uuid;
begin
  if p_action not in ('visto_por_medico', 'original_descargado') then raise exception 'Acción inválida.'; end if;
  select s.patient_id into v_patient from public.studies s
   where s.id = p_study
     and (s.patient_id = auth.uid() or (s.doctor_id = auth.uid() and public.is_linked(auth.uid(), s.patient_id)));
  if v_patient is null then raise exception 'No encontramos ese estudio.'; end if;
  perform public.log_action(v_patient, p_study, p_action);
end $$;

-- ---------------------------------------------------------------------------
-- Permisos y RLS
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.invitations enable row level security;
alter table public.care_links enable row level security;
alter table public.studies enable row level security;
alter table public.access_log enable row level security;
alter table public.ai_usage enable row level security;

revoke all on public.profiles, public.invitations, public.care_links, public.studies,
  public.access_log, public.ai_usage from anon, authenticated;
grant select on public.profiles, public.invitations, public.care_links, public.studies, public.access_log to authenticated;
grant update (full_name, birth_date) on public.profiles to authenticated;
grant insert (patient_id, doctor_id, title, study_date, report_text, file_path, file_name, file_type,
              status, explanation, glossary, lab_values, doctor_note) on public.studies to authenticated;
grant update (title, study_date, report_text, file_path, file_name, file_type, status, explanation,
              glossary, lab_values, doctor_note, ai_model, ai_generated_at) on public.studies to authenticated;
grant delete on public.studies, public.invitations to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.invitation_info(text) to anon, authenticated;
grant execute on function public.accept_consent(text), public.create_invitation(text),
  public.redeem_invitation(text), public.end_care_link(uuid), public.mark_study_viewed(uuid),
  public.give_feedback(uuid, text), public.log_study_access(uuid, text),
  public.is_doctor(uuid), public.is_linked(uuid, uuid) to authenticated;

-- Perfiles: el propio, y los de la otra parte de un vínculo activo.
create policy profiles_select on public.profiles for select to authenticated using (
  id = auth.uid()
  or public.is_linked(auth.uid(), id)
  or public.is_linked(id, auth.uid())
);
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy invitations_select on public.invitations for select to authenticated using (doctor_id = auth.uid());
create policy invitations_delete on public.invitations for delete to authenticated using (doctor_id = auth.uid() and used_by is null);

create policy care_links_select on public.care_links for select to authenticated
  using (doctor_id = auth.uid() or patient_id = auth.uid());

-- Estudios: el médico vinculado los maneja; el paciente ve solo los publicados.
create policy studies_doctor_select on public.studies for select to authenticated
  using (doctor_id = auth.uid() and public.is_linked(auth.uid(), patient_id));
create policy studies_patient_select on public.studies for select to authenticated
  using (patient_id = auth.uid() and status = 'publicado');
create policy studies_doctor_insert on public.studies for insert to authenticated
  with check (doctor_id = auth.uid() and public.is_doctor() and public.is_linked(auth.uid(), patient_id));
create policy studies_doctor_update on public.studies for update to authenticated
  using (doctor_id = auth.uid() and public.is_linked(auth.uid(), patient_id))
  with check (doctor_id = auth.uid() and public.is_linked(auth.uid(), patient_id));
create policy studies_doctor_delete on public.studies for delete to authenticated
  using (doctor_id = auth.uid() and status = 'borrador' and public.is_linked(auth.uid(), patient_id));

create policy access_log_select on public.access_log for select to authenticated using (patient_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Archivos originales (Storage). Ruta: <paciente>/<estudio>/<archivo>
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('estudios', 'estudios', false, 26214400,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/plain'])
on conflict (id) do nothing;

create policy estudios_doctor_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'estudios' and public.is_doctor()
  and public.is_linked(auth.uid(), ((storage.foldername(name))[1])::uuid)
);
create policy estudios_doctor_select on storage.objects for select to authenticated using (
  bucket_id = 'estudios' and public.is_linked(auth.uid(), ((storage.foldername(name))[1])::uuid)
);
create policy estudios_doctor_delete on storage.objects for delete to authenticated using (
  bucket_id = 'estudios' and public.is_linked(auth.uid(), ((storage.foldername(name))[1])::uuid)
);
create policy estudios_patient_select on storage.objects for select to authenticated using (
  bucket_id = 'estudios' and (storage.foldername(name))[1] = auth.uid()::text
  and exists (select 1 from public.studies s
              where s.patient_id = auth.uid() and s.status = 'publicado'
                and s.id::text = (storage.foldername(name))[2])
);
