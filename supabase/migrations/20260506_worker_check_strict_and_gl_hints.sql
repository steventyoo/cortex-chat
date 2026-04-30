-- Fix worker_amount_components check (strict with null guard)
-- Fix actual_amount definition contradiction, add regular_amount completeness hints.
-- Applied live via MCP; this file is for version control reference.

-- 1. worker_amount_components: strict equality but skip workers with no component data
UPDATE consistency_checks
SET expression = '(() => { const reg = ctx.current.regular_amount || 0; const ot = ctx.current.overtime_amount || 0; const dt = ctx.current.doubletime_amount || 0; const total = ctx.current.actual_amount || 0; if (total === 0) return { pass: true, message: "No total amount" }; if (reg === 0 && ot === 0 && dt === 0) return { pass: true, message: "No component amounts extracted" }; const sum = reg + ot + dt; const delta = Math.abs(sum - total); return { pass: delta <= 0.01, expected: total, actual: rd(sum, 2), delta, message: delta <= 0.01 ? "Components sum to total" : ctx.current.name + ": components=" + sum.toFixed(2) + " vs total=" + total.toFixed(2) }; })()',
    classification = 'extraction_error',
    display_name = 'Worker Amount Components (reg+ot+dt == actual)'
WHERE skill_id = 'job_cost_report' AND check_name = 'worker_amount_components';

-- 2. Fix actual_amount definition: for labor codes it equals reg+ot (not burdened)
-- 3. Add regular_amount completeness section
-- 4. Add GL/AP self-healing verification guidance
-- (All applied as text replacements + appends to extraction_hints via MCP)
