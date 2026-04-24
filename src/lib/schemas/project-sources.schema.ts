import { z } from 'zod';
import { normalizeJsonObject } from './helpers';
import { SourceKindEnum, ProviderNameEnum } from './enums';

export type { SourceKind } from './enums';

// ─── ProjectSource (project_sources table) ──────────────────────

export const ProjectSourceSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string(),
  org_id: z.string(),
  kind: SourceKindEnum,
  provider: ProviderNameEnum,
  config: normalizeJsonObject.transform(v => v ?? {}),
  integration_id: z.string().uuid().nullable().default(null),
  label: z.string().default(''),
  active: z.coerce.boolean().default(true),
  last_synced_at: z.string().nullable().default(null),
  created_at: z.string().nullable().optional(),
});

export type ProjectSource = z.infer<typeof ProjectSourceSchema>;

// ─── OrgIntegration (org_integrations table) ────────────────────

export const OrgIntegrationSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string(),
  provider: z.string(),
  credentials: normalizeJsonObject.transform(v => v ?? {}),
  label: z.string().default(''),
  active: z.coerce.boolean().default(true),
  created_at: z.string().nullable().optional(),
});

export type OrgIntegration = z.infer<typeof OrgIntegrationSchema>;

// ─── Write Inputs ───────────────────────────────────────────────

export const CreateSourceInput = z.object({
  provider: ProviderNameEnum,
  config: z.record(z.string(), z.unknown()).default({}),
  label: z.string().optional().default(''),
});

export type CreateSourceInput = z.infer<typeof CreateSourceInput>;
