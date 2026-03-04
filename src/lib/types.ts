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

// Dashboard types
export type HealthStatus = 'healthy' | 'warning' | 'critical';

export interface ProjectHealth {
  projectId: string;
  projectName: string;
  status: string; // Project Status from Airtable
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
