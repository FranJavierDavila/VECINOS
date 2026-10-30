#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Watchdog del dev server de VECINOS (sandbox con 4GB y OOM killer).
#
# Motivo: cuando la RAM se agota (Turbopack crece con cada compilación y el
# navegador consume mucho), el kernel mata procesos. Si cae el next-server,
# el juego carga con TODOS los assets rotos: texturas en blanco («no se ve
# nada») y vecinos en cápsula greybox (glTF no llegan).
#
# Este bucle comprueba el servidor cada POLL_SECS. Dos fallos consecutivos
# de conexión → relanza `bun run dev`. Además, vigilancia de memoria: si el
# next-server supera MEM_LIMIT_MB, lo relanza ANTES de que el OOM killer
# decida por nosotros (la UI del juego ya sabe recuperarse de un blip).
# Log de acciones: scripts/watchdog.log
# ─────────────────────────────────────────────────────────────────────────────
cd "$(dirname "$0")/.." || exit 1

POLL_SECS="${POLL_SECS:-20}"
MEM_LIMIT_MB="${MEM_LIMIT_MB:-2800}"
URL="http://localhost:3000/"
FAILS=0

log() { echo "[$(date '+%F %T')] $*" >> scripts/watchdog.log; }

restart_server() {
  log "relanzando dev server…"
  pkill -f "next dev" 2>/dev/null
  pkill -f "next-server" 2>/dev/null
  sleep 2
  nohup bun run dev >> dev.log 2>&1 &
  log "relanzado (bun run dev)"
}

log "watchdog iniciado (poll=${POLL_SECS}s, mem_limit=${MEM_LIMIT_MB}MB)"

while true; do
  sleep "$POLL_SECS"

  # 1) ¿Vivo? (cualquier código HTTP vale; 000 = sin conexión)
  code=$(curl -s -o /dev/null -m 6 -w "%{http_code}" "$URL" 2>/dev/null)
  if [ "$code" = "000" ]; then
    FAILS=$((FAILS + 1))
    log "sin respuesta (code=$code, fallo #$FAILS)"
    if [ "$FAILS" -ge 2 ]; then
      restart_server
      FAILS=0
    fi
    continue
  fi
  FAILS=0

  # 2) Memoria del next-server: relanzar preventivamente si se acerca al OOM
  rss_kb=$(ps -eo rss=,comm=,args= | grep -E "next-server" | grep -v grep | awk '{s+=$1} END {print s+0}')
  rss_mb=$((rss_kb / 1024))
  if [ "$rss_mb" -ge "$MEM_LIMIT_MB" ]; then
    log "next-server en ${rss_mb}MB (>= ${MEM_LIMIT_MB}MB): reinicio preventivo"
    restart_server
  fi
done
