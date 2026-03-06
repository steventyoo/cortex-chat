// Universal Job Cost Report Parser
// Detects and parses CSV/text exports from Sage, QuickBooks, Foundation, and generic formats
// Returns normalized job cost line items for Cortex intelligence engine

export interface ParsedJobCostReport {
  format: 'sage' | 'quickbooks' | 'foundation' | 'generic';
  projectInfo: {
    jobNumber: string | null;
    projectName: string | null;
    company: string | null;
    reportDate: string | null;
    period: string | null;
  };
  summary: {
    totalBudget: number;
    totalActual: number;
    totalChangeOrders: number;
    totalVariance: number;
    percentComplete: number | null;
  };
  lineItems: ParsedLineItem[];
  rawText: string;
  warnings: string[];
}

export interface ParsedLineItem {
  costCode: string;
  category: string; // L=Labor, M=Material, S=Sub, E=Equipment, O=Other
  description: string;
  originalBudget: number;
  revisedBudget: number;
  changeOrders: number;
  jobToDate: number;
  percentOfBudget: number | null;
  overUnder: number; // positive = over budget, negative = under
}

// ─── Format Detection ───────────────────────────────────────────

interface FormatSignature {
  format: 'sage' | 'quickbooks' | 'foundation';
  score: number;
}

