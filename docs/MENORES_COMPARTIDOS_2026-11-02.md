# Menores vinculados: diseño y límites de la primera etapa
**Hecho por ChatGPT · 2026-11-02**

## Objetivo
Un menor tiene una única ficha, sin contraseña ni cuenta ficticia. Padre, madre, abuelos y tutor pueden estar vinculados usando sus propias cuentas verificadas. La pestaña **Menores a cargo** sólo aparece si el usuario tiene un vínculo vigente en `minor_guardians` y el menor todavía no cumplió 18 años.

## Roles
- **Responsable**: tendrá acceso para leer y editar los estudios del menor, además de invitar a otros adultos y retirar vínculos que no correspondan al responsable fundador. Los estudios pediátricos se habilitarán en una etapa posterior.
- **Adulto autorizado (colaborador)**: tendrá acceso a leer y editar los estudios del menor, pero no puede crear invitaciones ni cambiar vínculos. **La gestión de estudios pediátricos sigue pendiente de implementación**, por lo que en esta primera etapa sólo ve la ficha de identidad.
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

## Aclaración de permisos del 2026-11-02
**Hecho por ChatGPT.** El usuario confirmó que un adulto vinculado a la ficha tendrá acceso tanto para **leer** como para **modificar** estudios pediátricos. «Colaborador» no es «sólo lectura»; restringe únicamente la **gestión de otros adultos**. Un tercero que sólo necesite ver **un estudio específico** recibirá una copia independiente y **no se añadirá a los vínculos del menor**.

La app ya permite al paciente adulto compartir una copia de un estudio concreto (PDF desde el diálogo de impresión o envío nativo de texto), sin acceso al perfil. Para menores, el mismo mecanismo debe añadirse únicamente después de implementar la lectura/edición autorizada de estudios pediátricos. Una copia descargada o enviada es irreversible; no equivale a enlace temporal revocable.

## 2026-11-02 — Segunda fase implementada (Hecho por ChatGPT)
- `public.minor_health_details`: documento DNI/CUIL/CUIT, altura, peso, alergias editables y obra social/prepaga. Acceso sólo de adultos vinculados, mientras el menor tenga menos de 18 años.
- `public.minor_studies`: informes médicos **exclusivos del menor**, edición compartida entre los adultos vinculados. No se mezclan con `public.studies` ni se altera `patient_id` de las cuentas adultas.
- Bucket privado `storage.estudios-menores` con RLS: los archivos se guardan bajo `minor_id/study_id/uuid`; la lectura, carga y eliminación requieren vínculo vigente y un estudio correspondiente. Se generan URL de consulta con vida de 120 segundos cuando se solicitan.
- Edge Function `ia-menores`, desplegada con JWT obligatorio, sesión Supabase y RLS, utiliza el motor actual de Claude para transcribir archivos PDF/imágenes y explicar informes escritos; toma la fecha de nacimiento del menor para calcular edad, sin leer el perfil del adulto ni otros menores.
- La nueva pantalla `Menores a cargo` permite completar datos de salud, cargar informes, editar, pedir lectura y explicación, compartir una **copia independiente** y eliminar. Acceso de lectura y modificación para `responsable` y `colaborador`; gestión de adultos sólo para responsables.
- Comprobaciones SQL: visitante anónimo sin permisos, adulto no vinculado sin visibilidad, adulto vinculado puede escribir salud/estudios en una transacción de prueba revertida. Ningún dato real de prueba guardado.
- **Pendiente de comprobar desde navegador:** subida de PDF e imágenes, lectura y explicación vía la IA, flujo con dos adultos con cuentas reales de prueba, y visualización móvil.
- **Advertencia:** el registro como padre/madre/tutor todavía depende de una declaración de la persona. No se valida documentación de representación legal automáticamente. Antes de habilitar Chely ampliamente a familias con datos pediátricos, definir verificación legal y respuesta ante conflictos de custodia con asesoría jurídica.
- **Al cumplir 18 años**, los permisos familiares se cortan y los registros permanecen protegidos hasta crear un mecanismo de traspaso a cuenta propia del titular.
