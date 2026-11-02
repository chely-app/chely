"""Hecho por ChatGPT · 2026-11-02.
Copia cifrada en Debian de la última explicación que YA está validada en Supabase.

Montar este router en la aplicación FastAPI existente con:
    from summary_sync_router import router as summary_sync_router
    app.include_router(summary_sync_router)

Sólo exponer detrás de Cloudflare Access, como el endpoint /storage existente.
La autorización JWT se comprueba en Supabase y se vuelve a validar aquí.
NO requiere la clave service_role en Debian ni acepta texto médico del llamante.
"""
import json
import os
import subprocess
import tempfile
import uuid
from pathlib import Path

import httpx
import jwt
from fastapi import APIRouter, Header, HTTPException
from jwt import PyJWKClient

router = APIRouter(prefix="/sync", tags=["sync"])

BASE = Path("/srv/chely-datos")
DEST = BASE / "ultima-explicacion"
SUPABASE_URL = "https://ypxmqaseqslswotcffdu.supabase.co"
JWKS = PyJWKClient(SUPABASE_URL + "/auth/v1/.well-known/jwks.json", cache_keys=True)
CONF_PATH = Path("/opt/chely-api/supabase.env")


def publishable_key() -> str:
    # El mismo fichero de configuración usado por la API de almacenamiento.
    settings = {}
    for line in CONF_PATH.read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            settings[k.strip()] = v.strip().strip("'\"")
    key = settings.get("SUPABASE_PUBLISHABLE_KEY", "")
    if not key:
        raise HTTPException(503, "Configuración de Supabase incompleta")
    return key


