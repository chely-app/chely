-- Piloto sin médico: el paciente puede subir sus propios estudios y pedir la explicación a la IA.
-- Esos estudios quedan marcados (self_uploaded) y solo los ve el propio paciente.

alter table public.studies add column self_uploaded boolean not null default false;
grant insert (self_uploaded) on public.studies to authenticated;

-- Reglas del disparador: el médico como antes; el paciente solo sobre sus estudios propios.
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

  if public.is_doctor() then
    if new.doctor_id is distinct from auth.uid() then
      raise exception 'El estudio debe quedar a tu nombre.';
    end if;
    if not public.is_linked(auth.uid(), new.patient_id) then
      raise exception 'Este paciente no está vinculado con vos.';
    end if;
    if tg_op = 'INSERT' then new.self_uploaded := false; else new.self_uploaded := old.self_uploaded; end if;
  else
    -- Paciente: solo estudios propios, sin médico.
    if new.patient_id is distinct from auth.uid() or new.doctor_id is not null or not new.self_uploaded then
      raise exception 'Solo podés cargar o editar tus propios estudios.';
    end if;
    if tg_op = 'UPDATE' and (not old.self_uploaded or old.patient_id <> auth.uid()) then
      raise exception 'Solo podés editar los estudios que subiste vos.';
    end if;
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
  -- Visto y respuesta solo cambian por sus acciones propias.
  if tg_op = 'UPDATE' then
    new.first_viewed_at = old.first_viewed_at;
    new.feedback = old.feedback;
    new.feedback_at = old.feedback_at;
  else
    new.first_viewed_at = null; new.feedback = null; new.feedback_at = null;
  end if;
  return new;
end $$;

-- Lectura del paciente: lo publicado por su médico y todo lo que subió él.
alter policy studies_patient_select on public.studies
  using (patient_id = (select auth.uid()) and (status = 'publicado' or self_uploaded));
create policy studies_patient_insert on public.studies for insert to authenticated
  with check (patient_id = (select auth.uid()) and doctor_id is null and self_uploaded);
create policy studies_patient_update on public.studies for update to authenticated
  using (patient_id = (select auth.uid()) and self_uploaded)
  with check (patient_id = (select auth.uid()) and doctor_id is null and self_uploaded);
create policy studies_patient_delete on public.studies for delete to authenticated
  using (patient_id = (select auth.uid()) and self_uploaded);

-- Archivos del paciente: en su propia carpeta y solo para estudios que subió él.
alter policy estudios_patient_select on storage.objects using (
  bucket_id = 'estudios' and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (select 1 from public.studies s
              where s.patient_id = (select auth.uid()) and (s.status = 'publicado' or s.self_uploaded)
                and s.id::text = (storage.foldername(name))[2])
);
create policy estudios_patient_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'estudios' and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (select 1 from public.studies s
              where s.patient_id = (select auth.uid()) and s.self_uploaded
                and s.id::text = (storage.foldername(name))[2])
);
create policy estudios_patient_delete on storage.objects for delete to authenticated using (
  bucket_id = 'estudios' and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (select 1 from public.studies s
              where s.patient_id = (select auth.uid()) and s.self_uploaded
                and s.id::text = (storage.foldername(name))[2])
);
