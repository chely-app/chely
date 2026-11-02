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

