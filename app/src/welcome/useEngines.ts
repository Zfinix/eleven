import { useEffect, useState } from "react";

import { adoptToolchain } from "../engine/toolchain";
import { t } from "../i18n";
import { currentSettings, saveSettings } from "../settings/store";
import { pickPath } from "../settings/system";
import { currentInstalls, detectEngine, type EngineId, type Found, type Install, startInstall, subscribeInstalls } from "./engines";

export type Engines = {
  readonly found: Readonly<Record<EngineId, Found | null>>;
  readonly installs: Readonly<Record<EngineId, Install>>;
  readonly install: (id: EngineId) => void;
  readonly locate: (id: EngineId) => void;
};

type FoundAll = Readonly<Record<EngineId, Found | null>>;

function detectAll(): FoundAll {
  return { rizin: detectEngine("rizin"), ghidra: detectEngine("ghidra"), java: detectEngine("java") };
}

const PLACES = {
  rizin: { kind: "file", prompt: "setup.locate.rizin", key: "rizinPath" },
  ghidra: { kind: "folder", prompt: "setup.locate.ghidra", key: "ghidraDir" },
  java: { kind: "folder", prompt: "setup.locate.java", key: "javaHome" },
} as const;

/** Detection on this Mac plus the live state of installs, which keep running when the screen changes. */
export function useEngines(): Engines {
  const [found, setFound] = useState<FoundAll>(detectAll);
  const [installs, setInstalls] = useState(currentInstalls);

  useEffect(() => {
    let before = currentInstalls();
    return subscribeInstalls(() => {
      const now = currentInstalls();
      setInstalls(now);
      if (Object.values(before).some((install) => install.phase === "running")) setFound(detectAll());
      before = now;
    });
  }, []);

  const locate = async (id: EngineId): Promise<void> => {
    const place = PLACES[id];
    const path = await pickPath(place.kind, t(place.prompt));
    if (!path) return;
    saveSettings({ ...currentSettings(), [place.key]: path });
    adoptToolchain();
    setFound(detectAll());
  };

  return { found, installs, install: (id) => void startInstall(id), locate: (id) => void locate(id) };
}
