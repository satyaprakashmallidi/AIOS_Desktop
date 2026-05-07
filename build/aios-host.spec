# PyInstaller spec for the AIOS Python sidecar.
#
# Bundles host.py + workspace.py into a single binary. The COLLECT step
# below writes to ./dist/aios-host/ (PyInstaller's default dist path with
# COLLECT name='aios-host'). electron-builder picks that up via the
# extraResources entry and places it at:
#   macOS:   <app>/Contents/Resources/aios-host/
#   Windows: <app>/resources/aios-host/
#
# Build: pyinstaller --noconfirm --clean build/aios-host.spec
#   (run from the repo root)

# -*- mode: python ; coding: utf-8 -*-

import os
import sys

repo_root = os.path.abspath(os.path.join(os.path.dirname(SPEC), '..'))
python_dir = os.path.join(repo_root, 'python')

block_cipher = None

a = Analysis(
    [os.path.join(python_dir, 'host.py')],
    pathex=[python_dir],
    binaries=[],
    datas=[],
    hiddenimports=[
        # workspace.py and its dependencies — PyInstaller's static analysis
        # picks up direct imports, but a few stdlib modules can be missed
        # on minimal builds.
        'workspace',
        'sqlite3',
        'json',
        'pathlib',
        'datetime',
        'uuid',
        'shutil',
        'platform',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # Keep the binary lean — the sidecar doesn't need any of these.
        'tkinter',
        'matplotlib',
        'numpy',
        'pandas',
        'PIL',
        'pytest',
        'unittest',
    ],
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='aios-host',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,  # UPX can confuse antivirus / Gatekeeper; keep raw
    console=True,
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='aios-host',
)
