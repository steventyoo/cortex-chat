import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { listCachedParsers, toggleParserActive } from '@/lib/stores/parser-cache.store';
import { ParserCacheSchema } from '@/lib/schemas/parser-cache.schema';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const skillId = searchParams.get('skill_id') || undefined;

  try {
    const raw = await listCachedParsers(skillId);
    const parsers = z.array(ParserCacheSchema).parse(raw);
    return NextResponse.json({ parsers });
  } catch (err) {
    console.error('[api/parser-cache] GET failed:', err);
    return NextResponse.json({ error: 'Failed to load parsers' }, { status: 500 });
  }
}

const PatchInput = z.object({
  id: z.string().uuid(),
  is_active: z.boolean(),
});

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = PatchInput.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    await toggleParserActive(parsed.data.id, parsed.data.is_active);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[api/parser-cache] PATCH failed:', err);
    return NextResponse.json({ error: 'Failed to update parser' }, { status: 500 });
  }
}