function detectFormat(text: string): FormatSignature {
  const lower = text.toLowerCase();
  const scores: FormatSignature[] = [
    { format: 'sage', score: 0 },
    { format: 'quickbooks', score: 0 },
    { format: 'foundation', score: 0 },
  ];

  // Sage indicators
  if (/sage\s*\d{3}/i.test(text)) scores[0].score += 3;
  if (/job\s*(cost\s*)?report/i.test(text)) scores[0].score += 3;
  if (/item\s*#.*description.*revised\s*budget/i.test(text)) scores[0].score += 3;
  if (/categories:\s*elmos/i.test(text)) scores[0].score += 2;
  if (/item\s*list:/i.test(text)) scores[0].score += 2;
  if (/\d+\.\d{2}-/m.test(text)) scores[0].score += 1; // Sage uses trailing minus for negative

  // QuickBooks indicators
  if (/profit\s*&?\s*loss\s*by\s*job/i.test(text)) scores[1].score += 3;
  if (/job\s*profitability/i.test(text)) scores[1].score += 3;
  if (/total\s+income/i.test(lower)) scores[1].score += 2;
  if (/cost\s*of\s*goods\s*sold/i.test(lower)) scores[1].score += 2;
  if (/quickbooks/i.test(text)) scores[1].score += 2;

  // Foundation indicators
  if (/job\s*cost\s*detail/i.test(text)) scores[2].score += 3;
  if (/committed\s*cost/i.test(text)) scores[2].score += 2;
  if (/est\s*cost\s*at\s*completion/i.test(text)) scores[2].score += 2;
  if (/foundation/i.test(text)) scores[2].score += 2;
  if (/wbs/i.test(text)) scores[2].score += 1;

  scores.sort((a, b) => b.score - a.score);
  return scores[0];
}

// ─── Number Parsing ─────────────────────────────────────────────

function parseNumber(str: string): number {
  if (!str || str.trim() === '') return 0;
  let cleaned = str.trim();

  // Sage uses trailing minus for negative: "4,724.00-"
  if (cleaned.endsWith('-')) {
    cleaned = '-' + cleaned.slice(0, -1);
  }

  // Remove currency symbols, commas, spaces
  cleaned = cleaned.replace(/[$,\s]/g, '');

  // Handle parentheses for negative: (1,234.56)
  if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
    cleaned = '-' + cleaned.slice(1, -1);
  }

  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

// ─── Sage Parser ────────────────────────────────────────────────

function parseSage(text: string): ParsedJobCostReport {
  const lines = text.split('\n').map((l) => l.trim());
  const warnings: string[] = [];
  const lineItems: ParsedLineItem[] = [];

  // Extract project info from header
  let jobNumber: string | null = null;
  let projectName: string | null = null;
  let company: string | null = null;
  let reportDate: string | null = null;
  let period: string | null = null;

  for (const line of lines.slice(0, 15)) {
    // Date line: "MAR 03,2026 OWP, LLC Page: 1 of 1"
    const dateMatch = line.match(/^([A-Z]{3}\s+\d{1,2},\s*\d{4})\s+(.+?)\s+Page:/i);
    if (dateMatch) {
      reportDate = dateMatch[1];
      company = dateMatch[2];
    }

    // Period: "for period ending MAR 2026, Categories: ELMOS"
    const periodMatch = line.match(/for\s+period\s+ending\s+([A-Z]{3}\s+\d{4})/i);
    if (periodMatch) period = periodMatch[1];

    // Job Number: "Job Number: 2103" or "Job: 2103 COMPASS NORTHGATE M2"
    const jobMatch = line.match(/Job\s*(?:Number)?:\s*(\S+)/i);
    if (jobMatch) {
      jobNumber = jobMatch[1];
      // If the rest of the line has a project name: "Job: 2103 COMPASS NORTHGATE M2"
      const afterJob = line.substring(line.indexOf(jobMatch[1]) + jobMatch[1].length).trim();
      if (afterJob && !projectName) projectName = afterJob;
    }

    // Description (project name): "Description: Compass Northgate M2"
    const descMatch = line.match(/Description:\s*(.+)/i);
    if (descMatch) projectName = descMatch[1].trim();

    // Company: "Company: ONE WAY PLUMBING LLC"
    const companyMatch = line.match(/Company:\s*(.+)/i);
    if (companyMatch && !company) company = companyMatch[1].trim();

    // Period: "Period: 01/01/2025 - 02/28/2025"
    const periodMatch2 = line.match(/Period:\s*(.+)/i);
    if (periodMatch2 && !period) period = periodMatch2[1].trim();
  }

  // Find the header line to determine column positions
  // "Item # C Description Revised Budget Change Orders Job-to-Date Quantity % Bud Over/Under"
  const headerIdx = lines.findIndex((l) =>
    /item\s*#/i.test(l) && /description/i.test(l) && /budget/i.test(l)
  );

  if (headerIdx === -1) {
    warnings.push('Could not find column header row in Sage report');
    return buildResult('sage', { jobNumber, projectName, company, reportDate, period }, lineItems, text, warnings);
  }

  // Parse data lines after header
  // Each line: "100 Supervision 16,210.00 11,486.00 1,000.00 167.00 70 4,724.00-"
  // Format: costCode [category] description ...numbers...
  // We parse by detecting cost code at start, then extracting numbers from the end

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];

    // Stop at summary/separator lines
    if (/^={3,}/.test(line) || /^-{3,}/.test(line)) break;
    if (/^cost\s/i.test(line) || /^revenue/i.test(line)) break;
    if (!line || line.length < 10) continue;

    // Match: costCode description numbers...
    // Cost code formats: "100", "01-100", "01-100 L", "100 L"
    const match = line.match(/^(\d{2,4}(?:-\d{2,4})?)\s+(.+)/);
    if (!match) continue;

    const costCode = match[1];
    let rest = match[2];

    // Check for explicit category letter right after cost code: "L", "M", "S", "E", "O"
    let explicitCategory: string | null = null;
    const catMatch = rest.match(/^([LMSEO])\s+/);
    if (catMatch) {
      explicitCategory = catMatch[1];
      rest = rest.substring(catMatch[0].length);
    }

    // Extract all numbers from the rest (they come after the description)
    // Numbers look like: 16,210.00 or 4,724.00- or 0.00
    const numberPattern = /[\d,]+\.\d{2}-?/g;
    const numbers: number[] = [];
    let numberMatch;
    let firstNumberPos = rest.length;

    // Reset and find all numbers
    const tempNumbers: { value: number; index: number }[] = [];
    while ((numberMatch = numberPattern.exec(rest)) !== null) {
      tempNumbers.push({ value: parseNumber(numberMatch[0]), index: numberMatch.index });
    }

    if (tempNumbers.length >= 3) {
      firstNumberPos = tempNumbers[0].index;
      for (const tn of tempNumbers) numbers.push(tn.value);
    } else {
      continue; // Not enough numeric data
    }

    // Description is everything before the first number
    const description = rest.substring(0, firstNumberPos).trim();

    // Determine category: use explicit letter if present, else infer from code ranges
    let category = explicitCategory || 'O';
    if (!explicitCategory) {
      const codeNum = parseInt(costCode.replace(/-/g, ''));
      if (codeNum >= 100 && codeNum < 200) category = 'L';
      else if (codeNum >= 200 && codeNum < 300) category = 'M';
      else if (codeNum >= 300 && codeNum < 400) category = 'E';
      else if (codeNum >= 600 && codeNum < 700) category = 'S';
    }

    // Sage column order varies by export configuration.
    // Header says: Budget, COs, JTD, Qty, %Bud, Over/Under
    // Some exports reorder to: Budget, JTD, COs, Qty, %Bud, Over/Under
    // The regex skips %Bud (whole number) and sometimes Qty (also whole number)
    // We auto-detect using: Over/Under ≈ JTD - Budget
    let revisedBudget = 0, changeOrders = 0, jobToDate = 0, pctBud: number | null = null, overUnder = 0;

    if (numbers.length >= 5) {
      // 5 numbers: Budget, ?, ?, Qty, Over/Under
      revisedBudget = numbers[0];
      overUnder = numbers[numbers.length - 1];

      // Try both column orders and pick the one where JTD - Budget ≈ Over/Under
      const option1JTD = numbers[1]; // Order: Budget, JTD, COs, ...
      const option2JTD = numbers[2]; // Order: Budget, COs, JTD, ...

      if (Math.abs((option1JTD - revisedBudget) - overUnder) < Math.abs((option2JTD - revisedBudget) - overUnder)) {
        jobToDate = numbers[1];
        changeOrders = numbers[2];
      } else {
        changeOrders = numbers[1];
        jobToDate = numbers[2];
      }
    } else if (numbers.length >= 4) {
      revisedBudget = numbers[0];
      overUnder = numbers[3];

      const option1JTD = numbers[1];
      const option2JTD = numbers[2];

      if (Math.abs((option1JTD - revisedBudget) - overUnder) < Math.abs((option2JTD - revisedBudget) - overUnder)) {
        jobToDate = numbers[1];
        changeOrders = numbers[2];
      } else {
        changeOrders = numbers[1];
        jobToDate = numbers[2];
      }
    } else if (numbers.length >= 3) {
      revisedBudget = numbers[0];
      jobToDate = numbers[1];
      overUnder = numbers[2];
    }

    // Compute %Bud from data
    pctBud = revisedBudget > 0 ? Math.round((jobToDate / revisedBudget) * 100) : null;

    // Sage Over/Under: negative means under budget (good), but displayed as positive with trailing minus
    // Our convention: positive = over budget, negative = under budget
    // The parser already handles trailing minus, so overUnder should be correct

    lineItems.push({
      costCode,
      category,
      description,
      originalBudget: revisedBudget - changeOrders,
      revisedBudget,
      changeOrders,
      jobToDate,
      percentOfBudget: pctBud,
      overUnder,
    });
  }

  return buildResult('sage', { jobNumber, projectName, company, reportDate, period }, lineItems, text, warnings);
}

