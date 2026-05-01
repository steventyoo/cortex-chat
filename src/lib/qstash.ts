import { Client, Receiver } from '@upstash/qstash';

let _client: Client | null = null;
let _receiver: Receiver | null = null;

export function getQStashClient(): Client {
  if (!_client) {
    _client = new Client({
      token: process.env.QSTASH_TOKEN!,
      baseUrl: process.env.QSTASH_URL,
    });
  }
  return _client;
}

export function getQStashReceiver(): Receiver {
  if (!_receiver) {
    _receiver = new Receiver({
      currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY!,
      nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY!,
    });
  }
  return _receiver;
}

export interface ProcessPayload {
  recordId: string;
  orgId: string;
  projectId: string | null;
  fileName: string;
  mimeType: string;
  storagePath: string;
  driveFileId?: string;
  driveModifiedTime?: string;
  driveWebViewLink?: string;
  driveFolderPath?: string;
  forceProcess?: boolean;
}

export async function publishProcessJob(
  payload: ProcessPayload,
  baseUrl: string
): Promise<string> {
  const client = getQStashClient();
  const url = `${baseUrl.replace(/\/$/, '')}/api/pipeline/process`;
  const result = await client.publishJSON({
    url,
    body: payload,
    retries: 3,
    flowControl: { key: FLOW_CONTROL_KEY, parallelism: PROCESS_PARALLELISM },
  });
  console.log(`[qstash] Published to ${url} → msgId=${result.messageId}`);
  return result.messageId;
}

const FLOW_CONTROL_KEY = 'cortex-pipeline-process';
const PROCESS_PARALLELISM = 5;

export async function publishProcessBatch(
  payloads: ProcessPayload[],
  baseUrl: string
): Promise<string[]> {
  if (payloads.length === 0) return [];
  if (payloads.length === 1) {
    const msgId = await publishProcessJob(payloads[0], baseUrl);
    return [msgId];
  }
  const client = getQStashClient();
  const url = `${baseUrl.replace(/\/$/, '')}/api/pipeline/process`;
  const batch = payloads.map((payload) => ({
    url,
    body: payload,
    retries: 3,
    flowControl: { key: FLOW_CONTROL_KEY, parallelism: PROCESS_PARALLELISM },
  }));
  const results = await client.batchJSON(batch);
  const ids = results.map((r) => {
    const msgId = Array.isArray(r) ? r[0]?.messageId : r.messageId;
    return msgId || 'unknown';
  });
  console.log(`[qstash] Batch published ${ids.length} jobs (parallelism=${PROCESS_PARALLELISM}) to ${url}`);
  return ids;
}

export interface ScanContinuationPayload {
  continuation: true;
  orgId: string;
  driveFolderId: string;
}

export async function publishScanContinuation(
  baseUrl: string,
  orgId: string,
  driveFolderId: string,
  delaySec: number = 5
): Promise<string> {
  const client = getQStashClient();
  const url = `${baseUrl.replace(/\/$/, '')}/api/pipeline/scan-drive`;
  const body: ScanContinuationPayload = { continuation: true, orgId, driveFolderId };
  const result = await client.publishJSON({
    url,
    body,
    retries: 2,
    delay: delaySec,
  });
  console.log(`[qstash] Scheduled scan continuation for org=${orgId} folder=${driveFolderId} in ${delaySec}s → msgId=${result.messageId}`);
  return result.messageId;
}

// ── Extraction Agent Continuation ────────────────────────────

export interface ExtractionContinuationPayload {
  continuation: true;
  pipelineLogId: string;
  skillId: string;
  blobUrl: string;
  attempt: number;
}

export async function publishExtractionContinuation(
  baseUrl: string,
  payload: ExtractionContinuationPayload,
  delaySec: number = 5,
): Promise<string> {
  const client = getQStashClient();
  const url = `${baseUrl.replace(/\/$/, '')}/api/pipeline/continue-extraction`;
  const result = await client.publishJSON({
    url,
    body: payload,
    retries: 3,
    delay: delaySec,
  });
  console.log(`[qstash] Scheduled extraction continuation attempt=${payload.attempt} for pipeline=${payload.pipelineLogId} in ${delaySec}s → msgId=${result.messageId}`);
  return result.messageId;
}
