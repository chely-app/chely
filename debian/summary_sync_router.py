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
