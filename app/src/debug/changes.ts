/** Values seen at this stop and the one before, so a step shows which registers and locals it changed. */
export class StepChanges {
  private stop = -1;
  private previous = new Map<string, string>();
  private current = new Map<string, string>();

  /** Whether the value at `path` differs from the stop just before; a stop that skipped one compares with nothing. */
  changed(stop: number, path: string, value: string): boolean {
    if (this.stop !== stop) {
      this.previous = this.stop === stop - 1 ? this.current : new Map();
      this.current = new Map();
      this.stop = stop;
    }
    this.current.set(path, value);
    const was = this.previous.get(path);
    return was !== undefined && was !== value;
  }
}
