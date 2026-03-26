/**
 * Supabase client + data access layer.
 * Replaces lib/airtable.ts and lib/organizations.ts.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { nanoid } from 'nanoid';
import { ProjectData, ProjectSummary, ProjectHealth, ProjectAlert, HealthStatus } from './types';

// ── Client ────────────────────────────────────────────────────

let _supabase: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (_supabase) return _supabase;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE env vars');
  _supabase = createClient(url, key);
  return _supabase;
}

// ── Types ─────────────────────────────────────────────────────

export interface OrgRecord {
  id: string;
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
  id: string;
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

// ── Mappers ───────────────────────────────────────────────────

function mapOrg(row: Record<string, unknown>): OrgRecord {
  return {
    id: String(row.id || ''),
    orgId: String(row.org_id || ''),
    orgName: String(row.org_name || ''),
    ownerEmail: String(row.owner_email || ''),
    plan: (row.plan as OrgRecord['plan']) || 'free',
    createdAt: String(row.created_at || ''),
    driveFolderId: String(row.google_drive_folder_id || ''),
    alertEmailEnabled: !!row.alert_email_enabled,
    weeklyReportEnabled: !!row.weekly_report_enabled,
    logoUrl: String(row.logo_url || ''),
    active: !!row.active,
    onboardingComplete: !!row.onboarding_complete,
  };
}

function mapUser(row: Record<string, unknown>): UserRecord {
  let alertPrefs: Record<string, boolean> = {};
  try {
    if (row.alert_preferences && typeof row.alert_preferences === 'object') {
      alertPrefs = row.alert_preferences as Record<string, boolean>;
    }
  } catch { /* ignore */ }
  return {
    id: String(row.id || ''),
    userId: String(row.user_id || ''),
    orgId: String(row.org_id || ''),
    email: String(row.email || ''),
    name: String(row.name || ''),
    passwordHash: String(row.password_hash || ''),
    role: (row.role as UserRecord['role']) || 'member',
    active: !!row.active,
    createdAt: String(row.created_at || ''),
    lastLogin: String(row.last_login || ''),
    phone: String(row.phone || ''),
    alertPreferences: alertPrefs,
  };
}

// ── Organization CRUD ─────────────────────────────────────────

export async function getOrganization(orgId: string): Promise<OrgRecord | null> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('organizations')
    .select('*')
    .eq('org_id', orgId)
    .single();
  if (error || !data) return null;
  return mapOrg(data);
}

export async function getOrganizationByName(name: string): Promise<OrgRecord | null> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('organizations')
    .select('*')
    .eq('org_name', name)
    .single();
  if (error || !data) return null;
  return mapOrg(data);
}

export async function listActiveOrganizations(): Promise<OrgRecord[]> {
  const sb = getSupabase();
  const { data } = await sb.from('organizations').select('*').eq('active', true);
  return (data || []).map(mapOrg);
}

export async function createOrganization(data: {
  orgName: string;
  ownerEmail: string;
  driveFolderId?: string;
}): Promise<OrgRecord> {
  const sb = getSupabase();
  const orgId = `org_${nanoid(10)}`;
  const { data: row, error } = await sb
    .from('organizations')
    .insert({
      org_id: orgId,
      org_name: data.orgName,
      owner_email: data.ownerEmail,
      plan: 'free',
      google_drive_folder_id: data.driveFolderId || '',
      alert_email_enabled: true,
      weekly_report_enabled: false,
      active: true,
      onboarding_complete: false,
    })
    .select()
    .single();
  if (error) throw new Error(`Failed to create org: ${error.message}`);
  return mapOrg(row);
}

export async function updateOrganization(orgId: string, fields: Partial<{
  orgName: string;
  driveFolderId: string;
  alertEmailEnabled: boolean;
  weeklyReportEnabled: boolean;
  logoUrl: string;
  onboardingComplete: boolean;
}>): Promise<void> {
  const sb = getSupabase();
  const update: Record<string, unknown> = {};
  if (fields.orgName !== undefined) update.org_name = fields.orgName;
  if (fields.driveFolderId !== undefined) update.google_drive_folder_id = fields.driveFolderId;
  if (fields.alertEmailEnabled !== undefined) update.alert_email_enabled = fields.alertEmailEnabled;
  if (fields.weeklyReportEnabled !== undefined) update.weekly_report_enabled = fields.weeklyReportEnabled;
  if (fields.logoUrl !== undefined) update.logo_url = fields.logoUrl;
  if (fields.onboardingComplete !== undefined) update.onboarding_complete = fields.onboardingComplete;
  update.updated_at = new Date().toISOString();
  await sb.from('organizations').update(update).eq('org_id', orgId);
}

