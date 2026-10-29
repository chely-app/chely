# Chely · Puesta en marcha del piloto

Esta guía es para dejar Chely funcionando con usuarios reales: médicos que suben estudios y pacientes que los leen explicados.

**Cómo está armada:**
- **La web** (carpeta `web/`) se publica en Cloudflare Pages, en `app.chely.app`.
- **Los datos y los usuarios** viven en **Supabase**: base de datos, inicio de sesión y archivos.
- **La IA** es Claude, de Anthropic. Se llama desde una función del servidor de Supabase; la clave nunca llega al navegador.

Algunos pasos los hacen ustedes y otros los hace Claude. Al lado de cada uno dice quién.

---

## 1. Cuenta de Supabase (ustedes, 10 minutos)

1. Entrar a **supabase.com** y crear una cuenta con `chely.app.14@gmail.com`.
2. Crear una organización llamada **Chely** (plan gratuito).
3. Crear un proyecto:
   - Nombre: `chely`
   - Región: **South America (São Paulo)**, la más cercana a Argentina.
   - Contraseña de la base: generar una fuerte y **guardarla en un lugar seguro**. No hace falta pasársela a nadie.
4. **Para que Claude pueda instalar todo:** en la organización Chely → **Team** → invitar como **Owner** al correo de la cuenta de Supabase que ya está conectada a Claude (la de Lucas). Después, en claude.ai, puede hacer falta volver a conectar el conector de Supabase para que aparezca la organización nueva.

## 2. Clave de la IA (ustedes, 10 minutos)

1. Entrar a **console.anthropic.com** y crear una cuenta con `chely.app.14@gmail.com`.
2. **Billing**: cargar crédito; con 10 dólares alcanza de sobra para el piloto. En **Limits**, poner un **tope de gasto mensual** (por ejemplo, 20 dólares) para que nunca haya sorpresas.
3. **API Keys** → **Create Key** → nombre `chely-piloto` → copiar la clave (empieza con `sk-ant-`).
4. **No la pegues en el chat.** Cargala directamente en Supabase: proyecto `chely` → **Edge Functions** → **Secrets** → **Add new secret**:
   - Nombre: `ANTHROPIC_API_KEY`
   - Valor: la clave copiada.

**Costo aproximado:** cada explicación cuesta entre 5 y 10 centavos de dólar, y leer un archivo, unos pocos centavos. La app limita a 60 usos de IA por médico cada 24 horas.

## 3. Correos de la app (ustedes, 15 minutos)

Supabase manda los correos de "confirmá tu cuenta" y "recuperá tu contraseña", pero su servicio gratuito **solo envía a los miembros del equipo**. Para que les lleguen a los pacientes hay que usar el Gmail de Chely:

1. En Gmail (`chely.app.14@gmail.com`) → **Gestionar tu cuenta de Google** → **Seguridad** → activar **Verificación en dos pasos**.
2. En la misma sección, buscar **Contraseñas de aplicaciones** → crear una llamada `Supabase` → copiar las 16 letras.
3. En Supabase → **Authentication** → **Emails** → **SMTP Settings** → activar **Custom SMTP**:
   - Sender email: `chely.app.14@gmail.com`
   - Sender name: `Chely`
   - Host: `smtp.gmail.com` · Port: `465`
   - Username: `chely.app.14@gmail.com` · Password: las 16 letras.
4. En **Authentication** → **Emails** → **Templates**, reemplazar los textos por los que están en `docs/correos/`:
   - "Confirm signup": `confirmar-cuenta.html`, con el asunto "Confirmá tu cuenta de Chely".
   - "Reset password": `recuperar-contrasena.html`, con el asunto "Tu contraseña de Chely".
   - "Change email": `cambio-de-correo.html`, con el asunto "Confirmá tu correo nuevo".

Gmail permite unos 500 correos por día, que alcanzan para el piloto.

## 4. Instalar la base y las funciones (Claude) · HECHO el 28/10/2026

Proyecto `chelyapp's Project` (São Paulo, ref `ypxmqaseqslswotcffdu`): base, seguridad, almacenamiento y las funciones `ia` y `borrar-cuenta` instaladas; `web/config.js` ya completo. En el servidor, las funciones se publicaron con la carpeta `_shared` copiada adentro de cada una.

### (Referencia) Qué se instaló

Cuando el paso 1 esté hecho, avisale a Claude. Claude va a:

- Aplicar `supabase/migrations/20261028000000_chely.sql`: las tablas, las reglas de seguridad y el almacenamiento de archivos.
- Publicar las funciones `ia` y `borrar-cuenta` (carpeta `supabase/functions/`).
- Completar `web/config.js` con la dirección del proyecto y la clave pública.
- Revisar los avisos de seguridad de Supabase.

Si prefieren hacerlo sin Claude, las instrucciones manuales están al final.

## 5. Configurar el inicio de sesión (ustedes o Claude)

En Supabase → **Authentication** → **URL Configuration**:
- **Site URL:** `https://app.chely.app`
- **Redirect URLs:** agregar `https://app.chely.app/**`