// ─── Generic CSV Parser ─────────────────────────────────────────

function parseGenericCSV(text: string): ParsedJobCostReport {
  const warnings: string[] = [];
  const lineItems: ParsedLineItem[] = [];

  // Split into lines and find header
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  // Try to detect CSV delimiter
  const firstLines = lines.slice(0, 5).join('\n');
  const commaCount = (firstLines.match(/,/g) || []).length;
  const tabCount = (firstLines.match(/\t/g) || []).length;
  const delimiter = tabCount > commaCount ? '\t' : ',';

  // Find header row by looking for common column names
  const headerKeywords = ['cost code', 'item', 'description', 'budget', 'actual', 'variance', 'job to date', 'jtd'];
  let headerIdx = -1;
  let headers: string[] = [];

  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    const cells = parseCsvLine(lines[i], delimiter);
    const lower = cells.map((c) => c.toLowerCase());
    const matchCount = headerKeywords.filter((kw) => lower.some((c) => c.includes(kw))).length;
    if (matchCount >= 2) {
      headerIdx = i;
      headers = cells.map((c) => c.trim());
      break;
    }
  }

  if (headerIdx === -1) {
    warnings.push('Could not detect header row in CSV. Expected columns like: Cost Code, Description, Budget, Actual');
    return buildResult('generic', { jobNumber: null, projectName: null, company: null, reportDate: null, period: null }, lineItems, text, warnings);
  }

  // Map column indices
  const colMap = mapColumns(headers);

  // Parse data rows
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i], delimiter);
    if (cells.length < 3) continue;

    const costCode = colMap.costCode >= 0 ? cells[colMap.costCode]?.trim() : '';
    const description = colMap.description >= 0 ? cells[colMap.description]?.trim() : '';

    if (!costCode && !description) continue;
    if (/^(total|subtotal|grand)/i.test(costCode) || /^(total|subtotal|grand)/i.test(description)) continue;

    const revisedBudget = colMap.revisedBudget >= 0 ? parseNumber(cells[colMap.revisedBudget]) : 0;
    const originalBudget = colMap.originalBudget >= 0 ? parseNumber(cells[colMap.originalBudget]) : revisedBudget;
    const changeOrders = colMap.changeOrders >= 0 ? parseNumber(cells[colMap.changeOrders]) : 0;
    const jobToDate = colMap.actual >= 0 ? parseNumber(cells[colMap.actual]) : 0;
    const overUnder = colMap.variance >= 0 ? parseNumber(cells[colMap.variance]) : jobToDate - revisedBudget;
    const pctBud = colMap.percentBudget >= 0 ? parseNumber(cells[colMap.percentBudget]) : null;
    const category = colMap.category >= 0 ? cells[colMap.category]?.trim() || 'O' : 'O';

    lineItems.push({
      costCode: costCode || `ROW-${i}`,
      category: category.charAt(0).toUpperCase(),
      description: description || 'Unknown',
      originalBudget,
      revisedBudget: revisedBudget || originalBudget + changeOrders,
      changeOrders,
      jobToDate,
      percentOfBudget: pctBud,
      overUnder,
    });
  }

  return buildResult('generic', { jobNumber: null, projectName: null, company: null, reportDate: null, period: null }, lineItems, text, warnings);
}

