import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE, isAdminRole } from '@/lib/auth-v2';
import { parseFileBuffer } from '@/lib/file-parser';
import Anthropic from '@anthropic-ai/sdk';

/**
 * POST /api/skills/generate
 *
 * Upload a sample document and have Claude analyze it to propose:
 * - Document type name (displayName + skillId)
 * - Field definitions with types, tiers, descriptions
 * - Classifier hints (description + keywords)
 *
 * The operator reviews the proposal and creates the skill.
 */
export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await validateUserSession(token || '');
  if (!session || !isAdminRole(session.role)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get('file') as File | null;

  if (!file) {
    return Response.json({ error: 'No file provided' }, { status: 400 });
  }

  // Parse document text
  let sourceText: string;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await parseFileBuffer(buffer, file.type, file.name);
    sourceText = result.text;
  } catch (err) {
    return Response.json({
      error: `Failed to parse file: ${err instanceof Error ? err.message : 'unknown'}`,
    }, { status: 400 });
  }

  // Truncate for the prompt
  const textForAnalysis = sourceText.slice(0, 15000);

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const tool: Anthropic.Tool = {
    name: 'propose_skill',
    description: 'Propose a document skill schema based on analyzing a sample document',
    input_schema: {
      type: 'object' as const,
      properties: {
        displayName: {
          type: 'string',
          description: 'Human-readable name for this document type (e.g. "Purchase Order", "Lien Waiver")',
        },
        skillId: {
          type: 'string',
          description: 'Machine-readable snake_case ID (e.g. "purchase_order", "lien_waiver")',
        },
        description: {
          type: 'string',
          description: 'One-paragraph description of what this document type is and when it appears in construction',
        },
        keywords: {
          type: 'array',
          items: { type: 'string' },
          description: 'Keywords that help classify this document type (5-10 keywords)',
        },
        fieldDefinitions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Field name in Title Case' },
              type: { type: 'string', enum: ['string', 'number', 'date', 'enum', 'boolean', 'array'] },
              tier: { type: 'number', enum: [1, 2, 3], description: '1=auto-extract, 2=verify, 3=human-only' },
              required: { type: 'boolean' },
              description: { type: 'string', description: 'What this field contains and how to find it' },
            },
            required: ['name', 'type', 'tier', 'required', 'description'],
          },
          description: 'All extractable fields from this document type',
        },
      },
      required: ['displayName', 'skillId', 'description', 'keywords', 'fieldDefinitions'],
    },
  };

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: `You are a construction document analysis expert. Given a sample document, you analyze its structure and content to propose a comprehensive extraction schema.

Rules:
- Identify the document type precisely (e.g. "Subcontract Agreement" not just "Contract")
- Extract ALL meaningful fields — parties, dates, amounts, identifiers, terms, conditions
- Set tier=1 for fields that are clearly stated and machine-readable
- Set tier=2 for fields that need verification (ambiguous or multiple candidates)
- Set tier=3 for fields that typically require human judgment
- Use appropriate types: "date" for dates, "number" for amounts/quantities, "enum" for fields with known options
- Field names should be descriptive Title Case (e.g. "Contract Value", "Execution Date")
- Descriptions should tell the AI exactly where/how to find each field`,
      messages: [{ role: 'user', content: `Analyze this construction document and propose a complete extraction schema.\n\n--- DOCUMENT TEXT ---\n${textForAnalysis}\n--- END ---` }],
      tools: [tool],
      tool_choice: { type: 'tool', name: 'propose_skill' },
    });

    const toolBlock = response.content.find(b => b.type === 'tool_use');
    if (!toolBlock || toolBlock.type !== 'tool_use') {
      throw new Error('No tool_use response from Claude');
    }

    const proposal = toolBlock.input as {
      displayName: string;
      skillId: string;
      description: string;
      keywords: string[];
      fieldDefinitions: Array<{
        name: string;
        type: string;
        tier: number;
        required: boolean;
        description: string;
      }>;
    };

    return Response.json({
      displayName: proposal.displayName,
      skillId: proposal.skillId,
      description: proposal.description,
      keywords: proposal.keywords,
      fieldDefinitions: proposal.fieldDefinitions,
      sourceTextPreview: sourceText.slice(0, 2000),
    });
  } catch (err) {
    console.error('[skills/generate] Claude analysis failed:', err);
    return Response.json({
      error: `Analysis failed: ${err instanceof Error ? err.message : 'unknown'}`,
    }, { status: 500 });
  }
}
