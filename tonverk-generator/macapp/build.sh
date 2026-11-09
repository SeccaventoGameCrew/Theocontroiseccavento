#!/usr/bin/env bash
# Builds "Tonverk Generator.app" and a .dmg on macOS.
#   cd tonverk-generator && ./macapp/build.sh
# Output: dist/Tonverk Generator.app and dist/TonverkGenerator-<version>-<arch>.dmg
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "$(uname)" != "Darwin" ]]; then
  echo "Questo script va eseguito su macOS." >&2
  exit 1
fi

VERSION="${TVGEN_VERSION:-$(sed -n 's/^version = "\(.*\)"/\1/p' pyproject.toml | head -1)}"
ARCH="${TVGEN_ARCH:-$(uname -m)}"
export TVGEN_VERSION="$VERSION" TVGEN_ARCH="$ARCH"
PY="${PYTHON:-python3}"
if ! "$PY" -c 'import sys; sys.exit(sys.version_info < (3, 10))'; then
  echo "Serve Python 3.10 o successivo (es. brew install python@3.12, poi PYTHON=python3.12 ./macapp/build.sh)." >&2
  exit 1
fi

# 1. isolated build environment
if [[ -z "${TVGEN_NO_VENV:-}" ]]; then
  "$PY" -m venv .venv-build
  # shellcheck disable=SC1091
  source .venv-build/bin/activate
  PY=python
fi
"$PY" -m pip install --upgrade pip >/dev/null
"$PY" -m pip install ".[mac]" "pyinstaller>=6.10"

# 2. icon (.icns) from macapp/icon.png
rm -rf build/icon.iconset && mkdir -p build/icon.iconset
for s in 16 32 128 256 512; do
  sips -z $s $s macapp/icon.png --out "build/icon.iconset/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2))
  sips -z $d $d macapp/icon.png --out "build/icon.iconset/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns build/icon.iconset -o build/icon.icns

# 3. app bundle
rm -rf "dist/Tonverk Generator" "dist/Tonverk Generator.app"
"$PY" -m PyInstaller --noconfirm --clean --distpath dist --workpath build/pyinstaller macapp/TonverkGenerator.spec

APP="dist/Tonverk Generator.app"
# ad-hoc signature (required to run on Apple Silicon; not a Developer ID signature)
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"

# 4. self test of the packaged app (no window)
"$APP/Contents/MacOS/Tonverk Generator" --selftest

# 5. disk image with a link to /Applications
DMG="dist/TonverkGenerator-${VERSION}-${ARCH}.dmg"
rm -rf build/dmg "$DMG" && mkdir -p build/dmg
cp -R "$APP" build/dmg/
ln -s /Applications build/dmg/Applications
hdiutil create -volname "Tonverk Generator" -srcfolder build/dmg -ov -format UDZO "$DMG" >/dev/null
echo "Creato: $APP"
echo "Creato: $DMG"
