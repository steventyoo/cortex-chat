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
  });
  console.log(`[qstash] Published to ${url} → msgId=${result.messageId}`);
  return result.messageId;
}
