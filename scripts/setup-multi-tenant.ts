/**
 * Setup script for multi-tenant auth.
 * Creates ORGANIZATIONS and USERS tables in Airtable,
 * seeds the default OWP org and admin user,
 * and adds Organization ID to existing PROJECTS records.
 *
 * Run: npx tsx scripts/setup-multi-tenant.ts
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local', override: true });

import bcrypt from 'bcryptjs';

const PAT = process.env.AIRTABLE_PAT!;
const BASE_ID = process.env.AIRTABLE_BASE_ID!;
const HEADERS = {
  Authorization: `Bearer ${PAT}`,
  'Content-Type': 'application/json',
};

const META_URL = `https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`;
const BASE_URL = `https://api.airtable.com/v0/${BASE_ID}`;

// Default OWP org config
const OWP_ORG_ID = 'org_owp_001';
const OWP_ORG_NAME = 'One Way Plumbing LLC';
const ADMIN_EMAIL = 'admin@onewayplumbing.com';
const ADMIN_PASSWORD = 'cortex2026'; // Will be bcrypt hashed
const ADMIN_NAME = 'Steven Yoo';

async function createTable(name: string, fields: Record<string, unknown>[]) {
  console.log(`\n📦 Creating table: ${name}...`);
  const res = await fetch(META_URL, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      name,
      fields,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    if (err.includes('DUPLICATE_TABLE_NAME') || err.includes('already exists')) {
      console.log(`   ⚠️  Table "${name}" already exists, skipping creation.`);
      return null;
    }
    throw new Error(`Failed to create table ${name}: ${res.status} ${err}`);
  }
  const data = await res.json();
  console.log(`   ✅ Created table "${name}" (ID: ${data.id})`);
  return data;
}

async function createRecord(tableName: string, fields: Record<string, unknown>) {
  const res = await fetch(`${BASE_URL}/${encodeURIComponent(tableName)}`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to create record in ${tableName}: ${res.status} ${err}`);
  }
  return await res.json();
}

async function fetchRecords(tableName: string, filterFormula?: string) {
  const params = new URLSearchParams({ pageSize: '100' });
  if (filterFormula) params.set('filterByFormula', filterFormula);
  const res = await fetch(
    `${BASE_URL}/${encodeURIComponent(tableName)}?${params}`,
    { headers: HEADERS }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to fetch ${tableName}: ${res.status} ${err}`);
  }
  const data = await res.json();
  return data.records || [];
}

async function updateRecord(tableName: string, recordId: string, fields: Record<string, unknown>) {
  const res = await fetch(`${BASE_URL}/${encodeURIComponent(tableName)}/${recordId}`, {
    method: 'PATCH',
    headers: HEADERS,
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to update record ${recordId} in ${tableName}: ${res.status} ${err}`);
  }
  return await res.json();
}

async function addFieldToTable(tableId: string, fieldConfig: Record<string, unknown>) {
  const res = await fetch(`${META_URL.replace('/tables', '')}/tables/${tableId}/fields`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(fieldConfig),
  });
  if (!res.ok) {
    const err = await res.text();
    if (err.includes('DUPLICATE_FIELD_NAME') || err.includes('already exists')) {
      console.log(`   ⚠️  Field already exists, skipping.`);
      return null;
    }
    throw new Error(`Failed to add field: ${res.status} ${err}`);
  }
  return await res.json();
}

async function getTableId(tableName: string): Promise<string | null> {
  const res = await fetch(META_URL.replace('/tables', ''), {
    headers: HEADERS,
  });
  if (!res.ok) return null;
  const data = await res.json();
  const table = data.tables?.find((t: { name: string; id: string }) => t.name === tableName);
  return table?.id || null;
}

async function main() {
  console.log('🚀 Setting up multi-tenant auth for Project Cortex\n');
  console.log(`   Base ID: ${BASE_ID}`);
  console.log(`   Org: ${OWP_ORG_NAME}`);
  console.log(`   Admin: ${ADMIN_EMAIL}`);

  // ── Step 1: Create ORGANIZATIONS table ──────────────────────
  await createTable('ORGANIZATIONS', [
    { name: 'Organization ID', type: 'singleLineText' },
    { name: 'Organization Name', type: 'singleLineText' },
    { name: 'Owner Email', type: 'email' },
    {
      name: 'Plan',
      type: 'singleSelect',
      options: {
        choices: [
          { name: 'free', color: 'grayLight2' },
          { name: 'pro', color: 'blueLight2' },
          { name: 'enterprise', color: 'purpleLight2' },
        ],
      },
    },
    { name: 'Created At', type: 'dateTime', options: { timeZone: 'America/Los_Angeles', dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' } } },
    { name: 'Google Drive Folder ID', type: 'singleLineText' },
    { name: 'Alert Email Enabled', type: 'checkbox', options: { icon: 'check', color: 'greenBright' } },
    { name: 'Weekly Report Enabled', type: 'checkbox', options: { icon: 'check', color: 'greenBright' } },
    { name: 'Logo URL', type: 'url' },
    { name: 'Active', type: 'checkbox', options: { icon: 'check', color: 'greenBright' } },
    { name: 'Onboarding Complete', type: 'checkbox', options: { icon: 'check', color: 'greenBright' } },
  ]);

  // ── Step 2: Create USERS table ──────────────────────────────
  await createTable('USERS', [
    { name: 'User ID', type: 'singleLineText' },
    { name: 'Organization ID', type: 'singleLineText' },
    { name: 'Email', type: 'email' },
    { name: 'Name', type: 'singleLineText' },
    { name: 'Password Hash', type: 'singleLineText' },
    {
      name: 'Role',
      type: 'singleSelect',
      options: {
        choices: [
          { name: 'owner', color: 'purpleBright' },
          { name: 'admin', color: 'blueBright' },
          { name: 'member', color: 'greenBright' },
          { name: 'viewer', color: 'grayBright' },
        ],
      },
    },
    { name: 'Active', type: 'checkbox', options: { icon: 'check', color: 'greenBright' } },
    { name: 'Created At', type: 'dateTime', options: { timeZone: 'America/Los_Angeles', dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' } } },
    { name: 'Last Login', type: 'dateTime', options: { timeZone: 'America/Los_Angeles', dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' } } },
    { name: 'Phone', type: 'phoneNumber' },
    { name: 'Alert Preferences', type: 'multilineText' },
  ]);

  // ── Step 3: Add Organization ID field to PROJECTS ───────────
  console.log('\n📝 Adding Organization ID field to PROJECTS table...');
  const projectsTableId = await getTableId('PROJECTS');
  if (projectsTableId) {
    const url = `https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables/${projectsTableId}/fields`;
    const res = await fetch(url, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        name: 'Organization ID',
        type: 'singleLineText',
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      if (err.includes('DUPLICATE_FIELD_NAME') || err.includes('already exists')) {
        console.log('   ⚠️  Field already exists, skipping.');
      } else {
        console.error(`   ❌ Failed to add field: ${res.status} ${err}`);
      }
    } else {
      console.log('   ✅ Added Organization ID field to PROJECTS');
    }
  } else {
    console.error('   ❌ Could not find PROJECTS table');
  }

  // ── Step 4: Seed OWP organization ───────────────────────────
  console.log('\n🏢 Seeding OWP organization...');

  // Check if org already exists
  const existingOrgs = await fetchRecords('ORGANIZATIONS', `{Organization ID}='${OWP_ORG_ID}'`);
  if (existingOrgs.length > 0) {
    console.log('   ⚠️  OWP org already exists, skipping seed.');
  } else {
    await createRecord('ORGANIZATIONS', {
      'Organization ID': OWP_ORG_ID,
      'Organization Name': OWP_ORG_NAME,
      'Owner Email': ADMIN_EMAIL,
      'Plan': 'pro',
      'Created At': new Date().toISOString(),
      'Google Drive Folder ID': process.env.GOOGLE_DRIVE_FOLDER_ID || '',
      'Alert Email Enabled': true,
      'Weekly Report Enabled': true,
      'Active': true,
      'Onboarding Complete': true,
    });
    console.log('   ✅ Created OWP organization');
  }

  // ── Step 5: Seed admin user ─────────────────────────────────
  console.log('\n👤 Seeding admin user...');

  const existingUsers = await fetchRecords('USERS', `{Email}='${ADMIN_EMAIL}'`);
  if (existingUsers.length > 0) {
    console.log('   ⚠️  Admin user already exists, skipping seed.');
  } else {
    const hash = await bcrypt.hash(ADMIN_PASSWORD, 12);
    await createRecord('USERS', {
      'User ID': 'usr_owp_001',
      'Organization ID': OWP_ORG_ID,
      'Email': ADMIN_EMAIL,
      'Name': ADMIN_NAME,
      'Password Hash': hash,
      'Role': 'owner',
      'Active': true,
      'Created At': new Date().toISOString(),
      'Alert Preferences': JSON.stringify({
        budget_threshold: true,
        labor_critical: true,
        co_pending: true,
        document_processed: true,
      }),
    });
    console.log(`   ✅ Created admin user: ${ADMIN_EMAIL}`);
  }

  // ── Step 6: Tag existing projects with OWP org ID ───────────
  console.log('\n🏗️  Tagging existing projects with OWP org ID...');

  const projects = await fetchRecords('PROJECTS');
  let tagged = 0;
  for (const proj of projects) {
    const currentOrgId = proj.fields?.['Organization ID'];
    if (!currentOrgId) {
      await updateRecord('PROJECTS', proj.id, { 'Organization ID': OWP_ORG_ID });
      tagged++;
      // Rate limit protection
      await new Promise(r => setTimeout(r, 250));
    }
  }
  console.log(`   ✅ Tagged ${tagged} projects with org ID ${OWP_ORG_ID} (${projects.length - tagged} already tagged)`);

  // ── Done ────────────────────────────────────────────────────
  console.log('\n✅ Multi-tenant setup complete!');
  console.log('\n📋 Summary:');
  console.log(`   Org:   ${OWP_ORG_NAME} (${OWP_ORG_ID})`);
  console.log(`   Admin: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  console.log(`   Role:  owner`);
  console.log('\n💡 Next: Build auth-v2.ts, update middleware, update API routes.');
}

main().catch((err) => {
  console.error('\n❌ Setup failed:', err);
  process.exit(1);
});
