import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import { getSupabase } from '@/lib/supabase';
import {
  EXTRACTION_SYSTEM_PROMPT,
  buildExtractionPrompt,
  generatePipelineId,
  computeOverallConfidence,
  ExtractionResult,
  ValidationFlag,
  DOCUMENT_TYPE_FIELDS,
} from '@/lib/pipeline';

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
  const sb = getSupabase();

  // 3. Create initial pipeline record (status: tier1_extracting)
  let recordId: string | null = null;
  try {
    const { data } = await sb.from('pipeline_log').insert({
      pipeline_id: pipelineId,
      project_id: projectId,
      file_name: fileName,
      file_url: fileUrl || null,
      status: 'tier1_extracting',
      source_text: sourceText.substring(0, 500000),
      created_at: now,
      ai_model: 'claude-sonnet-4-20250514',
    }).select('id').single();
    if (data) recordId = String(data.id);
  } catch (err) {
    console.error('Failed to create pipeline record:', err);
  }

  // 4. Tier 1: AI Extraction using Claude
  let extraction: ExtractionResult;

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
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    extraction = JSON.parse(jsonStr) as ExtractionResult;
  } catch (err) {
    console.error('AI extraction failed:', err);

    // Update pipeline record to show failure
    if (recordId) {
      await sb.from('pipeline_log').update({
        status: 'intake',
        validation_flags: [{
          field: 'extraction',
          issue: `AI extraction failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
          severity: 'error',
        }],
      }).eq('id', recordId);
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

  for (const [fieldName, fieldData] of Object.entries(extraction.fields)) {
    if (fieldData.value !== null && fieldData.confidence < 0.7) {
      flags.push({
        field: fieldName,
        issue: `Low confidence (${Math.round(fieldData.confidence * 100)}%)`,
        severity: 'warning',
      });
    }
    if (fieldData.value === null) {
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
  if (recordId) {
    try {
      await sb.from('pipeline_log').update({
        document_type: extraction.documentType,
        status: finalStatus,
        overall_confidence: overallConfidence,
        extracted_data: extraction,
        validation_flags: flags.length > 0 ? flags : null,
        tier1_completed_at: new Date().toISOString(),
        tier2_completed_at: new Date().toISOString(),
      }).eq('id', recordId);
    } catch (err) {
      console.error('Failed to update pipeline record:', err);
    }
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
