-- Allow the same email to belong to multiple organizations.
-- Drop the single-column unique constraint on email and replace with (email, org_id).

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;
ALTER TABLE users ADD CONSTRAINT users_email_org_unique UNIQUE (email, org_id);