// ── User CRUD ─────────────────────────────────────────────────

export async function getUserByEmail(email: string, orgId?: string): Promise<UserRecord | null> {
  const sb = getSupabase();
  let query = sb.from('users').select('*').eq('email', email.toLowerCase());
  if (orgId) query = query.eq('org_id', orgId);
  query = query.eq('active', true).limit(1);
  const { data, error } = await query;
  if (error || !data || data.length === 0) return null;
  return mapUser(data[0]);
}

export async function getUsersByEmail(email: string): Promise<UserRecord[]> {
  const sb = getSupabase();
  const { data } = await sb
    .from('users')
    .select('*')
    .eq('email', email.toLowerCase())
    .eq('active', true);
  return (data || []).map(mapUser);
}

export async function getOrgsForUser(email: string): Promise<Array<{ orgId: string; orgName: string; role: UserRecord['role'] }>> {
  const sb = getSupabase();
  const { data: userRows } = await sb
    .from('users')
    .select('org_id, role')
    .eq('email', email.toLowerCase())
    .eq('active', true);
  if (!userRows || userRows.length === 0) return [];

  const orgIds = userRows.map((r: Record<string, unknown>) => String(r.org_id));
  const { data: orgRows } = await sb
    .from('organizations')
    .select('org_id, org_name')
    .in('org_id', orgIds)
    .eq('active', true);
  if (!orgRows) return [];

  const orgMap = new Map(orgRows.map((o: Record<string, unknown>) => [String(o.org_id), String(o.org_name)]));
  return userRows
    .filter((r: Record<string, unknown>) => orgMap.has(String(r.org_id)))
    .map((r: Record<string, unknown>) => ({
      orgId: String(r.org_id),
      orgName: orgMap.get(String(r.org_id)) || '',
      role: (r.role as UserRecord['role']) || 'member',
    }));
}

export async function getUserById(userId: string): Promise<UserRecord | null> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('users')
    .select('*')
    .eq('user_id', userId)
    .single();
  if (error || !data) return null;
  return mapUser(data);
}

export async function getUsersByOrg(orgId: string): Promise<UserRecord[]> {
  const sb = getSupabase();
  const { data } = await sb
    .from('users')
    .select('*')
    .eq('org_id', orgId)
    .eq('active', true);
  return (data || []).map(mapUser);
}

export async function createUser(data: {
  orgId: string;
  email: string;
  name: string;
  passwordHash: string;
  role: UserRecord['role'];
}): Promise<UserRecord> {
  const sb = getSupabase();
  const userId = `usr_${nanoid(10)}`;
  const { data: row, error } = await sb
    .from('users')
    .insert({
      user_id: userId,
      org_id: data.orgId,
      email: data.email.toLowerCase(),
      name: data.name,
      password_hash: data.passwordHash,
      role: data.role,
      active: true,
      alert_preferences: {
        budget_threshold: true,
        labor_critical: true,
        co_pending: true,
        document_processed: false,
      },
    })
    .select()
    .single();
  if (error) throw new Error(`Failed to create user: ${error.message}`);
  return mapUser(row);
}

export async function updateUserLastLogin(userId: string): Promise<void> {
  const sb = getSupabase();
  await sb.from('users').update({ last_login: new Date().toISOString() }).eq('user_id', userId);
}

// ── Generic table helpers ─────────────────────────────────────
// These mimic the old Airtable fetchTable / createRecord / updateRecord
// but return rows in { fields: { ... } } shape for backward compat.

interface AirtableShapedRecord {
  id: string;
  fields: Record<string, unknown>;
}

