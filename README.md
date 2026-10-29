# Chely

Chely explica estudios médicos en palabras simples.

- Raíz (`index.html` y demás): la página de presentación, publicada en https://chely.app
- `app/`: la app, publicada en https://chely.app/app/
- `supabase/`: la base de datos (migraciones) y las funciones del servidor (`ia`, `borrar-cuenta`)
- `tests/`: pruebas de la base, de la IA y del recorrido en el navegador
- `docs/correos/`: plantillas de los correos de Supabase
- `INSTRUCCIONES.md`: puesta en marcha

GitHub Pages publica la página y la app con cada cambio en `main`. `_config.yml` deja afuera el resto (base de datos, pruebas, instrucciones).