// ─── Column Mapping ─────────────────────────────────────────────

interface ColumnMap {
  costCode: number;
  category: number;
  description: number;
  originalBudget: number;
  revisedBudget: number;
  changeOrders: number;
  actual: number;
  percentBudget: number;
  variance: number;
}

function mapColumns(headers: string[]): ColumnMap {
  const map: ColumnMap = {
    costCode: -1,
    category: -1,
    description: -1,
    originalBudget: -1,
    revisedBudget: -1,
    changeOrders: -1,
    actual: -1,
    percentBudget: -1,
    variance: -1,
  };

  headers.forEach((h, i) => {
    const lower = h.toLowerCase();
    if (/cost\s*code|item\s*#|item\s*code|code/i.test(lower) && map.costCode === -1) map.costCode = i;
    else if (/^c$|category|type|phase/i.test(lower) && map.category === -1) map.category = i;
    else if (/description|name|desc/i.test(lower) && map.description === -1) map.description = i;
    else if (/original\s*budget|orig.*budget/i.test(lower)) map.originalBudget = i;
    else if (/revised\s*budget|budget|budgeted/i.test(lower)) map.revisedBudget = i;
    else if (/change\s*order|co\s*amount|adjustment/i.test(lower)) map.changeOrders = i;
    else if (/job.to.date|jtd|actual|spent|cost\s*to\s*date/i.test(lower)) map.actual = i;
    else if (/%\s*bud|percent|pct/i.test(lower)) map.percentBudget = i;
    else if (/over.*under|variance|var|diff/i.test(lower)) map.variance = i;
  });

  return map;
}

// ─── CSV Line Parser ────────────────────────────────────────────

function parseCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}

// ─── Result Builder ─────────────────────────────────────────────

function buildResult(
  format: ParsedJobCostReport['format'],
  info: ParsedJobCostReport['projectInfo'],
  lineItems: ParsedLineItem[],
  rawText: string,
  warnings: string[]
): ParsedJobCostReport {
  const totalBudget = lineItems.reduce((s, li) => s + li.revisedBudget, 0);
  const totalActual = lineItems.reduce((s, li) => s + li.jobToDate, 0);
  const totalCOs = lineItems.reduce((s, li) => s + li.changeOrders, 0);
  const totalVariance = lineItems.reduce((s, li) => s + li.overUnder, 0);
  const pctComplete = totalBudget > 0 ? Math.round((totalActual / totalBudget) * 100) : null;

  if (lineItems.length === 0) {
    warnings.push('No line items were parsed from the report');
  }

  return {
    format,
    projectInfo: info,
    summary: {
      totalBudget,
      totalActual,
      totalChangeOrders: totalCOs,
      totalVariance,
      percentComplete: pctComplete,
    },
    lineItems,
    rawText,
    warnings,
  };
}

// ─── File Fingerprint ───────────────────────────────────────────

export function computeFingerprint(text: string): string {
  // Simple hash of normalized content (trim whitespace, lowercase)
  const normalized = text.replace(/\s+/g, ' ').trim().toLowerCase();
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return 'fp_' + Math.abs(hash).toString(36);
}

// ─── Main Parse Function ────────────────────────────────────────

export function parseJobCostReport(text: string): ParsedJobCostReport {
  if (!text || text.trim().length === 0) {
    return buildResult('generic', { jobNumber: null, projectName: null, company: null, reportDate: null, period: null }, [], text, ['Empty input']);
  }

  const detected = detectFormat(text);

  // Use format-specific parser if confidence is high enough
  if (detected.format === 'sage' && detected.score >= 3) {
    return parseSage(text);
  }

  // QuickBooks and Foundation use generic CSV parser with format tagging
  if (detected.format === 'quickbooks' && detected.score >= 3) {
    const result = parseGenericCSV(text);
    result.format = 'quickbooks';
    return result;
  }

  if (detected.format === 'foundation' && detected.score >= 3) {
    const result = parseGenericCSV(text);
    result.format = 'foundation';
    return result;
  }

  // Fallback: try Sage first (most common in construction), then generic
  const sageAttempt = parseSage(text);
  if (sageAttempt.lineItems.length > 0) {
    return sageAttempt;
  }

  return parseGenericCSV(text);
}
