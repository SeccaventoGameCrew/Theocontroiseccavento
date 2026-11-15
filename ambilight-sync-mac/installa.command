#!/bin/bash
# Installa (o aggiorna) Ambilight Sync su questo Mac.
# Uso: apri il Terminale e scrivi   bash ~/Downloads/ambilight-sync-mac/installa.command
set -euo pipefail

cd "$(dirname "$0")"
SRC="$(pwd)"
DEST="$HOME/Library/Application Support/AmbilightSync"
APP="$HOME/Applications/Ambilight Sync.app"
VERSION="$(sed -n 's/^__version__ = "\(.*\)"/\1/p' ambisync/__init__.py)"

echo "== Ambilight Sync $VERSION: installazione =="

# 1) Python 3.9 o successivo (quello di Apple arriva con gli Strumenti da riga di comando)
PY=""
for cand in /usr/bin/python3 /opt/homebrew/bin/python3 /usr/local/bin/python3; do
  if [ -x "$cand" ] && "$cand" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' >/dev/null 2>&1; then
    PY="$cand"; break
  fi
done
if [ -z "$PY" ]; then
  echo
  echo "Serve Python 3. macOS ora ti proporrà di installare gli «Strumenti da riga di comando»:"
  echo "accetta, attendi la fine dell'installazione e poi esegui di nuovo questo programma."
  xcode-select --install >/dev/null 2>&1 || true
  exit 1
fi
echo "· Python: $("$PY" --version 2>&1)"

# 2) Chiudi una versione già in esecuzione
curl -s -m 2 -X POST -H 'X-Ambisync: 1' -H 'Content-Type: application/json' -d '{}' \
  http://127.0.0.1:8765/api/quit >/dev/null 2>&1 || true
osascript -e 'if application "Ambilight Sync" is running then tell application "Ambilight Sync" to quit' >/dev/null 2>&1 || true
sleep 1

# 3) Copia il programma
mkdir -p "$DEST"
rm -rf "$DEST/ambisync"
cp -R "$SRC/ambisync" "$DEST/ambisync"
find "$DEST/ambisync" -name __pycache__ -prune -exec rm -rf {} +
echo "· Programma copiato in: $DEST"

# 4) Ambiente Python privato + supporto facoltativo Tuya / Smart Life
if [ ! -x "$DEST/venv/bin/python3" ]; then
  "$PY" -m venv "$DEST/venv"
fi
if "$DEST/venv/bin/python3" -m pip install --quiet --disable-pip-version-check --upgrade tinytuya; then
  echo "· Supporto Tuya / Smart Life installato"
else
  echo "· Attenzione: supporto Tuya non installato (serve Internet). Le altre marche funzionano lo stesso."
fi

# 5) Crea l'app in ~/Applications
mkdir -p "$HOME/Applications"
rm -rf "$APP"
osacompile -s -o "$APP" "$SRC/macos/AmbilightSync.applescript"
PL="$APP/Contents/Info.plist"
plist_set() {  # chiave tipo valore
  /usr/libexec/PlistBuddy -c "Set :$1 \"$3\"" "$PL" 2>/dev/null || /usr/libexec/PlistBuddy -c "Add :$1 $2 \"$3\"" "$PL"
}
plist_set CFBundleIdentifier string it.ambisync.mac
plist_set CFBundleName string "Ambilight Sync"
plist_set CFBundleShortVersionString string "$VERSION"
plist_set NSLocalNetworkUsageDescription string "Ambilight Sync legge i colori dalla TV Philips e li invia alle strisce LED della rete di casa."

ICONDIR="$(mktemp -d)"
if "$PY" "$SRC/macos/make_icon.py" "$ICONDIR/icon.png" 2>/dev/null; then
  SET="$ICONDIR/applet.iconset"; mkdir -p "$SET"
  for s in 16 32 128 256 512; do
    sips -z $s $s "$ICONDIR/icon.png" --out "$SET/icon_${s}x${s}.png" >/dev/null 2>&1 || true
    d=$((s * 2)); sips -z $d $d "$ICONDIR/icon.png" --out "$SET/icon_${s}x${s}@2x.png" >/dev/null 2>&1 || true
  done
  iconutil -c icns "$SET" -o "$APP/Contents/Resources/applet.icns" >/dev/null 2>&1 || true
fi
rm -rf "$ICONDIR"
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true
touch "$APP"
echo "· App creata: $APP"

# 6) Avvio
open "$APP"
cat <<EOF

Fatto! Il pannello si apre nel browser (http://127.0.0.1:8765).
 · Al primo avvio macOS chiede l'accesso alla «rete locale»: rispondi Consenti.
 · L'app è nella cartella Applicazioni della tua cartella Inizio (la trovi anche con Spotlight).
 · Per avviarla da sola all'accensione del Mac: Impostazioni di Sistema > Generali >
   Elementi login > + > Ambilight Sync.
EOF
