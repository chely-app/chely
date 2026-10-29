-- Supabase da EXECUTE a "authenticated" por defecto: se lo quitamos y dejamos solo las acciones de la app.
revoke execute on all functions in schema public from authenticated;
grant execute on function public.accept_consent(text), public.create_invitation(text),
  public.redeem_invitation(text), public.end_care_link(uuid), public.mark_study_viewed(uuid),
  public.give_feedback(uuid, text), public.log_study_access(uuid, text), public.invitation_info(text),
  public.is_doctor(uuid), public.is_linked(uuid, uuid) to authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
