import type { TargetAgent } from "../lib/types.js";

export interface ApplicationResult<T> {
  ok: boolean;
  warnings: string[];
  errors: string[];
  skipped: string[];
  targetAgent: TargetAgent;
  value?: T;
}
