import { NextRequest } from 'next/server';
import { validateToken, SESSION_COOKIE } from '@/lib/auth';
import { fetchProjectHealthData } from '@/lib/airtable';

export const maxDuration = 30;

export async function GET(request: NextRequest) {
  // Auth check
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !(await validateToken(token))) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const healthData = await fetchProjectHealthData();
    return new Response(JSON.stringify(healthData), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Project health error:', err);
    return new Response(
      JSON.stringify({ error: 'Failed to fetch project health data' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
