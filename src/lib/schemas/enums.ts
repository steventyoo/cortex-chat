import { z } from 'zod';

// ─── User / Auth ────────────────────────────────────────────────

export const UserRoleEnum = z.enum(['owner', 'admin', 'member', 'viewer']);
export type UserRole = z.infer<typeof UserRoleEnum>;
export const ADMIN_ROLES: readonly UserRole[] = ['owner', 'admin'] as const;

// ─── Project Sources ────────────────────────────────────────────

export const SourceKindEnum = z.enum(['file', 'api']);
export type SourceKind = z.infer<typeof SourceKindEnum>;

export const ProviderNameEnum = z.enum(['gdrive', 's3', 'gcs', 'azure_blob']);
export type ProviderName = z.infer<typeof ProviderNameEnum>;

// ─── Skills ─────────────────────────────────────────────────────

export const SkillStatusEnum = z.enum(['active', 'draft', 'archived']);
export type SkillStatus = z.infer<typeof SkillStatusEnum>;

// ─── Projects ───────────────────────────────────────────────────

export const ProjectStatusEnum = z.enum(['active', 'completed', 'closed']);
export type ProjectStatus = z.infer<typeof ProjectStatusEnum>;

// ─── Field Catalog ──────────────────────────────────────────────

export const FieldTypeEnum = z.enum(['string', 'number', 'date', 'enum', 'boolean', 'array']);
export type FieldType = z.infer<typeof FieldTypeEnum>;

export const FieldCategoryEnum = z.enum([
  'identity', 'financial', 'schedule', 'technical', 'quality', 'admin', 'general',
]);
export type FieldCategory = z.infer<typeof FieldCategoryEnum>;

export const FieldImportanceEnum = z.enum(['P', 'S', 'E', 'A']);
export type FieldImportance = z.infer<typeof FieldImportanceEnum>;

// ─── Document Links ─────────────────────────────────────────────

export const LinkStatusEnum = z.enum(['complete', 'partial', 'missing', 'not_applicable']);
export type LinkStatus = z.infer<typeof LinkStatusEnum>;

// ─── Health / Dashboard ─────────────────────────────────────────

export const HealthStatusEnum = z.enum(['healthy', 'warning', 'critical']);
export type HealthStatus = z.infer<typeof HealthStatusEnum>;
