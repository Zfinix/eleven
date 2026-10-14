import { render } from "@gpuix/react";

import { adoptLoginShell } from "./agents/detect";
import { App } from "./App";
import { Fonts } from "./components/Fonts";
import { startAppBridge } from "./bridge/live";
import { dispatchShortcut } from "./lib/shortcuts";
import { prepareTarget, type Target } from "./engine/target";
import { adoptToolchain } from "./engine/toolchain";
import { startTelemetry } from "./lib/telemetry";
import { startUpdates } from "./lib/update";

await adoptLoginShell();
adoptToolchain();
startAppBridge();
startUpdates();
startTelemetry();

const initialPath = process.argv[2];
const initial: Target | null = initialPath ? prepareTarget(initialPath) : null;

render(<Fonts><App initial={initial} /></Fonts>, {
  title: "Eleven",
  appName: "Eleven",
  width: 1440,
  height: 900,
  minWidth: 960,
  minHeight: 640,
  titlebarTransparent: true,
  windowBackground: "blurred",
  trafficLightX: 18,
  trafficLightY: 18,
  onKeyDown: dispatchShortcut,
});
