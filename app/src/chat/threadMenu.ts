import type { MenuEntry } from "../components/ContextMenu";
import { t } from "../i18n";
import type { Chat } from "./useChat";
import { copyText } from "./useThread";

/** What you can do with a saved thread, from either sidebar. Deleting asks once more in a submenu. */
export function threadMenu(chat: Chat, id: string, title: string, onRename: () => void, onOpen: () => void): readonly MenuEntry[] {
  return [
    { kind: "action", label: t("threadMenu.open"), icon: "thread", run: onOpen },
    { kind: "action", label: t("threadMenu.rename"), icon: "rename", run: onRename },
    { kind: "action", label: t("threadMenu.copyTitle"), icon: "copy", run: () => copyText(title) },
    { kind: "separator" },
    { kind: "action", label: t("threadMenu.newChat"), icon: "new", run: chat.thread.reset },
    { kind: "separator" },
    {
      kind: "submenu",
      label: t("threadMenu.delete"),
      icon: "close",
      items: [{
        kind: "action",
        label: t("threadMenu.deleteForGood", { title }),
        run: () => chat.deleteChats([id]),
      }],
    },
  ];
}