def require_encrypted_mount() -> None:
    try:
        result = subprocess.run(
            ["findmnt", "-rn", "-o", "SOURCE,FSTYPE", "--mountpoint", str(BASE)],
            text=True, capture_output=True, timeout=5, check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise HTTPException(503, "Disco no disponible")
    if result.returncode or result.stdout.strip().split() != ["/dev/mapper/chely_datos", "ext4"]:
        raise HTTPException(503, "El disco cifrado no está montado")


def verified_user(authorization: str | None) -> tuple[str, str]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Sesión requerida")
    token = authorization[7:]
    try:
        key = JWKS.get_signing_key_from_jwt(token).key
        claims = jwt.decode(
            token, key, algorithms=["ES256"],
            issuer=SUPABASE_URL + "/auth/v1", audience="authenticated",
            options={"require": ["exp", "sub", "iss", "aud"]},
        )
        user_id = str(uuid.UUID(claims["sub"]))
    except (jwt.PyJWTError, ValueError, jwt.exceptions.PyJWKClientError):
        raise HTTPException(401, "Sesión inválida")
    return token, user_id


@router.post("/patient-latest")
async def save_patient_latest(authorization: str | None = Header(None)):
    token, patient_id = verified_user(authorization)
    require_encrypted_mount()

    # No se confía en un JSON provisto por el navegador: se descarga la fila
    # ya autenticada desde Supabase bajo las políticas RLS del paciente.
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(
                SUPABASE_URL + "/rest/v1/patient_latest_explanations",
                params={
                    "patient_id": "eq." + patient_id,
                    "select": "patient_id,source_study_id,explanation,glossary,lab_values,model,generated_at,source_signature,previous_studies_used",
                },
                headers={"Authorization": "Bearer " + token, "apikey": publishable_key()},
            )
    except httpx.RequestError:
        raise HTTPException(503, "Supabase no respondió")
    if response.status_code != 200:
        raise HTTPException(503, "No se pudo verificar la explicación")
    try:
        rows = response.json()
    except ValueError:
        raise HTTPException(503, "Respuesta inválida")
    if not isinstance(rows, list) or len(rows) != 1:
        raise HTTPException(404, "Explicación no disponible")

    row = rows[0]
    if row.get("patient_id") != patient_id:
        raise HTTPException(403, "Acceso no autorizado")
    signature = row.get("source_signature")
    try:
        uuid.UUID(row["source_study_id"])
    except (TypeError, ValueError):
        raise HTTPException(409, "Estudio de origen inválido")
    if not isinstance(signature, str) or len(signature) != 64:
        raise HTTPException(409, "Firma de contexto inválida")
    if not isinstance(row.get("explanation"), str) or not (0 < len(row["explanation"]) <= 60000):
        raise HTTPException(409, "Explicación inválida")

    content = json.dumps(row, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(content) > 256 * 1024:
        raise HTTPException(413, "Explicación demasiado grande")
    require_encrypted_mount()
    DEST.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(DEST, 0o700)
    final = DEST / (patient_id + ".json")
    # El nombre sólo proviene de UUID verificado, nunca de una ruta del usuario.
    fd, tmp = tempfile.mkstemp(prefix=".incoming-", dir=DEST)
    try:
        with os.fdopen(fd, "wb") as output:
            os.fchmod(output.fileno(), 0o600)
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        require_encrypted_mount()
        os.replace(tmp, final)
        # Persistir también los metadatos del directorio.
        dirfd = os.open(DEST, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(dirfd)
        finally:
            os.close(dirfd)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)
    return {"status": "stored", "source_signature": signature}


# Hecho por ChatGPT · 2026-11-02 · Borrado de copias privadas.
# IMPORTANTE: primero desplegar en Debian y probar autenticación. El navegador
# no obtiene permisos para borrar archivos de otros pacientes.

def _unlink_file(path: Path) -> bool:
    # Se rehúsa a seguir enlaces simbólicos, incluso si alguien modificó el disco.
    if path.is_symlink():
        raise HTTPException(409, "Ruta de almacenamiento insegura")
    if not path.exists():
        return False
    if not path.is_file():
        raise HTTPException(409, "El almacenamiento contiene un tipo inesperado")
    path.unlink()
    fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)
    return True


@router.delete("/patient-latest")
async def delete_latest_for_study(
    study_id: str,
    authorization: str | None = Header(None),
):
    token, patient_id = verified_user(authorization)
    del token
    try:
        study_id = str(uuid.UUID(study_id))
    except ValueError:
        raise HTTPException(400, "Estudio inválido")
    require_encrypted_mount()
    if DEST.is_symlink():
        raise HTTPException(409, "Directorio de resumen inseguro")
    target = DEST / (patient_id + ".json")
    if target.is_symlink():
        raise HTTPException(409, "Copia de resumen insegura")
    if not target.exists():
        return {"status": "absent"}
    try:
        existing = json.loads(target.read_text("utf-8"))
    except (OSError, json.JSONDecodeError):
        raise HTTPException(409, "Copia de resumen dañada")
    if existing.get("patient_id") != patient_id:
        raise HTTPException(409, "Titular de copia inconsistente")
    if existing.get("source_study_id") != study_id:
        return {"status": "other_study"}
    deleted = _unlink_file(target)
    return {"status": "deleted" if deleted else "absent"}


@router.delete("/patient-all")
async def delete_all_patient_copies(authorization: str | None = Header(None)):
    token, patient_id = verified_user(authorization)
    require_encrypted_mount()
    # Consultar únicamente los estudios creados por quien está pidiendo
    # eliminar su cuenta. La consulta usa su propio JWT bajo RLS.
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.get(
                SUPABASE_URL + "/rest/v1/studies",
                params={
                    "patient_id": "eq." + patient_id,
                    "self_uploaded": "eq.true",
                    "select": "id,storage_backend,storage_file_id,file_path",
                    "limit": "1000",
                },
                headers={"Authorization": "Bearer " + token, "apikey": publishable_key()},
            )
    except httpx.RequestError:
        raise HTTPException(503, "No pudimos comprobar los estudios")
    if response.status_code != 200:
        raise HTTPException(503, "Supabase no permitió verificar los estudios")
    try:
        rows = response.json()
    except ValueError:
        raise HTTPException(503, "Respuesta de estudios inválida")
    if not isinstance(rows, list) or len(rows) >= 1000:
        raise HTTPException(409, "Demasiados estudios para borrar en una solicitud")
    # Comprobar todas las rutas antes de eliminar cualquier archivo.
    targets = []
    dirs = []
    base_studies = BASE / "estudios"
    if base_studies.is_symlink():
        raise HTTPException(409, "Directorio de estudios inseguro")
    for row in rows:
        if not isinstance(row, dict):
            raise HTTPException(409, "Datos del estudio inválidos")
        backend = row.get("storage_backend")
        legacy = str(row.get("file_path") or "")
        if backend != "debian" and not legacy.startswith("debian:"):
            continue
        try:
            study_id = str(uuid.UUID(row["id"]))
            file_id = str(uuid.UUID(row.get("storage_file_id") or legacy.removeprefix("debian:")))
        except (TypeError, ValueError, AttributeError):
            raise HTTPException(409, "Referencia Debian inválida")
        folder = base_studies / study_id
        if folder.is_symlink():
            raise HTTPException(409, "Directorio de estudio inseguro")
        target = folder / file_id
        if target.is_symlink() or (target.exists() and not target.is_file()):
            raise HTTPException(409, "Archivo de estudio inseguro")
        # Cualquier otro archivo que permanezca en la carpeta se debe
        # investigar antes de dar la eliminación como completada.
        if folder.exists():
            unknown = [p for p in folder.iterdir() if p.name != file_id]
            if unknown:
                raise HTTPException(409, "Quedan archivos de un estudio que requieren revisión")
        targets.append(target)
        dirs.append(folder)
    if DEST.is_symlink():
        raise HTTPException(409, "Directorio de resúmenes inseguro")
    summary = DEST / (patient_id + ".json")
    if summary.is_symlink():
        raise HTTPException(409, "Copia de resumen insegura")
    # Borrado idempotente: soporta reintentos después de interrupciones.
    for target, folder in zip(targets, dirs):
        _unlink_file(target)
        if folder.exists():
            try:
                folder.rmdir()
            except OSError:
                raise HTTPException(409, "No pudimos vaciar el directorio del estudio")
    _unlink_file(summary)
    return {"status": "deleted", "files": len(targets)}
