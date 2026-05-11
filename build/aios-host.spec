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
# Always build a universal2 sidecar on Mac so the same binary runs natively on
# both Apple Silicon and Intel without needing a separate Intel CI runner
# (macos-13 GitHub runners have brutal queue times). Allow env override for
# local debugging where you might want a single arch.
target_arch = os.environ.get('AIOS_PYINSTALLER_TARGET_ARCH')
if sys.platform != 'darwin':
    target_arch = None
elif target_arch not in ('arm64', 'x86_64', 'universal2'):
    target_arch = 'universal2'

block_cipher = None

from PyInstaller.utils.hooks import collect_all

# SpeechRecognition ships a bundled FLAC encoder binary plus a few support
# files that PyInstaller's static analyzer misses if we only import the
# module name. collect_all grabs the binaries + data files + submodules.
sr_binaries = sr_datas = sr_hiddenimports = []
try:
    sr_datas, sr_binaries, sr_hiddenimports = collect_all('speech_recognition')
except Exception:
    # Library not installed yet (e.g., running spec without `pip install -r
    # python/requirements.txt`). The runtime import in transcribe_audio
    # surfaces a clean "missing dependency" error in that case.
    pass

a = Analysis(
    [os.path.join(python_dir, 'host.py')],
    pathex=[python_dir],
    binaries=sr_binaries,
    datas=sr_datas,
    hiddenimports=[
        'workspace',
        'sqlite3',
        'json',
        'pathlib',
        'datetime',
        'uuid',
        'shutil',
        'platform',
        # Voice transcription (lazy-imported in workspace.transcribe_audio).
        'speech_recognition',
        *sr_hiddenimports,
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
    # On macOS release builds, CI sets this to match the electron-builder arch
    # so native sidecar bits line up with the app bundle.
    target_arch=target_arch,
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