/** Maps snake_case Supabase columns back to Title Case Airtable field names */
const COLUMN_TO_FIELD: Record<string, string> = {
  // Projects
  project_id: 'Project ID',
  org_id: 'Organization ID',
  project_name: 'Project Name',
  job_number: 'Job Number',
  contract_value: 'Contract Value',
  revised_budget: 'Revised Budget',
  job_to_date: 'Job to Date',
  percent_complete_cost: 'Percent Complete Cost',
  total_cos: 'Total COs',
  project_status: 'Project Status',
  foreman: 'Foreman',
  project_manager: 'Project Manager',
  // Change Orders
  co_id: 'CO ID',
  co_type: 'CO Type',
  scope_description: 'Scope Description',
  date_submitted: 'Date Submitted',
  triggering_doc_ref: 'Triggering Doc Ref',
  foreman_hours: 'Foreman Hours',
  foreman_rate: 'Foreman Rate',
  journeyman_hours: 'Journeyman Hours',
  journeyman_rate: 'Journeyman Rate',
  mgmt_hours: 'Mgmt Hours',
  mgmt_rate: 'Mgmt Rate',
  labor_subtotal: 'Labor Subtotal',
  material_subtotal: 'Material Subtotal',
  sub_tier_amount: 'Sub Tier Amount',
  ohp_rate: 'OHP Rate',
  ohp_on_labor: 'OHP on Labor',
  ohp_on_material: 'OHP on Material',
  proposed_amount: 'GC Proposed Amount',
  approved_amount: 'Owner Approved Amount',
  csi_divisions: 'CSI Divisions',
  building_system: 'Building System',
  initiating_party: 'Initiating Party',
  change_reason: 'Change Reason',
  schedule_impact: 'Schedule Impact',
  approval_status: 'Approval Status',
  root_cause: 'Root Cause',
  preventability: 'Preventability',
  // Job Costs
  item_code: 'Item Code',
  item_description: 'Item Description',
  category: 'Category',
  over_under: 'Over Under',
  pct_of_budget: 'Pct of Budget',
  variance_status: 'Variance Status',
  cost_to_complete: 'Cost to Complete',
  estimated_cost_at_completion: 'Estimated Cost at Completion',
  invoice_amount: 'Invoice Amount',
  vendor: 'Vendor',
  change_orders_amount: 'Change Orders',
  // Production
  cost_code: 'Cost Code',
  activity_description: 'Activity Description',
  budget_labor_hours: 'Budget Labor Hours',
  actual_labor_hours: 'Actual Labor Hours',
  hours_to_complete: 'Hours to Complete',
  hours_remaining: 'Hrs Remaining',
  performance_ratio: 'Performance Ratio',
  productivity_indicator: 'Productivity Indicator',
  production_status: 'Production Status',
  // Design Changes
  design_doc_id: 'Design Doc ID',
  doc_type: 'Document Type',
  description: 'Description',
  issued_by: 'Issued By',
  issue_date: 'Issue Date',
  response_date: 'Response Date',
  cost_impact: 'Cost Impact',
  resulting_cor_co: 'Resulting COR CO',
  csi_divisions_affected: 'CSI Divisions Affected',
  // Documents
  document_id: 'Document ID',
  document_type: 'Document Type',
  document_title: 'Document Title',
  date_on_document: 'Date on Document',
  labeling_status: 'Labeling Status',
  // Cross Refs
  relationship_id: 'Relationship ID',
  from_document: 'From Document',
  to_document: 'To Document',
  relationship_type: 'Relationship Type',
  dollar_value_carried: 'Dollar Value Carried',
  // Labeling Log
  document_id_ref: 'Document ID',
  tier1_complete: 'Tier 1 Complete',
  tier2_complete: 'Tier 2 Complete',
  tier3_complete: 'Tier 3 Complete',
  // Staffing
  name: 'Name',
  role: 'Role',
  active: 'Active',
  // Pipeline
  pipeline_id: 'Pipeline ID',
  file_name: 'File Name',
  file_url: 'File URL',
  status: 'Status',
  overall_confidence: 'Overall Confidence',
  source_text: 'Source Text',
  extracted_data: 'Extracted Data',
  validation_flags: 'Validation Flags',
  ai_model: 'AI Model',
  fingerprint: 'Fingerprint',
  reviewer: 'Reviewer',
  review_action: 'Review Action',
  review_notes: 'Review Notes',
  review_edits: 'Review Edits',
  rejection_reason: 'Rejection Reason',
  pushed_record_ids: 'Airtable Record IDs',
  created_at: 'Created At',
  tier1_completed_at: 'Tier1 Completed At',
  tier2_completed_at: 'Tier2 Completed At',
  reviewed_at: 'Reviewed At',
  pushed_at: 'Pushed At',
  // Daily Notes
  content: 'Content',
  crew_count: 'Crew Count',
  weather: 'Weather',
  author_name: 'Author Name',
  author_email: 'Author Email',
  note_date: 'Date',
  updated_at: 'Updated At',
};

/** Reverse mapping: Title Case → snake_case */
const FIELD_TO_COLUMN: Record<string, string> = {};
for (const [col, field] of Object.entries(COLUMN_TO_FIELD)) {
  FIELD_TO_COLUMN[field] = col;
}
// Handle the change_orders numeric column name collision
FIELD_TO_COLUMN['Change Orders'] = 'change_orders';

