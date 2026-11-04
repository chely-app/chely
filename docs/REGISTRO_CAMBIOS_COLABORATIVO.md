# Registro colaborativo de cambios — Chely

Este archivo documenta los cambios realizados por distintos colaboradores (humanos o asistentes) para facilitar las revisiones y evitar sobrescribir trabajo ajeno.

## Convención
- En cada modificación relevante, agregá una entrada con fecha, responsable, archivos y motivo.
- Identificá los bloques nuevos o modificados con un comentario discreto en el código: `Hecho por ChatGPT`, `Hecho por Claude` o el nombre de la persona que hizo el cambio.
- Los comentarios de autoría son **internos**. No forman parte de la interfaz para pacientes.
- Mantené los commits y pull requests separados por tarea; no afirmes haber realizado cambios de otros colaboradores.
- Antes de editar, revisá el historial y la rama actual; no reescribas el trabajo de otro colaborador sin revisarlo.

## 2026-11-01 — Hecho por ChatGPT
**Objetivo:** simplificar la página pública `/` y actualizar la identidad visual.

**Archivo:** `index.html`
- Se reemplazó el lema anterior por **«Tus estudios, explicados en palabras claras»** en la portada, el título, las etiquetas sociales y el pie.
- Se agregó un selector de siete secciones para evitar el desplazamiento vertical de toda la información. El contenido original permanece en cada sección.
- Se mantuvieron los enlaces de navegación y las rutas `#seccion`; la sección inicial es «Cómo funciona».
- Se adaptó el selector a pantallas pequeñas y se conservaron los contenidos accesibles si JavaScript está desactivado.
- Se sustituyeron las dos imágenes integradas del logotipo de la portada y la demostración por una adaptación optimizada del **logo oficial suministrado por el equipo** (la C blanca y el corazón menta sobre el fondo turquesa).

**No se modificaron:** `app/`, autenticación, base de datos, API, almacenamiento de informes ni funciones médicas.

**Publicación:** PR #5 sobre la rama `main`, una vez aprobado.

## 2026-11-01 — Hecho por ChatGPT (segunda ronda)
**Objetivo:** mejorar el diseño en pantallas de PC y realizar auditoría SEO/seguridad/accesibilidad sin tocar los datos médicos.

**Archivos:** `index.html`, `app/index.html`, `_headers`, `sitemap.xml` y `docs/AUDITORIA_SEO_SEGURIDAD_2026-11-01.md`.
- Contenedor más ancho (máximo 1.280 px), encabezado compacto, márgenes adaptables y menor desplazamiento vertical.
- Región semántica `main`, enlace de salto de contenido y corrección de etiqueta HTML mal cerrada.
- Ajuste de metadescripción sin prometer revisión médica inexistente, fuentes preconectadas y sitemap actualizado.
- Reglas de encabezados HTTP más restrictivas para `/app/*` y controles básicos en la portada.
- Auditoría de Supabase **solo de lectura**; problemas pendientes documentados, sin alterar RLS, RPC ni Auth.
- Etiquetas y commits con la convención `Hecho por ChatGPT`.

## 2026-11-01 — Hecho por ChatGPT (Supabase Auth y RPC)
**Objetivo:** reducir la exposición de funciones privilegiadas sin interrumpir el acceso a estudios.

**Archivos:** `app/app.js`, `supabase/migrations/20261102010000_security_rpc_roles.sql`, `docs/SEGURIDAD_RPC_SUPABASE_2026-11-01.md`.
- El formulario de invitación ya no solicita información sobre médicos antes de iniciar sesión.
- Se retira el acceso de `anon` y `authenticated` a `public.invitation_info(text)` (función no utilizada después del cambio).
- `public.is_doctor(uuid)` y `public.is_linked(uuid,uuid)` pasan a `SECURITY INVOKER`, manteniendo el acceso sujeto a las políticas RLS existentes.
- Las siete funciones con elevación de privilegios necesaria permanecen documentadas y requieren pruebas de roles al actualizarse.
- La protección de contraseñas filtradas requiere activación manual si el plan Supabase lo permite.

## 2026-11-02 — Hecho por Claude
**Objetivo:** panel de control para el equipo de Chely: ver pacientes y médicos y administrar las cuentas.

