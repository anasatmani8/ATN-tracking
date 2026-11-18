/** Current instant in UTC ms. Used from event handlers; timers read persisted timestamps instead. */
export const nowMs = (): number => Date.now();
