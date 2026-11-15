"""Persistent configuration (JSON file, readable only by the current user)."""
from __future__ import annotations

import copy
import json
import os
import sys
import threading
from pathlib import Path

DEFAULT_TARGETS = ["mensola 1", "mensola 2", "mensola 3", "tavolo", "salone"]

# Suggested screen zone for each target name; editable in the panel.
DEFAULT_ZONES = {
    "mensola 1": "alto_sx",
    "mensola 2": "alto_centro",
    "mensola 3": "alto_dx",
    "tavolo": "basso",
    "salone": "tutto",
}

DEFAULT_SETTINGS = {
    "fps": 10,                # TV reads per second
    "source": "processed",    # "processed" (what the TV LEDs show) or "measured" (raw screen colours)
    "brightness": 100,        # 0-100 %
    "smoothing": 0.35,        # 0 = immediate, 0.9 = very soft
    "saturation": 1.2,        # 1 = unchanged
    "dark_threshold": 8,      # below this level (0-255) a strip is considered "black"
    "off_when_dark": True,    # turn strips off on black scenes
    "off_when_tv_off": True,  # turn strips off when the TV disappears
    "autostart": True,        # start syncing when the app opens
}


def app_dir() -> Path:
    env = os.environ.get("AMBISYNC_HOME")
    if env:
        return Path(env)
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "AmbilightSync"
    return Path.home() / ".config" / "ambisync"


class Config:
    def __init__(self, path: str | Path | None = None):
        self.path = Path(path) if path else app_dir() / "config.json"
        self.lock = threading.RLock()
        self.data = self._load()

    @staticmethod
    def _defaults() -> dict:
        return {
            "tv": None,
            "lights": {},
            "targets": list(DEFAULT_TARGETS),
            "settings": dict(DEFAULT_SETTINGS),
            "hue_bridges": {},
            "tuya_devices": {},
        }

    def _load(self) -> dict:
        data = self._defaults()
        try:
            with open(self.path, encoding="utf-8") as f:
                stored = json.load(f)
        except FileNotFoundError:
            return data
        except (OSError, ValueError):
            try:
                os.replace(self.path, self.path.with_suffix(".corrotto.json"))
            except OSError:
                pass
            return data
        if not isinstance(stored, dict):
            return data
        for key in data:
            if key in stored and stored[key] is not None:
                data[key] = stored[key]
        data["settings"] = {**DEFAULT_SETTINGS, **(stored.get("settings") or {})}
        return data

    def save(self) -> None:
        with self.lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_name(self.path.name + ".tmp")
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(self.data, f, indent=2, ensure_ascii=False)
            os.replace(tmp, self.path)

    def snapshot(self) -> dict:
        with self.lock:
            return copy.deepcopy(self.data)

    # Convenience accessors -------------------------------------------------
    @property
    def settings(self) -> dict:
        return self.data["settings"]

    @property
    def lights(self) -> dict:
        return self.data["lights"]

    @property
    def targets(self) -> list:
        return self.data["targets"]

    @property
    def tv(self) -> dict | None:
        return self.data["tv"]

    @tv.setter
    def tv(self, value: dict | None) -> None:
        with self.lock:
            self.data["tv"] = value
            self.save()

    def update_settings(self, changes: dict) -> dict:
        with self.lock:
            s = self.data["settings"]
            for key, value in changes.items():
                if key not in DEFAULT_SETTINGS:
                    continue
                default = DEFAULT_SETTINGS[key]
                if isinstance(default, bool):
                    value = bool(value)
                elif isinstance(default, (int, float)):
                    value = type(default)(float(value)) if isinstance(default, float) else int(round(float(value)))
                elif isinstance(default, str):
                    value = str(value)
                s[key] = value
            s["fps"] = max(1, min(25, s["fps"]))
            s["brightness"] = max(0, min(100, s["brightness"]))
            s["smoothing"] = max(0.0, min(0.95, s["smoothing"]))
            s["saturation"] = max(0.0, min(2.5, s["saturation"]))
            s["dark_threshold"] = max(0, min(80, s["dark_threshold"]))
            if s["source"] not in ("processed", "measured"):
                s["source"] = "processed"
            self.save()
            return dict(s)
