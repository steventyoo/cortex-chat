export interface ToolCallEntry {
  name: string;
  displayName?: string;
  input: Record<string, unknown>;
  result?: unknown;
  resultCount?: number;
  htmlArtifact?: string;
  status: 'calling' | 'done' | 'error';
}

export type MessagePart =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; toolCall: ToolCallEntry };

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  toolCalls?: ToolCallEntry[];
  parts?: MessagePart[];
}

export interface ProjectData {
  project: Record<string, unknown> | null;
  documents: Record<string, unknown>[];
  changeOrders: Record<string, unknown>[];
  production: Record<string, unknown>[];
  jobCosts: Record<string, unknown>[];
  designChanges: Record<string, unknown>[];
  documentLinks: Record<string, unknown>[];
  labelingLog: Record<string, unknown>[];
  staffing: Record<string, unknown>[];
  meta: {
    projectId: string;
    fetchedAt: number;
    recordCounts: Record<string, number>;
  };
}

export interface ProjectSummary {
  projectId: string;
  projectName: string;
  status: string;
  contractValue: number;
  address: string;
  trade: string;
}

export interface StreamEvent {
  text?: string;
  done?: boolean;
  error?: string;
}

// Dashboard types
export type HealthStatus = 'healthy' | 'warning' | 'critical';

export interface ProjectHealth {
  projectId: string;
  projectName: string;
  status: string;
  contractValue: number;
  jobToDate: number;
  percentComplete: number;
  totalCOs: number;
  pendingCOs: number;
  pendingCOAmount: number;
  budgetHealth: HealthStatus;
  laborHealth: HealthStatus;
  overallHealth: HealthStatus;
  laborPerformanceRatio: number;
  budgetVariancePercent: number;
  foreman: string | null;
  projectManager: string | null;
  crewSize: number;
  alerts: ProjectAlert[];
}

export interface ProjectAlert {
  type: 'budget' | 'labor' | 'change_order' | 'schedule';
  severity: 'info' | 'warning' | 'critical';
  message: string;
  projectId: string;
  projectName: string;
}

export interface ConversationSummary {
  id: string;
  projectId: string | null;
  projectName: string | null;
  firstMessage: string;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface SourceRef {
  tag: string;
  type: 'structured' | 'extracted';
  label: string;
  table?: string;
  similarity?: number;
  sourceFile?: string;
}
