import type { MenuEntry } from "../components/ContextMenu";
import { tr, trN } from "../i18n";
import type { Chat } from "./useChat";
import { copyText } from "./useThread";

/** What you can do with a saved thread, from either sidebar. Deleting asks once more in a submenu. */
export function threadMenu(chat: Chat, id: string, title: string, onRename: () => void, onOpen: () => void): readonly MenuEntry[] {
  return [
    { kind: "action", label: tr("Open"), icon: "thread", run: onOpen },
    { kind: "action", label: tr("Rename"), icon: "rename", run: onRename },
    { kind: "action", label: tr("Copy title"), icon: "copy", run: () => copyText(title) },
    { kind: "separator" },
    { kind: "action", label: tr("New chat"), icon: "new", run: chat.thread.reset },
    { kind: "separator" },
    {
      kind: "submenu",
      label: tr("Delete"),
      icon: "close",
      items: [{
        kind: "action",
        label: trN('Delete "{title}" for good', { title }),
        run: () => chat.deleteChats([id]),
      }],
    },
  ];
}
