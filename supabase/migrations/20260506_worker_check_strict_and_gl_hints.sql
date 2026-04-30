-- Fix worker_amount_components check (revert ratio, keep strict with null guard)
-- and add GL self-healing hints to extraction_hints.
-- Applied live via MCP; this file is for version control reference.

-- 1. worker_amount_components: strict equality but skip workers with no component data
UPDATE consistency_checks
SET expression = '(() => { const reg = ctx.current.regular_amount || 0; const ot = ctx.current.overtime_amount || 0; const dt = ctx.current.doubletime_amount || 0; const total = ctx.current.actual_amount || 0; if (total === 0) return { pass: true, message: "No total amount" }; if (reg === 0 && ot === 0 && dt === 0) return { pass: true, message: "No component amounts extracted" }; const sum = reg + ot + dt; const delta = Math.abs(sum - total); return { pass: delta <= 0.01, expected: total, actual: rd(sum, 2), delta, message: delta <= 0.01 ? "Components sum to total" : ctx.current.name + ": components=" + sum.toFixed(2) + " vs total=" + total.toFixed(2) }; })()',
    classification = 'extraction_error',
    display_name = 'Worker Amount Components (reg+ot+dt == actual)'
WHERE skill_id = 'job_cost_report' AND check_name = 'worker_amount_components';

-- 2. Add GL/AP self-healing verification guidance to extraction_hints
UPDATE document_skills
SET extraction_hints = extraction_hints || E'\n\n**CRITICAL — GL/AP amount verification (self-healing):**\n- After initial parsing, compare your GL and AP sums against the "by Source: GL:" and "AP:" totals from "Job Totals by Source".\n- If there is a gap (even $1), identify which transactions have amount=0 or null — these are likely page-break casualties where header stripping did not fully resolve the split.\n- For each suspect transaction (amount=0 but the line clearly had an amount), use read_lines on the raw /tmp/source_text.txt around that line to find the correct amount nearby.\n- Common pattern: a transaction line has source/ref/description, then a standalone number appears on the next line (the amount that was separated by a page break).\n- GL transactions are the most susceptible because they often have short descriptions and amounts that look like standalone numbers after header removal.\n- IMPORTANT: If your sum is off by < $5000 total, the gap is usually just 3-5 transactions. Find and fix them rather than re-parsing everything.'
WHERE skill_id = 'job_cost_report';
