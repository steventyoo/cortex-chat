import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { publishProcessJob, ProcessPayload } from '@/lib/qstash';

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const sb = getSupabase();
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

  const { data: stuck, error } = await sb
    .from('pipeline_log')
    .select('id, org_id, project_id, file_name, file_url, status, created_at')
    .in('status', ['processing', 'queued'])
    .lt('created_at', tenMinutesAgo)
    .limit(20);

  if (error) {
    console.error('[recover] Failed to query stuck records:', error.message);
    return Response.json({ error: 'Query failed' }, { status: 500 });
  }

  if (!stuck || stuck.length === 0) {
    return Response.json({ recovered: 0, message: 'No stuck records found' });
  }

  const baseUrl = getBaseUrl(request);
  let recovered = 0;
  const errors: string[] = [];

  for (const record of stuck) {
    const fileUrl = record.file_url as string | null;
    if (!fileUrl || !fileUrl.startsWith('storage://')) {
      await sb.from('pipeline_log').update({
        status: 'failed',
        validation_flags: [{ field: 'recovery', issue: 'No stored file found during recovery', severity: 'error' }],
      }).eq('id', record.id);
      continue;
    }

    const storagePath = fileUrl.replace('storage://', '');
    const fileName = record.file_name as string;
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    const mimeMap: Record<string, string> = {
      pdf: 'application/pdf',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      csv: 'text/csv',
      txt: 'text/plain',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
    };
    const mimeType = mimeMap[ext] || 'application/octet-stream';

    try {
      await sb.from('pipeline_log').update({ status: 'queued' }).eq('id', record.id);
      const payload: ProcessPayload = {
        recordId: String(record.id),
        orgId: record.org_id as string,
        projectId: (record.project_id as string) || null,
        fileName,
        mimeType,
        storagePath,
      };
      await publishProcessJob(payload, baseUrl);
      recovered++;
    } catch (err) {
      const msg = `Failed to recover ${record.id}: ${err instanceof Error ? err.message : 'Unknown'}`;
      console.error(`[recover] ${msg}`);
      errors.push(msg);
    }
  }

  console.log(`[recover] Recovered ${recovered}/${stuck.length} stuck records`);
  return Response.json({ recovered, total: stuck.length, errors });
}

function getBaseUrl(request: NextRequest): string {
  const forwardedHost = request.headers.get('x-forwarded-host');
  const forwardedProto = request.headers.get('x-forwarded-proto') || 'https';
  if (forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }
  const host = request.headers.get('host') || 'localhost:3000';
  const proto = host.includes('localhost') ? 'http' : 'https';
  return `${proto}://${host}`;
}
