-- Replace dedup-based validation with reconciliation-based validation.
-- The document's own totals are the source of truth — sum(PR txns) + burden = PR by Source.
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

-- 3. Add a new doc-level check: sum(all PR txns) + burden_codes_JTD = PR_by_source
INSERT INTO consistency_checks (skill_id, check_name, display_name, description, tier, classification, scope, expression, tolerance_abs, affected_fields, hint_template) VALUES
('job_cost_report', 'pr_source_reconciliation',
 'PR Source Reconciliation',
 'Sum of all individual PR transactions + burden code JTD must equal the PR by Source total from Job Totals. This is the master reconciliation identity.',
 1, 'extraction_error', 'doc',
 '(() => {
  const txns = ctx.collections.payroll_transactions || [];
  const codes = ctx.collections.cost_code || [];
  const prBySource = ctx.doc.pr_amount || ctx.doc.extracted_pr_amount || 0;
  if (prBySource === 0 || txns.length === 0) return { pass: true, message: "No PR data to reconcile" };

  const txnSum = txns.reduce((s, t) => s + (t.actual_amount || 0), 0);

  let burdenTotal = 0;
  for (const cc of codes) {
    const c = parseInt(String(cc.cost_code || 0));
    if (c === 995 || c === 998) burdenTotal += (cc.jtd_cost || 0);
  }

  const computed = Math.round((txnSum + burdenTotal) * 100) / 100;
  const expected = Math.round(prBySource * 100) / 100;
  const delta = Math.abs(computed - expected);

  return {
    pass: delta <= 0.50,
    expected: expected,
    actual: computed,
    delta: delta,
    message: delta <= 0.50
      ? "PR reconciles: txns($" + txnSum.toFixed(2) + ") + burden($" + burdenTotal.toFixed(2) + ") = $" + computed.toFixed(2)
      : "PR mismatch: txns($" + txnSum.toFixed(2) + ") + burden($" + burdenTotal.toFixed(2) + ") = $" + computed.toFixed(2) + " vs pr_source=$" + expected.toFixed(2)
  };
})()',
 0.50, '{pr_amount,actual_amount,jtd_cost}',
 'Re-read the Job Totals by Source PR amount. Computed PR = sum(individual PR txns) + burden codes.')
ON CONFLICT (skill_id, check_name) DO NOTHING;
