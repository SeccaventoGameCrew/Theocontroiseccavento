# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for "Tonverk Generator.app". Build with macapp/build.sh.
import os

from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs, collect_submodules

ROOT = os.path.abspath(os.path.join(SPECPATH, ".."))
VERSION = os.environ.get("TVGEN_VERSION", "0.2.0")
ICON = os.path.join(ROOT, "build", "icon.icns")
ARCH = os.environ.get("TVGEN_ARCH") or None

a = Analysis(
    [os.path.join(SPECPATH, "launcher.py")],
    pathex=[ROOT],
    binaries=collect_dynamic_libs("rocksdict"),
    datas=[(os.path.join(ROOT, "tvgen", "web", "index.html"), "tvgen/web")] + collect_data_files("certifi"),
    hiddenimports=collect_submodules("tvgen") + collect_submodules("rocksdict") + ["anthropic"],
    excludes=["tkinter", "pytest", "PIL", "numpy", "yaml"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz, a.scripts, [],
    exclude_binaries=True,
    name="Tonverk Generator",
    console=False,
    argv_emulation=False,
    target_arch=ARCH,
    codesign_identity=None,
)
coll = COLLECT(exe, a.binaries, a.datas, name="Tonverk Generator")
app = BUNDLE(
    coll,
    name="Tonverk Generator.app",
    icon=ICON if os.path.exists(ICON) else None,
    bundle_identifier="io.github.seccaventogamecrew.tonverk-generator",
    version=VERSION,
    info_plist={
        "CFBundleDisplayName": "Tonverk Generator",
        "CFBundleShortVersionString": VERSION,
        "CFBundleVersion": VERSION,
        "LSMinimumSystemVersion": "11.0",
        "LSApplicationCategoryType": "public.app-category.music",
        "NSHighResolutionCapable": True,
        "NSRequiresAquaSystemAppearance": False,
        "NSHumanReadableCopyright": "Progetto indipendente, non affiliato con Elektron.",
        # the interface is served by a local server on 127.0.0.1
        "NSAppTransportSecurity": {"NSAllowsLocalNetworking": True},
    },
)
