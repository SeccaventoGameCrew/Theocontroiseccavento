#!/bin/bash
# Rimuove Ambilight Sync, le sue impostazioni e l'abbinamento con la TV.
set -euo pipefail
DEST="$HOME/Library/Application Support/AmbilightSync"
APP="$HOME/Applications/Ambilight Sync.app"

read -r -p "Rimuovere Ambilight Sync e le sue impostazioni? [s/N] " answer
case "$answer" in
  s|S|si|SI|sì|Sì) ;;
  *) echo "Annullato."; exit 0 ;;
esac

curl -s -m 2 -X POST -H 'X-Ambisync: 1' -H 'Content-Type: application/json' -d '{}' \
  http://127.0.0.1:8765/api/quit >/dev/null 2>&1 || true
osascript -e 'if application "Ambilight Sync" is running then tell application "Ambilight Sync" to quit' >/dev/null 2>&1 || true
sleep 1
rm -rf "$APP" "$DEST"
echo "Ambilight Sync rimosso. Se vuoi, togli anche «Ambilight Sync» dai dispositivi abbinati della TV."
