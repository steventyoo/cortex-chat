/**
 * Source registry: maps provider names to metadata, config schemas, and
 * implementation status. New providers are added here — no migration needed.
 *
 * The UI reads this registry to render provider pickers and dynamic config forms.
 * The scan pipeline reads it to dispatch to the correct file lister.
 */

import type { SourceKind, ProviderName } from './schemas/enums';

export interface ConfigField {
  type: 'string' | 'boolean';
  required: boolean;
  label: string;
  placeholder?: string;
}

export interface SourceProviderDef {
  kind: SourceKind;
  label: string;
  icon: string;
  configSchema: Record<string, ConfigField>;
  needsOrgIntegration: boolean;
  implemented: boolean;
}

export const PROVIDERS: Record<ProviderName, SourceProviderDef> = {
  gdrive: {
    kind: 'file',
    label: 'Google Drive',
    icon: 'drive',
    configSchema: {
      folder_id: { type: 'string', required: true, label: 'Folder ID', placeholder: 'Paste the Google Drive folder ID' },
      subpath: { type: 'string', required: false, label: 'Subpath', placeholder: 'e.g. 1705 SES / Contracts' },
      relative_to_org_root: { type: 'boolean', required: false, label: 'Relative to org root folder' },
    },
    needsOrgIntegration: false,
    implemented: true,
  },

  s3: {
    kind: 'file',
    label: 'Amazon S3',
    icon: 's3',
    configSchema: {
      bucket: { type: 'string', required: true, label: 'Bucket Name', placeholder: 'my-project-docs' },
      prefix: { type: 'string', required: false, label: 'Key Prefix', placeholder: 'projects/1705-ses/' },
      region: { type: 'string', required: true, label: 'AWS Region', placeholder: 'us-east-1' },
    },
    needsOrgIntegration: true,
    implemented: false,
  },

  gcs: {
    kind: 'file',
    label: 'Google Cloud Storage',
    icon: 'gcs',
    configSchema: {
      bucket: { type: 'string', required: true, label: 'Bucket Name' },
      prefix: { type: 'string', required: false, label: 'Object Prefix' },
    },
    needsOrgIntegration: true,
    implemented: false,
  },

  azure_blob: {
    kind: 'file',
    label: 'Azure Blob Storage',
    icon: 'azure',
    configSchema: {
      container: { type: 'string', required: true, label: 'Container Name' },
      prefix: { type: 'string', required: false, label: 'Blob Prefix' },
    },
    needsOrgIntegration: true,
    implemented: false,
  },
};

export function getProvider(name: string): SourceProviderDef | undefined {
  return PROVIDERS[name as ProviderName];
}

export function listProviders(): Array<{ name: ProviderName } & SourceProviderDef> {
  return (Object.entries(PROVIDERS) as [ProviderName, SourceProviderDef][]).map(([name, def]) => ({ name, ...def }));
}

export function listImplementedProviders(): Array<{ name: ProviderName } & SourceProviderDef> {
  return listProviders().filter((p) => p.implemented);
}

export function validateConfig(provider: string, config: Record<string, unknown>): string | null {
  const def = PROVIDERS[provider as ProviderName];
  if (!def) return `Unknown provider: ${provider}`;
  for (const [key, field] of Object.entries(def.configSchema)) {
    if (field.required && !config[key]) {
      return `Missing required field: ${field.label}`;
    }
  }
  return null;
}
