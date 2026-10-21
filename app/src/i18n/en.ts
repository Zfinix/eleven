/** Every interface message in English, the source each locale file in app/locales translates by id. */
export const en = {
  "device.mac": "this Mac",
  "device.computer": "this computer",

  "settings.language": "Language",
  "settings.language.desc": "The language menus and buttons speak.",
  "settings.language.auto": "Automatic",

  "kit.showDetails": "Show details",
  "kit.hideDetails": "Hide details",
  "kit.step": "Step {current} of {count}",
  "kit.skip": "Skip",
} as const;

export type MessageId = keyof typeof en;
