# Seguridad RPC Supabase — 2026-11-01
**Hecho por ChatGPT**

## Contexto
La auditoría de Supabase de Chely marcó tres categorías:
1. `auth_leaked_password_protection` — protección contra contraseñas filtradas desactivada.
2. `anon_security_definer_function_executable` — `public.invitation_info(text)` expuesta a `anon`.
3. `authenticated_security_definer_function_executable` — diez funciones privilegiadas accesibles por usuarios registrados.

## Cambios de esta entrega
- `app/app.js`: ya no consulta el nombre del médico **antes** de iniciar sesión. Muestra una indicación general. Después de iniciar sesión y aceptar el consentimiento, `redeem_invitation` comprueba el código y vincula al paciente.
- `public.invitation_info(text)`: `REVOKE EXECUTE` a `PUBLIC`, `anon` y `authenticated`. La función se conserva para mantenimiento por `service_role`.
- `public.is_doctor(uuid)`: se cambia a `SECURITY INVOKER`, de forma que la consulta de perfiles respeta RLS. La identidad puede consultarse con RLS de perfiles.
- `public.is_linked(uuid,uuid)`: se cambia a `SECURITY INVOKER`; las políticas actuales de `care_links` permiten leer solo los vínculos en los que participa `auth.uid()`. Las políticas RLS de `profiles`, `studies` y `storage.objects` siguen llamándola con `auth.uid()` como una de las partes.
- Las otras **siete funciones** privilegiadas, necesarias para escribir invitaciones, aceptar consentimiento, desvincular médicos, comentar un estudio, registrar accesos y vincular pacientes, se mantienen como `SECURITY DEFINER` porque no tienen políticas RLS equivalentes para escritura directa. Revocar `EXECUTE` o convertirlas a `SECURITY INVOKER` rompería funcionalidades de Chely. El aviso del linter para ellas será **intencional** hasta que se haga una refactorización de backend con pruebas de roles, permisos y pacientes.
- No se toca ninguna fila de datos médicos, permisos RLS, usuarios ni contraseñas.

## Configuración manual pendiente de Supabase Auth
La protección de contraseñas filtradas se habilita en el panel de Supabase, Auth / configuración de contraseña, si el plan lo permite. Supabase actualmente indica que esa función se ofrece en **Pro o superior**:
https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

Después de cambiar el control, volver a revisar Supabase Security Advisor. Si se usa el plan gratuito y el control no está disponible, ese aviso no se puede eliminar de forma equivalente mediante SQL ni mediante validación solo en el navegador.

## Pruebas recomendadas
- Carga de `/app/#crear` sin cuenta, con un código de invitación en URL: **no debe** intentar leer el nombre del médico anónimamente.
- Alta con un código válido, aceptación de consentimiento y vinculación paciente-médico.
- Un médico genera invitación; el paciente la acepta; se verifica el vínculo.
- Ver perfil, leer estudios propios, y comprobar que un usuario ajeno no pueda leer un paciente con quien no está vinculado.
- Confirmar `is_doctor(auth.uid())` y `is_linked(auth.uid(), id)` en cuentas de prueba, no con pacientes reales.
- Volver a ejecutar `get_advisors(type=security)` y `has_function_privilege`.
- Confirmar en los logs que no se dispararon errores de PostgREST (403/permission denied/recursion) después del despliegue.

## Nota de seguridad
No se deben eliminar las advertencias solo para obtener un panel «verde». La prioridad es que las operaciones de los pacientes estén limitadas y auditadas. Las funciones `SECURITY DEFINER` intencionales requieren controles de identidad dentro de sus cuerpos y pruebas posteriores de acceso cruzado entre usuarios.

## Verificación posterior — 2026-11-01 (Hecho por ChatGPT)

- Migración **aplicada con éxito** en Supabase: `security_rpc_roles_20261102`, versión `20261102010004`.
- Consultas a permisos: `invitation_info` sin `EXECUTE` para `anon` ni `authenticated`; `is_doctor` y `is_linked` sin `SECURITY DEFINER`.
- Security Advisor ejecutado luego de la migración: **ningún aviso 0028 para acceso anónimo**; 0029 reducido de **10 a 7** funciones, que siguen siendo operaciones RPC privilegiadas utilizadas por la aplicación.
- Aviso de **Leaked Password Protection** continúa; no se puede habilitar desde la conexión Supabase SQL. Requiere operación del usuario en el panel Auth y plan compatible.
- Prueba no destructiva con `SET LOCAL ROLE authenticated` y JWT de una cuenta paciente existente: sesión detectada, **1 perfil visible**, **1 estudio visible**, **0 vínculos**, `is_doctor()=false`, `is_linked()` con tercero inexistente `false`.
- Actualmente las 3 cuentas de la tabla `public.profiles` son de tipo paciente; no hay un perfil de médico disponible para ensayo de invitaciones con cuentas de prueba. Esta limitación impide declarar completamente validado el flujo médico-paciente.

**Pendiente:** comprobar despliegue actualizado de `app/app.js` en Cloudflare, probar alta real de médico/paciente con cuentas de prueba y habilitar protección de contraseñas filtradas cuando esté disponible.