/** Airtable table name → Supabase table name.
 *  After running the backfill script (scripts/backfill-extracted-records.js),
 *  swap the commented values below to read from extracted_records views
 *  instead of the legacy typed tables. The views expose identical column names.
 */
const TABLE_MAP: Record<string, string> = {
  PROJECTS: 'projects',
  DOCUMENTS: 'documents',              // swap to: 'documents_v'
  CHANGE_ORDERS: 'change_orders',      // swap to: 'change_orders_v'
  PRODUCTION: 'production',            // swap to: 'production_v'
  JOB_COSTS: 'job_costs',
  DESIGN_CHANGES: 'design_changes',    // swap to: 'design_changes_v'
  DOCUMENT_LINKS: 'document_links',
  LABELING_LOG: 'labeling_log',
  STAFFING: 'staffing',
  PIPELINE_LOG: 'pipeline_log',
  DAILY_NOTES: 'daily_notes',
  DAILY_NOTE_VERSIONS: 'daily_note_versions',
  ORGANIZATIONS: 'organizations',
  USERS: 'users',
};

function resolveTableName(tableName: string): string {
  return TABLE_MAP[tableName] || tableName.toLowerCase();
}

function rowToFields(row: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [col, val] of Object.entries(row)) {
    const fieldName = COLUMN_TO_FIELD[col] || col;
    // JSON-stringify complex objects that Airtable stored as strings
    if (col === 'extracted_data' || col === 'validation_flags' || col === 'review_edits') {
      fields[fieldName] = val != null ? JSON.stringify(val) : null;
    } else {
      fields[fieldName] = val;
    }
  }
  return fields;
}

function fieldsToRow(fields: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [field, val] of Object.entries(fields)) {
    const col = FIELD_TO_COLUMN[field] || field;
    row[col] = val;
  }
  return row;
}

/**
 * fetchTable — backward-compatible with Airtable's fetchTable().
 * Returns records in { id, fields } shape.
 */
export async function fetchTable(
  tableName: string,
  filterFormula?: string
): Promise<AirtableShapedRecord[]> {
  const sb = getSupabase();
  const table = resolveTableName(tableName);

  let query = sb.from(table).select('*');

  // Parse simple Airtable filter formulas into Supabase filters
  if (filterFormula) {
    const filters = parseAirtableFilter(filterFormula);
    for (const f of filters) {
      if (f.op === 'eq') {
        query = query.eq(f.column, f.value);
      } else if (f.op === 'neq') {
        query = query.neq(f.column, f.value);
      }
    }
  }

  const { data, error } = await query;
  if (error) {
    console.error(`Supabase error for ${table}:`, error.message);
    return [];
  }

  return (data || []).map((row: Record<string, unknown>) => ({
    id: String(row.id || ''),
    fields: rowToFields(row),
  }));
}

/**
 * Parse Airtable filter formulas into Supabase-compatible filters.
 * Handles: {Field}='value', AND({Field1}='v1',{Field2}='v2'), {Field}!='value'
 */
function parseAirtableFilter(formula: string): Array<{ column: string; op: 'eq' | 'neq'; value: string }> {
  const filters: Array<{ column: string; op: 'eq' | 'neq'; value: string }> = [];

  // Strip outer AND()
  let inner = formula;
  const andMatch = formula.match(/^AND\((.+)\)$/);
  if (andMatch) inner = andMatch[1];

  // Match all {FieldName}='value' or {FieldName}!='value' patterns
  const pattern = /\{([^}]+)\}\s*(!=|=)\s*'([^']*)'/g;
  let match;
  while ((match = pattern.exec(inner)) !== null) {
    const fieldName = match[1];
    const operator = match[2];
    const value = match[3];
    const column = FIELD_TO_COLUMN[fieldName] || fieldName.toLowerCase().replace(/\s+/g, '_');
    filters.push({
      column,
      op: operator === '!=' ? 'neq' : 'eq',
      value,
    });
  }

  return filters;
}

/**
 * createRecord — backward-compatible with Airtable's createRecord().
 * Accepts Title Case field names, maps to snake_case columns.
 */
export async function createRecord(
  tableName: string,
  fields: Record<string, unknown>
): Promise<AirtableShapedRecord | null> {
  const sb = getSupabase();
  const table = resolveTableName(tableName);
  const row = fieldsToRow(fields);

  const { data, error } = await sb.from(table).insert(row).select().single();
  if (error) {
    console.error(`Supabase create error for ${table}:`, error.message);
    return null;
  }
  return { id: String(data.id), fields: rowToFields(data) };
}

