-- Remove overly prescriptive regex hints from extraction_hints
-- The agent should explore the PDF and figure out the format itself.
-- We keep only conceptual guidance (field semantics, verification rules, sign conventions)
-- and remove the specific regex patterns that were WRONG and caused a regression.
--
-- Also adds guidance for the agent to:
-- 1. Always print() intermediate results so it can debug
-- 2. Use the PDF itself as source of truth for format discovery

UPDATE document_skills
SET extraction_hints = E'## Job Cost Report (JCR) Extraction Guidance

### Field Semantics
- `actual_amount`: The total dollar amount for a transaction line
- `regular_amount`: The dollar portion attributable to regular hours (for PR labor lines only)
- `overtime_amount`: The dollar portion attributable to overtime hours (for PR labor lines only)
- For PR labor lines: `actual_amount = regular_amount + overtime_amount` (base wage components)
- `source`: The transaction source — one of PR (Payroll), AP (Accounts Payable), GL (General Ledger), AR (Accounts Receivable)

### Extraction Strategy
1. Start by reading 2-3 pages to understand the EXACT format of this specific document
2. Identify the transaction line structure by examining real examples (do NOT assume a format)
3. Look for dollar amounts — they may appear at the beginning or end of lines
4. Use print() statements to verify your parsing on a small sample before scaling up
5. After parsing all transactions, verify sums against the document''s own summary totals

### Verification Requirements (CRITICAL)
The document contains "Job Totals by Source" summary that shows PR, AP, GL, AR totals.
Your extracted transaction sums MUST match these totals exactly:
- SUM(actual_amount WHERE source=PR) must equal the PR total from "Job Totals by Source"
- SUM(actual_amount WHERE source=AP) must equal the AP total
- SUM(actual_amount WHERE source=GL) must equal the GL total
- SUM(actual_amount WHERE source=AR) must equal the AR total (if present)
If your sums don''t match, you have parsing errors — fix them before finalizing.

### Sign Conventions
- Store amounts with their original sign as shown in the document
- Negative amounts may appear with a trailing minus (1,234.56-) or in parentheses ((1,234.56))
- Do NOT flip signs — store exactly as parsed

### Page Header Handling
- Reports often have repeating page headers (date, time, report title, column labels, page numbers)
- These headers can split transaction data across page boundaries
- Strip all page headers from the full text BEFORE parsing to create a continuous data stream
- This is the #1 cause of missed amounts in multi-page reports

### Deduplication
- Each transaction should appear exactly once in the output
- Use a composite key (cost_code + source + date + reference + amount) to detect duplicates
- If you see duplicate counts, your parser is likely matching the same lines multiple times

### Cost Code Structure  
- All cost codes have individual transaction lines that must be extracted
- This includes burden codes (e.g. 995, 998) and revenue codes (e.g. 999)
- Every code that has a "Cost Code Totals" section has individual lines above it'
WHERE skill_id = 'job_cost_report';
