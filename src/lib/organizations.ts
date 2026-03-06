/**
 * Airtable CRUD for ORGANIZATIONS and USERS tables.
 */

import { nanoid } from 'nanoid';

const BASE_URL = 'https://api.airtable.com/v0';

function getHeaders() {
  return {
    Authorization: `Bearer ${process.env.AIRTABLE_PAT}`,
    'Content-Type': 'application/json',
  };
}

function getBaseId() {
  return process.env.AIRTABLE_BASE_ID || '';
}

// ── Types ────────────────────────────────────────────────────

export interface OrgRecord {
  id: string; // Airtable record ID
  orgId: string;
  orgName: string;
  ownerEmail: string;
  plan: 'free' | 'pro' | 'enterprise';
  createdAt: string;
  driveFolderId: string;
  alertEmailEnabled: boolean;
  weeklyReportEnabled: boolean;
  logoUrl: string;
  active: boolean;
  onboardingComplete: boolean;
}

export interface UserRecord {
  id: string; // Airtable record ID
  userId: string;
  orgId: string;
  email: string;
  name: string;
  passwordHash: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  active: boolean;
  createdAt: string;
  lastLogin: string;
  phone: string;
  alertPreferences: Record<string, boolean>;
}

// ── Helpers ──────────────────────────────────────────────────

async function fetchOneRecord(tableName: string, filterFormula: string): Promise<Record<string, unknown> | null> {
  const params = new URLSearchParams({
    pageSize: '1',
    filterByFormula: filterFormula,
  });
  const url = `${BASE_URL}/${getBaseId()}/${encodeURIComponent(tableName)}?${params}`;
  const res = await fetch(url, { headers: getHeaders(), cache: 'no-store' });
  if (!res.ok) return null;
  const data = await res.json();
  return data.records?.[0] || null;
}

async function fetchRecords(tableName: string, filterFormula?: string): Promise<Record<string, unknown>[]> {
  const records: Record<string, unknown>[] = [];
  let offset: string | undefined;
  do {
    const params = new URLSearchParams({ pageSize: '100' });
    if (filterFormula) params.set('filterByFormula', filterFormula);
    if (offset) params.set('offset', offset);
    const url = `${BASE_URL}/${getBaseId()}/${encodeURIComponent(tableName)}?${params}`;
    const res = await fetch(url, { headers: getHeaders(), cache: 'no-store' });
    if (!res.ok) break;
    const data = await res.json();
    records.push(...(data.records || []));
    offset = data.offset;
  } while (offset);
  return records;
}

async function createRecord(tableName: string, fields: Record<string, unknown>): Promise<Record<string, unknown>> {
  const url = `${BASE_URL}/${getBaseId()}/${encodeURIComponent(tableName)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to create record in ${tableName}: ${res.status} ${err}`);
  }
  return await res.json();
}

async function updateRecord(tableName: string, recordId: string, fields: Record<string, unknown>): Promise<void> {
  const url = `${BASE_URL}/${getBaseId()}/${encodeURIComponent(tableName)}/${recordId}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: getHeaders(),
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to update record ${recordId}: ${res.status} ${err}`);
  }
}

// ── Mapping helpers ──────────────────────────────────────────

function mapOrg(rec: Record<string, unknown>): OrgRecord {
  const f = (rec as { fields: Record<string, unknown> }).fields;
  return {
    id: (rec as { id: string }).id,
    orgId: (f['Organization ID'] as string) || '',
    orgName: (f['Organization Name'] as string) || '',
    ownerEmail: (f['Owner Email'] as string) || '',
    plan: (f['Plan'] as OrgRecord['plan']) || 'free',
    createdAt: (f['Created At'] as string) || '',
    driveFolderId: (f['Google Drive Folder ID'] as string) || '',
    alertEmailEnabled: !!f['Alert Email Enabled'],
    weeklyReportEnabled: !!f['Weekly Report Enabled'],
    logoUrl: (f['Logo URL'] as string) || '',
    active: !!f['Active'],
    onboardingComplete: !!f['Onboarding Complete'],
  };
}

function mapUser(rec: Record<string, unknown>): UserRecord {
  const f = (rec as { fields: Record<string, unknown> }).fields;
  let alertPrefs: Record<string, boolean> = {};
  try {
    alertPrefs = JSON.parse((f['Alert Preferences'] as string) || '{}');
  } catch { /* ignore */ }
  return {
    id: (rec as { id: string }).id,
    userId: (f['User ID'] as string) || '',
    orgId: (f['Organization ID'] as string) || '',
    email: (f['Email'] as string) || '',
    name: (f['Name'] as string) || '',
    passwordHash: (f['Password Hash'] as string) || '',
    role: (f['Role'] as UserRecord['role']) || 'member',
    active: !!f['Active'],
    createdAt: (f['Created At'] as string) || '',
    lastLogin: (f['Last Login'] as string) || '',
    phone: (f['Phone'] as string) || '',
    alertPreferences: alertPrefs,
  };
}