**Archivos:** `supabase/migrations/20261102020000_panel_de_control.sql`, `app/app.js`, `app/styles.css`, `tests/db/*`, `tests/ui/*`, `INSTRUCCIONES.md`.
- Nuevo rol `admin` (cuenta del equipo) y tabla `admin_log`, sin políticas: solo se usa desde funciones.
- Funciones `admin_overview`, `admin_users`, `admin_set_role` y `admin_recent_log`. Todas comprueban `is_admin()` y no devuelven texto de estudios ni explicaciones.
- En la app, el rol `admin` ve **Panel** (resumen y cuentas, con cambio paciente ↔ médico), **Registro** y **Mi cuenta**, con su propio compromiso de confidencialidad (`equipo-v1`).
- Migración aplicada en Supabase como `panel_de_control` (después de `security_rpc_roles_20261102`). Comprobado en la base real con una prueba que se deshace sola.
- Pruebas: 13 nuevas en la base y 3 pasos nuevos en el recorrido del navegador. Se ajustaron dos pruebas existentes al cambio de ChatGPT que retiró `invitation_info` (ahora se espera que esté bloqueada y se busca el texto nuevo de la invitación).

**No se modificó:** la lógica de pacientes ni la de médicos, las reglas RLS existentes ni las funciones `ia` y `borrar-cuenta`.


## 2026-11-01 — Hecho por ChatGPT (navegación del logo)
**Pedido:** tocar el logo de Chely en cualquier pantalla debe llevar a `https://chely.app/`.

**Archivos:** `index.html`, `app/app.js`.
- El logo y nombre de la barra superior de la portada enlazan al dominio principal en lugar de desplazarse al inicio.
- En la demostración del celular, el logo de Chely también enlaza a la página principal.
- Dentro de la aplicación `/app/`, el logo y nombre vuelven a `https://chely.app/` en vez de cambiar la pantalla interna del usuario.
- Se conservan la navegación de secciones y los demás enlaces existentes.

## 2026-11-02 — Hecho por ChatGPT (datos de paciente y auditoría)
**Pedido:** retirar historial de «Mi cuenta» del paciente y conservarlo sólo para administradores autorizados; confirmar contraseñas; incorporar documento, altura, peso, alergias dinámicas y cobertura.
**Archivos:** `app/app.js`, `app/styles.css`, `supabase/migrations/20261102020000_patient_health_and_admin_access.sql`.
- Los registros existentes de `access_log` no se borran. Se retira el widget del paciente y se revoca el `SELECT` directo; un RPC protegido por `is_admin()` ofrece los últimos 100 movimientos en «Equipo → Registro».
- Tabla privada `patient_health_details`: documento DNI/CUIT, altura, peso, alergias editables y obra social/prepaga. Cada paciente lee y edita únicamente su fila mediante RLS; no se comparte automáticamente con médicos ni administradores.
- «Mi cuenta» y recuperación de contraseña ahora solicitan confirmación de la nueva contraseña.
- Campo de cobertura con sugerencias locales, entrada libre y enlace al registro RNAS de la Superintendencia de Servicios de Salud. **No es una base exhaustiva ni sincronizada** de obras sociales.
- Antes de publicar, migración SQL, comprobación RLS y pruebas de la pantalla. Esta entrega no modifica el contenido de estudios.

## 2026-11-02 — Hecho por ChatGPT (correo y copia individual de un estudio)
**Archivo:** `app/app.js`.
- «Mi cuenta» muestra el correo de registro leído de la sesión de Supabase, en un campo visible y de solo lectura; el nombre sigue siendo editable.
- Cada estudio propio visible para el paciente incluye «Compartir este estudio»: abrir una copia imprimible («Guardar como PDF») y, cuando el navegador lo permite, «Enviar copia» por la interfaz de compartir del sistema.
- El contenido compartido se limita al informe escrito, la explicación y una nota del profesional si existe. No incluye tokens de sesión, enlaces privados, datos de perfil ni acceso a otros estudios.
- El PDF lo guarda el usuario desde el diálogo de impresión del navegador; la opción de envío puede transferir un archivo de texto a una app elegida por la persona.
- **Aviso:** una copia enviada fuera de Chely no se puede revocar y no adjunta automáticamente el archivo original.
- Se mantiene la funcionalidad de abrir/descargar el informe original por separado para el paciente autenticado.

