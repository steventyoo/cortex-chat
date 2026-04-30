-- Replace dedup-based validation with reconciliation-based validation.
-- The document's own totals are the source of truth — sum(PR txns) = PR by Source.
-- No deduplication is needed; instead we validate per-cost-code sums against JTD totals.

-- 1. Reclassify negative PR transaction amounts as document_anomaly (legitimate reversals)
UPDATE consistency_checks
SET classification = 'document_anomaly',
    description = 'Negative PR transaction amounts are typically payroll reversals (void-and-reissue). Flag for review but do not treat as extraction error.',
    display_name = 'PR Transaction Amount Negative (Reversal)'
WHERE skill_id = 'job_cost_report' AND check_name = 'pr_txn_amounts_positive';

-- 2. Replace the dedup check with a per-cost-code PR amount reconciliation check.
--    Instead of guessing which transactions are duplicates, we sum all transactions
--    per cost code and compare against the cost code's JTD total. If they match,
--    every transaction is correct — no dedup needed.
UPDATE consistency_checks
SET check_name = 'pr_per_code_amount_reconciliation',
    display_name = 'PR Per-Code Amount = JTD Cost',
    description = 'For each labor cost code, sum of PR transaction amounts must equal the cost code JTD total. This validates transaction completeness without deduplication.',
    tier = 2,
    classification = 'extraction_error',
    scope = 'doc',
    expression = '(() => {
  const txns = ctx.collections.payroll_transactions || [];
  const codes = ctx.collections.cost_code || [];
  if (txns.length === 0 || codes.length === 0) return { pass: true, message: "No data" };

  const txnSumByCode = {};
  for (const t of txns) {
    const code = String(t.cost_code || "");
    if (!code) continue;
    txnSumByCode[code] = (txnSumByCode[code] || 0) + (t.actual_amount || 0);
  }

  const laborCodes = codes.filter(r => {
    const c = parseInt(String(r.cost_code || 0));
    return (c >= 100 && c <= 199) || c === 11;
  });

  let matched = 0;
  const mismatches = [];
  for (const cc of laborCodes) {
    const code = String(cc.cost_code);
    const jtd = Math.round((cc.jtd_cost || 0) * 100) / 100;
    const txnSum = Math.round((txnSumByCode[code] || 0) * 100) / 100;
    if (Math.abs(txnSum - jtd) < 0.01) {
      matched++;
    } else {
      mismatches.push(code + ": txn=$" + txnSum.toFixed(2) + " vs jtd=$" + jtd.toFixed(2));
    }
  }

  const pass = mismatches.length === 0;
  return {
    pass,
    expected: laborCodes.length + " codes matched",
    actual: matched + "/" + laborCodes.length + " matched",
    delta: mismatches.length,
    message: pass
      ? "All " + laborCodes.length + " labor codes reconcile to the penny"
      : mismatches.length + " labor code mismatches: " + mismatches.slice(0, 5).join("; ")
  };
})()',
    tolerance_abs = 0.01,
    affected_fields = '{jtd_cost,actual_amount}',
    hint_template = NULL
WHERE skill_id = 'job_cost_report' AND check_name = 'worker_dedup';

-- 3. Add a new doc-level check: sum(all PR-source txns) = PR by Source total
--    Since we now extract individual burden/tax lines (995/998), the sum of all PR
--    transactions directly equals the PR by Source amount.
INSERT INTO consistency_checks (skill_id, check_name, display_name, description, tier, classification, scope, expression, tolerance_abs, affected_fields, hint_template) VALUES
('job_cost_report', 'pr_source_reconciliation',
 'PR Source Reconciliation',
 'Sum of all PR-source transactions must equal the PR by Source total from Job Totals. This is the master reconciliation identity.',
 1, 'extraction_error', 'doc',
 '(() => {
  const txns = ctx.collections.payroll_transactions || [];
  const prBySource = ctx.doc.pr_amount || ctx.doc.extracted_pr_amount || 0;
  if (prBySource === 0 || txns.length === 0) return { pass: true, message: "No PR data to reconcile" };

  const prTxns = txns.filter(t => String(t.source || "").toUpperCase() === "PR");
  const txnSum = Math.round(prTxns.reduce((s, t) => s + (t.actual_amount || 0), 0) * 100) / 100;
  const expected = Math.round(prBySource * 100) / 100;
  const delta = Math.abs(txnSum - expected);

  return {
    pass: delta <= 1.00,
    expected: expected,
    actual: txnSum,
    delta: delta,
    message: delta <= 1.00
      ? "PR reconciles: sum(PR txns)=$" + txnSum.toFixed(2) + " = pr_source=$" + expected.toFixed(2)
      : "PR mismatch: sum(PR txns)=$" + txnSum.toFixed(2) + " vs pr_source=$" + expected.toFixed(2) + " (gap=$" + delta.toFixed(2) + ")"
  };
})()',
 1.00, '{pr_amount,actual_amount}',
 'Re-read the Job Totals by Source PR amount. Sum of all PR-source transactions must equal it.')
ON CONFLICT (skill_id, check_name) DO NOTHING;

-- 4. Simplify pr_amount derived field: now just sum(PR txns) since burden lines are extracted individually
UPDATE derived_fields
SET formula = 'SUM(actual_amount) WHERE source = PR from payroll_transactions',
    expression = 'safe(() => { const txns = ctx.collections.payroll_transactions || []; return rd(txns.filter(t => String(t.source || "").toUpperCase() === "PR").reduce((s, t) => s + (t.actual_amount || 0), 0), 2); })'
WHERE primary_skill_id = 'job_cost_report' AND canonical_name = 'pr_amount';

-- 5. Update aggregate_workers filter to exclude burden/tax/revenue codes (>= 900)
UPDATE skill_pipeline_ops
SET config = jsonb_set(config, '{filter}', '[{"field": "source", "operator": "==", "value": "PR"}, {"field": "cost_code", "operator": "<", "value": 900}]'::jsonb)
WHERE skill_id = 'job_cost_report' AND op_name = 'aggregate_workers';
