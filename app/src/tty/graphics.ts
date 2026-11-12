export type Transport = "kitty-file" | "kitty-inline" | "iterm";

export type Box = { readonly columns: number; readonly rows: number };

const CHUNK = 4096;

/** Kitty's file transport is local only and wants this marker in a temporary file's name before it deletes it. */
export const KITTY_TEMP_MARKER = "tty-graphics-protocol";

export function pickTransport(env: NodeJS.ProcessEnv): Transport {
  if (env.TERM_PROGRAM === "iTerm.app") return "iterm";
  if (env.SSH_CONNECTION || env.SSH_TTY) return "kitty-inline";
  return "kitty-file";
}

function kittyHeader(id: number, box: Box): string {
  return `a=T,f=100,i=${id},q=2,C=1,c=${box.columns},r=${box.rows}`;
}

/** Draws a PNG over the box from the top-left cell, then drops the previous frame so nothing flickers. */
export function placeFrame(transport: Transport, png: Uint8Array, path: string, id: number, previous: number | null, box: Box): string {
  const home = "\x1b[1;1H";
  const drop = previous === null || transport === "iterm" ? "" : deleteImage(previous);
  switch (transport) {
    case "kitty-file":
      return `${home}\x1b_G${kittyHeader(id, box)},t=t;${Buffer.from(path).toString("base64")}\x1b\\${drop}`;
    case "kitty-inline": {
      const data = Buffer.from(png).toString("base64");
      let out = home;
      for (let offset = 0; offset < data.length; offset += CHUNK) {
        const more = offset + CHUNK < data.length ? 1 : 0;
        const header = offset === 0 ? `${kittyHeader(id, box)},` : "";
        out += `\x1b_G${header}m=${more};${data.slice(offset, offset + CHUNK)}\x1b\\`;
      }
      return out + drop;
    }
    case "iterm":
      return `${home}\x1b]1337;File=inline=1;width=${box.columns};height=${box.rows};preserveAspectRatio=0:${Buffer.from(png).toString("base64")}\x07`;
  }
}

export function deleteImage(id: number): string {
  return `\x1b_Ga=d,d=I,i=${id},q=2;\x1b\\`;
}