## 2026-11-02 — Hecho por ChatGPT (formularios alineados y alta de menores)
**Archivos:** `app/app.js`, `app/styles.css`, `supabase/migrations/20261102030000_minor_guardians_first_phase.sql`, `docs/MENORES_COMPARTIDOS_2026-11-02.md`.
- Corrige el estiramiento de campos en «Mi cuenta» causado por los textos de ayuda y distribuye DNI/CUIT, altura y peso en cuatro columnas alineadas en PC, con adaptación responsive.
- Incluye «Registrar o vincular a un menor» al principio de «Mi cuenta». Sólo después del vínculo vigente se muestra la pestaña «Menores a cargo».
- Crea los datos de identidad mínima del menor y las relaciones de varios adultos, sin crear cuentas ficticias ni permitir buscar menores ajenos.
- Invitaciones personales de un uso, ligadas a correo verificado; control de permisos y RLS desde Supabase. Roles «responsable» y «colaborador» para acceso futuro a los estudios; sólo responsable gestiona vínculos.
- **Primera fase únicamente**: no se habilitan aún estudios, carga de archivos, IA ni datos pediátricos. Se necesita completar validaciones médicas/legales y de seguridad.
- Verificar la migración y las RPC antes de publicar el frontend; sin cambios en datos médicos preexistentes.

## 2026-11-02 — Hecho por ChatGPT (calendario estándar integrado)
**Archivos:** `app/app.js`, `app/styles.css`.
- Ícono compacto de calendario dentro del campo de fecha, sin botón externo «Calendario».
- Formato de entrada `dd/mm/aaaa`; la base conserva fechas ISO.
- El mismo componente se utiliza en nacimiento del paciente, nacimiento del menor y fechas de carga/edición de estudios.
- Cierre con Escape o clic fuera y atributos accesibles para el botón; diseño adaptado a celulares.

## 2026-11-02 — Hecho por ChatGPT (estudios pediátricos)
**Archivos:** `app/app.js`, `app/styles.css`, `supabase/migrations/20261102040000_minor_health_studies_storage.sql`, `supabase/functions/ia-menores/*`, `docs/MENORES_COMPARTIDOS_2026-11-02.md`.
- Se incorporan datos de salud del menor (DNI/CUIL/CUIT, altura, peso, alergias, cobertura).
- Los adultos vinculados pueden añadir, leer, corregir, explicar con IA y eliminar informes pediátricos.
- Archivo privado independiente en Supabase Storage, con controles RLS por menor y estudio.
- IA separada, con sesión verificada, edad real del menor y restricciones de acceso al estudio.
- La explicación por IA no sustituye revisión médica. La representación legal del adulto se declara, pendiente de revisión de documentación en un despliegue amplio.

## 2026-11-02 — Hecho por Claude (mensaje de correo inválido)
**Archivo:** `app/app.js`, función `errorText`.
- El error de Supabase para un correo mal escrito ("Unable to validate email address: invalid format") se mostraba en inglés. Ahora se muestra en español y sugiere revisar espacios o un punto al final.


## 2026-11-02 — Hecho por ChatGPT (cuatro vías de ingreso de informes)
**Archivos:** `app/app.js` y `app/styles.css`.
- La pantalla «Subir un estudio» ofrece cuatro métodos grandes, con foto primero: cámara o galería, PDF, pegar texto y enlace del portal.
- Sólo se ve el contenido del método elegido. En «Pegar texto» se ofrecen nombre y fecha; se pueden sugerir automáticamente si el texto incluye encabezados reconocibles.
- Con fotos, PDF o archivos importados, Chely crea el estudio provisionalmente como «Estudio por identificar», lee el archivo con la función IA existente y sugiere nombre y fecha al usuario para revisión antes de generar la explicación. La fecha real nunca se sustituye silenciosamente por la fecha de carga: en listas se muestra «Fecha por confirmar» mientras no se verifique.
- Los enlaces HTTPS **solo pueden importar directamente PDF o JPG/PNG/WebP públicos cuando el navegador permite CORS**. Nunca se envían cookies ni contraseñas a terceros. Los enlaces de portales que requieren inicio de sesión se abren para que el usuario descargue el documento y después lo adjunte manualmente.
- Se aplica el mismo selector a estudios personales y al módulo de menores; no cambia autenticación, permisos de estudios, RLS, Storage ni el motor de IA.
- Se conserva el borrador en memoria de la pestaña (sin guardar datos médicos en localStorage). El archivo original, si se sube, sigue protegido por los mecanismos existentes.
- Comprobación de sintaxis JS y casos de inferencia de metadatos realizados. Pendiente: prueba de interfaz, permisos de cámara, enlace CORS y carga real en PC y móvil.