En **Authentication** → **Sign In / Providers** → **Email**:
- Dejar activado **Confirm email**.
- **Minimum password length:** 8.

En **Edge Functions** → **Secrets**, agregar `APP_ORIGIN` con el valor `https://app.chely.app`. Así las funciones solo aceptan pedidos de la app.

## 6. Publicar la web (ustedes, 5 minutos)

1. Cloudflare → **Workers & Pages** → **Crear** → **Pages** → **Cargar recursos**.
2. Nombre del proyecto: `chely-app`. Subir el contenido de la carpeta `web/` (con el `config.js` ya completado).
3. En el proyecto → **Dominios personalizados** → agregar `app.chely.app`. Cloudflare crea el registro DNS solo.

La página de presentación sigue en `chely.app`, y la app queda en `app.chely.app`.

## 7. Dar de alta a la médica (Claude o ustedes)

1. La médica entra a `https://app.chely.app` → **Crear cuenta** → confirma el correo.
2. Hay que marcar su cuenta como médica. Se hace una sola vez por profesional, en Supabase → **SQL Editor**:

   ```sql
   update public.profiles set role = 'doctor' where email = 'correo-de-la-medica@ejemplo.com';
   ```

3. La médica vuelve a entrar y acepta las condiciones para profesionales.

## 8. Prueba completa antes del paciente real

Con cuentas de prueba (pueden ser correos de ustedes):

1. La médica toca **Invitar paciente** y manda el enlace.
2. El "paciente de prueba" abre el enlace, crea la cuenta, confirma el correo y acepta el consentimiento.
3. La médica abre al paciente → **Nuevo estudio** → sube un PDF de ejemplo **ficticio** → **Leer el archivo con IA** → **Generar explicación con IA** → revisa → **Publicar**.
4. El paciente entra, lee la explicación, toca una palabra subrayada, mira los valores y responde **¿Se entendió?**
5. Probar **Me olvidé la contraseña**, **Dejar de compartir** y **Borrar mi cuenta**.

Si todo funciona, recién ahí se invita al paciente real.

## Antes de usar datos reales: lo legal

- **Que lo revise un abogado:** el texto de consentimiento del paciente y las condiciones del médico están en `web/app.js`, en la función `consentBody`.
- **Responsable de los datos:** hoy figura "equipo de Chely" con el correo de contacto. Conviene poner el nombre de la persona o la empresa responsable.
- **Registro de la base:** se registra ante la Agencia de Acceso a la Información Pública (Ley 25.326, datos sensibles de salud).
- **Copias de seguridad:** el plan gratuito de Supabase no guarda copias que se puedan restaurar. Para el piloto alcanza, pero con más pacientes conviene pasar al plan Pro (25 dólares por mes).
- **Si un médico deja de participar:** ya no puede ver los estudios. Los pacientes conservan los que les publicó.

## Qué hace la app

**Paciente:**
- Crea su cuenta desde el enlace de invitación de su médico y acepta el consentimiento.
- Ve sus estudios publicados, con aviso de "Nuevo".
- En cada estudio: la explicación con glosario al tocar, la nota del médico, los valores con su rango, el gráfico de evolución, el informe original y la pregunta "¿Se entendió?".
- **Mis médicos:** vincular con un código, o dejar de compartir con un médico.
- **Mi cuenta:** nombre, fecha de nacimiento, contraseña, el registro de quién vio sus estudios y la opción de borrar la cuenta.
- Letra grande o chica y modo oscuro.

**Médico:**
- Invita pacientes con un enlace o código que vence en 14 días y sirve una sola vez.
- Carga estudios: un PDF o una foto, o el texto pegado.
- La IA lee el archivo, y el médico revisa el texto.
- La IA prepara el borrador de explicación, el glosario y los valores. El médico corrige todo, ve la vista previa y **publica solo después de tildar "Revisé"**.
- Puede retirar o corregir lo publicado, y ve si el paciente lo abrió y qué respondió.

**Seguridad:** está en la base de datos, no solo en la pantalla.
- Cada paciente ve solo lo suyo, y solo lo publicado.
- Cada médico ve solo a sus pacientes vinculados.
- Nadie puede cambiar su propio rol.
- Quedan registradas las acciones sobre cada estudio.

---

## Instalación manual (sin Claude)

Con la [CLI de Supabase](https://supabase.com/docs/guides/cli) instalada:

```bash
supabase login
supabase link --project-ref <ref-del-proyecto>
supabase db push
supabase functions deploy ia
supabase functions deploy borrar-cuenta
supabase secrets set ANTHROPIC_API_KEY=sk-ant-... APP_ORIGIN=https://app.chely.app
```

Después, en `web/config.js`, completar `supabaseUrl` (Project Settings → API → Project URL) y `supabaseKey` (la clave pública `anon` o `publishable`).

## Pruebas incluidas

- `tests/db/run.sh`: reglas de seguridad de la base, con un Postgres local (32 comprobaciones).
- `tests/ia/claude.test.mjs`: la lógica de IA con respuestas simuladas, sin gastar crédito.
- `tests/ui/flow.mjs`: el recorrido completo médico → paciente en el navegador, con una base simulada.
