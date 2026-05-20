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

# pyautogui pulls a tree of Mac-only deps (pyobjc-framework-Cocoa,
# Quartz, AppKit, ApplicationServices, etc) that PyInstaller's static
# analyzer misses unless we collect the whole package transitively.
# Without this the packaged Mac binary errors at runtime with
# "No module named 'pyautogui'" or "No module named 'Quartz'".
pa_binaries = pa_datas = pa_hiddenimports = []
try:
    pa_datas, pa_binaries, pa_hiddenimports = collect_all('pyautogui')
except Exception:
    pass

# Same story for pyscreeze (pyautogui's screenshot helper) and mss
# (multi-monitor screen capture used by screen_capture). Both have native
# C extensions PyInstaller's analyzer can miss.
ps_binaries = ps_datas = ps_hiddenimports = []
try:
    ps_datas, ps_binaries, ps_hiddenimports = collect_all('pyscreeze')
except Exception:
    pass
mss_binaries = mss_datas = mss_hiddenimports = []
try:
    mss_datas, mss_binaries, mss_hiddenimports = collect_all('mss')
except Exception:
    pass
pil_binaries = pil_datas = pil_hiddenimports = []
try:
    pil_datas, pil_binaries, pil_hiddenimports = collect_all('PIL')
    # PIL/Pillow's AVIF plugin ships as a single-architecture binary on
    # Mac (arm64 wheels do NOT include an x86_64 slice). When PyInstaller
    # builds a universal2 sidecar, COLLECT errors out with
    # "_avif.cpython-*.so is not a fat binary!". We don't decode AVIF
    # anywhere in AIOS — strip it from the collected blobs entirely so
    # the universal2 build succeeds. Filter applies cross-platform; on
    # Windows there's no _avif.so so the filter is a no-op.
    def _strip_avif(items):
        return [pair for pair in items
                if '_avif' not in str(pair[0]).lower()
                and 'avifimageplugin' not in str(pair[0]).lower()]
    pil_binaries = _strip_avif(pil_binaries)
    pil_datas = _strip_avif(pil_datas)
    pil_hiddenimports = [m for m in pil_hiddenimports if 'avif' not in m.lower()]
except Exception:
    pass

# On Mac, explicitly collect pyobjc subframeworks that pyautogui touches.
# pyobjc is split into many sibling packages (Cocoa, Quartz, AppKit,
# CoreGraphics, ApplicationServices). Each must be collected individually
# — collect_all('pyobjc') doesn't recursively follow the framework tree.
pyobjc_datas = []
pyobjc_binaries = []
pyobjc_hiddenimports = []
if sys.platform == 'darwin':
    for framework in (
        'objc',
        'AppKit',
        'Foundation',
        'Quartz',
        'CoreFoundation',
        'CoreGraphics',
        'ApplicationServices',
        'PyObjCTools',
    ):
        try:
            d, b, h = collect_all(framework)
            pyobjc_datas.extend(d)
            pyobjc_binaries.extend(b)
            pyobjc_hiddenimports.extend(h)
        except Exception:
            pass

a = Analysis(
    [os.path.join(python_dir, 'host.py')],
    pathex=[python_dir],
    binaries=sr_binaries + pa_binaries + ps_binaries + mss_binaries + pil_binaries + pyobjc_binaries,
    datas=sr_datas + pa_datas + ps_datas + mss_datas + pil_datas + pyobjc_datas,
    hiddenimports=[
        'workspace',
        'agents',
        'tasks_store',
        'tasks_runner',
        'claude_runtime',
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
        # Voice control (v0.2.0+) — pyautogui drives screen capture + input.
        # Lazy-imported in voice_control_*; listed here so PyInstaller finds
        # the deps for the bundled binary.
        'pyautogui',
        'pyscreeze',
        'pymsgbox',
        'mouseinfo',
        'mss',
        'PIL',
        'PIL.Image',
        'PIL.PngImagePlugin',
        'PIL.ImageDraw',
        'PIL.ImageFont',
        *pa_hiddenimports,
        *ps_hiddenimports,
        *mss_hiddenimports,
        *pil_hiddenimports,
        # Mac pyobjc framework imports (auto-collected on darwin only).
        *pyobjc_hiddenimports,
        # Windows UIAutomation reader (v0.2.0-beta). Win-only — listing
        # these on Mac wastes bytes and triggers PyInstaller "module not
        # found" warnings since uiautomation/comtypes have no Mac wheel.
        *(['uiautomation', 'comtypes', 'comtypes.client', 'comtypes.gen']
          if sys.platform == 'win32' else []),
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
        'pytest',
        'unittest',
        # Pillow's AVIF plugin — single-arch on Mac wheels, breaks
        # universal2 COLLECT. We never decode AVIF in AIOS.
        'PIL.AvifImagePlugin',
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
