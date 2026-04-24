# Integration Guide: Adding Data Source Providers

This guide explains how to add new file storage providers or API-based software integrations to the per-project data sources system.

## Architecture Overview

Each project can have multiple **data sources** stored in the `project_sources` table. Sources have two dimensions:

- **kind**: `file` (scans for documents to extract) or `api` (pulls structured data directly)
- **provider**: the specific service (`gdrive`, `s3`, `procore`, etc.)

Provider-specific configuration lives in a `config` JSONB column. Credentials for API providers live in the `org_integrations` table at the org level, referenced by `integration_id`.

### Key Files

| File | Purpose |
|------|---------|
| `src/lib/source-registry.ts` | Provider definitions, config schemas, validation |
| `src/lib/supabase.ts` | `ProjectSource` type, CRUD helpers |
| `src/app/api/pipeline/scan-drive/route.ts` | Scans file sources and queues documents |
| `src/app/api/projects/[projectId]/sources/route.ts` | REST API for managing project sources |
| `src/components/ProjectSources.tsx` | UI for adding/removing sources |
| `supabase/migrations/20260424_project_sources.sql` | Table schema |

---

## Adding a File Source Provider (e.g., S3, GCS)

### Step 1: Register the provider

Add an entry to `PROVIDERS` in `src/lib/source-registry.ts`:

```typescript
s3: {
  kind: 'file',
  label: 'Amazon S3',
  icon: 's3',
  configSchema: {
    bucket: { type: 'string', required: true, label: 'Bucket Name', placeholder: 'my-docs' },
    prefix: { type: 'string', required: false, label: 'Key Prefix', placeholder: 'projects/' },
    region: { type: 'string', required: true, label: 'AWS Region', placeholder: 'us-east-1' },
  },
  needsOrgIntegration: true,
  implemented: true,  // flip to true when ready
},
```

The `configSchema` drives the dynamic form in the UI — each field becomes an input.

### Step 2: Implement a file lister

Create a new module (e.g., `src/lib/s3.ts`) that exports a function returning the same shape as `listAllDriveFiles`:

```typescript
interface SourceFile {
  id: string;           // unique identifier (S3 key, Drive file ID, etc.)
  name: string;         // display name
  mimeType: string;
  createdTime: string;
  modifiedTime: string;
  webViewLink: string;  // URL to view the file (can be empty for S3)
  size: number;
  parentFolderId: string;
  parentFolderName: string;
  folderPath: string;
}

export async function listS3Files(
  bucket: string,
  prefix: string,
  region: string,
  credentials: Record<string, unknown>
): Promise<SourceFile[]> {
  // Use AWS SDK to list objects, map to SourceFile shape
}
```

### Step 3: Add a branch in scan-drive

In `src/app/api/pipeline/scan-drive/route.ts`, in the per-source scanning section, add handling for your provider:

```typescript
for (const source of fileSources) {
  if (source.provider === 'gdrive' && source.config.folder_id) {
    // existing gdrive logic
  } else if (source.provider === 's3' && source.config.bucket) {
    const files = await listS3Files(
      String(source.config.bucket),
      String(source.config.prefix || ''),
      String(source.config.region),
      credentials  // from org_integrations
    );
    // tag files with source.projectId, add to perSourceFiles
  }
}
```

### Step 4: Implement a download function

The `process-document.ts` pipeline downloads file content for extraction. Add a download path for your provider:

```typescript
// In process-document.ts, before the existing Drive download:
if (fileUrl.startsWith('s3://')) {
  // Download from S3
}
```

### Step 5: Test the connection

Add a validation branch in the sources API route (`src/app/api/projects/[projectId]/sources/route.ts`):

```typescript
if (provider === 's3' && config.bucket) {
  // Validate S3 access (list 1 object, check permissions)
}
```

### What you don't need to change

- The `project_sources` table schema — `config` JSONB handles any shape
- The dedup/queue logic — it works on `drive_file_id` / `file_url` generically
- The extraction pipeline — it processes any file regardless of source
- The UI — it reads the registry and renders forms dynamically

---

## Adding an API Source Provider (e.g., Procore, ComputerEase)

