/**
 * Seed default document categories for orgs that don't have any.
 * Targets: Rhema Tech, Rhema Electric, Lone Star Electric, and any other missing orgs.
 * Run: npx tsx scripts/seed-missing-categories.ts
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env', override: true });

import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(url, key);

const DEFAULT_CATEGORIES = [
  { key: 'contracts', label: 'Contracts & Agreements', priority: 'high', sort_order: 1, search_keywords: ['contract', 'agreement', 'subcontract', 'master service'] },
  { key: 'change_orders', label: 'Change Orders', priority: 'high', sort_order: 2, search_keywords: ['change order', 'co', 'modification', 'amendment'] },
  { key: 'invoices', label: 'Invoices & Billing', priority: 'high', sort_order: 3, search_keywords: ['invoice', 'billing', 'payment', 'pay application'] },
  { key: 'submittals', label: 'Submittals', priority: 'medium', sort_order: 4, search_keywords: ['submittal', 'shop drawing', 'product data'] },
  { key: 'rfis', label: 'RFIs', priority: 'medium', sort_order: 5, search_keywords: ['rfi', 'request for information'] },
  { key: 'drawings', label: 'Drawings & Plans', priority: 'medium', sort_order: 6, search_keywords: ['drawing', 'plan', 'blueprint', 'as-built'] },
  { key: 'specs', label: 'Specifications', priority: 'medium', sort_order: 7, search_keywords: ['specification', 'spec', 'scope of work', 'sow'] },
  { key: 'insurance', label: 'Insurance & Bonds', priority: 'medium', sort_order: 8, search_keywords: ['insurance', 'bond', 'certificate', 'coi', 'surety'] },
  { key: 'safety', label: 'Safety & Compliance', priority: 'medium', sort_order: 9, search_keywords: ['safety', 'osha', 'compliance', 'incident'] },
  { key: 'correspondence', label: 'Correspondence', priority: 'low', sort_order: 10, search_keywords: ['letter', 'email', 'memo', 'notice', 'loi'] },
  { key: 'reports', label: 'Reports', priority: 'low', sort_order: 11, search_keywords: ['report', 'daily', 'weekly', 'progress', 'schedule'] },
  { key: 'other', label: 'Other / Uncategorized', priority: 'low', sort_order: 99, search_keywords: [] },
];

async function main() {
  const { data: orgs, error: orgErr } = await sb
    .from('organizations')
    .select('org_id, org_name')
    .eq('active', true);

  if (orgErr || !orgs) {
    console.error('Failed to fetch orgs:', orgErr?.message);
    process.exit(1);
  }

  console.log(`Found ${orgs.length} active org(s)\n`);

  for (const org of orgs) {
    const { count } = await sb
      .from('document_categories')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', org.org_id);

    if (count && count > 0) {
      console.log(`  ✓ ${org.org_name} (${org.org_id}) — already has ${count} categories`);
      continue;
    }

    console.log(`  → ${org.org_name} (${org.org_id}) — seeding ${DEFAULT_CATEGORIES.length} categories...`);

    const rows = DEFAULT_CATEGORIES.map((cat) => ({
      org_id: org.org_id,
      key: cat.key,
      label: cat.label,
      priority: cat.priority,
      sort_order: cat.sort_order,
      search_keywords: cat.search_keywords,
      is_default: true,
      created_by: null,
    }));

    const { error: insertErr } = await sb.from('document_categories').insert(rows);
    if (insertErr) {
      console.error(`    ✗ Failed: ${insertErr.message}`);
    } else {
      console.log(`    ✓ Seeded ${rows.length} categories`);
    }
  }

  console.log('\nDone!');
}

main().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
