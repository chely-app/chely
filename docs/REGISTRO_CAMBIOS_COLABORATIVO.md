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