## 2026-11-02 — Hecho por ChatGPT (coberturas múltiples y contraseña alineada)
**Archivos:** `app/app.js`, `app/styles.css`, `supabase/migrations/20261102050000_multiple_health_coverages.sql`.
- «Cambiar la contraseña»: los dos campos se presentan a la misma altura y con dimensiones iguales. La ayuda «Al menos 8 caracteres» se ubica debajo del primer campo para no desplazarlo.
- «Obras sociales o prepagas» admite agregar y quitar hasta ocho coberturas independientes, sin sobrescribir las anteriores. La información se guarda por paciente y por menor bajo las políticas RLS existentes.
- Se agregan `PAMI Veteranos de Guerra` y `INSSSEP` a la lista local de sugerencias. También es posible escribir coberturas no incluidas. No se afirma verificar la condición real de afiliado.
- Se incorporó la columna `health_coverages text[]` a `patient_health_details` y `minor_health_details`; los valores previos se migraron automáticamente al arreglo sin perderse.
- Se mantiene la columna anterior `health_coverage` con la primera cobertura para compatibilidad, y la interfaz nueva escribe ambos campos.
- Verificación tras aplicar la migración: dos columnas y dos límites activos, cero valores anteriores perdidos, y ausencia de permiso de lectura pública en las dos tablas.

## 2026-11-02 — Hecho por ChatGPT (cuenta adaptable, vincular menor al final, grupo sanguíneo)
**Archivos:** `app/app.js`, `app/styles.css`, `supabase/migrations/20261102060000_blood_type_private_profiles.sql`.
- Reemplazada grilla rígida por columnas automáticas que se adaptan al ancho del contenedor y al tamaño de fuente (incluidos A+/A−), con rótulos e inputs de altura coherente, sin desbordamientos en celular.
- Eliminado el desplegable de menores de la parte superior de «Mi cuenta». Se agregó tarjeta «Menores a cargo» con botón visible «Vincular o registrar un menor», inmediatamente encima de «Borrar mi cuenta». El botón abre/cierra los formularios de registro y aceptación de invitación sin cambiar RPC ni permisos.
- Agregado campo opcional «Grupo y factor sanguíneo (ABO/Rh)» en datos de salud de pacientes y menores: A+/A−, B+/B−, AB+/AB−, O+/O− o sin especificar.
- Migración no destructiva: `blood_type` con validación CHECK en ambas tablas privadas. Sin establecer por defecto un grupo desconocido. No se modifican datos médicos existentes ni políticas RLS.
- Advertencia junto al campo: grupo sanguíneo autodeclarado, no verificado por Chely; no sustituye prueba clínica ni debe utilizarse para decisiones transfusionales.
- Verificación Supabase: 2 restricciones de valor, RLS habilitada en ambos perfiles y sin permisos de lectura anónima.
- Pendiente comprobación visual en navegador con tamaños de letra 17/19/22/25 px, celular y PC.

