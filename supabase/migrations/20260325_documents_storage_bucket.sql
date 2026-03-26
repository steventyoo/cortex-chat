-- Create private storage bucket for uploaded documents.
-- Files are organized as: {org_id}/{project_id}/{pipeline_log_id}/{filename}
-- Access is service-role only (uploads and signed URLs happen server-side).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'documents',
  'documents',
  false,
  52428800,
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/tiff',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-powerpoint',
    'text/plain',
    'text/csv',
    'text/html',
    'application/json',
    'message/rfc822'
  ]
)
ON CONFLICT (id) DO NOTHING;
