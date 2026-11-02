# Chely · Réplica de explicaciones en Debian

**Estado:** módulo preparado en GitHub, **no instalado aún en el servidor**.

La explicación vigente ya está en `public.patient_latest_explanations` bajo RLS. Debian debe guardar una copia atómica del JSON por paciente en el volumen LUKS `/srv/chely-datos/ultima-explicacion/<patient-id>.json`, permisos 0600.

## Integración segura
1. Verificar en Debian el código realmente instalado en `/opt/chely-api` y conservar copia de seguridad de la API.
2. Copiar `summary_sync_router.py` al paquete FastAPI y registrar su `router` en la aplicación.
3. Comprobar que el disco `/srv/chely-datos` está montado desde `/dev/mapper/chely_datos`, ext4.
4. Exponer `POST /sync/patient-latest` **exclusivamente** bajo Cloudflare Access. No exponerlo sin la política de acceso.
5. Integrar la llamada desde la Edge Function `ia` de Supabase con el mismo JWT de paciente y el token de servicio de Cloudflare Access ya utilizado para archivos.
6. Confirmar la réplica comparando `source_signature` devuelta por Debian con el valor de Supabase antes de poner `debian_sync_status='synced'`. Si falla, conservar `pending` y reintentar sin consumir IA.
7. Probar permisos de otro paciente, token vencido, caída del disco, interrupción de red, sobrescritura atómica y borrado de la copia al eliminar al paciente o el estudio.
8. Definir reconciliación periódica de pendientes y limpieza de archivos huérfanos; no comenzar con datos reales hasta completar estas pruebas.

Este módulo NO necesita service_role en Debian: obtiene la explicación desde la API de Supabase usando el JWT del propio paciente y la RLS correspondiente. Nunca se debe guardar un JWT en disco ni registrar el contenido médico en logs.

**Importante:** al borrar un estudio o la cuenta, deben borrarse también los JSON asociados en Debian; esta operación aún no está implementada. No se debe habilitar la ruta hasta tener ese flujo de borrado y la reconciliación verificados.
