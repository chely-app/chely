# Chely

Chely explica estudios médicos en palabras simples.

- Raíz (`index.html` y demás): la página de presentación, publicada en https://chely.app
- `app/`: la app, publicada en https://chely.app/app/
- `supabase/`: la base de datos (migraciones) y las funciones del servidor (`ia`, `borrar-cuenta`)
- `tests/`: pruebas de la base, de la IA y del recorrido en el navegador
- `docs/correos/`: plantillas de los correos de Supabase
- `INSTRUCCIONES.md`: puesta en marcha

GitHub Pages publica la página y la app con cada cambio en `main`. `_config.yml` deja afuera el resto (base de datos, pruebas, instrucciones).

<!-- Hecho por ChatGPT · 2026-11-04 · Aclarar el proveedor configurado y los encabezados pendientes de verificación. -->
## Publicación y encabezados

La configuración versionada define GitHub Pages como destino para la raíz y `/app/` (ver `_config.yml` y `CNAME`). El archivo `_headers` usa sintaxis de Cloudflare Pages y **no configura encabezados HTTP en GitHub Pages**. No asumir que CSP, HSTS u otras reglas declaradas allí llegan al navegador: verificar el proveedor activo y las respuestas de producción antes de considerar aplicadas esas protecciones.

`INSTRUCCIONES.md` quedó archivado porque describe una estructura y un dominio anteriores. Para operar producción, confirmar en los paneles del proveedor y Supabase los dominios, URLs de redirección y origen permitido vigentes; no reutilizar valores antiguos sin validarlos.
