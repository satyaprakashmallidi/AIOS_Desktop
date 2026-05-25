import { useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { invoke } from "../lib/api";

// Slim banner that announces "AIOS updated to vX.Y.Z" after auto-update lands
// the user on a new version. Compares the running version against the last
// version the user dismissed; banner shows until dismissed.
//
// Pairs with the existing AutoUpdateBanner (which prompts to install BEFORE
// update). This one closes the loop — the user RAN through an install and
// now sees a clear "what changed" pointer.

const SETTING_KEY = "last_seen_version";
const RELEASES_BASE = "https://github.com/everyai-com/AIOS_Desktop-releases/releases/tag";

export function WhatsNewBanner(): React.ReactElement | null {
  const [version, setVersion] = useState<string | null>(null);
  const [lastSeen, setLastSeen] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [v, res] = await Promise.all([
          window.aios?.getVersion?.().catch(() => ""),
          invoke<{ key: string; value: string | null }>("get_setting", { key: SETTING_KEY }),
        ]);
        if (cancelled) return;
        setVersion(v || null);
        const stored = res?.value ?? null;
        if (stored === null && v) {
          // Fresh install — silently seed last_seen_version so the banner
          // only fires on actual UPDATES, not on first launch.
          await invoke("set_setting", { key: SETTING_KEY, value: v }).catch(() => undefined);
          setLastSeen(v);
        } else {
          setLastSeen(stored);
        }
      } catch {
        /* swallow — banner is non-essential */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const isNew = version && lastSeen !== null && lastSeen !== version;
  if (!isNew || dismissed) return null;

  async function dismiss() {
    setDismissed(true);
    if (version) {
      await invoke("set_setting", { key: SETTING_KEY, value: version }).catch(() => undefined);
    }
  }

  function openReleaseNotes() {
    if (!version) return;
    void window.aios?.openExternal?.(`${RELEASES_BASE}/v${version}`);
    void dismiss();
  }

  return (
    <div className="aios-whatsnew-banner" data-testid="whats-new-banner">
      <span className="aios-whatsnew-icon" aria-hidden="true"><Sparkles size={13} /></span>
      <span className="aios-whatsnew-text">
        AIOS updated to <strong>v{version}</strong>
      </span>
      <button type="button" className="aios-whatsnew-link" onClick={openReleaseNotes}>
        See what's new
      </button>
      <button type="button" className="aios-whatsnew-close" onClick={dismiss} aria-label="Dismiss">
        <X size={12} />
      </button>
    </div>
  );
}
