-- Deactivate the jcr_self_check rules from reconciliation_rules.
-- These are replaced by pre-computed tie-outs in the jcr_export Reconciliation tab,
-- which correctly handles cost code 999 filtering, overhead exclusion, and category splits.

UPDATE reconciliation_rules
  SET is_active = false
  WHERE link_type_key = 'jcr_self_check';
