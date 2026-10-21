import { render } from "@gpuix/react";

import { adoptLoginShell } from "./agents/detect";
import { App } from "./App";
import { Fonts } from "./components/Fonts";
import { startAppBridge } from "./bridge/live";
import { adoptLanguage } from "./i18n";
import { dispatchShortcut } from "./lib/shortcuts";
import { prepareTarget, type Target } from "./engine/target";
import { adoptToolchain } from "./engine/toolchain";
import { startTelemetry } from "./lib/telemetry";
import { startUpdates } from "./lib/update";
import { currentSettings } from "./settings/store";

await adoptLoginShell();
adoptLanguage(currentSettings().language);
adoptToolchain();
startAppBridge();
startUpdates();
startTelemetry();

const initialPath = process.argv[2];
const initial: Target | null = initialPath ? prepareTarget(initialPath) : null;
const { transparency, frost } = currentSettings();

render(<Fonts><App initial={initial} /></Fonts>, {
  title: "Eleven",
  appName: "Eleven",
  appId: "eleven",
  width: 1440,
  height: 900,
  minWidth: 960,
  minHeight: 640,
  titlebarTransparent: true,
  windowBackground: transparency === 0 && frost === 0 ? "opaque" : "blurred",
  trafficLightX: 18,
  trafficLightY: 18,
  onKeyDown: dispatchShortcut,
});
