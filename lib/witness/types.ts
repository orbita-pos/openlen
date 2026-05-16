// Re-export witness types from the orchestrator types module so witness/* has a
// stable import path even if we later split orchestrator schemas across files.
export type { WitnessRecord, RoutingDecision } from "@/lib/orchestrator/types";
export { WitnessRecordSchema, RoutingDecisionSchema } from "@/lib/orchestrator/types";
