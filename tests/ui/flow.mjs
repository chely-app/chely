// Recorre la app con Supabase simulado: médica invita, carga, genera y publica; paciente lo ve y responde.
// Uso: node tests/ui/flow.mjs <url> <carpeta para capturas>
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const [url, out] = process.argv.slice(2);
const b = await chromium.launch();
const ctx = await b.newContext();  // mismo navegador: la base simulada vive en su almacenamiento
const errors = [];
async function page(width) {
  const p = await ctx.newPage();
  await p.setViewportSize({ width, height: 900 });
  p.on('pageerror', e => errors.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  return p;
}
const step = s => console.log('  OK:', s);
const p = await page(1200);
await p.goto(url); await p.evaluate(() => localStorage.clear()); await p.reload();

// Médica entra y acepta condiciones.
await p.fill('#auth-email', 'medica@ej.com'); await p.fill('#auth-pass', 'clave1234'); await p.click('button[type=submit]');
await p.waitForSelector('#consent-ok'); await p.screenshot({ path: out + '/1-consentimiento-medico.png', fullPage: true });
await p.check('#consent-ok'); await p.click('text=Acepto y continúo');
await p.waitForSelector('text=Mis pacientes'); step('médica entra y acepta condiciones');

// Invita a la paciente.
await p.click('text=Invitar paciente'); await p.fill('#invite-hint', 'Marta Prueba'); await p.click('text=Crear invitación');
await p.waitForSelector('.linkbox'); const link = await p.textContent('.linkbox');
await p.screenshot({ path: out + '/2-invitacion.png' }); await p.click('text=Cerrar'); step('crea invitación: ' + link.replace(/^.*\?/, '?'));
await p.click('text=Salir');

// La paciente usa el enlace.
const pp = await page(390);
await pp.goto(link); await pp.waitForSelector('#auth-email');
await pp.waitForFunction(() => /te invitó/.test(document.body.innerText));
await pp.screenshot({ path: out + '/3-paciente-invitacion.png', fullPage: true });
await pp.click('role=tab[name="Entrar"]');
await pp.fill('#auth-email', 'paciente@ej.com'); await pp.fill('#auth-pass', 'clave1234'); await pp.click('button[type=submit]');
await pp.waitForSelector('#consent-ok'); await pp.screenshot({ path: out + '/4-consentimiento-paciente.png', fullPage: true });
await pp.check('#consent-ok'); await pp.click('text=Acepto y continúo');
await pp.waitForSelector('text=Mis estudios'); step('paciente acepta y queda vinculada');
await pp.click('text=Salir');

// La médica carga el estudio.
await p.goto(url); await p.fill('#auth-email', 'medica@ej.com'); await p.fill('#auth-pass', 'clave1234'); await p.click('button[type=submit]');
await p.click('text=Marta Prueba');
await p.fill('#ns-title', 'Análisis de sangre'); await p.fill('#ns-text', 'Glucemia en ayunas: 112 mg/dL (VR 70 - 100)\nHemoglobina: 12,9 g/dL');
await p.click('text=Crear estudio'); await p.waitForSelector('#ed-report'); step('crea el estudio');
await p.click('text=Generar explicación con IA'); await p.waitForFunction(() => document.querySelector('#ed-expl').value.includes('glucemia'));
step('genera el borrador con IA (simulada)');
await p.click('text=Ver como lo verá el paciente'); await p.waitForSelector('text=Vista previa');
await p.screenshot({ path: out + '/5-editor-medico.png', fullPage: true });
await p.check('#ed-reviewed'); await p.click('text=Publicar para el paciente');
await p.waitForSelector('text=Publicado'); step('publica');
await p.click('text=Salir'); await p.waitForSelector('#auth-email');

// La paciente lo ve.
await pp.goto(url); await pp.fill('#auth-email', 'paciente@ej.com'); await pp.fill('#auth-pass', 'clave1234'); await pp.click('button[type=submit]');
await pp.waitForSelector('text=Nuevo'); await pp.screenshot({ path: out + '/6-paciente-lista.png', fullPage: true });
await pp.click('text=Análisis de sangre'); await pp.waitForSelector('.term');
await pp.click('.term'); await pp.waitForSelector('.sheet'); step('glosario al tocar');
await pp.screenshot({ path: out + '/7-paciente-estudio.png', fullPage: true });
await pp.click('.sheet >> text=Cerrar');
await pp.waitForSelector('text=Cómo vienen tus valores'); step('valores y evolución');
await pp.click('.feedback >> text=Sí'); await pp.waitForSelector('text=Gracias por responder'); step('responde «¿Se entendió?»');
// Piloto sin médico: la paciente sube su propio estudio.
await pp.click('text=Mis estudios'); await pp.click('text=Subir un estudio');
await pp.fill('#up-title', 'Mi análisis de octubre'); await pp.fill('#up-text', 'Glucemia en ayunas: 118 mg/dL (VR 70 - 100)');
await pp.click('button:has-text("Subir estudio")'); step('paciente sube su propio estudio');
await pp.waitForSelector('text=sin revisión médica');  // se explica solo, sin tocar otro botón
await pp.screenshot({ path: out + '/9-estudio-propio.png', fullPage: true }); step('la IA lo explica con aviso de «sin revisión médica»');
await pp.click('text=Mi cuenta'); await pp.waitForSelector('text=Quién vio tus estudios');
await pp.screenshot({ path: out + '/8-paciente-cuenta.png', fullPage: true }); step('ve el registro de accesos');
const overflow = await pp.evaluate(() => document.documentElement.scrollWidth > innerWidth);
console.log(overflow ? '  FALLA: desborda en celular' : '  OK: sin desborde horizontal en celular');
console.log(errors.length ? 'ERRORES: ' + errors.join(' | ') : 'SIN ERRORES DE CONSOLA');
await b.close();
