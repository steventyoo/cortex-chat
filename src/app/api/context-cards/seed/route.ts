import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE, SessionPayload } from '@/lib/auth-v2';
import { getSupabase } from '@/lib/supabase';
import { generateEmbedding } from '@/lib/embeddings';

const SEED_CARDS = [
  {
    card_name: 'unbilled_co_recovery',
    display_name: 'Unbilled Change Order Recovery',
    description: 'Identify change orders that have been approved but not yet billed or where billing is incomplete.',
    trigger_concepts: ['unbilled', 'CO recovery', 'billing gap', 'approved but not billed', 'revenue leakage'],
    skills_involved: ['change_order', 'job_cost_report'],
    business_logic: `To find unbilled COs:
1. Query change_order records where Status = 'Approved' or 'Executed'
2. Compare the Approved Amount to the Billed Amount field
3. Records where Billed Amount < Approved Amount represent unbilled revenue
4. Cross-reference with job_cost_report to verify costs were incurred
5. Key metric: Total Unbilled = SUM(Approved Amount - Billed Amount) where Billed Amount < Approved Amount`,
    key_fields: { change_order: ['Status', 'Approved_Amount', 'Billed_Amount', 'CO_Number'], job_cost_report: ['Cost_Code', 'Actual_Cost'] },
    example_questions: ['Are there any approved change orders we haven\'t billed yet?', 'What is our total unbilled CO exposure?', 'Which COs have billing gaps?'],
  },
  {
    card_name: 'bid_accuracy_analysis',
    display_name: 'Bid Accuracy Analysis',
    description: 'Compare original bid estimates to actual job costs to measure estimating accuracy.',
    trigger_concepts: ['bid accuracy', 'estimate vs actual', 'estimating variance', 'over-estimate', 'under-estimate'],
    skills_involved: ['estimate', 'job_cost_report'],
    business_logic: `To analyze bid accuracy:
1. Query estimate records for bid amounts and line items
2. Query job_cost_report records for actual costs
3. Match by project and cost code where possible
4. Calculate variance: (Actual - Estimated) / Estimated * 100
5. Group by project type, trade, or size range to find patterns
6. Negative variance = under budget (good), Positive = over budget (bad)`,
    key_fields: { estimate: ['Total_Amount', 'Line_Items', 'Project_Type'], job_cost_report: ['Budget_Amount', 'Actual_Cost', 'Cost_Code'] },
    example_questions: ['How accurate are our bids?', 'Which project types do we over-estimate?', 'Compare bid to actual across projects'],
  },
  {
    card_name: 'bid_sweet_spot',
    display_name: 'Bid Sweet Spot Identification',
    description: 'Find the optimal project size and type ranges where the company is most profitable.',
    trigger_concepts: ['sweet spot', 'optimal project size', 'most profitable projects', 'ideal bid range'],
    skills_involved: ['estimate', 'job_cost_report'],
    business_logic: `To find the bid sweet spot:
1. Query all estimates with their Total_Amount
2. Cross-reference with job_cost_report actuals for completed projects
3. Calculate margin: (Contract_Value - Actual_Cost) / Contract_Value
4. Group projects into size ranges (e.g., <$100K, $100K-500K, $500K-1M, >$1M)
5. The sweet spot is the size range with the highest average margin AND win rate
6. Also factor in project_type and trade if available`,
    key_fields: { estimate: ['Total_Amount', 'Project_Type', 'Trade'], job_cost_report: ['Budget_Amount', 'Actual_Cost'] },
    example_questions: ['What size projects are we most profitable on?', 'Where is our bidding sweet spot?', 'What is our ideal project range?'],
  },
  {
    card_name: 'subcontractor_benchmarking',
    display_name: 'Subcontractor Tier Benchmarking',
    description: 'Compare subcontractor performance by pricing, reliability, and quality.',
    trigger_concepts: ['sub benchmark', 'vendor comparison', 'subcontractor ranking', 'best subs', 'sub pricing'],
    skills_involved: ['sub_bid', 'change_order', 'submittal'],
    business_logic: `To benchmark subcontractors:
1. Query sub_bid records grouped by Vendor/Subcontractor name
2. For pricing: compare bid amounts for similar scopes across subs
3. For reliability: cross-reference with change_order records to see which subs generate the most COs
4. For quality: check submittal approval rates and rejection counts
5. Rank subs by: lowest average bid, fewest COs generated, highest submittal approval rate
6. The best sub has competitive pricing AND low CO/rejection rates`,
    key_fields: { sub_bid: ['Vendor', 'Bid_Amount', 'Trade', 'Scope'], change_order: ['Vendor', 'Status', 'Amount'], submittal: ['Vendor', 'Status'] },
    example_questions: ['Who gives us the best pricing?', 'Compare our subcontractor bids by trade', 'Which subs are most reliable?'],
  },
  {
    card_name: 'change_order_exposure',
    display_name: 'Change Order Exposure Analysis',
    description: 'Analyze total change order exposure by status, type, and GC.',
    trigger_concepts: ['CO exposure', 'change order total', 'pending COs', 'CO breakdown', 'change order status'],
    skills_involved: ['change_order'],
    business_logic: `To analyze CO exposure:
1. Query all change_order records
2. Group by Status (Pending, Approved, Rejected, Draft)
3. Calculate: Total Pending = SUM(Amount) WHERE Status = 'Pending'
4. Calculate: Total Approved = SUM(Amount) WHERE Status = 'Approved'
5. Show breakdown by CO type (owner-directed, field condition, design error) if available
6. Flag any COs over 90 days pending as at-risk`,
    key_fields: { change_order: ['Status', 'Amount', 'CO_Number', 'Description', 'Date_Submitted'] },
    example_questions: ['What is our total CO exposure?', 'Break down change orders by status', 'How many COs are pending?'],
  },
  {
    card_name: 'project_cost_health',
    display_name: 'Project Cost Health Check',
    description: 'Assess overall project financial health by comparing budget, actuals, and commitments.',
    trigger_concepts: ['cost health', 'budget status', 'over budget', 'under budget', 'project financials'],
    skills_involved: ['job_cost_report', 'change_order'],
    business_logic: `To check project cost health:
1. Query job_cost_report for all cost codes
2. Calculate: Total Budget = SUM(Budget_Amount), Total Actual = SUM(Actual_Cost)
3. Budget Variance = Total Actual - Total Budget (negative = under budget)
4. Budget Variance % = Variance / Total Budget * 100
5. Flag cost codes where actual > 110% of budget as 🔴
6. Cross-reference with change_order approved amounts to adjust expectations
7. Health: 🟢 <95% budget, ⚠️ 95-105%, 🔴 >105%`,
    key_fields: { job_cost_report: ['Cost_Code', 'Description', 'Budget_Amount', 'Actual_Cost', 'Committed_Cost'] },
    example_questions: ['Are we over budget?', 'What is the project cost status?', 'Which cost codes are over budget?'],
  },
  {
    card_name: 'submittal_tracking',
    display_name: 'Submittal Status Tracking',
    description: 'Track submittal log status, approval rates, and identify bottlenecks.',
    trigger_concepts: ['submittal status', 'submittal log', 'approval pipeline', 'pending submittals', 'submittal bottleneck'],
    skills_involved: ['submittal'],
    business_logic: `To track submittals:
1. Query all submittal records
2. Group by Status (Submitted, Approved, Rejected, Pending Review, Resubmit)
3. Calculate approval rate: Approved / (Approved + Rejected)
4. Identify bottlenecks: submittals pending > 14 days
5. Group by trade/spec section to find which areas are delayed
6. Flag any critical submittals (structural, MEP) that aren't approved`,
    key_fields: { submittal: ['Submittal_Number', 'Description', 'Status', 'Date_Submitted', 'Trade', 'Spec_Section'] },
    example_questions: ['What submittals are pending?', 'What is our submittal approval rate?', 'Which submittals are delayed?'],
  },
  {
    card_name: 'design_change_impact',
    display_name: 'Design Change Impact Analysis',
    description: 'Quantify the full cost and schedule impact of design changes.',
    trigger_concepts: ['design change', 'ASI impact', 'bulletin impact', 'design modification cost'],
    skills_involved: ['design_change', 'change_order', 'rfi'],
    business_logic: `To quantify design change impact:
1. Query design_change records for all modifications
2. Link each design change to resulting change_orders by description/reference
3. Sum the CO amounts attributable to each design change
4. Check rfi records for related clarification requests
5. Total Impact = SUM(CO amounts linked to design changes)
6. Categorize: owner-directed vs. error/omission vs. field condition`,
    key_fields: { design_change: ['Description', 'Type', 'Date', 'Impact'], change_order: ['Amount', 'Description', 'Reason'], rfi: ['Subject', 'Response'] },
    example_questions: ['What is the cost impact of design changes?', 'Which design changes generated the most COs?', 'How do design changes affect our schedule?'],
  },
  {
    card_name: 'labor_productivity',
    display_name: 'Labor Productivity Analysis',
    description: 'Analyze labor productivity by comparing planned vs actual hours and output rates.',
    trigger_concepts: ['labor productivity', 'crew efficiency', 'hours per unit', 'production rate', 'foreman performance'],
    skills_involved: ['production_activity', 'daily_report', 'job_cost_report'],
    business_logic: `To analyze labor productivity:
1. Query production_activity for hours worked and quantities installed
2. Calculate unit rate: Hours / Quantity for each activity
3. Compare actual unit rates to estimated/budgeted rates from job_cost_report
4. Group by foreman/crew if available in daily_report
5. Best performers have lowest hours-per-unit AND highest quality
6. Flag activities where actual rate > 1.2x budgeted rate`,
    key_fields: { production_activity: ['Activity', 'Hours', 'Quantity', 'Crew_Size', 'Foreman'], daily_report: ['Date', 'Weather', 'Crew_Count'], job_cost_report: ['Budget_Hours', 'Actual_Hours'] },
    example_questions: ['How is our labor productivity?', 'Which crews are most efficient?', 'Where are we losing productivity?'],
  },
  {
    card_name: 'material_cost_tracking',
    display_name: 'Material Cost Escalation Tracking',
    description: 'Track material cost changes between bid time and actual procurement.',
    trigger_concepts: ['material escalation', 'price increase', 'material cost', 'procurement cost'],
    skills_involved: ['estimate', 'job_cost_report'],
    business_logic: `To track material escalation:
1. Query estimate records for material line items and their bid prices
2. Query job_cost_report for actual material costs
3. Calculate escalation: (Actual - Estimated) / Estimated * 100
4. Group by material type/category
5. Materials with >10% escalation should be flagged for future bid adjustments
6. Consider adding escalation clauses for high-volatility materials`,
    key_fields: { estimate: ['Material_Items', 'Material_Cost', 'Unit_Price'], job_cost_report: ['Cost_Code', 'Material_Cost', 'Actual_Cost'] },
    example_questions: ['Which materials have seen the biggest price increases?', 'How much has material escalation cost us?', 'Compare bid material prices to actuals'],
  },
  {
    card_name: 'contract_risk_review',
    display_name: 'Contract Risk Review',
    description: 'Identify risky contract clauses and terms that affect project outcomes.',
    trigger_concepts: ['contract risk', 'contract terms', 'penalty clause', 'liquidated damages', 'payment terms'],
    skills_involved: ['contract'],
    business_logic: `To review contract risks:
1. Query contract records for key terms
2. Flag: liquidated damages clauses, no-damage-for-delay, pay-when-paid
3. Identify retention percentage and release conditions
4. Check payment terms (net 30, 45, 60 — longer = higher risk)
5. Look for flow-down clauses that transfer risk
6. Risk score: count of unfavorable clauses`,
    key_fields: { contract: ['Contract_Value', 'Payment_Terms', 'Retention_Rate', 'Key_Clauses', 'Penalties'] },
    example_questions: ['What are the riskiest contract terms?', 'What are the payment terms?', 'Are there liquidated damages?'],
  },
  {
    card_name: 'rfi_response_tracking',
    display_name: 'RFI Response Tracking',
    description: 'Track RFI submission and response timelines to identify delays.',
    trigger_concepts: ['RFI tracking', 'RFI response time', 'pending RFIs', 'RFI delays'],
    skills_involved: ['rfi'],
    business_logic: `To track RFIs:
1. Query all rfi records
2. Calculate response time: Date_Responded - Date_Submitted
3. Flag RFIs without response > 14 days as delayed
4. Group by responsible party to identify slow responders
5. Average response time is a key project health indicator
6. Unresolved RFIs can indicate coordination issues`,
    key_fields: { rfi: ['RFI_Number', 'Subject', 'Date_Submitted', 'Date_Responded', 'Status', 'Responsible_Party'] },
    example_questions: ['How long do RFIs take to get answered?', 'Which RFIs are still pending?', 'Who is slowest to respond to RFIs?'],
  },
  {
    card_name: 'safety_compliance',
    display_name: 'Safety & Inspection Compliance',
    description: 'Track safety inspection results and compliance rates.',
    trigger_concepts: ['safety', 'inspection', 'compliance', 'violations', 'OSHA'],
    skills_involved: ['safety_inspection', 'daily_report'],
    business_logic: `To assess safety compliance:
1. Query safety_inspection records
2. Group by result: Pass, Fail, Corrective Action Required
3. Calculate compliance rate: Pass / Total * 100
4. Identify repeat violations by type
5. Cross-reference with daily_report for incident mentions
6. Flag any areas with <90% compliance`,
    key_fields: { safety_inspection: ['Inspection_Type', 'Result', 'Date', 'Violations', 'Corrective_Actions'], daily_report: ['Safety_Notes', 'Incidents'] },
    example_questions: ['What is our safety compliance rate?', 'Are there any repeated safety violations?', 'Show me recent inspection results'],
  },
  {
    card_name: 'project_document_completeness',
    display_name: 'Document Completeness Check',
    description: 'Assess whether all expected document types are present for a project.',
    trigger_concepts: ['document completeness', 'missing documents', 'coverage check', 'what data do we have'],
    skills_involved: [],
    business_logic: `To check document completeness:
1. Use project_overview tool to get document_inventory
2. Expected document types for a typical project: estimate, contract, sub_bid, submittal, rfi, change_order, daily_report, job_cost_report, production_activity
3. Flag any expected types with 0 records
4. For financial analysis: need at minimum estimate + job_cost_report
5. For operations analysis: need daily_report + production_activity
6. Completeness score: (types with data) / (expected types) * 100`,
    key_fields: {},
    example_questions: ['What data do we have for this project?', 'Are we missing any document types?', 'How complete is our project documentation?'],
  },
  {
    card_name: 'gc_payment_velocity',
    display_name: 'GC Payment Velocity Scoring',
    description: 'Score GCs by how quickly they process change orders and payments.',
    trigger_concepts: ['payment velocity', 'GC payment speed', 'slow payer', 'payment timing'],
    skills_involved: ['change_order', 'contract'],
    business_logic: `To score GC payment velocity:
1. Query change_order records grouped by GC/owner
2. Calculate average approval time: Date_Approved - Date_Submitted
3. If billing data available: time from approval to payment
4. Score: <30 days = Fast (🟢), 30-60 = Average (⚠️), >60 = Slow (🔴)
5. Consider contract payment terms as baseline
6. Best GCs: fastest approval AND fastest payment after approval`,
    key_fields: { change_order: ['Date_Submitted', 'Date_Approved', 'Amount', 'Status'], contract: ['Payment_Terms', 'Owner'] },
    example_questions: ['Which GCs pay the fastest?', 'How long does it take to get COs approved?', 'Score our GCs by payment speed'],
  },
];

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session || !['owner', 'admin'].includes(session.role)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const orgId = (session as SessionPayload).orgId;
  const sb = getSupabase();

  const { data: existing } = await sb
    .from('context_cards')
    .select('card_name')
    .eq('org_id', orgId);

  const existingNames = new Set((existing || []).map((c: { card_name: string }) => c.card_name));
  const toInsert = SEED_CARDS.filter(c => !existingNames.has(c.card_name));

  if (toInsert.length === 0) {
    return Response.json({ message: 'All context cards already exist', seeded: 0 });
  }

  let seeded = 0;
  const errors: string[] = [];

  for (const card of toInsert) {
    let embeddingStr: string | null = null;

    if (process.env.OPENAI_API_KEY) {
      try {
        const text = [
          card.display_name,
          card.description,
          ...card.trigger_concepts,
          ...card.example_questions,
        ].join('\n');
        const embedding = await generateEmbedding(text);
        embeddingStr = `[${embedding.join(',')}]`;
      } catch (err) {
        console.error(`Failed to embed card ${card.card_name}:`, err);
      }
    }

    const { error } = await sb.from('context_cards').insert({
      org_id: orgId,
      ...card,
      embedding: embeddingStr,
      created_by: session.userId,
    });

    if (error) {
      errors.push(`${card.card_name}: ${error.message}`);
    } else {
      seeded++;
    }
  }

  return Response.json({
    message: `Seeded ${seeded} context cards${errors.length > 0 ? `, ${errors.length} errors` : ''}`,
    seeded,
    errors: errors.length > 0 ? errors : undefined,
  });
}