// ── Organization CRUD ────────────────────────────────────────

export async function getOrganization(orgId: string): Promise<OrgRecord | null> {
  const rec = await fetchOneRecord('ORGANIZATIONS', `{Organization ID}='${orgId}'`);
  return rec ? mapOrg(rec) : null;
}

export async function getOrganizationByName(name: string): Promise<OrgRecord | null> {
  const rec = await fetchOneRecord('ORGANIZATIONS', `{Organization Name}='${name}'`);
  return rec ? mapOrg(rec) : null;
}

export async function listActiveOrganizations(): Promise<OrgRecord[]> {
  const recs = await fetchRecords('ORGANIZATIONS', '{Active}=TRUE()');
  return recs.map(mapOrg);
}

export async function createOrganization(data: {
  orgName: string;
  ownerEmail: string;
  driveFolderId?: string;
}): Promise<OrgRecord> {
  const orgId = `org_${nanoid(10)}`;
  const rec = await createRecord('ORGANIZATIONS', {
    'Organization ID': orgId,
    'Organization Name': data.orgName,
    'Owner Email': data.ownerEmail,
    'Plan': 'free',
    'Created At': new Date().toISOString(),
    'Google Drive Folder ID': data.driveFolderId || '',
    'Alert Email Enabled': true,
    'Weekly Report Enabled': false,
    'Active': true,
    'Onboarding Complete': false,
  });
  return mapOrg(rec);
}

export async function updateOrganization(orgRecordId: string, fields: Partial<{
  orgName: string;
  driveFolderId: string;
  alertEmailEnabled: boolean;
  weeklyReportEnabled: boolean;
  logoUrl: string;
  onboardingComplete: boolean;
}>): Promise<void> {
  const airtableFields: Record<string, unknown> = {};
  if (fields.orgName !== undefined) airtableFields['Organization Name'] = fields.orgName;
  if (fields.driveFolderId !== undefined) airtableFields['Google Drive Folder ID'] = fields.driveFolderId;
  if (fields.alertEmailEnabled !== undefined) airtableFields['Alert Email Enabled'] = fields.alertEmailEnabled;
  if (fields.weeklyReportEnabled !== undefined) airtableFields['Weekly Report Enabled'] = fields.weeklyReportEnabled;
  if (fields.logoUrl !== undefined) airtableFields['Logo URL'] = fields.logoUrl;
  if (fields.onboardingComplete !== undefined) airtableFields['Onboarding Complete'] = fields.onboardingComplete;
  await updateRecord('ORGANIZATIONS', orgRecordId, airtableFields);
}

// ── User CRUD ────────────────────────────────────────────────

export async function getUserByEmail(email: string): Promise<UserRecord | null> {
  const rec = await fetchOneRecord('USERS', `{Email}='${email.toLowerCase()}'`);
  return rec ? mapUser(rec) : null;
}

export async function getUserById(userId: string): Promise<UserRecord | null> {
  const rec = await fetchOneRecord('USERS', `{User ID}='${userId}'`);
  return rec ? mapUser(rec) : null;
}

export async function getUsersByOrg(orgId: string): Promise<UserRecord[]> {
  const recs = await fetchRecords('USERS', `AND({Organization ID}='${orgId}',{Active}=TRUE())`);
  return recs.map(mapUser);
}

export async function createUser(data: {
  orgId: string;
  email: string;
  name: string;
  passwordHash: string;
  role: UserRecord['role'];
}): Promise<UserRecord> {
  const userId = `usr_${nanoid(10)}`;
  const rec = await createRecord('USERS', {
    'User ID': userId,
    'Organization ID': data.orgId,
    'Email': data.email.toLowerCase(),
    'Name': data.name,
    'Password Hash': data.passwordHash,
    'Role': data.role,
    'Active': true,
    'Created At': new Date().toISOString(),
    'Alert Preferences': JSON.stringify({
      budget_threshold: true,
      labor_critical: true,
      co_pending: true,
      document_processed: false,
    }),
  });
  return mapUser(rec);
}

export async function updateUserLastLogin(userRecordId: string): Promise<void> {
  await updateRecord('USERS', userRecordId, {
    'Last Login': new Date().toISOString(),
  });
}