## 2026-11-02 — Hecho por ChatGPT (nombre/s y apellido/s; etiquetas próximas a campos)
**Archivos:** `app/app.js`, `app/styles.css`, `supabase/migrations/20261102070000_profiles_given_family_names.sql`, `supabase/migrations/20261102071000_profiles_name_field_grants.sql`.
- Reemplazado «Nombre y apellido» por dos campos independientes «Nombre/s» y «Apellido/s» en «Mi cuenta» tanto de pacientes como de médicos.
- Columnas opcionales `profiles.given_names` y `profiles.family_names`, con validación de longitud. Se conserva `profiles.full_name` actualizado al guardar para mantener compatibles todas las pantallas de Chely y sus integraciones.
- Los nombres existentes no se dividen masivamente en la base: se propone una separación orientativa **solo en la pantalla**. El usuario debe revisarla antes de pulsar Guardar; esto evita sobrescribir apellidos compuestos sin consentimiento. Pruebas: «Araceli Nidia Di Pietro» pasa a «Araceli Nidia» + «Di Pietro».
- Los cuatro campos de «Mi cuenta» (nombre/s, apellido/s, correo y nacimiento) se distribuyen en columnas automáticas. Se eliminaron las alturas fijas excesivas entre los rótulos y sus inputs. En datos de salud también se acercaron las etiquetas a cada campo.
- Los permisos `UPDATE` nuevos son **por columna** exclusivamente sobre given_names y family_names; se conserva la RLS que permite editar solo el perfil propio. Se verificó que no se permiten cambios de rol ni UPDATE anónimo.
- Las dos migraciones están aplicadas a Supabase. JS validado sintácticamente; pendiente de comprobación visual en navegador y de guardado con sesión real.

## 2026-11-02 — Hecho por ChatGPT (continuidad de navegación y borradores)
**Archivo:** `app/app.js`.
- La pestaña actual se conserva al recargar con F5 mediante `history.state`, incluidas las referencias de estudio, paciente o menor, y se restaura únicamente después de verificar que el usuario y su rol coinciden con la sesión actual. Se elimina al cerrar sesión.
- La app no vuelve automáticamente a «Mis estudios» por un F5, excepto cuando la ruta deja de estar disponible por permisos o porque se eliminó un estudio.
- Los formularios de carga y edición de pacientes, menores y médicos conservan **en memoria de la pestaña** los textos, fechas, títulos, fotos/PDF seleccionados e importaciones de enlaces al cambiar de sección y regresar.
- Las operaciones de subida ya iniciadas continúan mientras se navega **dentro de la SPA y sin descargar o recargar el documento HTML**. El botón de subir queda bloqueado mientras esa carga está en curso, y el resultado no cambia automáticamente la pantalla si el usuario ya navegó a otra.
- Las lecturas y explicaciones por IA comparten una misma solicitud pendiente por estudio/rol para evitar llamadas duplicadas al reentrar en un formulario.
- Un archivo seleccionado por el usuario no puede reponerse automáticamente tras un refresco real o cierre de pestaña, por limitaciones de seguridad del navegador: en esos casos debe seleccionarse nuevamente. Los **borradores sin guardar tampoco sobreviven a F5**: no se escriben informes médicos sin cifrar en localStorage/sessionStorage.
- Para estudios que ya tienen una fila guardada en Supabase, F5 recupera la pantalla y los datos confirmados del servidor. Refrescar/cerrar la pestaña DURANTE una subida de red puede interrumpirla: la continuidad en segundo plano se garantiza para navegación interna, no al cerrar el documento.
- Mantener todos los cambios de autoría identificados como «Hecho por ChatGPT».
- Pendiente prueba manual de navegación, sesión, F5, formularios y subidas reales en Chrome/Android/iOS.

## 2026-11-04 — Hecho por ChatGPT (auditoría de accesibilidad y publicación)
**Archivos:** `app/app.js`, `app/site.webmanifest`, `README.md`, `INSTRUCCIONES.md`.
- Los diálogos de confirmación ahora tienen título y descripción accesibles, mantienen el foco dentro del diálogo, se cancelan con Escape, devuelven el foco al control que los abrió y requieren usar botones explícitos para cerrar.
- La app instalada inicia en `/app/` y limita su alcance a esa ruta.
- La guía antigua de despliegue quedó marcada como histórica; README aclara que `_headers` usa formato Cloudflare y no aplica encabezados HTTP en GitHub Pages.
- No se tocaron cuentas, datos médicos, Supabase ni la configuración del hosting. Pendiente revisar los encabezados HTTP y la experiencia visual en producción.
