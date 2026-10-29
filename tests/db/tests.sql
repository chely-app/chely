-- Pruebas de seguridad. Cada bloque falla con un mensaje claro si algo no es como debe.
\set ON_ERROR_STOP on
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, false);
      execute 'set role authenticated'; end $$;
create or replace function pg_temp.as_admin() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claims', '', false); end $$;
create or replace function pg_temp.expect_error(q text, label text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then raise notice 'OK (rechazado): % -> %', label, sqlerrm; return; end;
  raise exception 'FALLA: se esperaba un error en: %', label;
end $$;
create or replace function pg_temp.check(cond boolean, label text) returns void language plpgsql as $$
begin if not cond then raise exception 'FALLA: %', label; end if; raise notice 'OK: %', label; end $$;

-- Usuarios: médica, paciente, otro paciente, otro médico.
insert into auth.users (id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-00000000000d', 'medica@ej.com', '{"full_name":"Dra. Prueba"}'),
 ('00000000-0000-0000-0000-00000000000a', 'paciente@ej.com', '{"full_name":"Marta Prueba"}'),
 ('00000000-0000-0000-0000-00000000000b', 'otro@ej.com', '{"full_name":"Otro Paciente"}'),
 ('00000000-0000-0000-0000-00000000000e', 'medico2@ej.com', '{"full_name":"Dr. Ajeno"}');
select pg_temp.check((select count(*) from public.profiles) = 4, 'se crean los perfiles automáticamente');
update public.profiles set role = 'doctor' where email in ('medica@ej.com', 'medico2@ej.com');

-- Un paciente no puede volverse médico.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_error($$update public.profiles set role = 'doctor' where id = auth.uid()$$, 'paciente cambia su rol');
update public.profiles set full_name = 'Marta P.' where id = auth.uid();
select pg_temp.check((select full_name from public.profiles where id = auth.uid()) = 'Marta P.', 'paciente edita su nombre');
select pg_temp.check((select count(*) from public.profiles) = 1, 'paciente sin vínculos solo ve su perfil');
select pg_temp.expect_error($$select public.create_invitation('x')$$, 'paciente crea invitación');
select pg_temp.expect_error($$select public.log_action(auth.uid(), null, 'falso')$$, 'paciente escribe registros falsos');

-- La médica invita.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
create temp table inv as select public.create_invitation('Marta') as code;
grant select on inv to authenticated, anon;
select pg_temp.check((select length(code) = 10 from inv), 'código de invitación de 10 letras');
select pg_temp.expect_error($$insert into public.studies (patient_id, doctor_id, title, study_date) values ('00000000-0000-0000-0000-00000000000a', auth.uid(), 'x', '2026-10-01')$$, 'médica carga estudio antes del vínculo');

-- Info pública de la invitación (sin sesión).
select pg_temp.as_admin(); set role anon;
select pg_temp.check((select doctor_name from public.invitation_info((select code from inv))) = 'Dra. Prueba', 'invitación muestra el nombre de la médica');
select pg_temp.expect_error($$select * from public.profiles$$, 'anónimo lee perfiles');
reset role;

-- El paciente acepta y usa la invitación.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_error($$select public.redeem_invitation((select code from inv))$$, 'canjear sin consentimiento');
select public.accept_consent('paciente-v1');
select public.redeem_invitation((select code from inv));
select pg_temp.check((select count(*) from public.care_links where active) = 1, 'vínculo creado');

-- Otro paciente no puede reutilizarla.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.accept_consent('paciente-v1');
select pg_temp.expect_error($$select public.redeem_invitation((select code from inv))$$, 'reusar invitación ajena');

-- La médica carga un borrador.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check((select count(*) from public.profiles) = 2, 'médica ve su perfil y el de su paciente');
insert into public.studies (patient_id, doctor_id, title, study_date, report_text)
  values ('00000000-0000-0000-0000-00000000000a', auth.uid(), 'Análisis de sangre', '2026-10-01', 'Glucemia 112 mg/dL');
select pg_temp.expect_error($$insert into public.studies (patient_id, doctor_id, title, study_date) values ('00000000-0000-0000-0000-00000000000b', auth.uid(), 'x', '2026-10-01')$$, 'médica carga a paciente no vinculado');
select pg_temp.expect_error($$update public.studies set status = 'publicado'$$, 'publicar sin explicación');
select pg_temp.expect_error($$update public.studies set feedback = 'si'$$, 'médica escribe la respuesta del paciente');

-- El paciente no ve borradores.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((select count(*) from public.studies) = 0, 'paciente no ve borradores');

-- La médica publica.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
update public.studies set explanation = 'La glucemia dio 112.', status = 'publicado';
select pg_temp.check((select published_at is not null from public.studies), 'publicar fija la fecha');

-- El paciente lo ve, lo marca visto y responde.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((select count(*) from public.studies) = 1, 'paciente ve el estudio publicado');
update public.studies set explanation = 'cambiado';
select pg_temp.check((select explanation from public.studies) = 'La glucemia dio 112.', 'paciente no puede editar la explicación');
select public.mark_study_viewed((select id from public.studies));
select public.give_feedback((select id from public.studies), 'si');
select pg_temp.check((select feedback = 'si' and first_viewed_at is not null from public.studies), 'respuesta y visto guardados');
select pg_temp.check((select count(*) from public.access_log) >= 4, 'paciente ve su registro de accesos');

-- Archivos: rutas por paciente.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
insert into storage.objects (bucket_id, name) select 'estudios', '00000000-0000-0000-0000-00000000000a/' || id || '/informe.pdf' from public.studies;
select pg_temp.expect_error($$insert into storage.objects (bucket_id, name) values ('estudios', '00000000-0000-0000-0000-00000000000b/x/informe.pdf')$$, 'médica sube archivo a paciente no vinculado');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((select count(*) from storage.objects) = 1, 'paciente ve el original de su estudio publicado');

-- Otro médico y otro paciente no ven nada.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
select pg_temp.check((select count(*) from public.studies) = 0 and (select count(*) from storage.objects) = 0, 'otro médico no ve estudios ni archivos');
select pg_temp.expect_error($$select public.log_study_access((select id from public.studies limit 1), 'visto_por_medico')$$, 'otro médico registra acceso');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) from public.studies) = 0 and (select count(*) from storage.objects) = 0, 'otro paciente no ve estudios ni archivos');
select pg_temp.check((select count(*) from public.profiles) = 1, 'otro paciente no ve perfiles ajenos');

