/**
 * Shared types for per-skill data accuracy evaluation labels.
 *
 * Each skill exports a SkillEvalLabels from src/lib/eval-labels/{skill_id}.ts.
 * The runner (scripts/run-data-evals.ts) dynamically imports the labels by skill id.
 */

export interface DerivedLabel {
  /** canonical_name in computed_export (record_key = "project") */
  field: string;
  /** Ground-truth numeric value */
  expected: number;
  /** Relative tolerance for comparison — default 0.05 (5%) */
  tolerance?: number;
  /** If the pipeline stores this under a different canonical_name, map it here */
  pipelineField?: string;
  /** Field cannot be computed yet — scores 0 until pipeline catches up */
  notYetComputable?: boolean;
}

export interface RecordLabel {
  /** Matches computed_export.record_key, e.g. "cost_code=120" or "worker=Spears, Gregory M" */
  recordKey: string;
  /** canonical_name in computed_export */
  field: string;
  /** Ground-truth numeric value */
  expected: number;
  /** Relative tolerance — default 0.05 (5%) */
  tolerance?: number;
}

export interface SkillEvalLabels {
  skillId: string;
  projectId: string;
  derivedLabels: DerivedLabel[];
  extractionLabels: RecordLabel[];
  langfuse: {
    derivedDataset: string;
    extractionDataset: string;
  };
}