/**
 * updateRecord — backward-compatible with Airtable's updateRecord().
 * recordId is the UUID (or Airtable record ID during migration).
 */
export async function updateRecord(
  tableName: string,
  recordId: string,
  fields: Record<string, unknown>
): Promise<AirtableShapedRecord | null> {
  const sb = getSupabase();
  const table = resolveTableName(tableName);
  const row = fieldsToRow(fields);

  const { data, error } = await sb.from(table).update(row).eq('id', recordId).select().single();
  if (error) {
    console.error(`Supabase update error for ${table}/${recordId}:`, error.message);
    return null;
  }
  return { id: String(data.id), fields: rowToFields(data) };
}

// ── Project queries ───────────────────────────────────────────

export async function fetchAllProjectData(projectId: string): Promise<ProjectData> {
  const sb = getSupabase();

  const tables = [
    'projects', 'documents', 'change_orders', 'production',
    'job_costs', 'design_changes', 'document_links', 'labeling_log', 'staffing',
  ];

  const results = await Promise.allSettled(
    tables.map((table) =>
      sb.from(table).select('*').eq('project_id', projectId).then(({ data }) => data || [])
    )
  );

  const extract = (r: PromiseSettledResult<Record<string, unknown>[]>) =>
    r.status === 'fulfilled' ? r.value.map(rowToFields) : [];

  const projectRecords = extract(results[0]);

  return {
    project: projectRecords[0] || null,
    documents: extract(results[1]),
    changeOrders: extract(results[2]),
    production: extract(results[3]),
    jobCosts: extract(results[4]),
    designChanges: extract(results[5]),
    documentLinks: extract(results[6]),
    labelingLog: extract(results[7]),
    staffing: extract(results[8]),
    meta: {
      projectId,
      fetchedAt: Date.now(),
      recordCounts: {
        documents: extract(results[1]).length,
        changeOrders: extract(results[2]).length,
        production: extract(results[3]).length,
        jobCosts: extract(results[4]).length,
        designChanges: extract(results[5]).length,
        documentLinks: extract(results[6]).length,
        labelingLog: extract(results[7]).length,
        staffing: extract(results[8]).length,
      },
    },
  };
}

export async function fetchProjectList(orgId?: string): Promise<ProjectSummary[]> {
  const sb = getSupabase();
  let query = sb.from('projects').select('*');
  if (orgId) query = query.eq('org_id', orgId);

  const { data } = await query;
  return (data || [])
    .map((row: Record<string, unknown>) => ({
      projectId: String(row.project_id || ''),
      projectName: String(row.project_name || ''),
      status: String(row.project_status || ''),
      contractValue: Number(row.contract_value || 0),
      address: String(row.address || ''),
      trade: String(row.trade || ''),
    }))
    .filter((p) => p.projectId.length > 0);
}

