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
