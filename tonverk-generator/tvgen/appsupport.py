"""Desktop integration: settings, API key in the macOS Keychain, Finder, SD card copy.

Everything here works on any OS for tests and the browser mode; the macOS-only parts
(Keychain, Finder) degrade gracefully elsewhere.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys

APP_NAME = "Tonverk Generator"
KEYCHAIN_SERVICE = "tonverk-generator"
KEYCHAIN_ACCOUNT = "anthropic-api-key"

IS_MAC = sys.platform == "darwin"


def support_dir() -> str:
    if IS_MAC:
        d = os.path.expanduser(f"~/Library/Application Support/{APP_NAME}")
    else:
        d = os.path.join(os.environ.get("XDG_CONFIG_HOME", os.path.expanduser("~/.config")), "tvgen")
    os.makedirs(d, exist_ok=True)
    return d


def default_output_dir() -> str:
    if IS_MAC:
        return os.path.expanduser(f"~/Music/{APP_NAME}")
    return os.path.abspath("output")


# ------------------------------------------------------------------ settings
def load_settings() -> dict:
    p = os.path.join(support_dir(), "settings.json")
    try:
        with open(p, encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def save_settings(update: dict) -> dict:
    allowed = {"template", "engine", "model", "effort", "quantize"}
    s = load_settings()
    s.update({k: v for k, v in update.items() if k in allowed})
    p = os.path.join(support_dir(), "settings.json")
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(s, f, indent=2, ensure_ascii=False)
    os.replace(tmp, p)
    return s


# ------------------------------------------------------------------ API key (Keychain)
def keychain_get() -> str | None:
    if not IS_MAC:
        return None
    r = subprocess.run(["security", "find-generic-password", "-s", KEYCHAIN_SERVICE,
                        "-a", KEYCHAIN_ACCOUNT, "-w"], capture_output=True, text=True)
    key = r.stdout.strip()
    return key if r.returncode == 0 and key else None


def keychain_set(key: str | None) -> bool:
    """Store (or delete, with an empty key) the API key. Returns True if stored."""
    if not IS_MAC:
        return False
    subprocess.run(["security", "delete-generic-password", "-s", KEYCHAIN_SERVICE,
                    "-a", KEYCHAIN_ACCOUNT], capture_output=True)
    if not key:
        return False
    r = subprocess.run(["security", "add-generic-password", "-U", "-s", KEYCHAIN_SERVICE,
                        "-a", KEYCHAIN_ACCOUNT, "-l", APP_NAME, "-w", key], capture_output=True)
    return r.returncode == 0


def apply_api_key(key: str | None):
    if key:
        os.environ["ANTHROPIC_API_KEY"] = key
    else:
        os.environ.pop("ANTHROPIC_API_KEY", None)


def masked(key: str | None) -> str:
    if not key:
        return ""
    return key[:7] + "…" + key[-4:] if len(key) > 14 else "…"


# ------------------------------------------------------------------ Finder
def reveal(path: str) -> bool:
    if not os.path.exists(path):
        return False
    if IS_MAC:
        subprocess.Popen(["open", "-R", path])
        return True
    return False


def open_path(path: str) -> bool:
    if not os.path.exists(path):
        return False
    if IS_MAC:
        subprocess.Popen(["open", path])
        return True
    return False


# ------------------------------------------------------------------ SD card
def copy_next_to_template(project_dir: str, template_dir: str) -> str:
    """Copy a generated project folder next to the template (e.g. on the SD card).

    Never overwrites: if a folder with the same name exists, a numbered name is used.
    """
    if not os.path.isdir(project_dir):
        raise FileNotFoundError(project_dir)
    if not os.path.isdir(template_dir):
        raise FileNotFoundError(f"template non trovato: {template_dir}")
    parent = os.path.dirname(os.path.abspath(template_dir.rstrip("/")))
    name = os.path.basename(project_dir.rstrip("/"))
    dest = os.path.join(parent, name)
    i = 2
    while os.path.exists(dest):
        dest = os.path.join(parent, f"{name}-{i}")
        i += 1
    shutil.copytree(project_dir, dest)
    return dest


def on_removable_volume(path: str) -> bool:
    p = os.path.abspath(path)
    return p.startswith("/Volumes/") or p.startswith("/media/") or p.startswith("/run/media/")