export async function verifyProjectAccess(projectId: string, orgId: string): Promise<boolean> {
  const sb = getSupabase();
  const { count } = await sb
    .from('projects')
    .select('*', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .eq('org_id', orgId);
  return (count || 0) > 0;
}

// ── Health metrics ────────────────────────────────────────────

function computeHealthStatus(value: number, warningThreshold: number, criticalThreshold: number): HealthStatus {
  if (value >= criticalThreshold) return 'critical';
  if (value >= warningThreshold) return 'warning';
  return 'healthy';
}

export async function fetchProjectHealthData(orgId?: string): Promise<ProjectHealth[]> {
  const sb = getSupabase();

  // Fetch projects
  let projQuery = sb.from('projects').select('*');
  if (orgId) projQuery = projQuery.eq('org_id', orgId);
  const { data: projects } = await projQuery;
  if (!projects || projects.length === 0) return [];

  const validProjects = projects.filter((p: Record<string, unknown>) => String(p.project_id || '').length > 0);
  if (validProjects.length === 0) return [];

  const projectIds = validProjects.map((p: Record<string, unknown>) => String(p.project_id));

  // Fetch related data in parallel
  const [coRes, prodRes, jcRes, staffRes] = await Promise.all([
    sb.from('change_orders').select('project_id, approval_status, proposed_amount').in('project_id', projectIds),
    sb.from('production').select('project_id, budget_labor_hours, actual_labor_hours').in('project_id', projectIds),
    sb.from('job_costs').select('project_id, item_code, item_description, over_under, variance_status').in('project_id', projectIds),
    sb.from('staffing').select('project_id, name, role, active').in('project_id', projectIds),
  ]);

  const coFields = coRes.data || [];
  const prodFields = prodRes.data || [];
  const jcFields = jcRes.data || [];
  const staffFields = staffRes.data || [];

  return validProjects.map((p: Record<string, unknown>) => {
    const projectId = String(p.project_id || '');
    const projectName = String(p.project_name || '');
    const contractValue = Number(p.contract_value || 0);
    const jobToDate = Number(p.job_to_date || 0);
    const rawPercent = Number(p.percent_complete_cost || 0);
    const percentComplete = rawPercent > 0 && rawPercent <= 1 ? rawPercent * 100 : rawPercent;
    const totalCOs = Number(p.total_cos || 0);
    const status = String(p.project_status || '');

    const projectCOs = coFields.filter((co: Record<string, unknown>) => String(co.project_id) === projectId);
    const projectProd = prodFields.filter((pr: Record<string, unknown>) => String(pr.project_id) === projectId);
    const projectJC = jcFields.filter((jc: Record<string, unknown>) => String(jc.project_id) === projectId);
    const projectStaff = staffFields.filter((s: Record<string, unknown>) => String(s.project_id) === projectId);

    // Staffing
    const activeStaff = projectStaff.filter((s: Record<string, unknown>) => s.active);
    const foremanRec = activeStaff.find((s: Record<string, unknown>) => {
      const role = String(s.role || '').toLowerCase();
      return role.includes('foreman') || role.includes('superintendent');
    });
    const pmRec = activeStaff.find((s: Record<string, unknown>) => {
      const role = String(s.role || '').toLowerCase();
      return role.includes('project manager');
    });
    const foreman = foremanRec ? String(foremanRec.name || '') : null;
    const projectManager = pmRec ? String(pmRec.name || '') : null;
    const crewSize = activeStaff.length;

    // Pending COs
    const pendingCOs = projectCOs.filter((co: Record<string, unknown>) => {
      const approval = String(co.approval_status || '').toLowerCase();
      return approval.includes('pending') || approval.includes('submitted') || approval.includes('review');
    });
    const pendingCOAmount = pendingCOs.reduce(
      (sum: number, co: Record<string, unknown>) => sum + Number(co.proposed_amount || 0),
      0
    );

    // Labor performance
    const totalBudgetHrs = projectProd.reduce(
      (sum: number, pr: Record<string, unknown>) => sum + Number(pr.budget_labor_hours || 0),
      0
    );
    const totalActualHrs = projectProd.reduce(
      (sum: number, pr: Record<string, unknown>) => sum + Number(pr.actual_labor_hours || 0),
      0
    );
    const laborPerformanceRatio = totalBudgetHrs > 0 ? totalActualHrs / totalBudgetHrs : 0;

    // Budget variance
    const revisedBudget = Number(p.revised_budget || contractValue);
    const budgetVariancePercent = revisedBudget > 0
      ? ((jobToDate - revisedBudget) / revisedBudget) * 100
      : 0;

    const budgetHealth = computeHealthStatus(Math.max(0, budgetVariancePercent), 5, 15);
    const laborHealth = computeHealthStatus(Math.max(0, (laborPerformanceRatio - 1) * 100), 10, 25);

    const healthPriority: Record<HealthStatus, number> = { healthy: 0, warning: 1, critical: 2 };
    const worstHealth = Math.max(healthPriority[budgetHealth], healthPriority[laborHealth]);
    const overallHealth: HealthStatus = worstHealth === 2 ? 'critical' : worstHealth === 1 ? 'warning' : 'healthy';

    // Alerts
    const alerts: ProjectAlert[] = [];

    const overBudgetItems = projectJC.filter((jc: Record<string, unknown>) => {
      const variance = String(jc.variance_status || '').toLowerCase();
      return variance.includes('over');
    });
    if (overBudgetItems.length > 0) {
      const worstItem = overBudgetItems.reduce((worst, jc) =>
        Math.abs(Number(jc.over_under || 0)) > Math.abs(Number(worst.over_under || 0)) ? jc : worst
      );
      alerts.push({
        type: 'budget',
        severity: budgetHealth === 'critical' ? 'critical' : budgetHealth === 'warning' ? 'warning' : 'info',
        message: `${overBudgetItems.length} cost item${overBudgetItems.length > 1 ? 's' : ''} over budget — worst: ${String(worstItem.item_description || worstItem.item_code)}`,
        projectId,
        projectName,
      });
    }

    if (laborPerformanceRatio > 1.1) {
      const overPct = ((laborPerformanceRatio - 1) * 100).toFixed(0);
      alerts.push({
        type: 'labor',
        severity: laborHealth === 'critical' ? 'critical' : 'warning',
        message: `Labor ${overPct}% over budgeted hours (ratio: ${laborPerformanceRatio.toFixed(2)})`,
        projectId,
        projectName,
      });
    }

    if (pendingCOs.length > 0) {
      alerts.push({
        type: 'change_order',
        severity: pendingCOAmount > 50000 ? 'warning' : 'info',
        message: `${pendingCOs.length} pending CO${pendingCOs.length > 1 ? 's' : ''} totaling $${(pendingCOAmount / 1000).toFixed(0)}K awaiting approval`,
        projectId,
        projectName,
      });
    }

    return {
      projectId,
      projectName,
      status,
      contractValue,
      jobToDate,
      percentComplete,
      totalCOs,
      pendingCOs: pendingCOs.length,
      pendingCOAmount,
      budgetHealth,
      laborHealth,
      overallHealth,
      laborPerformanceRatio,
      budgetVariancePercent,
      foreman,
      projectManager,
      crewSize,
      alerts,
    };
  });
}

export async function resolveProjectId(
  userQuery: string,
  orgId?: string
): Promise<string | null> {
  const projects = await fetchProjectList(orgId);
  if (projects.length === 0) return null;

  const query = userQuery.toLowerCase();

  const exactMatch = projects.find((p) => p.projectId.toLowerCase() === query);
  if (exactMatch) return exactMatch.projectId;

  const fuzzyMatch = projects.find((p) => {
    if (!p.projectId || !p.projectName) return false;
    const id = p.projectId.toLowerCase();
    const name = p.projectName.toLowerCase();
    return (
      (id.length > 0 && query.includes(id)) ||
      (id.length > 0 && id.includes(query)) ||
      (name.length > 2 && query.includes(name)) ||
      (name.length > 2 && name.includes(query)) ||
      name.split(/\s+/).some((word) => word.length > 2 && query.includes(word)) ||
      id.split(/[-_]/).some((part) => part.length > 2 && query.includes(part))
    );
  });

  if (fuzzyMatch) return fuzzyMatch.projectId;
  if (projects.length === 1) return projects[0].projectId;
  return null;
}

// ── Pipeline helpers ──────────────────────────────────────────

export async function fetchPipelineRecord(recordId: string): Promise<Record<string, unknown> | null> {
  const sb = getSupabase();
  const { data, error } = await sb.from('pipeline_log').select('*').eq('id', recordId).single();
  if (error || !data) return null;
  return data as Record<string, unknown>;
}

export async function updatePipelineRecord(recordId: string, fields: Record<string, unknown>): Promise<void> {
  const sb = getSupabase();
  await sb.from('pipeline_log').update(fields).eq('id', recordId);
}

export async function checkDuplicatePipeline(
  fileUrl: string | null,
  fileName: string | null,
  projectId: string | null,
  excludeId?: string
): Promise<boolean> {
  const sb = getSupabase();

  // Check by file URL
  if (fileUrl) {
    let query = sb.from('pipeline_log')
      .select('id', { count: 'exact', head: true })
      .eq('file_url', fileUrl)
      .eq('status', 'pushed');
    if (excludeId) query = query.neq('id', excludeId);
    const { count } = await query;
    if ((count || 0) > 0) return true;
  }

  // Check by filename + project
  if (fileName && projectId) {
    let query = sb.from('pipeline_log')
      .select('id', { count: 'exact', head: true })
      .eq('file_name', fileName)
      .eq('project_id', projectId)
      .eq('status', 'pushed');
    if (excludeId) query = query.neq('id', excludeId);
    const { count } = await query;
    if ((count || 0) > 0) return true;
  }

  return false;
}

export async function pushToExtractedRecords(opts: {
  projectId: string;
  orgId: string;
  skillId: string;
  skillVersion: number;
  pipelineLogId?: string;
  documentType?: string;
  sourceFile?: string;
  fields: Record<string, { value: string | number | null; confidence: number }>;
  rawText?: string;
  overallConfidence?: number;
  status?: string;
}): Promise<string | null> {
  const sb = getSupabase();

  const fieldsJson: Record<string, unknown> = {};
  for (const [name, data] of Object.entries(opts.fields)) {
    fieldsJson[name] = { value: data.value, confidence: data.confidence };
  }

  const row = {
    project_id: opts.projectId,
    org_id: opts.orgId,
    skill_id: opts.skillId,
    skill_version: opts.skillVersion,
    pipeline_log_id: opts.pipelineLogId || null,
    document_type: opts.documentType || opts.skillId,
    source_file: opts.sourceFile || null,
    fields: fieldsJson,
    raw_text: opts.rawText || null,
    overall_confidence: opts.overallConfidence ?? null,
    status: opts.status || 'approved',
  };

  const { data, error } = await sb
    .from('extracted_records')
    .insert(row)
    .select('id')
    .single();

  if (error) {
    console.error('Failed to push to extracted_records:', error.message);
    return null;
  }
  return data?.id ? String(data.id) : null;
}

export async function pushRecordsToTable(
  tableName: string,
  projectId: string,
  orgId: string,
  records: Array<Record<string, { value: string | number | null; confidence: number }>>,
  columnMapping?: Record<string, string>
): Promise<string[]> {
  const sb = getSupabase();
  const table = resolveTableName(tableName);
  const ids: string[] = [];

  for (const rec of records) {
    const row: Record<string, unknown> = { project_id: projectId, org_id: orgId };
    for (const [fieldName, fieldData] of Object.entries(rec)) {
      if (fieldData.value !== null) {
        const col = columnMapping?.[fieldName] || FIELD_TO_COLUMN[fieldName] || fieldName.toLowerCase().replace(/\s+/g, '_');
        row[col] = fieldData.value;
      }
    }

    const { data, error } = await sb.from(table).insert(row).select('id').single();
    if (error) {
      console.error(`Failed to push to ${table}:`, error.message);
    } else if (data) {
      ids.push(String(data.id));
    }
  }

  return ids;
}

// ── Document Storage ──────────────────────────────────────────

const DOCUMENTS_BUCKET = 'documents';

/**
 * Upload a file to Supabase Storage.
 * Path convention: {orgId}/{projectId}/{pipelineLogId}/{fileName}
 * Returns the storage path on success, or null on failure.
 */
export async function uploadToStorage(
  storagePath: string,
  buffer: Buffer,
  mimeType: string
): Promise<string | null> {
  const sb = getSupabase();
  const { error } = await sb.storage
    .from(DOCUMENTS_BUCKET)
    .upload(storagePath, buffer, {
      contentType: mimeType,
      upsert: false,
    });

  if (error) {
    console.error('Storage upload failed:', error.message);
    return null;
  }
  return storagePath;
}

/**
 * Generate a time-limited signed URL for a stored document.
 * Default expiry is 1 hour (3600 seconds).
 */
export async function getSignedUrl(
  storagePath: string,
  expiresIn = 3600
): Promise<string | null> {
  const sb = getSupabase();
  const { data, error } = await sb.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(storagePath, expiresIn);

  if (error) {
    console.error('Failed to create signed URL:', error.message);
    return null;
  }
  return data?.signedUrl || null;
}

// ── Document Links (Causal Chains) ────────────────────────────

export async function createDocumentLink(link: {
  projectId: string;
  orgId: string;
  sourceTable: string;
  sourceId: string;
  sourceDocRef?: string;
  targetTable: string;
  targetId: string;
  targetDocRef?: string;
  linkType: string;
  timeDeltaDays?: number;
  costImpact?: number;
  description?: string;
  createdBy?: string;
}): Promise<string | null> {
  const sb = getSupabase();
  const { data, error } = await sb.from('document_links').insert({
    project_id: link.projectId,
    org_id: link.orgId,
    source_table: link.sourceTable,
    source_id: link.sourceId,
    source_doc_ref: link.sourceDocRef || '',
    target_table: link.targetTable,
    target_id: link.targetId,
    target_doc_ref: link.targetDocRef || '',
    link_type: link.linkType,
    time_delta_days: link.timeDeltaDays,
    cost_impact: link.costImpact,
    description: link.description || '',
    created_by: link.createdBy || '',
  }).select('id').single();

  if (error) {
    console.error('Failed to create document link:', error.message);
    return null;
  }
  return data?.id || null;
}

export async function getDocumentLinks(
  projectId: string,
  filters?: { linkType?: string; sourceTable?: string; targetTable?: string }
): Promise<Record<string, unknown>[]> {
  const sb = getSupabase();
  let query = sb.from('document_links').select('*').eq('project_id', projectId);
  if (filters?.linkType) query = query.eq('link_type', filters.linkType);
  if (filters?.sourceTable) query = query.eq('source_table', filters.sourceTable);
  if (filters?.targetTable) query = query.eq('target_table', filters.targetTable);

  const { data } = await query;
  return data || [];
}
