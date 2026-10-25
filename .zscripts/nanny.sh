#!/bin/bash
# Nanny: mantiene el dev server de VECINOS en pie (el sandbox puede recoger procesos huérfanos).
cd /home/z/my-project
while true; do
  if ! curl -s -o /dev/null --max-time 3 http://localhost:3000/; then
    echo "[$(date '+%H:%M:%S')] servidor caído → relanzando" >> /home/z/my-project/.zscripts/nanny.log
    NODE_OPTIONS="--max-old-space-size=1280" nohup ./node_modules/.bin/next dev -p 3000 >> dev.log 2>&1 < /dev/null &
  fi
  sleep 5
done
