# Respaldo del proyecto en GitHub

Este proyecto ya es un repositorio Git local completo (rama `main`, todo el
trabajo de la v0.3 comprometido). Solo falta conectarlo a un remoto en GitHub
para tener la copia de respaldo siempre actualizada.

---

## Paso 1 — Crear el repositorio en GitHub (2 minutos)

1. Entra en <https://github.com> con tu cuenta (si no tienes, regístrate gratis).
2. Pulsa el botón **`+`** (arriba a la derecha) → **New repository**.
3. Nombre sugerido: `vecinos` (o el que prefieras).
4. Marca **Private** (recomendado: es un proyecto comercial).
5. **IMPORTANTE**: NO marques ninguna casilla de inicialización
   (ni *Add a README*, ni *.gitignore*, ni *license*). El repositorio debe
   quedar **vacío** para no crear historiales en conflicto.
6. Pulsa **Create repository** y copia la URL que te muestra, p. ej.:
   `https://github.com/TU-USUARIO/vecinos.git`

## Paso 2 — Crear un token de acceso (PAT)

GitHub ya no acepta contraseñas para push; hace falta un token:

1. GitHub → clic en tu avatar → **Settings** → (menú izquierdo, abajo)
   **Developer settings** → **Personal access tokens** → **Fine-grained tokens**
   → **Generate new token**.
2. Configúralo así:
   - **Token name**: `sandbox-backup`
   - **Expiration**: 90 días (puedes regenerarlo cuando caduque).
   - **Repository access**: *Only select repositories* → elige el repo que
     acabas de crear.
   - **Permissions → Repository permissions → Contents**: **Read and write**
     (es el único permiso necesario para push).
3. **Generate token** y copia el token (empieza por `github_pat_...`).
   Solo se muestra una vez.

> El token solo da acceso de escritura a ese único repositorio y puedes
> revocarlo en cualquier momento desde la misma pantalla.

## Paso 3 — Conectar el sandbox a GitHub

**Opción A (recomendada): pídemelo en el chat.**

Escríbeme:

```
Repo: https://github.com/TU-USUARIO/vecinos.git
Token: github_pat_XXXX...
```

y yo me encargo de: añadir el remote, hacer el primer push (sube todo el
historial: 6 commits + el nuevo) y verificar que en GitHub se ve todo.

> Nota de seguridad: el token quedará guardado en la configuración del
> sandbox (`.git/config`) para poder hacer push sin pedírtelo cada vez.
> Si prefieres maximizar la seguridad, revoca ese token cuando quieras y
> generamos otro nuevo.

**Opción B (hazlo tú mismo):**

```bash
cd /home/z/my-project
git remote add origin https://github.com/TU-USUARIO/vecinos.git
./scripts/backup-github.sh
# Cuando pida credenciales:
#   Username: TU-USUARIO
#   Password: el token (no tu contraseña de GitHub)
```

---

## Mantener el respaldo actualizado

A partir de ahí, mantener GitHub al día cuesta **un comando** (o ni eso):

| Forma | Qué hacer |
|---|---|
| **Pedírmelo en el chat** (recomendado) | Di «sube los cambios a GitHub» y haré commit con mensaje descriptivo + push + verificación. |
| **Tú mismo, un comando** | `./scripts/backup-github.sh -m "v0.4: audio"` |
| **Ver sin subir nada** | `./scripts/backup-github.sh --check` |

El script hace: `git add -A` → commit (con mensaje) → `push` a `origin/main`,
y te dice claramente qué se subió o qué falló.

### Caducidad del token

Cuando el token caduque (a los 90 días si elegiste eso), el push fallará con
`401/403`. Solución: genera un token nuevo (Paso 2) y:

```bash
git remote set-url origin https://<NUEVO-TOKEN>@github.com/TU-USUARIO/vecinos.git
```

(o pídemelo y lo actualizo).

---

## Notas sobre el contenido del respaldo

- **Todo el proyecto se sube**: código (`src/`), contenido data-driven
  (`public/content/*.json`), esquemas, scripts, docs y `worklog.md`.
- **`upload/VECINOS.zip` (~43 MB)**: GitHub acepta archivos hasta 100 MB
  (avisa a partir de 50 MB), así que se sube sin problema. Si algún día el
  repo crece demasiado, podemos migrar ese zip a **Git LFS**.
- **`tool-results/`** (capturas de verificación E2E, ~1 MB en total): se
  incluyen como historial de QA. Si prefieres un repo más ligero, puedo
  añadirlas a `.gitignore` — tú decides.
- **`db/custom.db`** (partida guardada, 61 KB): se incluye; es tu estado de
  prueba actual.
- Los commits aparecen con el autor del sandbox (`Z User`). Si quieres que se
  vinculen a tu perfil de GitHub, dime tu email de GitHub y lo dejo configurado
  (o usa el email `noreply` que GitHub te asigna en *Settings → Emails*).

## Recuperar el proyecto desde GitHub (si el sandbox se pierde)

En cualquier máquina con Git y Bun:

```bash
git clone https://github.com/TU-USUARIO/vecinos.git
cd vecinos
bun install
bun run dev
```

La partida guardada vuelve con el repo (está en `db/custom.db`) y el historial
completo de commits está disponible.
