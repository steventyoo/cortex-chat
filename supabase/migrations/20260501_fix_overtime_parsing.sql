-- Fix: Overtime amount parsing bug in cached parser
-- The active cached parser (f4e429d7) was extracting overtime HOURS but always
-- setting overtime_amount = 0 and assigning the full actual_amount to regular_amount.
-- This is because the regex only captured hours, not the dollar amount that follows.
--
-- Changes applied:
-- 1. Deactivated the buggy cached parser so the agent regenerates a correct one
-- 2. Updated extraction_hints to include explicit regex patterns showing how to
--    capture BOTH hours AND dollar amounts from "Regular: N hours AMOUNT" and
--    "Overtime: N hours AMOUNT" lines, with a "COMMON BUG" warning

-- Deactivate buggy parser
UPDATE parser_cache
SET is_active = false
WHERE id = 'f4e429d7-8dd0-4e87-bffd-19d123ddea6b';

-- The extraction_hints update was applied directly to document_skills.extraction_hints
-- for skill_id = 'job_cost_report'. Key additions:
--
-- 1. Explicit multi-line PR transaction format documentation:
--    Line 1 (header):  PR <ref#> <MM/DD/YY> <emp_code> <Worker Name>
--    Line 2 (detail):  <actual_amount> Ck #: <check#><MM/DD/YY> Regular: <N> hours <REGULAR_AMOUNT>
--    Line 3 (optional): Overtime: <N> hours <OVERTIME_AMOUNT>
--
-- 2. Explicit regex patterns:
--    reg_match = re.search(r"Regular:\s+(\d+\.?\d*)\s+hours\s+([\d,]+\.\d{2}-?)", detail_text)
--    ot_match = re.search(r"Overtime:\s+(\d+\.?\d*)\s+hours\s+([\d,]+\.\d{2}-?)", next_line_text)
--
-- 3. COMMON BUG warning:
--    "Do NOT just capture hours and then assign regular_amount = actual_amount"
--    "If overtime_amount is always 0 while overtime_hours > 0, your regex is broken"