-- El paciente deja de compartir: la médica pierde el acceso.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.end_care_link('00000000-0000-0000-0000-00000000000d');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check((select count(*) from public.studies) = 0, 'médica desvinculada ya no ve los estudios');
select pg_temp.check((select count(*) from public.profiles) = 1, 'médica desvinculada ya no ve el perfil');
update public.studies set title = 'cambiado por médica desvinculada';
select pg_temp.as_admin();
select pg_temp.check((select title from public.studies) = 'Análisis de sangre', 'médica desvinculada no puede editar');

-- Piloto sin médico: el paciente sube sus propios estudios.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
insert into public.studies (patient_id, doctor_id, title, study_date, report_text, self_uploaded)
  values (auth.uid(), null, 'Mi análisis', '2026-10-20', 'Glucemia 99 mg/dL', true);
select pg_temp.check((select count(*) from public.studies where self_uploaded) = 1, 'paciente ve su estudio propio aunque sea borrador');
update public.studies set explanation = 'Explicación de IA', status = 'publicado' where self_uploaded;
select pg_temp.check((select status = 'publicado' and published_at is not null from public.studies where self_uploaded), 'paciente publica la explicación de su estudio');
select pg_temp.expect_error($$insert into public.studies (patient_id, doctor_id, title, study_date, self_uploaded) values ('00000000-0000-0000-0000-00000000000a', null, 'x', '2026-10-01', true)$$, 'paciente carga estudio a otra persona');
select pg_temp.expect_error($$insert into public.studies (patient_id, doctor_id, title, study_date, self_uploaded) values (auth.uid(), null, 'x', '2026-10-01', false)$$, 'paciente carga estudio haciéndose pasar por médico');
select pg_temp.expect_error($$insert into public.studies (patient_id, doctor_id, title, study_date, self_uploaded) values (auth.uid(), '00000000-0000-0000-0000-00000000000d', 'x', '2026-10-01', true)$$, 'paciente pone un médico en su estudio');
insert into storage.objects (bucket_id, name) select 'estudios', auth.uid() || '/' || id || '/mio.pdf' from public.studies where self_uploaded;
select pg_temp.check((select count(*) from storage.objects) = 1, 'paciente sube y ve el archivo de su estudio');
select pg_temp.expect_error($$insert into storage.objects (bucket_id, name) values ('estudios', '00000000-0000-0000-0000-00000000000a/x/ajeno.pdf')$$, 'paciente sube archivo a la carpeta de otro');
select public.give_feedback((select id from public.studies where self_uploaded), 'mas_o_menos');
select pg_temp.check((select feedback from public.studies where self_uploaded) = 'mas_o_menos', 'paciente responde sobre su estudio propio');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
select pg_temp.check((select count(*) from public.studies where self_uploaded) = 0, 'un médico no ve estudios propios de pacientes');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
delete from public.studies where self_uploaded;
select pg_temp.check((select count(*) from public.studies) = 0, 'paciente borra su estudio propio');
select pg_temp.as_admin();

-- Borrar la cuenta del paciente borra sus estudios.
select pg_temp.as_admin();
delete from auth.users where id = '00000000-0000-0000-0000-00000000000a';
select pg_temp.check((select count(*) from public.studies) = 0, 'al borrar la cuenta se borran sus estudios');
\echo 'TODAS LAS PRUEBAS PASARON'
