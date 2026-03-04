export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface ProjectData {
  project: Record<string, unknown> | null;
  documents: Record<string, unknown>[];
  changeOrders: Record<string, unknown>[];
  production: Record<string, unknown>[];
  jobCosts: Record<string, unknown>[];
  designChanges: Record<string, unknown>[];
  crossRefs: Record<string, unknown>[];
  labelingLog: Record<string, unknown>[];
  meta: {
    projectId: string;
    fetchedAt: number;
    recordCounts: Record<string, number>;
  };
}

export interface AirtableRecord {
  id: string;
  fields: Record<string, unknown>;
  createdTime: string;
}

export interface ProjectSummary {
  projectId: string;
  projectName: string;
  status: string;
  contractValue: number;
}

export interface StreamEvent {
  text?: string;
  done?: boolean;
  error?: string;
}
