import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import {
  EXTRACTION_SYSTEM_PROMPT,
  buildExtractionPrompt,
  generatePipelineId,
  computeOverallConfidence,
  ExtractionResult,
  ValidationFlag,
  DOCUMENT_TYPE_FIELDS,
} from '@/lib/pipeline';

const BASE_URL = 'https://api.airtable.com/v0';

function getHeaders() {
  return {
    Authorization: `Bearer ${process.env.AIRTABLE_PAT}`,
    'Content-Type': 'application/json',
  };
}

function getBaseId() {
  return process.env.AIRTABLE_BASE_ID || '';
}

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  // 1. Auth check
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !(await validateUserSession(token))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2. Parse request
  let sourceText: string;
  let projectId: string;
  let fileName: string;
  let fileUrl: string | null;

  try {
    const body = await request.json();
    sourceText = body.sourceText;
    projectId = body.projectId || '';
    fileName = body.fileName || 'Untitled Document';
    fileUrl = body.fileUrl || null;

    if (!sourceText || sourceText.trim().length === 0) {
      return Response.json({ error: 'sourceText is required' }, { status: 400 });
    }
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const pipelineId = generatePipelineId();
  const now = new Date().toISOString();

  // 3. Create initial pipeline record in Airtable (status: tier1_extracting)
  try {
    await fetch(`${BASE_URL}/${getBaseId()}/PIPELINE_LOG`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        records: [{
          fields: {
            'Pipeline ID': pipelineId,
            'Project ID': projectId,
            'File Name': fileName,
            'File URL': fileUrl || undefined,
            'Status': 'tier1_extracting',
            'Source Text': sourceText.substring(0, 99000), // Airtable text limit
            'Created At': now,
            'AI Model': 'claude-sonnet-4-20250514',
          },
        }],
      }),
    });
  } catch (err) {
    console.error('Failed to create pipeline record:', err);
  }

  // 4. Tier 1: AI Extraction using Claude
  let extraction: ExtractionResult;
  let recordId: string | null = null;

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const extractionPrompt = buildExtractionPrompt(sourceText, projectId || undefined);

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      system: EXTRACTION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: extractionPrompt }],
    });

    // Parse Claude's response
    const responseText = response.content
      .filter((block) => block.type === 'text')
      .map((block) => {
        if (block.type === 'text') return block.text;
        return '';
      })
      .join('');

    // Try to extract JSON from the response
    let jsonStr = responseText.trim();
    // Handle if Claude wraps in markdown code block
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    extraction = JSON.parse(jsonStr) as ExtractionResult;
  } catch (err) {
    console.error('AI extraction failed:', err);

    // Update pipeline record to show failure
    const records = await fetch(
      `${BASE_URL}/${getBaseId()}/PIPELINE_LOG?filterByFormula=${encodeURIComponent(`{Pipeline ID}='${pipelineId}'`)}`,
      { headers: getHeaders() }
    );
    const data = await records.json();
    if (data.records?.[0]) {
      await fetch(`${BASE_URL}/${getBaseId()}/PIPELINE_LOG/${data.records[0].id}`, {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify({
          fields: { 'Status': 'intake', 'Validation Flags': JSON.stringify([{
            field: 'extraction',
            issue: `AI extraction failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
            severity: 'error',
          }]) },
        }),
      });
    }

    return Response.json(
      { error: 'AI extraction failed', pipelineId },
      { status: 500 }
    );
  }

  // 5. Compute confidence and update record
  const overallConfidence = computeOverallConfidence(extraction);

  // 6. Tier 2: Validation
  const flags: ValidationFlag[] = [];

  // Check for low-confidence fields
  for (const [fieldName, fieldData] of Object.entries(extraction.fields)) {
    if (fieldData.value !== null && fieldData.confidence < 0.7) {
      flags.push({
        field: fieldName,
        issue: `Low confidence (${Math.round(fieldData.confidence * 100)}%)`,
        severity: 'warning',
      });
    }
    if (fieldData.value === null) {
      // Check if it's a required field for this doc type
      const expectedFields = DOCUMENT_TYPE_FIELDS[extraction.documentType] || [];
      if (expectedFields.includes(fieldName)) {
        flags.push({
          field: fieldName,
          issue: 'Missing — not detected in document',
          severity: 'info',
        });
      }
    }
  }

  // Check document type confidence
  if (extraction.documentTypeConfidence < 0.8) {
    flags.push({
      field: 'Document Type',
      issue: `Document type classification has low confidence (${Math.round(extraction.documentTypeConfidence * 100)}%)`,
      severity: 'warning',
    });
  }

  // Determine final status
  const hasErrors = flags.some((f) => f.severity === 'error');
  const hasWarnings = flags.some((f) => f.severity === 'warning');
  const autoApproveEligible = overallConfidence >= 0.95 && !hasErrors && !hasWarnings;
  const finalStatus = autoApproveEligible ? 'tier2_validated' : hasErrors ? 'tier2_flagged' : 'pending_review';

  // 7. Update the pipeline record with results
  try {
    // Find the record we created
    const findRes = await fetch(
      `${BASE_URL}/${getBaseId()}/PIPELINE_LOG?filterByFormula=${encodeURIComponent(`{Pipeline ID}='${pipelineId}'`)}`,
      { headers: getHeaders() }
    );
    const findData = await findRes.json();
    recordId = findData.records?.[0]?.id;

    if (recordId) {
      await fetch(`${BASE_URL}/${getBaseId()}/PIPELINE_LOG/${recordId}`, {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify({
          fields: {
            'Document Type': extraction.documentType,
            'Status': finalStatus,
            'Overall Confidence': overallConfidence,
            'Extracted Data': JSON.stringify(extraction),
            'Validation Flags': flags.length > 0 ? JSON.stringify(flags) : undefined,
            'Tier1 Completed At': new Date().toISOString(),
            'Tier2 Completed At': new Date().toISOString(),
          },
        }),
      });
    }
  } catch (err) {
    console.error('Failed to update pipeline record:', err);
  }

  // 8. Return the result
  return Response.json({
    pipelineId,
    recordId,
    status: finalStatus,
    extraction,
    overallConfidence,
    flags,
    autoApproveEligible,
  });
}
