# Installing AIOS Desktop

## Windows

1. Download the latest `AIOS Desktop Setup x.y.z.exe` from the [Releases page](https://github.com/satyaprakashmallidi/AIOS_Desktop/releases/latest).
2. Double-click the installer. **You will see a Microsoft Defender SmartScreen warning** — *"Windows protected your PC"*. This is expected for new apps that haven't yet been signed with a code-signing certificate.
3. In the SmartScreen dialog, click **More info**, then click **Run anyway**.
4. Follow the wizard. The default install location is fine for most users.
5. After install, AIOS Desktop is in your Start Menu and on your Desktop.

### About the SmartScreen warning

Microsoft shows that warning on every Windows app it hasn't seen installed by many other users yet. We haven't signed our installer with a paid code-signing certificate, so each release starts fresh in SmartScreen's eyes. The warning is **not** because AIOS Desktop is unsafe — you can confirm the file is the one we published by checking the SHA-256 hash in the release notes.

If you'd rather not see the warning, you can [submit the file to Microsoft Defender for analysis](https://www.microsoft.com/en-us/wdsi/filesubmission). It's free and helps build reputation for future downloaders.

### First launch

The first time you open AIOS Desktop after install, it sets up your workspace (creates the SQLite database, copies the starter kit). This takes a few seconds. You'll see a loading spinner during this — the app is ready as soon as the spinner clears.

If the splash sits for more than ~15 seconds, click **Retry** to reload. Worst case, restart the app.

### Prerequisites

AIOS Desktop needs **Claude Code CLI** installed separately (`npm install -g @anthropic-ai/claude-code`). The onboarding flow walks you through this if Claude isn't detected. Python is **not** required — we bundle a self-contained Python sidecar inside the app.

## macOS

1. Download the `AIOS Desktop-x.y.z-universal.dmg` from the [Releases page](https://github.com/satyaprakashmallidi/AIOS_Desktop/releases/latest).
2. Open the DMG and drag **AIOS Desktop** into your Applications folder.
3. The first time you launch, macOS will say *"AIOS Desktop cannot be opened because the developer cannot be verified"*. **Right-click the app icon → Open**, then click **Open** in the dialog that appears.
4. From the second launch onward, double-clicking just works.

Same caveat as Windows: we haven't paid for Apple Developer ID signing yet. Right-click → Open is the macOS equivalent of "Run anyway".
