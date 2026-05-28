export function dedupeBySid<T extends { sid: string }>(entries: T[]): T[] {
  const deduped = new Map<string, T>();
  for (const entry of entries) {
    deduped.set(entry.sid, entry);
  }
  return Array.from(deduped.values());
}

export function sortByTimestampThenSid<T extends { sid: string }>(entries: T[], getTimestamp: (entry: T) => string | undefined): T[] {
  return entries.sort((left, right) => {
    const leftTimestamp = getTimestamp(left);
    const rightTimestamp = getTimestamp(right);
    const leftTime = leftTimestamp ? new Date(leftTimestamp).getTime() : Number.NEGATIVE_INFINITY;
    const rightTime = rightTimestamp ? new Date(rightTimestamp).getTime() : Number.NEGATIVE_INFINITY;
    if (rightTime !== leftTime) {
      return rightTime - leftTime;
    }
    return right.sid.localeCompare(left.sid);
  });
}