/** Builds the rows on the first call and hands back the same rows after that. */
export function lazyRows<Row>(build: () => readonly Row[]): () => readonly Row[] {
  let rows: readonly Row[] | undefined;
  return (): readonly Row[] => {
    rows ??= build();
    return rows;
  };
}
