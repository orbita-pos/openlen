/**
 * WHERE EACH VISUAL OF A TURN GOES IN LEN'S TEXT, on the chat's side (local spec
 * 2026-10-16-len-inline-visuals, §4.5).
 *
 * A `show_widget` call's point is the length of the text when its FIRST chunk
 * arrived (`widget_preview`); its card takes the oldest point still waiting, or
 * the text so far if it had no preview.
 */
export function createWidgetOffsets() {
  const starts = new Map<number, number>();
  const waiting: number[] = [];
  return {
    /** A chunk of call `callIndex` arrived with `textLength` characters written. */
    preview(callIndex: number, textLength: number): number {
      if (!starts.has(callIndex)) {
        starts.set(callIndex, textLength);
        waiting.push(textLength);
      }
      return starts.get(callIndex)!;
    },
    /** A `show_widget` card arrived with `textLength` characters written. Cards
     *  come after every chunk of their round, and `callIndex` starts again at 0
     *  in the next round: so the round's indices are forgotten here. */
    card(textLength: number): number {
      starts.clear();
      return waiting.shift() ?? textLength;
    },
  };
}
