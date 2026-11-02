# Menores vinculados: diseño y límites de la primera etapa
**Hecho por ChatGPT · 2026-11-02**

## Objetivo
Un menor tiene una única ficha, sin contraseña ni cuenta ficticia. Padre, madre, abuelos y tutor pueden estar vinculados usando sus propias cuentas verificadas. La pestaña **Menores a cargo** sólo aparece si el usuario tiene un vínculo vigente en `minor_guardians` y el menor todavía no cumplió 18 años.

## Roles
- **Responsable**: puede consultar la ficha, invitar a otros adultos y retirar los accesos que no correspondan al responsable fundador.
- **Consulta**: puede consultar la ficha; no puede crear invitaciones ni cambiar vínculos.
- La madre/padre/tutor que crea la ficha es el responsable inicial. El parentesco inicial es una **declaración del adulto**, no una verificación de documentación por Chely.
- El código de invitación es aleatorio, se guarda en SHA-256, es de un solo uso, vence a los siete días y exige iniciar sesión con el **correo verificado exacto** al que fue dirigido. Los adultos pueden ser madre, padre, abuelo/a, tutor/a u otro responsable.
- No se permite buscar menores por nombre, DNI o fecha de nacimiento. Sólo los vínculos autorizados aparecen en las cuentas.
- Si dos adultos crean independientemente dos fichas del mismo menor, no se fusionan automáticamente, para evitar revelar la existencia de una ficha ajena.

## Base de datos
Tablas `minor_profiles` (identidad mínima), `minor_guardians` (vínculos) y `minor_invitations` (códigos privados). RLS: la ficha sólo puede leerse por un adulto vinculado; el vínculo propio se puede consultar; invitaciones sin acceso directo por PostgREST. Las escrituras van exclusivamente por RPC con comprobación de identidad y permisos.

## Límites que no se deben confundir con funciones completadas
**Esta primera etapa no habilita estudios del menor.** Los informes, archivos originales y peticiones IA están construidos actualmente alrededor de `public.studies.patient_id` (cuenta adulta), su RLS, Storage y las Edge Functions `archivo` e `ia`. Es inseguro simplemente dar a dos adultos acceso a la cuenta de un tercero. No subir estudios del menor como si fueran del perfil personal del padre o la madre.

**Siguiente etapa antes de habilitar datos médicos de menores:**
1. Diseñar tabla `minor_studies` o ampliar la existente con dueño `minor_id`, separando explícitamente estudios del adulto y del menor.
2. Añadir políticas RLS y validación servidor en `archivo`, `ia`, Storage y borrado; las cuentas en modo «Consulta» sólo leerán; las «Responsables» podrán administrar.
3. Diseñar registro de auditoría por menor y controlar cómo se revocan permisos y se exportan informes cuando cumple 18 años, con consentimiento de la persona.
4. Revisar identidad de responsables, representación legal del menor, tratamiento de datos sensibles, consentimiento y casos de conflictos familiares con asesoría jurídica local. Para operar con pacientes reales debe existir un proceso verificable de autorización legal, no sólo una casilla de autoafirmación.
5. Realizar pruebas con cuentas de adulto distintas, incluyendo correo equivocado, enlace usado, enlace vencido, menor no vinculado, permiso sólo consulta y retiro de acceso.

## Convención de colaboración
Todas las modificaciones llevan comentarios y commits «Hecho por ChatGPT». Cuando Claude edite la funcionalidad deberá agregar la descripción de sus propios cambios al registro compartido.

## Publicación
No publicar la interfaz sin aplicar antes la migración SQL y comprobar su seguridad; el despliegue de frontend depende de que las RPC `minor_list`, `minor_create`, `minor_invite`, `minor_accept`, `minor_members` y `minor_remove_adult` existan en Supabase.
