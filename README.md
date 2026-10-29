# Chely

Chely explica estudios médicos en palabras simples.

- `sitio/`: la página de presentación, publicada en https://chely.app
- `web/`: la app, publicada en https://app.chely.app
- `supabase/`: la base de datos (migraciones) y las funciones del servidor (`ia`, `borrar-cuenta`)
- `tests/`: pruebas de la base, de la IA y del recorrido en el navegador
- `docs/correos/`: plantillas de los correos de Supabase
- `INSTRUCCIONES.md`: puesta en marcha

Cloudflare Pages publica `sitio/` y `web/` automáticamente con cada cambio en `main`.
