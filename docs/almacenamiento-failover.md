# Respaldo temporal cuando Debian está desconectado (propuesta de implementación)

Estado: **preparación, NO desplegado**. El servidor Debian y el servicio actual siguen siendo la fuente principal.

## Situación verificada
- La interfaz actual de `app/app.js` invoca la Edge Function `archivo` para subir/bajar/borrar.
- **El código de esa Edge Function no está versionado en este repositorio**. Debemos obtener exactamente la versión desplegada antes de reemplazarla.
- `supabase/functions/ia/index.ts` está desactualizada: descarga desde Supabase y todavía no entiende el almacenamiento Debian; NO desplegar esa versión sobre producción.
- Existen campos `storage_backend`, `storage_file_id` en producción según la web. Su migración no aparece aquí; comparar esquema real antes de aplicar otra migración.
- El bucket `estudios` debe permanecer privado y bajo RLS.

## Requisitos de seguridad y consistencia
1. `archivo` prueba el backend Debian con un timeout corto. **Solo** si hay indisponibilidad transitoria (timeout, conectividad o 503/502/504 del origen) hace fallback a Supabase. Nunca hacer fallback ante 401/403, 404 del estudio, 409 por duplicidad, 413 o 415.
2. Verificar identidad/JWT, titularidad y tipo/tamaño del archivo. Usar ruta de objeto por usuario/estudio/archivo, sin sobrescribir objetos existentes.
3. Registrar archivo y `storage_backend='supabase'` en `studies` con actualización condicionada (sin archivo previo); registrar trabajo en `storage_sync_jobs`. Si el segundo registro falla, reconciliar por barrido periódico, no eliminar el archivo confirmado.
4. La IA debe descargar según `storage_backend` tanto desde Debian como desde el bucket privado, usando únicamente token autorizado.
5. Servicio de sincronización con privilegios **de servidor** (nunca `service_role` en navegador), lotes limitados, reintentos y bloqueos con expiración. Puede ejecutarse periódicamente en Debian después del arranque.
6. Al recuperar servicio: descargar desde Supabase, comprobar tamaño y SHA-256, copiar al disco cifrado mediante escritura atómica, verificar lectura del destino, realizar cambio condicionado de puntero en `studies` y solo entonces eliminar el objeto temporal.
7. Eliminar temporales mediante un proceso independiente e idempotente: si falla el borrado, dejar la referencia del trabajo hasta limpieza posterior. No borrar datos originales antes de verificar el nuevo destino.
8. Manejar la eliminación del estudio mientras está pendiente de sincronización sin revivir registros ni filtrar datos privados.
9. No desplegar código solo por estar en GitHub: Cloudflare y Supabase necesitan su propio despliegue controlado.

## Pruebas obligatorias antes de producción
- Debian conectado: subir, leer con IA, descargar, borrar.
- Debian desconectado: subir a Supabase, transcribir, explicar, descargar, borrar.
- Recuperación: sincronizar, comprobar hash, actualizar backend, borrar temporal.
- Corte durante transferencia; dos procesos sincronizando simultáneamente; subida repetida; permisos cruzados entre usuarios.
- Archivo incorrecto o >20 MB, JWT vencido, Cloudflare Access caído y RLS sin permisos.

## Pendiente para empezar con código ejecutable
1. Recuperar y versionar la Edge Function `archivo` **actual** (fuente desplegada).
2. Recuperar la Edge Function `ia` **actual** (para no sobrescribir su soporte Debian).
3. Comparar columnas y permisos del esquema desplegado con migraciones del repositorio.
4. Implementar backend y sincronizador, probar en entorno de pruebas y recién después desplegar.
