# Auditoría inicial de Chely: experiencia en PC, SEO, seguridad y accesibilidad
**Fecha:** 2026-11-01
**Autor:** Hecho por ChatGPT
**Ámbito:** repositorio `chely-app/chely` (rama `main` al iniciar) y diagnóstico de seguridad de Supabase `ypxmqaseqslswotcffdu`. 
**Alcance limitado:** no se obtuvo respuesta verificable de los encabezados HTTP del sitio publicado ni acceso a Google Search Console. La inspección del código y el linter de Supabase no equivalen a una auditoría de penetración.

## Cambios aplicados en esta entrega
- Portada PC/tablet/celular: ampliar el contenedor de 1.100 a 1.280 px como máximo; reducir el tamaño del título, espacios verticales y altura mínima de las tarjetas; mejorar transición a una columna en pantallas medianas. Mantener el selector de siete secciones y el logo oficial.
- Accesibilidad: un `<main>` semántico, enlace «Saltar al contenido» visible al recibir foco y corrección de un `</div>` sobrante en «Privacidad y plan». Se comprobó el balance de etiquetas del HTML estático.
- SEO: agregar `preconnect` para las fuentes usadas, actualizar la descripción de la portada y `lastmod` del sitemap al día real del cambio.
- Coherencia clínica: corregir una descripción de `app/index.html` que afirmaba que la explicación estaba revisada por un médico, a diferencia del aviso visible del piloto.
- Seguridad HTTP en Cloudflare Pages: política CSP mínima para la portada (`object-src`, `base-uri`, `frame-ancestors`), HSTS sin subdominios y CSP más restrictiva para `/app/*` en el archivo raíz `/_headers`. Esta configuración necesita verificación tras el despliegue. No se modificó autenticación ni base de datos.

## SEO: hallazgos y próximos pasos
**Ya existe:**
- Título, metadescripción, `lang=es-AR`, canonical `https://chely.app/`, Open Graph/Twitter, iconos y manifest.
- `robots.txt` que permite rastreo, sitemap con la portada como única página pública y JSON-LD de Organization/WebSite/FAQPage.
- `/app/` tiene `noindex`: apropiado para el entorno con autenticación y datos médicos.

**Verificar/mejorar después del despliegue:**
1. En **Google Search Console**, usar «Inspeccionar URL» para `https://chely.app/`, hacer «Probar URL publicada», solicitar indexación si corresponde y presentar `https://chely.app/sitemap.xml`. No se puede garantizar el posicionamiento o la indexación.
2. En Cloudflare, confirmar que `http://`, `www.chely.app` y cualquier dominio `pages.dev` duplicado no compiten con la URL canónica. Preferir redirección permanente 301/308 desde `www` a `https://chely.app/` si ambas versiones están accesibles.
3. Comprobar con una captura real de Search Console si hay páginas indexadas. Una búsqueda `site:` no es evidencia exhaustiva.
4. Evaluar Google PageSpeed Insights/Core Web Vitals en PC y móvil. El HTML de portada incorpora imágenes embebidas y demostración interactiva; medir antes de optimizar más.
5. El `FAQPage` no promete fragmentos enriquecidos para sitios nuevos: Google restringe ese formato a sitios gubernamentales/sanitarios autoritativos. No forzar marcado promocional para simular una autoridad sanitaria.
6. Para visibilidad orgánica sostenida, priorizar contenido público útil, preciso, revisado por profesionales cuando corresponda y con fuentes/autoría clara. Evitar publicar consejos clínicos no verificados o casos reales identificables.

## Seguridad: hallazgos del código
- El archivo `/_headers` de la raíz tenía algunas defensas (nosniff, referrer, SAMEORIGIN y Permissions-Policy), pero no CSP ni HSTS. Se reforzó con cambios conservadores.
- El archivo `app/_headers` contenía reglas importantes, pero **debe comprobarse** si Cloudflare Pages lo procesa en una carpeta anidada; por eso la regla crítica `/app/*` ahora también está en el `/_headers` raíz.
- La clave Supabase presente en `app/config.js` es del tipo **publicable** (`sb_publishable_`); su presencia en el frontend es esperada. Nunca guardar una `service_role`, credenciales de Anthropic ni claves privadas en JavaScript del navegador.
- La aplicación contiene varias asignaciones de `innerHTML`. Se requiere revisar que todo contenido médico y de usuario sea escapado/saneado antes de integrarlo en HTML y que las rutas RPC se autoricen en el servidor.
- Las reglas de UI no reemplazan RLS, controles de acceso ni validación por usuario del servidor.

## Seguridad: hallazgos de Supabase (consulta de lectura, sin cambios)
- Las tablas revisadas del esquema público, incluida `public.studies`, tienen **RLS activado**. Los permisos de lectura/escritura de estudios definen políticas específicas para pacientes y médicos.
- El bucket `storage.estudios` está **privado**, tiene límite de 25 MiB por archivo y tipos de archivo permitidos. Verificar con pruebas controladas el aislamiento entre usuarios, médicos vinculados y terceros.
- **AVISO:** Supabase informa que la protección de contraseñas filtradas está desactivada. Activarla desde Auth si la opción está disponible en el plan: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection
- **AVISO:** función `public.invitation_info(p_code)` con `SECURITY DEFINER` ejecutable por `anon`. El código consultado devuelve nombre de médico y validez de un código de invitación. Su uso público puede ser intencional, pero revisar exposición por adivinación de códigos y límites de solicitudes antes de revocar permisos: https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable
- **AVISO:** 10 funciones con `SECURITY DEFINER` accesibles por `authenticated`. Varias contienen comprobaciones explícitas de identidad, lo cual puede ser intencional; revisar una por una con pruebas, no revocar `EXECUTE` indiscriminadamente: https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable
- **INFO:** `public.ai_usage` tiene RLS sin políticas; si es una tabla solo de servicio, podría ser una decisión deliberada. Verificarlo en contexto: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy
- Las advertencias de rendimiento mencionan 5 claves foráneas sin índice y políticas RLS con evaluación reiterada de `auth.uid()`. Planificar ajustes separados y medir el efecto antes de modificar políticas de autorización.

## Privacidad y cumplimiento (pendiente de revisión del equipo)
- La portada incluye afirmaciones sobre cifrado, registro de accesos y eliminación de datos; **validar técnicamente** cada una antes de usarlas como promesas publicitarias.
- Antes de escalar a pacientes reales, revisar la política de privacidad, términos, responsable de datos personales, retención/eliminación, consentimientos y circuito de incidentes con asesoría legal local. No publicar documentos legales en borrador sin autorización.
- Definir copias de seguridad **externas** y verificadas. El Toshiba de 1 TB del servidor local tiene SMART FAILED y no debe ser el único respaldo.
- Considerar una evaluación externa de seguridad para uso con datos de salud. Esta auditoría de código no sustituye revisión de infraestructura, autenticación y permisos reales.

## Lista de comprobación tras publicar
- Abrir `chely.app` con Ctrl+F5 en PC (1366×768, 1920×1080) y en celular (375–430 px). Revisar sin desbordes horizontales, título compacto y navegación.
- Probar «Saltar al contenido» con Tab, todas las secciones, vínculos `#`, formulario y modo oscuro/claro.
- Confirmar que `/app/` inicia sesión y carga estudios como antes; probar con cuentas de prueba, nunca con información médica real.
- Verificar respuesta HTTP HTTPS y los encabezados CSP, HSTS, X-Frame-Options, referrer, noindex de app.
- Revisar Search Console, sitemap y resultados de Lighthouse; documentar métricas reales.
