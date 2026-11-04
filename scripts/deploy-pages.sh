#!/bin/bash
# Redespliega el sitio estático de VECINOS en GitHub Pages (rama `gh-pages`).
# Uso: ./scripts/deploy-pages.sh   (desde la raíz del repo)
#
# Requisitos: PAT con Contents R-W en el remote (el mismo del push de main).
# Pages debe estar ALTA una sola vez: GitHub → Settings → Pages → Source:
# «Deploy from a branch» → gh-pages / (root).
#
# Qué hace:
#  1) Export estático con NEXT_PAGES=1 (distDir .next-pages: no toca el .next del dev;
#     rutas API fuera — SQLite/fs no existen en Pages, el guardado cae a localStorage).
#  2) Staging en /tmp con manifest ajustado al subpath /VECINOS/ + .nojekyll (sirve _next/).
#  3) Commit huérfano en gh-pages vía plumbing (GIT_INDEX_FILE/GIT_WORK_TREE: el working
#     tree de main no se toca) y push.
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf .next-pages
if [ -d src/app/api ]; then mv src/app/api /tmp/vecinos-api-bak; RESTORE_API=1; fi
NEXT_PAGES=1 NEXT_PUBLIC_SW=off bunx next build
if [ "${RESTORE_API:-0}" = "1" ]; then mv /tmp/vecinos-api-bak src/app/api; fi

rm -rf /tmp/ghpages && cp -r .next-pages /tmp/ghpages
sed -i 's|"start_url": "/"|"start_url": "/VECINOS/"|; s|"scope": "/"|"scope": "/VECINOS/"|' /tmp/ghpages/manifest.webmanifest
touch /tmp/ghpages/.nojekyll

export GIT_INDEX_FILE=/tmp/ghidx GIT_WORK_TREE=/tmp/ghpages
rm -f "$GIT_INDEX_FILE"
git read-tree --empty
git add -A
TREE=$(git write-tree)
COMMIT=$(git commit-tree "$TREE" -m "gh-pages: export estático desde main $(git rev-parse --short main) — $(date -u '+%Y-%m-%dT%H:%MZ')")
git update-ref refs/heads/gh-pages "$COMMIT"
unset GIT_INDEX_FILE GIT_WORK_TREE

git push --force origin gh-pages
echo "✓ gh-pages actualizado desde main $(git rev-parse --short main) → https://franjavierdavila.github.io/VECINOS/"
