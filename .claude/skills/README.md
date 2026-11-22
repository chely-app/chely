<!-- Hecho por Claude · 2026-11-22 · instalación de skills de Claude Code para el equipo -->
# Skills de Claude Code

Claude Code carga solo las skills de esta carpeta en cada sesión, incluidas las sesiones en la nube y las que se abren desde el celular.
Cada skill es una carpeta con un `SKILL.md`, que tiene instrucciones para el asistente. **No cambian el código de la app
y no corren en producción.**

Instaladas el 2026-11-22. Cada skill se revisó antes de instalarla: no descargan scripts externos ni piden claves.

## Qué hay

**Desarrollo (Superpowers, de obra/superpowers).** Pide un orden de trabajo: pensar, planificar, escribir tests,
implementar, verificar y revisar.
`brainstorming`, `writing-plans`, `executing-plans`, `test-driven-development`, `systematic-debugging`,
`verification-before-completion`, `requesting-code-review`, `receiving-code-review`, `subagent-driven-development`,
`dispatching-parallel-agents`, `using-git-worktrees`, `finishing-a-development-branch`, `using-superpowers`,
`writing-skills`, `diagnosing-superpowers`. Van todas juntas porque se usan entre sí.

**Supabase (oficial, de supabase/agent-skills).**
`supabase` (RLS, Auth, migraciones, seguridad) y `supabase-postgres-best-practices` (30 reglas de Postgres).

**Pruebas (oficial de Anthropic, de anthropics/skills).**
`webapp-testing`: prueba la web con un navegador real (Playwright), saca capturas y lee los errores de la consola.

**Marketing (de coreyhaines31/marketingskills).**
`product-marketing`, `copywriting`, `copy-editing`, `cro`, `social`, `ads`, `ad-creative`, `emails`, `launch`,
`pricing`, `marketing-psychology`, `seo-audit`, `onboarding`, `churn-prevention`.

## Origen y licencias

La versión exacta de cada fuente (commit) está en `.claude/skills-licenses/SOURCES.txt` y las licencias en
`.claude/skills-licenses/`. `webapp-testing` trae su propia `LICENSE.txt`.

## Cómo usarlas

Se activan solas cuando el pedido encaja, o las podés pedir por nombre, por ejemplo: "usá systematic-debugging
para ver por qué no abre la puerta".

## Cómo actualizar o quitar

- Quitar: borrar la carpeta de la skill.
- Actualizar: copiar de nuevo la carpeta desde su repo de origen y revisar el `SKILL.md` antes de commitear.
- No instalar skills de fuentes desconocidas sin leerlas: el asistente sigue sus instrucciones.
