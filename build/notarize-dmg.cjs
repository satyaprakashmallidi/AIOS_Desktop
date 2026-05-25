// After electron-builder produces the .dmg, submit it to Apple's notarization
// service and staple the returned ticket to the .dmg file itself.
//
// Why: electron-builder notarizes the .app INSIDE the .dmg by default (which
// makes the app launch cleanly once dragged to /Applications). But the .dmg
// CONTAINER stays unsigned/unstapled — when a browser quarantines the
// downloaded .dmg, macOS Gatekeeper checks the .dmg first, sees no ticket,
// and shows "AIOS Desktop.app is damaged and can't be opened". This hook
// fixes that by notarizing + stapling the .dmg artifacts.
//
// Skipped on:
//   - Non-mac platforms (no .dmg to process)
//   - Missing notarize credentials (CI builds without secrets — won't notarize
//     anyway, no point trying)
//
// Runs against the .dmg files produced this build only.

const { execSync } = require("node:child_process");
const path = require("node:path");

module.exports = async function notarizeDmg(context) {
  const platforms = (context.platformToTargets && [...context.platformToTargets.keys()]) || [];
  const isMac = platforms.some((p) => p.name === "mac");
  if (!isMac) return;

  const appleId = process.env.APPLE_ID;
  const appPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;
  if (!appleId || !appPassword || !teamId) {
    console.log("[notarize-dmg] Skipping — APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID not all set");
    return;
  }

  const dmgs = (context.artifactPaths || []).filter((p) => p.endsWith(".dmg"));
  if (dmgs.length === 0) {
    console.log("[notarize-dmg] No .dmg artifacts to notarize");
    return;
  }

  for (const dmg of dmgs) {
    const name = path.basename(dmg);
    console.log(`[notarize-dmg] Submitting ${name} to Apple notary…`);
    try {
      execSync(
        `xcrun notarytool submit "${dmg}" --apple-id "${appleId}" --password "${appPassword}" --team-id "${teamId}" --wait`,
        { stdio: "inherit" }
      );
      console.log(`[notarize-dmg] Stapling ticket to ${name}…`);
      execSync(`xcrun stapler staple "${dmg}"`, { stdio: "inherit" });
      execSync(`xcrun stapler validate "${dmg}"`, { stdio: "inherit" });
      console.log(`[notarize-dmg] Done: ${name}`);
    } catch (err) {
      console.error(`[notarize-dmg] FAILED for ${name}:`, err.message);
      throw err;
    }
  }
};
