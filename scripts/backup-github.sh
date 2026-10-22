#!/usr/bin/env bash
# ============================================================================
# backup-github.sh — Respaldo del proyecto en GitHub con un solo comando.
#
# Uso:
#   ./scripts/backup-github.sh                    # commit + push (mensaje automático)
#   ./scripts/backup-github.sh -m "v0.4: audio"   # commit con mensaje personalizado
#   ./scripts/backup-github.sh --check            # solo muestra qué se subiría
#
# Requiere haber configurado el remote 'origin' (ver docs/BACKUP-GITHUB.md).
# ============================================================================
set -euo pipefail

MSG=""
MODE="push"
case "${1:-}" in
  -m)
    MSG="${2:-}"
    [[ -n "$MSG" ]] || { echo "✗ Falta el mensaje tras -m. Ej: ./scripts/backup-github.sh -m \"v0.4: audio\""; exit 1; }
    ;;
  --check)
    MODE="check"
    ;;
  "")
    ;;
  *)
    echo "✗ Argumento no reconocido: $1 (usa -m \"mensaje\", --check o nada)"; exit 1
    ;;
esac

cd "$(git rev-parse --show-toplevel)"

# --- 1) Remote -------------------------------------------------------------
if ! git remote get-url origin >/dev/null 2>&1; then
  echo "✗ No hay remote 'origin' configurado."
  echo "  Añádelo con:  git remote add origin https://github.com/<TU-USUARIO>/<TU-REPO>.git"
  echo "  Guía completa: docs/BACKUP-GITHUB.md"
  exit 1
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
ORIGIN="$(git remote get-url origin | sed -E 's#https://[^@]+@#https://<token>@#')"
echo "→ Remoto : ${ORIGIN}"
echo "→ Rama   : ${BRANCH}"

# --- 2) ¿Qué se subiría? ---------------------------------------------------
if [[ -n "$(git status --porcelain)" ]]; then
  echo ""
  echo "Cambios pendientes:"
  git status --porcelain | head -40
  N=$(git status --porcelain | wc -l)
  [[ "$N" -gt 40 ]] && echo "... y $((N - 40)) más"
  echo ""
else
  echo "• Sin cambios nuevos respecto al último commit."
fi

if [[ "$MODE" == "check" ]]; then
  echo "✓ (--check) Nada se ha commiteado ni subido."
  exit 0
fi

# --- 3) Commit -------------------------------------------------------------
if [[ -n "$(git status --porcelain)" ]]; then
  git add -A
  if [[ -z "$MSG" ]]; then
    MSG="Backup automático $(date '+%Y-%m-%d %H:%M')"
  fi
  git commit -m "$MSG"
  echo "✓ Commit creado: $MSG"
fi

# --- 4) Push ---------------------------------------------------------------
echo "→ Subiendo a GitHub..."
if git push -u origin "$BRANCH"; then
  echo ""
  echo "✓ Respaldo actualizado en GitHub (origin/${BRANCH})."
else
  echo ""
  echo "✗ El push falló. Causas típicas:"
  echo "  1. Token caducado/revocado → regenera el PAT y actualiza:"
  echo "     git remote set-url origin https://<TOKEN>@github.com/<usuario>/<repo>.git"
  echo "  2. Sin conexión de red en el sandbox → reintenta más tarde."
  echo "  3. 403 permisos → el token necesita permiso 'Contents: Read and write'."
  exit 1
fi
