/** Keep DSH's versioned directory projection at the adapter boundary. */
import type { SessionRow } from './host.ts';

export function withDshCurrentCwd(row: SessionRow): SessionRow {
  const values = row.projections?.values;
  if (!values || !Object.hasOwn(values, 'workingDirectory')) return row;
  const value = values.workingDirectory;
  // Presence matters: null means the original directory; absent means a legacy
  // host. Keep malformed-present data distinguishable so only the selected
  // source fails closed, rather than rejecting an unrelated session's row.
  return { ...row, currentCwd: typeof value === 'string' || value === null ? value : undefined };
}
