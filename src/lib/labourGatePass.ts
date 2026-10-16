// Worker gate pass (LGP-…) helpers kept for the labour pages that read the
// half-day marks. Everything else lives in personGatePass.ts, shared with the
// staff gate pass (SGP-…).

import { WORKER_PASS, ppDb, usePersonPassHalfDays } from "@/lib/personGatePass";

export { WORKER_PASS } from "@/lib/personGatePass";

/** Untyped client for the gate pass tables (not in the generated types). */
export const lgpDb = ppDb;

/** Worker half-day gate pass marks between two dates (yyyy-MM-dd), keyed "employeeId|date". */
export const useGatePassHalfDays = (start: string, end: string) => usePersonPassHalfDays(WORKER_PASS, start, end);
