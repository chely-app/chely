# Guía histórica de puesta en marcha (archivada)

<!-- Hecho por ChatGPT · 2026-11-04 · Marcar como obsoleta la guía de despliegue heredada. -->

> **No uses esta guía para publicar ni configurar producción.** Sus pasos describen la antigua carpeta `web/`, el dominio `app.chely.app` y una carga manual en Cloudflare; el repositorio vigente publica la portada desde la raíz y la app desde `app/` en `https://chely.app/app/`. También pueden haber cambiado los valores y servicios de Supabase.

La guía se conserva solo como referencia histórica. La configuración versionada actualmente apunta a GitHub Pages (ver `README.md`, `_config.yml` y `CNAME`), pero antes de operar producción hay que confirmar el proveedor conectado, el dominio activo y las URLs de redirección/orígenes permitidos en los paneles correspondientes. El archivo `_headers` del repositorio usa formato de Cloudflare Pages y no aplica encabezados por sí mismo en GitHub Pages.

No copies credenciales, claves, dominios ni instrucciones de esta guía a una configuración activa sin verificarlos.
