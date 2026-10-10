/** Keep DSH's versioned directory projection at the adapter boundary. */
import type { SessionRow } from './host.ts';
export declare function withDshCurrentCwd(row: SessionRow): SessionRow;
