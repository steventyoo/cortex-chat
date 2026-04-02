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
}

export async function publishProcessJob(
  payload: ProcessPayload,
  baseUrl: string
): Promise<string> {
  const client = getQStashClient();
  const result = await client.publishJSON({
    url: `${baseUrl}/api/pipeline/process`,
    body: payload,
    retries: 3,
  });
  return result.messageId;
}
