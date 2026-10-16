/** Keep prepared rows when a section or folder closes, until its inventory changes. */
export function lazyRows<Row>(build: () => readonly Row[]): () => readonly Row[] {
  let prepare: (() => readonly Row[]) | undefined = build;
  let rows: readonly Row[] = [];

  return (): readonly Row[] => {
    if (prepare) {
      rows = prepare();
      prepare = undefined;
    }
    return rows;
  };
}