API sources are fundamentally different from file sources. They pull **structured data** directly from external software APIs, bypassing the document extraction pipeline.

### Step 1: Register the provider

```typescript
procore: {
  kind: 'api',
  label: 'Procore',
  icon: 'procore',
  configSchema: {
    procore_project_id: { type: 'string', required: true, label: 'Procore Project ID' },
  },
  needsOrgIntegration: true,
  implemented: true,
},
```

### Step 2: Set up org-level credentials

Insert a row into `org_integrations` for the org:

```sql
INSERT INTO org_integrations (org_id, provider, credentials, label)
VALUES ('org_abc', 'procore', '{
  "client_id": "...",
  "client_secret": "...",
  "access_token": "...",
  "refresh_token": "...",
  "expires_at": "..."
}', 'Procore');
```

Eventually this will be done via an OAuth flow in the org settings UI. For now, seed it manually or via an API route.

### Step 3: Implement a sync adapter

Create `src/lib/adapters/procore.ts`:

```typescript
import { ProjectSource } from '@/lib/supabase';

export interface SyncResult {
  recordsSynced: number;
  errors: string[];
}

export async function syncProcore(
  source: ProjectSource,
  credentials: Record<string, unknown>
): Promise<SyncResult> {
  const projectId = String(source.config.procore_project_id);
  const token = String(credentials.access_token);

  // 1. Call Procore API
  const response = await fetch(
    `https://api.procore.com/rest/v1.0/projects/${projectId}/daily_logs`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const logs = await response.json();

  // 2. Map to extracted_records schema
  const records = logs.map((log: any) => ({
    project_id: source.projectId,
    org_id: source.orgId,
    skill_id: 'daily_log',
    fields: {
      date: { value: log.date, confidence: 1.0 },
      description: { value: log.description, confidence: 1.0 },
      // ... map more fields
    },
  }));

  // 3. Upsert into extracted_records
  // ...

  return { recordsSynced: records.length, errors: [] };
}
```

### Step 4: Create a sync-sources endpoint

Create `src/app/api/pipeline/sync-sources/route.ts` that:

1. Fetches all active `kind=api` sources for the org
2. For each source, resolves credentials from `org_integrations` (via `integration_id`) or falls back to `source.config`
3. Dispatches to the appropriate adapter function
4. Updates `last_synced_at` on each source

```typescript
import { listActiveAPISourcesForOrg, updateSourceLastSynced } from '@/lib/supabase';
import { syncProcore } from '@/lib/adapters/procore';

// In the handler:
for (const source of apiSources) {
  const credentials = await getOrgIntegrationCredentials(source.orgId, source.provider);

  switch (source.provider) {
    case 'procore':
      await syncProcore(source, credentials);
      break;
    // case 'computerease': ...
  }

  await updateSourceLastSynced(source.id);
}
```

### Step 5: Schedule the sync

Add the endpoint to the Vercel cron in `vercel.json`:

```json
{
  "path": "/api/pipeline/sync-sources",
  "schedule": "0 */4 * * *"
}
```

---

## Conventions

- **Provider names** are lowercase, alphanumeric with underscores: `procore`, `computerease`, `azure_blob`
- **The `provider` column is TEXT**, not an enum — no migration needed for new providers
- **Config schemas** define what the UI form renders. Keep fields minimal — only what's needed to connect
- **Credentials are never stored in `project_sources.config`** — they go in `org_integrations.credentials`
- **All providers must handle**:
  - Connection testing (validate access before saving)
  - Incremental sync (use `last_synced_at` to avoid re-processing)
  - Error reporting (return structured errors, don't swallow them)
- **File sources** produce `pipeline_log` entries that flow through the existing extraction pipeline
- **API sources** write to `extracted_records` (or a future `synced_records` table) directly

## Credential Resolution Order

When syncing an API source:

1. If `source.config` contains credential fields → use those (per-source override)
2. Else if `source.integration_id` is set → load credentials from `org_integrations` by ID
3. Else → look up `org_integrations` by `(org_id, provider)` as default
4. If no credentials found → skip and report error
