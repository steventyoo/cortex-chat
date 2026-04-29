/**
 * Canonical ExportRow interface — single source of truth.
 * Used by both server (skill-pipeline, derived-evaluator, project-profile)
 * and client (JcrAnalysisPanel, tab components, pivotRows).
 */
export interface ExportRow {
  id?: string;
  skill_id: string;
  tab: string;
  section: string;
  record_key: string;
  field: string;
  canonical_name: string;
  display_name: string;
  data_type: 'currency' | 'number' | 'string' | 'percent' | 'integer' | 'ratio' | 'date';
  status: 'Extracted' | 'Derived' | 'Cross-Ref';
  value_text: string | null;
  value_number: number | null;
  notes: string | null;
}
