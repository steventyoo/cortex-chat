// Calendar Smart Command API — parse natural language into availability actions.
// POST: takes a command string + context (roster, dates), returns structured actions.

import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic();

const VALID_STATUSES = ['available', 'pto', 'holiday', 'sick', 'no_show', 'leave'];

export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { command, roster, dates } = body;
    // roster: [{ id, workerName, role }]
    // dates: string[] (YYYY-MM-DD)

    if (!command?.trim()) {
      return Response.json({ error: 'command required' }, { status: 400 });
    }

    const rosterList = (roster || []).map((r: { id: string; workerName: string; role: string }) =>
      `${r.workerName} (${r.role}, id: ${r.id})`
    ).join('\n');

    const prompt = `You are a scheduling assistant for a construction crew calendar. Parse the user's command and return a JSON array of status changes.

CREW ROSTER:
${rosterList}

VISIBLE DATES: ${dates.join(', ')}
TODAY: ${new Date().toISOString().split('T')[0]}

VALID STATUSES: ${VALID_STATUSES.join(', ')}
- "available" = working (default, clears any override)
- "pto" = paid time off
- "holiday" = company/public holiday
- "sick" = sick day
- "no_show" = didn't show up
- "leave" = unpaid leave / other leave

USER COMMAND: "${command}"

Return ONLY a JSON object with this exact format, no other text:
{
  "actions": [
    { "rosterId": "<crew member id>", "date": "YYYY-MM-DD", "status": "<status>" }
  ],
  "summary": "<brief human-readable summary of what was done>"
}

Rules:
- Match crew by name, role, or group (e.g. "all foremen", "everyone", "laborers")
- "off" / "taking off" / "not available" = "pto" unless specified otherwise
- "sick" = "sick"
- "holiday" = "holiday"
- "clear" / "reset" / "back to work" = "available"
- "this week" = all visible dates. "Monday" = the Monday in the visible dates. "next 3 days" = today + 2.
- If a date reference is ambiguous, use the closest match from visible dates.
- Only include actions for crew members and dates that exist in the provided data.`;

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text : '';

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return Response.json({ error: 'Could not parse AI response', raw: text }, { status: 500 });
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const actions = (parsed.actions || []).filter(
      (a: { rosterId: string; date: string; status: string }) =>
        a.rosterId && a.date && VALID_STATUSES.includes(a.status)
    );

    return Response.json({
      actions,
      summary: parsed.summary || `${actions.length} change(s)`,
    });
  } catch (err) {
    console.error('Calendar command error:', err);
    return Response.json(
      { error: 'Failed to process command', detail: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 }
    );
  }
}
