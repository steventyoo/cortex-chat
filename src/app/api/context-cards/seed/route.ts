import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE, SessionPayload } from '@/lib/auth-v2';
import { getSupabase } from '@/lib/supabase';
import { generateEmbedding } from '@/lib/embeddings';

const SEED_CARDS = [
  {
    card_name: 'unbilled_co_recovery',
    display_name: 'Unbilled Change Order Recovery',
    description: 'Identify approved change orders not yet billed, design changes stuck in pipeline, and ghost work from bulletins that should have generated CORs.',
    trigger_concepts: ['unbilled', 'CO recovery', 'billing gap', 'approved but not billed', 'revenue leakage', 'ghost work', 'pipeline stall', 'missed revenue'],
    skills_involved: ['change_order', 'contract', 'design_change', 'job_cost_report', 'project_admin'],
    business_logic: `To find unbilled CO revenue:
1. Query change_order records where status is Approved/Executed. Compare GC Proposed Amount vs Owner Approved Amount to find negotiation shrinkage. Sum Negotiation Delta by GC to rank recovery rates.
2. Cross-reference with design_change records: find PRs/PCOs with Conversion Rate Flag = false (never became COs). Check Estimated Missed Revenue field. Flag bulletins where PR/CO Generated = No (ghost work).
3. Trace the pipeline: ASI → PR/PCO → CO (link_type: asi_generates_co, pco_rolled_into_co). Measure Pipeline Duration to find stall points. Stalled items = cash stuck in limbo.
4. Check JCR: CO Absorption Rate by cost code reveals which phases absorb change scope. High absorption + over budget = CO scope underpriced.
5. Verify billing: CO → Pay App (link_type: co_billed_in_payapp). COs approved but not in pay apps = unbilled revenue.
6. Check contract Historical Dispute Flag to predict recovery difficulty by GC.
Key metric: Total Unbilled = SUM(Approved COs not in Pay Apps) + SUM(Estimated Missed Revenue from unconverted design changes).`,
    key_fields: {
    change_order: ['Change Reason (Root Cause)', 'Dates (Initiated / Approved / Closed)', 'Disputed (Y/N) + Outcome', 'GC Proposed Amount', 'Markup Applied', 'Negotiation Delta ($)', 'Originating Document Chain', 'Owner Approved Amount'],
    contract: ['Historical Dispute Flag'],
    design_change: ['Approval Status', 'Classification (Bulletin)', 'Conversion Rate Flag', 'Cost Impact (ASI)', 'Document Type (PR/PCO/COR)', 'Estimated Missed Revenue', 'Originating Event', 'PR/CO Generated? (Bulletin)', 'Pipeline Duration (days)', 'Proposed Amount (PR)', 'Resulting PR/CO', 'Stall Point (if delayed)'],
    job_cost_report: ['CO Absorption Rate (line)', 'Change Orders (line)', 'Total Change Orders'],
    project_admin: ['Disputed / Held Items'],
  },
    example_questions: ['Are there any approved change orders we haven\'t billed yet?', 'What is our total unbilled CO exposure?', 'Which design changes are stuck in the pipeline?', 'Are there bulletins that should have generated COs but didn\'t?', 'What is our CO recovery rate by GC?'],
    calc_function: 'change_orders.unbilled_recovery',
    sql_templates: {
      co_data: `SELECT source_file, fields->'GC Proposed Amount'->>'value' as gc_proposed_amount, fields->'Owner Approved Amount'->>'value' as owner_approved_amount, fields->'Change Reason (Root Cause)'->>'value' as change_reason, fields->'Disputed (Y/N) + Outcome'->>'value' as disputed, fields->'Negotiation Delta ($)'->>'value' as negotiation_delta FROM extracted_records WHERE skill_id = 'change_order' AND project_id = {{project_id}}`,
      dc_data: `SELECT source_file, fields->'Conversion Rate Flag'->>'value' as conversion_rate_flag, fields->'Estimated Missed Revenue'->>'value' as estimated_missed_revenue, fields->'Approval Status'->>'value' as approval_status, fields->'Pipeline Duration (days)'->>'value' as pipeline_duration FROM extracted_records WHERE skill_id = 'design_change' AND project_id = {{project_id}}`,
    },
  },
  {
    card_name: 'retention_float_acceleration',
    display_name: 'Retention Float Acceleration',
    description: 'Analyze retention held across projects, identify blockers to release, and quantify cash flow impact of accelerating closeout.',
    trigger_concepts: ['retention', 'retainage', 'punch list', 'closeout', 'float', 'retention release', 'cash tied up'],
    skills_involved: ['design_change', 'project_admin'],
    business_logic: `To accelerate retention release:
1. Query project_admin for Retainage Held across all active projects. This is the total cash float locked up.
2. Calculate retention release readiness: Current Contract Value × retention % - amount already released. Check Days to Complete Punch List for closeout velocity.
3. Identify blockers: pending design changes (Approval Status != Approved), open PR/COR pipeline (Pipeline Duration still running), and disputed items.
4. Trace cash flow chain: CO → Pay App (link_type: co_billed_in_payapp) ensures COs are billed. JCR → Pay App (link_type: payapp_vs_jcr) catches overbilling/underbilling. Punch List → Retention Release (link_type: punchlist_to_retention) tracks closeout.
5. Score projects by release-readiness: punch list completion %, open design changes, disputed items count.
6. Compare Days to Payment and Payment Received Date across GCs to rank payment velocity.
Key metric: Total Retainage Held × (% projects ready for release) = actionable cash float.`,
    key_fields: {
    design_change: ['Approval Status', 'Pipeline Duration (days)'],
    project_admin: ['Billed This Period', 'Current Contract Value', 'Days to Complete Punch List', 'Days to Payment', 'Payment Received Date', 'Retainage Held', 'Scheduled Value (original SOV)'],
  },
    example_questions: ['How much retention do we have held across all projects?', 'Which projects are closest to retention release?', 'What is blocking our retention release?', 'How fast do different GCs release retention?'],
    calc_function: 'cash_flow.retention_readiness',
    sql_templates: {
      admin_data: `SELECT source_file, project_id, fields->'Retainage Held'->>'value' as retainage_held, fields->'Days to Complete Punch List'->>'value' as days_to_complete_punch_list, fields->'Total Punch Items'->>'value' as total_punch_items, fields->'Days to Payment'->>'value' as days_to_payment FROM extracted_records WHERE skill_id = 'project_admin' AND project_id = {{project_id}}`,
      dc_data: `SELECT source_file, fields->'Approval Status'->>'value' as approval_status, fields->'Pipeline Duration (days)'->>'value' as pipeline_duration FROM extracted_records WHERE skill_id = 'design_change' AND project_id = {{project_id}}`,
    },
  },
  {
    card_name: 'tm_work_underbilling',
    display_name: 'T&M Work Under-Billing',
    description: 'Detect time-and-material work where billed amounts are less than actual costs by comparing CO billing, production hours, and daily report crew data.',
    trigger_concepts: ['T&M', 'time and material', 'under-billing', 'unbilled hours', 'markup gap', 'T&M tickets'],
    skills_involved: ['change_order', 'daily_report', 'design_change', 'job_cost_report', 'production_activity'],
    business_logic: `To detect T&M under-billing:
1. Query change_order records for T&M type COs. Compare GC Proposed Amount to actual costs. Check Markup Applied for consistency — inconsistent markup by GC = under-billing pattern.
2. Cross-reference with production_activity: Total Labor Hours worked and Hours by Type (Regular/OT/DT) — T&M rates differ by hour type. Hours not captured in CO billing = revenue leak.
3. Validate with daily_report: Crews on Site (headcounts) and Work Performed descriptions should match T&M tickets. Missing daily report entries for T&M days = documentation gap.
4. Check design_change: ASIs with Cost Impact that triggered T&M work — was the T&M cost fully captured? Compare Estimated Missed Revenue. CCD Final Approved Amount vs GC Proposed Amount delta = T&M leakage.
5. Compare JCR Job-to-Date Cost by cost code against T&M billing totals.
Key metric: (Actual Labor Hours × Rate) + Materials + Markup - Billed Amount = Under-billing per project.`,
    key_fields: {
    change_order: ['GC Proposed Amount', 'Markup Applied'],
    daily_report: ['Crews on Site (Structured)', 'Work Performed (Structured)'],
    design_change: ['Cost Impact (ASI)', 'Estimated Missed Revenue', 'Final Approved Amount (CCD)', 'GC Proposed Amount (CCD)'],
    job_cost_report: ['Job-to-Date Cost (line)'],
    production_activity: ['Hours by Type', 'Total Labor Hours'],
  },
    example_questions: ['Are we under-billing on T&M work?', 'Which projects have the biggest T&M billing gaps?', 'Compare T&M billed hours to actual production hours', 'Is our markup being applied consistently on T&M work?'],
    calc_function: 'billing.tm_underbilling',
    sql_templates: {
      co_data: `SELECT source_file, fields->'GC Proposed Amount'->>'value' as gc_proposed_amount, fields->'Markup Applied'->>'value' as markup_applied, fields->'Change Reason (Root Cause)'->>'value' as change_reason FROM extracted_records WHERE skill_id = 'change_order' AND project_id = {{project_id}}`,
      prod_data: `SELECT source_file, fields->'Total Labor Hours'->>'value' as total_labor_hours, fields->'Hours by Type'->>'value' as hours_by_type FROM extracted_records WHERE skill_id = 'production_activity' AND project_id = {{project_id}}`,
    },
  },
  {
    card_name: 'back_charge_defense',
    display_name: 'Back-Charge Defense',
    description: 'Build evidence chains to defend against or prosecute back-charges using contracts, daily reports, RFIs, submittals, and production data.',
    trigger_concepts: ['back-charge', 'back charge', 'dispute', 'defense', 'claim', 'liability', 'notice', 'documentation'],
    skills_involved: ['change_order', 'contract', 'daily_report', 'estimate', 'production_activity', 'project_admin', 'rfi', 'submittal'],
    business_logic: `To build back-charge defense:
1. Query change_order: Disputed (Y/N) + Outcome and Change Reason (Root Cause). Track Negotiation Delta by GC. Originating Document Chain proves causation.
2. Assess contract risk: Risk Score, Clause Category (especially LD, no-damage-for-delay, pay-when-paid), Risk Direction, Historical Dispute Flag by GC.
3. Check documentation strength: daily_report Issues/Delays Reported (contemporaneous notice = strongest defense), Work Performed proves what was done. Timeliness of contractual notices — late notices = forfeited claims.
4. Cross-reference: submittal Status/Disposition = Approved proves work met spec. RFI Responsibility Attribution supports delay claims. estimate Key Assumptions & Exclusions = #1 defense against scope back-charges.
5. Production evidence: Disruption Cause Categories and Responsible Party attribute fault. Check project_admin Back-Charges Issued, Notice Timeliness.
6. Trace: Contract Clause → CO (link_type: contract_clause_to_co) predicts dispute rates. Contract Clause → Back-Charge (link_type: contract_clause_to_co).
Key metric: Defense score = (documentation completeness × contract favorability × notice timeliness) per dispute.`,
    key_fields: {
    change_order: ['Change Reason (Root Cause)', 'Disputed (Y/N) + Outcome', 'GC Proposed Amount', 'Negotiation Delta ($)', 'Originating Document Chain', 'Owner Approved Amount'],
    contract: ['Clause Category (12 types)', 'Historical Dispute Flag', 'Risk Direction', 'Risk Score (1–5)'],
    daily_report: ['Issues / Delays Reported', 'Work Performed (Structured)'],
    estimate: ['Key Assumptions & Exclusions'],
    production_activity: ['Disruption Cause Categories', 'Responsible Party'],
    project_admin: ['Back-Charges Issued?', 'Contractual Notice?', 'Disputed / Held Items', 'Notice Timeliness'],
    rfi: ['Responsibility Attribution'],
    submittal: ['Status / Disposition'],
  },
    example_questions: ['What back-charges have been issued against us?', 'Do we have documentation to defend this back-charge?', 'Which GCs dispute COs most frequently?', 'Were our contractual notices filed on time?', 'What are our riskiest contract clauses?'],
    calc_function: 'risk_and_scoring.back_charge_score',
    sql_templates: {
      co_data: `SELECT source_file, fields->'Disputed (Y/N) + Outcome'->>'value' as disputed, fields->'Change Reason (Root Cause)'->>'value' as change_reason, fields->'GC Proposed Amount'->>'value' as gc_proposed_amount, fields->'Negotiation Delta ($)'->>'value' as negotiation_delta FROM extracted_records WHERE skill_id = 'change_order' AND project_id = {{project_id}}`,
      contract_data: `SELECT source_file, fields->'Risk Score (1–5)'->>'value' as risk_score, fields->'Clause Category (12 types)'->>'value' as clause_category, fields->'Historical Dispute Flag'->>'value' as historical_dispute_flag FROM extracted_records WHERE skill_id = 'contract' AND project_id = {{project_id}}`,
      admin_data: `SELECT source_file, fields->'Notice Timeliness'->>'value' as notice_timeliness, fields->'Back-Charges Issued?'->>'value' as back_charges_issued FROM extracted_records WHERE skill_id = 'project_admin' AND project_id = {{project_id}}`,
    },
  },
  {
    card_name: 'warranty_callback_reduction',
    display_name: 'Warranty Callback Cost Reduction',
    description: 'Trace warranty failures back to original crews, installation methods, and design changes to find patterns and reduce callback costs.',
    trigger_concepts: ['warranty', 'callback', 'warranty claim', 'defect', 'rework pattern', 'post-closeout'],
    skills_involved: ['change_order', 'design_change', 'job_cost_report', 'production_activity', 'project_admin'],
    business_logic: `To reduce warranty callback costs:
1. Query project_admin: Warranty Items (post-closeout) by trade (Items by Trade). Track Days to Complete Punch List — slow punch list completion correlates with more warranty items.
2. Trace to production: Warranty Item → Production/Crew (link_type: warranty_to_production). Match warranty failures to original Rework Cause (Workmanship vs Design), installation crew, and method.
3. Check production_activity: Rework Today flag, Rework Cost, and Rework Labor Hours quantify the pattern. Group by crew/foreman to find repeat offenders.
4. Look upstream: design_change Rework Required flag — design changes requiring rework have higher warranty rates. change_order Change Reason roots causes to prevention.
5. JCR Lessons Learned / Estimating Flag closes the loop — flag warranty-prone scopes for future bids.
Key metric: Warranty cost per project × frequency of callbacks by trade = targeted reduction opportunity.`,
    key_fields: {
    change_order: ['Change Reason (Root Cause)'],
    design_change: ['Rework Required?'],
    job_cost_report: ['Lessons Learned / Estimating Flag'],
    production_activity: ['Rework Cause', 'Rework Cost', 'Rework Labor Hours', 'Rework Today?'],
    project_admin: ['Days to Complete Punch List', 'Items by Trade (Punch)', 'Warranty Items (post-closeout)'],
  },
    example_questions: ['What are our warranty callback costs by trade?', 'Which crews have the most warranty issues?', 'Are design changes causing warranty problems?', 'What is the pattern in our punch list and warranty items?'],
    calc_function: 'billing.warranty_callback_cost',
    sql_templates: {
      admin_data: `SELECT source_file, fields->'Warranty Items (post-closeout)'->>'value' as warranty_items, fields->'Days to Complete Punch List'->>'value' as days_to_complete_punch_list, fields->'Total Punch Items'->>'value' as total_punch_items, fields->'Items by Trade (Punch)'->>'value' as items_by_trade FROM extracted_records WHERE skill_id = 'project_admin' AND project_id = {{project_id}}`,
      prod_data: `SELECT source_file, fields->'Rework Cost'->>'value' as rework_cost, fields->'Rework Cause'->>'value' as rework_cause, fields->'Rework Labor Hours'->>'value' as rework_labor_hours FROM extracted_records WHERE skill_id = 'production_activity' AND project_id = {{project_id}}`,
    },
  },
  {
    card_name: 'gc_profitability_contradiction',
    display_name: 'GC Profitability Contradiction',
    description: 'Expose GCs that appear profitable on the surface but destroy margin through slow payments, CO shrinkage, disputes, and hidden costs.',
    trigger_concepts: ['GC profitability', 'GC ranking', 'hidden costs', 'profitable GC', 'margin erosion', 'GC analysis', 'true profitability by GC'],
    skills_involved: ['change_order', 'contract', 'design_change', 'estimate', 'job_cost_report', 'project_admin'],
    business_logic: `To expose GC profitability contradictions:
1. Query change_order by GC: CO approval rates (Owner Approved / GC Proposed), Negotiation Delta patterns, Disputed outcomes, resolution time from Dates.
2. Score contract risk by GC: Risk Score, Clause Category (unfavorable clauses count), Historical Dispute Flag, Risk Direction.
3. Check design_change by GC: Approval Status rates, Disputed CCDs, CCD Final Approved vs GC Proposed delta = margin erosion per GC. Estimated Missed Revenue from unconverted changes.
4. Compute true margin: estimate Fee/Markup Structure × JCR Estimated Margin at Completion. Factor in CO Absorption Rate — high absorption + over budget = scope underpriced for this GC.
5. Add project_admin costs: Days to Payment (cash flow cost), Back-Charges, Retainage Held duration, Current Contract Value growth.
6. Cross-ref: Contract Clause → CO dispute rate (link_type: contract_clause_to_co). Sub Bid → Sub Performance (link_type: subbid_vs_co) by GC project.
Key metric: True GC Score = Margin - (CO shrinkage + dispute cost + payment delay cost + back-charges) per GC.`,
    key_fields: {
    change_order: ['Change Reason (Root Cause)', 'Dates (Initiated / Approved / Closed)', 'Disputed (Y/N) + Outcome', 'GC Proposed Amount', 'Negotiation Delta ($)', 'Owner Approved Amount'],
    contract: ['Clause Category (12 types)', 'Historical Dispute Flag', 'Risk Direction', 'Risk Score (1–5)'],
    design_change: ['Approval Status', 'Disputed? (CCD)', 'Estimated Missed Revenue', 'Final Approved Amount (CCD)', 'GC Proposed Amount (CCD)'],
    estimate: ['Fee / Markup Structure'],
    job_cost_report: ['CO Absorption Rate (line)', 'Change Orders (line)', 'Estimated Margin at Completion', 'Total Change Orders'],
    project_admin: ['Back-Charges Issued?', 'Current Contract Value', 'Days to Payment', 'Retainage Held'],
  },
    example_questions: ['Which GCs are actually profitable for us after all costs?', 'Rank our GCs by true profitability', 'Which GC has the biggest gap between apparent and true margin?', 'Who gives us the most CO shrinkage?', 'Compare GC dispute rates and payment velocity'],
    calc_function: 'financial.gc_profitability_score',
    sql_templates: {
      co_data: `SELECT source_file, project_id, fields->'GC Proposed Amount'->>'value' as gc_proposed_amount, fields->'Owner Approved Amount'->>'value' as owner_approved_amount, fields->'Negotiation Delta ($)'->>'value' as negotiation_delta, fields->'Disputed (Y/N) + Outcome'->>'value' as disputed FROM extracted_records WHERE skill_id = 'change_order' AND project_id = {{project_id}}`,
      admin_data: `SELECT source_file, project_id, fields->'Days to Payment'->>'value' as days_to_payment, fields->'Back-Charges Issued?'->>'value' as back_charges_issued, fields->'Retainage Held'->>'value' as retainage_held FROM extracted_records WHERE skill_id = 'project_admin' AND project_id = {{project_id}}`,
    },
  },
  {
    card_name: 'gc_payment_velocity',
    display_name: 'GC Payment Velocity Scoring',
    description: 'Score GCs by how quickly they approve COs, process CCDs, and pay invoices to identify fast and slow payers.',
    trigger_concepts: ['payment velocity', 'GC payment speed', 'slow payer', 'payment timing', 'days to payment', 'cash flow by GC'],
    skills_involved: ['change_order', 'contract', 'design_change', 'project_admin'],
    business_logic: `To score GC payment velocity:
1. Query change_order: Calculate CO approval time from Dates (Initiated/Approved/Closed). Group by GC. Compare GC Proposed vs Owner Approved amounts for approval completeness.
2. Check design_change: Days CCD to Price Agreement (hidden cash flow delay), Pipeline Duration (PR-to-CO approval velocity by GC).
3. Query project_admin: Days to Payment (core KPI), Payment Received Date for actual velocity.
4. Factor contract terms: Clause Category for payment-related clauses. Contract Clause → Payment Terms (link_type: contract_to_payment_terms) defines the baseline.
5. Score: <30 days = Fast, 30-60 = Average, >60 = Slow. Weight by dollar volume.
Key metric: Weighted average Days to Payment across all payment types (invoices + COs + CCDs) per GC.`,
    key_fields: {
    change_order: ['Dates (Initiated / Approved / Closed)', 'GC Proposed Amount', 'Owner Approved Amount'],
    contract: ['Clause Category (12 types)'],
    design_change: ['Days CCD to Price Agreement', 'Pipeline Duration (days)'],
    project_admin: ['Days to Payment', 'Payment Received Date'],
  },
    example_questions: ['Which GCs pay the fastest?', 'Score our GCs by payment speed', 'How long does each GC take to approve COs?', 'What is our average days-to-payment by GC?'],
    calc_function: 'cash_flow.payment_velocity_score',
    sql_templates: {
      admin_data: `SELECT source_file, project_id, fields->'Days to Payment'->>'value' as days_to_payment, fields->'Payment Received Date'->>'value' as payment_received_date FROM extracted_records WHERE skill_id = 'project_admin' AND project_id = {{project_id}}`,
      co_data: `SELECT source_file, project_id, fields->'Dates (Initiated / Approved / Closed)'->>'value' as co_dates, fields->'GC Proposed Amount'->>'value' as gc_proposed_amount FROM extracted_records WHERE skill_id = 'change_order' AND project_id = {{project_id}}`,
    },
  },
  {
    card_name: 'gc_co_approval_rate',
    display_name: 'GC Change Order Approval Rate Analysis',
    description: 'Analyze CO approval rates, negotiation patterns, and pipeline conversion by GC to optimize change management strategy.',
    trigger_concepts: ['CO approval rate', 'change order approval', 'negotiation', 'CO rejection', 'approval pattern', 'GC approval'],
    skills_involved: ['change_order', 'contract', 'design_change', 'job_cost_report'],
    business_logic: `To analyze GC CO approval rates:
1. Query change_order by GC: Approval Rate = Owner Approved Amount / GC Proposed Amount. Track Negotiation Delta ($) — the core metric. Group by Change Reason to find which types get approved.
2. Check Markup Applied consistency by GC — some GCs reject high-markup COs. Track Disputed (Y/N) + Outcome patterns.
3. Analyze design_change pipeline: Conversion Rate Flag (did COR become approved CO?), Pipeline Duration by GC, Stall Points where money gets stuck. Compare PR Proposed Amount to final CO amount.
4. Factor contract context: Risk Score, Historical Dispute Flag, Clause Category predict approval difficulty. Contract Clause → CO (link_type: contract_clause_to_co).
5. JCR validation: CO Absorption Rate reveals if approved COs cover actual costs. Total Change Orders as % of budget = scope growth.
6. Trace full pipeline: PR/PCO → CO (link_type: pco_rolled_into_co) conversion rates by GC.
Key metric: Net Approval Rate = (Total Approved / Total Proposed) by GC, weighted by dollar amount.`,
    key_fields: {
    change_order: ['Change Reason (Root Cause)', 'Dates (Initiated / Approved / Closed)', 'Disputed (Y/N) + Outcome', 'GC Proposed Amount', 'Markup Applied', 'Negotiation Delta ($)', 'Owner Approved Amount'],
    contract: ['Clause Category (12 types)', 'Historical Dispute Flag', 'Risk Direction', 'Risk Score (1–5)'],
    design_change: ['Approval Status', 'Conversion Rate Flag', 'Disputed? (CCD)', 'Document Type (PR/PCO/COR)', 'Final Approved Amount (CCD)', 'GC Proposed Amount (CCD)', 'Pipeline Duration (days)', 'Proposed Amount (PR)', 'Stall Point (if delayed)'],
    job_cost_report: ['CO Absorption Rate (line)', 'Change Orders (line)', 'Total Change Orders'],
  },
    example_questions: ['What is our CO approval rate by GC?', 'Which GCs reject the most change orders?', 'Where do our COs get stuck in the pipeline?', 'How much do we lose in CO negotiations by GC?'],
    calc_function: 'change_orders.co_approval_rate',
    sql_templates: {
      co_data: `SELECT source_file, project_id, fields->'GC Proposed Amount'->>'value' as gc_proposed_amount, fields->'Owner Approved Amount'->>'value' as owner_approved_amount, fields->'Negotiation Delta ($)'->>'value' as negotiation_delta, fields->'Change Reason (Root Cause)'->>'value' as change_reason, fields->'Markup Applied'->>'value' as markup_applied FROM extracted_records WHERE skill_id = 'change_order' AND project_id = {{project_id}}`,
    },
  },
  {
    card_name: 'gc_risk_concentration',
    display_name: 'GC Risk Concentration Alert',
    description: 'Alert when too much revenue or backlog is concentrated with high-risk GCs based on contract terms, dispute history, and CO patterns.',
    trigger_concepts: ['risk concentration', 'GC risk', 'portfolio risk', 'customer concentration', 'backlog risk'],
    skills_involved: ['change_order', 'contract', 'design_change'],
    business_logic: `To assess GC risk concentration:
1. Query contract by GC: Risk Score (1-5), Clause Category (count unfavorable clauses), Risk Direction, Historical Dispute Flag.
2. Calculate revenue concentration: estimate Total Bid Amount and change_order GC Proposed Amount by GC as % of total portfolio.
3. Factor behavioral risk: design_change Disputed CCDs rate by GC — CCD disputes are a core risk signal.
4. Cross-reference: Contract Clause → CO (link_type: contract_clause_to_co) — unfavorable clauses predict higher dispute rates.
5. Risk Score = (contract risk × revenue concentration × dispute history). Flag GCs where >30% of backlog AND risk score > 3.
Key metric: Concentration Risk Index = % of revenue from GCs with Risk Score > 3.`,
    key_fields: {
    change_order: ['GC Proposed Amount'],
    contract: ['Clause Category (12 types)', 'Historical Dispute Flag', 'Risk Direction', 'Risk Score (1–5)'],
    design_change: ['Disputed? (CCD)'],
  },
    example_questions: ['Are we too concentrated with risky GCs?', 'Which GCs have the highest risk scores?', 'What percentage of our backlog is with high-risk GCs?'],
    calc_function: 'risk_and_scoring.risk_concentration',
    sql_templates: {
      contract_data: `SELECT source_file, project_id, fields->'Risk Score (1–5)'->>'value' as risk_score, fields->'Clause Category (12 types)'->>'value' as clause_category, fields->'Historical Dispute Flag'->>'value' as historical_dispute_flag FROM extracted_records WHERE skill_id = 'contract' AND project_id = {{project_id}}`,
      co_data: `SELECT source_file, project_id, fields->'GC Proposed Amount'->>'value' as gc_proposed_amount FROM extracted_records WHERE skill_id = 'change_order' AND project_id = {{project_id}}`,
    },
  },
  {
    card_name: 'gc_pm_performance',
    display_name: 'GC Project Manager Performance Tracking',
    description: 'Track GC project manager performance across projects by budget outcomes, sub management, and coordination quality.',
    trigger_concepts: ['PM performance', 'project manager', 'GC PM', 'PM tracking', 'management quality'],
    skills_involved: ['change_order', 'rfi', 'sub_bid', 'job_cost_report'],
    business_logic: `To track GC PM performance:
1. Query job_cost_report: Total Over/Under Budget by project, grouped by GC PM. This is the core performance metric.
2. Cross-reference with change_order patterns: CO volume, approval rates, and resolution times under each PM.
3. Check RFI response times and resolution quality by PM — slow RFI responses indicate poor coordination.
4. Sub Bid → Sub Performance (link_type: subbid_vs_co) — track sub CO rates on projects managed by each PM.
5. Rank PMs by: budget performance, CO velocity, RFI response quality, sub management.
Key metric: Average Over/Under Budget across projects per GC PM.`,
    key_fields: {
    change_order: ['Dates (Initiated / Approved / Closed)', 'GC Proposed Amount', 'Owner Approved Amount'],
    job_cost_report: ['Total Over/Under Budget'],
    rfi: ['Response Time (calendar days)', 'Responsibility Attribution'],
  },
    example_questions: ['Which GC PMs give us the best project outcomes?', 'Rank project managers by budget performance', 'Which PMs have the slowest CO approvals?'],
    calc_function: 'risk_and_scoring.gc_pm_ranking',
    sql_templates: {
      jcr_data: `SELECT source_file, project_id, fields->'Total Over/Under Budget'->>'value' as total_over_under_budget FROM extracted_records WHERE skill_id = 'job_cost_report' AND project_id = {{project_id}}`,
      co_data: `SELECT source_file, project_id, fields->'GC Proposed Amount'->>'value' as gc_proposed_amount, fields->'Owner Approved Amount'->>'value' as owner_approved_amount FROM extracted_records WHERE skill_id = 'change_order' AND project_id = {{project_id}}`,
    },
  },
  {
    card_name: 'bid_accuracy_by_project_type',
    display_name: 'Bid Accuracy by Project Type',
    description: 'Compare bid estimates to actual costs segmented by project type, building type, and size to find systematic estimating patterns.',
    trigger_concepts: ['bid accuracy', 'estimate vs actual', 'estimating variance', 'over-estimate', 'under-estimate', 'bid performance'],
    skills_involved: ['contract', 'estimate', 'job_cost_report', 'production_activity'],
    business_logic: `To analyze bid accuracy:
1. Query estimate: Total Bid Amount, Final Project Cost (if complete), Project Type, Building Type, Gross Square Footage, Total Cost per SF. Calculate Overall Estimating Accuracy Score.
2. Break down by division: Cost Breakdown by Division vs Final Cost by Division. Variance Explanation by Division categorizes reasons for misses.
3. Cross-reference JCR: Compare Revised Budget vs Job-to-Date Cost at line level. Track % Budget Consumed, Over/Under Budget by cost code. Variance Root Cause per line is the most valuable field.
4. Factor context: Design Completeness at Bid (incomplete CDs → systematic underestimating), Market Condition at Bid, Key Assumptions & Exclusions.
5. Check production_activity Production Rate (actual field productivity by project type) — THE bid accuracy feedback loop.
6. Contract Recommended Contingency % — did we bid enough contingency?
7. Trace: Estimate → Actual Cost (link_type: estimate_vs_jcr), JCR → Estimate feedback (link_type: estimate_vs_jcr).
Key metric: Accuracy Score = 1 - |Actual - Estimated| / Estimated, grouped by Project Type.`,
    key_fields: {
    contract: ['Recommended Contingency %'],
    estimate: ['Bid Result', 'Building Type', 'Contract Amount (if won)', 'Cost Breakdown by Division', 'Design Completeness at Bid', 'Final Cost by Division', 'Final Project Cost (if complete)', 'Gross Square Footage', 'Key Assumptions & Exclusions', 'Market Condition at Bid', 'Overall Estimating Accuracy Score', 'Project Type', 'Total Bid Amount', 'Total Cost per SF (Bid)', 'Variance Explanation by Division'],
    job_cost_report: ['% Budget Consumed (line)', 'CO Absorption Rate (line)', 'CSI Division (Primary) — JCR', 'Change Orders (line)', 'Cost Category', 'Cost-to-Complete Estimate', 'Estimated Labor Rate (from bid)', 'Estimated Margin at Completion', 'Job-to-Date Cost (line)', 'Lessons Learned / Estimating Flag', 'Line Item Forecast to Complete', 'Over/Under Budget — $ (line)', 'Overall % Budget Consumed', 'Project Type', 'Report Period', 'Revised Budget (line)', 'Total Change Orders', 'Total Job-to-Date Cost', 'Total Over/Under Budget', 'Total Revised Budget', 'Variance Root Cause (per line)', 'Variance Trend (vs prior period)', 'Work Phase / Activity'],
    production_activity: ['Production Rate (calculated)'],
  },
    example_questions: ['How accurate are our bids by project type?', 'Which project types do we consistently over-estimate?', 'What are the main reasons for bid misses?', 'Compare bid to actual cost across completed projects'],
    calc_function: 'variance.bid_accuracy',
    sql_templates: {
      estimate_data: `SELECT source_file, project_id, fields->'Total Bid Amount'->>'value' as total_bid_amount, fields->'Project Type'->>'value' as project_type, fields->'Building Type'->>'value' as building_type, fields->'Gross Square Footage'->>'value' as gross_square_footage FROM extracted_records WHERE skill_id = 'estimate' AND project_id = {{project_id}}`,
      jcr_data: `SELECT source_file, project_id, fields->'Total Job-to-Date Cost'->>'value' as total_jtd_cost, fields->'Total Revised Budget'->>'value' as total_revised_budget, fields->'Estimated Margin at Completion'->>'value' as estimated_margin_at_completion FROM extracted_records WHERE skill_id = 'job_cost_report' AND project_id = {{project_id}}`,
    },
  },
  {
    card_name: 'bid_sweet_spot',
    display_name: 'Bid Sweet Spot Identification',
    description: 'Find optimal project size, type, and market conditions where the company wins most and achieves highest margins.',
    trigger_concepts: ['sweet spot', 'optimal project size', 'most profitable projects', 'ideal bid range', 'win rate', 'best project type'],
    skills_involved: ['estimate', 'job_cost_report'],
    business_logic: `To find the bid sweet spot:
1. Query estimate: Total Bid Amount, Project Type, Building Type, Gross Square Footage, Total Cost per SF, Bid Result (Win/Loss), Contract Amount (if won), Market Condition at Bid.
2. Calculate win rate by segment: Group by Project Type × size range × Building Type. Win/Loss Analysis Notes reveal competitive intelligence.
3. For won projects: Cross-reference JCR Estimated Margin at Completion, Overall % Budget Consumed, Total Job-to-Date Cost vs Total Revised Budget.
4. Sweet spot = intersection of highest win rate AND highest margin. Plot Project Type × Size Range → Win Rate and Margin.
5. Factor market conditions: Market Condition at Bid shifts the sweet spot.
Key metric: Sweet Spot Score = Win Rate × Average Margin per segment.`,
    key_fields: {
    estimate: ['Bid Result', 'Building Type', 'Contract Amount (if won)', 'Final Project Cost (if complete)', 'Gross Square Footage', 'Market Condition at Bid', 'Project Type', 'Total Bid Amount', 'Total Cost per SF (Bid)', 'Win/Loss Analysis Notes'],
    job_cost_report: ['Estimated Margin at Completion', 'Overall % Budget Consumed', 'Project Type', 'Total Job-to-Date Cost', 'Total Revised Budget'],
  },
    example_questions: ['What size projects are we most profitable on?', 'Where is our bidding sweet spot?', 'What is our win rate by project type?', 'Which market conditions favor our bidding?'],
    calc_function: 'risk_and_scoring.bid_sweet_spot',
    sql_templates: {
      estimate_data: `SELECT source_file, project_id, fields->'Total Bid Amount'->>'value' as total_bid_amount, fields->'Project Type'->>'value' as project_type, fields->'Bid Result'->>'value' as bid_result, fields->'Building Type'->>'value' as building_type, fields->'Market Condition at Bid'->>'value' as market_condition FROM extracted_records WHERE skill_id = 'estimate'`,
    },
  },
  {
    card_name: 'labor_hour_estimation_variance',
    display_name: 'Labor Hour Estimation Variance',
    description: 'Compare estimated labor hours and rates to actuals at the phase and activity level to calibrate future bids.',
    trigger_concepts: ['labor variance', 'hours variance', 'labor estimation', 'production rate vs estimate', 'labor overrun'],
    skills_involved: ['daily_report', 'estimate', 'job_cost_report', 'production_activity'],
    business_logic: `To analyze labor hour estimation variance:
1. Query estimate: Cost Breakdown by Division, Final Cost by Division, Variance Explanation by Division. Check Design Completeness at Bid and Key Assumptions.
2. Compare to JCR at line level: Quantity (labor hours), Estimated Labor Rate vs actual Labor Productivity Rate ($/hr). Variance Root Cause per line categorizes why hours differed.
3. Cross-reference production_activity: Activity Type, Total Labor Hours, Production Rate (calculated) vs Estimated Production Rate. Daily Production vs Plan tracks drift daily.
4. Validate with daily_report: Work Performed descriptions feed production schema.
5. Track by Work Phase / Activity in JCR: Rough-In vs Underground vs Finish vs Startup — core for labor variance.
6. Trace: JCR → Production Activity (link_type: production_vs_jcr) for rate validation. Estimate → Actual Cost feedback loop.
Key metric: Labor Variance = (Actual Hours - Estimated Hours) / Estimated Hours by phase and activity type.`,
    key_fields: {
    daily_report: ['Work Performed (Structured)'],
    estimate: ['Building Type', 'Cost Breakdown by Division', 'Design Completeness at Bid', 'Final Cost by Division', 'Final Project Cost (if complete)', 'Gross Square Footage', 'Key Assumptions & Exclusions', 'Overall Estimating Accuracy Score', 'Project Type', 'Total Bid Amount', 'Variance Explanation by Division'],
    job_cost_report: ['% Budget Consumed (line)', 'CSI Division (Primary) — JCR', 'Cost Category', 'Estimated Labor Rate (from bid)', 'Job-to-Date Cost (line)', 'Labor Productivity Rate ($/hr)', 'Labor-to-Material Ratio', 'Lessons Learned / Estimating Flag', 'Over/Under Budget — $ (line)', 'Project Type', 'Quantity (labor hours or units)', 'Report Period', 'Revised Budget (line)', 'Total Job-to-Date Cost', 'Total Over/Under Budget', 'Total Revised Budget', 'Variance Root Cause (per line)', 'Variance Trend (vs prior period)', 'Work Phase / Activity'],
    production_activity: ['Activity Type', 'CSI Division', 'Daily Production vs Plan', 'Estimated Production Rate', 'Production Rate (calculated)', 'Quantity Installed', 'Total Labor Hours', 'Unit of Measure'],
  },
    example_questions: ['How do our labor hour estimates compare to actuals?', 'Which work phases have the biggest labor overruns?', 'What is our production rate vs what we estimated?', 'Where are we consistently underestimating labor?'],
    calc_function: 'variance.labor_hour_variance',
    sql_templates: {
      prod_data: `SELECT source_file, fields->'Activity Type'->>'value' as activity_type, fields->'Total Labor Hours'->>'value' as total_labor_hours, fields->'Production Rate (calculated)'->>'value' as production_rate, fields->'Estimated Production Rate'->>'value' as estimated_production_rate, fields->'Daily Production vs Plan'->>'value' as daily_production_vs_plan FROM extracted_records WHERE skill_id = 'production_activity' AND project_id = {{project_id}}`,
    },
  },
  {
    card_name: 'material_cost_escalation',
    display_name: 'Material Cost Escalation Tracking',
    description: 'Track material cost changes between bid time and actual procurement, grouped by CSI division and material type.',
    trigger_concepts: ['material escalation', 'price increase', 'material cost', 'procurement cost', 'material variance', 'escalation clause'],
    skills_involved: ['estimate', 'job_cost_report', 'submittal'],
    business_logic: `To track material escalation:
1. Query estimate: Cost Breakdown by Division (material lines), Final Cost by Division, Escalation Assumptions, Variance Explanation by Division, Market Condition at Bid.
2. Compare to JCR: Material Price Variance (flags Price Increase vs Quantity Overrun vs Under-Procurement). Cost Category = Material lines. CSI Division for trade grouping.
3. Calculate: (Actual Material Cost - Bid Material Cost) / Bid Material Cost × 100 by CSI division.
4. Check submittal Procurement Critical flag — long-lead items with price volatility = highest risk.
5. Trace: Estimate → Actual Cost feedback (link_type: estimate_vs_jcr) closes the loop.
6. Recommend: Materials with >10% escalation should trigger escalation clause review or bid adjustment.
Key metric: Material Escalation % by CSI Division and material category.`,
    key_fields: {
    estimate: ['Cost Breakdown by Division', 'Escalation Assumptions', 'Final Cost by Division', 'Final Project Cost (if complete)', 'Gross Square Footage', 'Market Condition at Bid', 'Project Type', 'Total Bid Amount', 'Variance Explanation by Division'],
    job_cost_report: ['CSI Division (Primary) — JCR', 'Cost Category', 'Material Price Variance', 'Variance Root Cause (per line)'],
    submittal: ['Procurement Critical?'],
  },
    example_questions: ['Which materials have seen the biggest price increases?', 'How much has material escalation cost us?', 'Compare bid material prices to actuals by division', 'Should we be including escalation clauses?'],
    calc_function: 'variance.material_escalation',
    sql_templates: {
      jcr_data: `SELECT source_file, fields->'CSI Division (Primary) — JCR'->>'value' as csi_division, fields->'Material Price Variance'->>'value' as material_price_variance, fields->'Cost Category'->>'value' as cost_category FROM extracted_records WHERE skill_id = 'job_cost_report' AND project_id = {{project_id}}`,
    },
  },
  {
    card_name: 'panic_pricing_elimination',
    display_name: 'Panic Pricing Elimination',
    description: 'Identify bids where pricing was driven by market pressure rather than data, and quantify the margin impact of panic decisions.',
    trigger_concepts: ['panic pricing', 'under-bidding', 'margin compression', 'bid discipline', 'fee structure', 'win rate analysis'],
    skills_involved: ['contract', 'estimate', 'job_cost_report'],
    business_logic: `To eliminate panic pricing:
1. Query estimate: Bid Result, Fee/Markup Structure, Market Condition at Bid, Design Completeness, Overall Estimating Accuracy Score, Win/Loss Analysis Notes.
2. Identify panic bids: low Fee/Markup + hot Market Condition + incomplete Design Completeness = panic pricing pattern.
3. Compare outcomes: JCR Estimated Margin at Completion for panic-priced bids vs disciplined bids. Track % Budget Consumed, Over/Under Budget, Cost-to-Complete.
4. JCR deep dive: Variance Root Cause per line, Variance Trend, Lessons Learned / Estimating Flag. Phase-level Forecast to Complete.
5. Factor contract risk: Risk Score and Recommended Contingency % — did we bid enough contingency for the risk level?
6. Trace: Estimate → Actual Cost, JCR → Estimate feedback (link_type: estimate_vs_jcr).
Key metric: Margin delta = Average margin on disciplined bids - Average margin on panic bids.`,
    key_fields: {
    contract: ['Recommended Contingency %', 'Risk Score (1–5)'],
    estimate: ['Bid Result', 'Design Completeness at Bid', 'Fee / Markup Structure', 'Final Project Cost (if complete)', 'Market Condition at Bid', 'Overall Estimating Accuracy Score', 'Project Type', 'Total Bid Amount', 'Win/Loss Analysis Notes'],
    job_cost_report: ['% Budget Consumed (line)', 'Cost-to-Complete Estimate', 'Estimated Margin at Completion', 'Job-to-Date Cost (line)', 'Lessons Learned / Estimating Flag', 'Line Item Forecast to Complete', 'Over/Under Budget — $ (line)', 'Overall % Budget Consumed', 'Revised Budget (line)', 'Total Job-to-Date Cost', 'Total Over/Under Budget', 'Total Revised Budget', 'Variance Root Cause (per line)', 'Variance Trend (vs prior period)'],
  },
    example_questions: ['Which bids were under-priced due to market pressure?', 'What is the margin difference between panic bids and disciplined bids?', 'Are we bidding with enough contingency?', 'Where do we consistently leave money on the table?'],
    calc_function: 'change_orders.panic_bid_analysis',
    sql_templates: {
      estimate_data: `SELECT source_file, project_id, fields->'Total Bid Amount'->>'value' as total_bid_amount, fields->'Bid Result'->>'value' as bid_result, fields->'Fee / Markup Structure'->>'value' as fee_markup_structure, fields->'Market Condition at Bid'->>'value' as market_condition, fields->'Design Completeness at Bid'->>'value' as design_completeness FROM extracted_records WHERE skill_id = 'estimate'`,
      jcr_data: `SELECT source_file, project_id, fields->'Estimated Margin at Completion'->>'value' as estimated_margin_at_completion, fields->'Total Revised Budget'->>'value' as total_revised_budget FROM extracted_records WHERE skill_id = 'job_cost_report'`,
    },
  },
  {
    card_name: 'foreman_productivity_gap',
    display_name: 'Foreman Productivity Gap Analysis',
    description: 'Rank foremen by production rates, efficiency trends, and cost impact to identify top performers and intervention targets.',
    trigger_concepts: ['foreman productivity', 'crew efficiency', 'production rate', 'foreman ranking', 'productivity gap', 'best crew'],
    skills_involved: ['daily_report', 'job_cost_report', 'production_activity'],
    business_logic: `To analyze foreman productivity gaps:
1. Query production_activity: Production Rate (units per LH), Productive Rate (adjusted for idle/disruption), Cumulative Production Efficiency, Productivity Trend (7-day). Group by foreman/crew.
2. Compare to estimates: Estimated Production Rate vs actual. Daily Production vs Plan tracks daily drift.
3. Factor crew mix: Crew Composition (journeyman/apprentice ratio), Activity Type, CSI Division. Same activity, different crews = productivity gap.
4. Validate with daily_report: Crews on Site, Productivity Indicator (superintendent assessment), Work Performed.
5. Cost impact via JCR: Labor Productivity Rate ($/hr), Quantity (labor hours), Over/Under Budget per cost code. Variance Root Cause = Productivity flags foreman issues. Work Phase / Activity segments the analysis.
6. Track disruptions: Total Disruption Hours monetized at blended rate.
7. Trace: Daily Report → Production Activity (link_type: daily_to_production). JCR → Production Activity (link_type: production_vs_jcr).
Key metric: Production Rate Gap = (Best Foreman Rate - This Foreman Rate) / Best Foreman Rate × 100.`,
    key_fields: {
    daily_report: ['Crews on Site (Structured)', 'Productivity Indicator', 'Work Performed (Structured)'],
    job_cost_report: ['% Budget Consumed (line)', 'CSI Division (Primary) — JCR', 'Cost Category', 'Cost-to-Complete Estimate', 'Estimated Labor Rate (from bid)', 'Job-to-Date Cost (line)', 'Labor Productivity Rate ($/hr)', 'Labor-to-Material Ratio', 'Line Item Forecast to Complete', 'Over/Under Budget — $ (line)', 'Overall % Budget Consumed', 'Quantity (labor hours or units)', 'Report Period', 'Revised Budget (line)', 'Total Job-to-Date Cost', 'Total Over/Under Budget', 'Total Revised Budget', 'Trade / Scope', 'Variance Root Cause (per line)', 'Variance Trend (vs prior period)', 'Work Phase / Activity'],
    production_activity: ['Activity Type', 'CSI Division', 'Crew Composition', 'Cumulative Production Efficiency', 'Daily Production vs Plan', 'Estimated Production Rate', 'Production Rate (calculated)', 'Productive Rate (adjusted)', 'Productivity Trend (7-day)', 'Quantity Installed', 'Total Disruption Hours', 'Total Labor Hours', 'Unit of Measure'],
  },
    example_questions: ['Who are our most productive foremen?', 'What is the productivity gap between best and worst crews?', 'Which foremen are trending down in productivity?', 'How do crew compositions affect production rates?'],
    calc_function: 'productivity.foreman_gap',
    sql_templates: {
      prod_data: `SELECT source_file, fields->'Production Rate (calculated)'->>'value' as production_rate, fields->'Total Labor Hours'->>'value' as total_labor_hours, fields->'Activity Type'->>'value' as activity_type, fields->'Crew Composition'->>'value' as crew_composition, fields->'Cumulative Production Efficiency'->>'value' as cumulative_production_efficiency, fields->'Productivity Trend (7-day)'->>'value' as productivity_trend FROM extracted_records WHERE skill_id = 'production_activity' AND project_id = {{project_id}}`,
    },
  },
  {
    card_name: 'overtime_pattern_detection',
    display_name: 'Overtime Pattern Detection',
    description: 'Detect overtime patterns by project, phase, and crew to quantify cost impact and identify avoidable overtime.',
    trigger_concepts: ['overtime', 'OT', 'double time', 'overtime cost', 'overtime pattern', 'shift differential'],
    skills_involved: ['daily_report', 'job_cost_report', 'production_activity'],
    business_logic: `To detect overtime patterns:
1. Query production_activity: Overtime/Shift data, Total Labor Hours, Activity Type, CSI Division, Productivity Trend (7-day).
2. Correlate overtime with productivity: declining Productivity Trend + increasing overtime = diminishing returns.
3. Validate with daily_report: Crews on Site headcounts, Work Performed, Productivity Indicator.
4. Cost impact via JCR: Labor Productivity Rate changes during OT periods, % Budget Consumed, Over/Under Budget by cost code during OT-heavy periods. Cost Category = Labor lines.
5. JCR Variance Root Cause = Productivity on OT-heavy phases. Track by Work Phase / Activity — which phases drive OT?
6. Trace: Daily Report → Production Activity (link_type: daily_to_production). JCR → Production Activity (link_type: production_vs_jcr).
Key metric: OT Premium Cost = (OT hours × rate premium) + productivity loss during OT periods.`,
    key_fields: {
    daily_report: ['Crews on Site (Structured)', 'Productivity Indicator', 'Work Performed (Structured)'],
    job_cost_report: ['% Budget Consumed (line)', 'CSI Division (Primary) — JCR', 'Cost Category', 'Cost-to-Complete Estimate', 'Job-to-Date Cost (line)', 'Labor Productivity Rate ($/hr)', 'Line Item Forecast to Complete', 'Over/Under Budget — $ (line)', 'Overall % Budget Consumed', 'Quantity (labor hours or units)', 'Report Period', 'Revised Budget (line)', 'Total Job-to-Date Cost', 'Total Over/Under Budget', 'Total Revised Budget', 'Trade / Scope', 'Variance Root Cause (per line)', 'Variance Trend (vs prior period)', 'Work Phase / Activity'],
    production_activity: ['Activity Type', 'CSI Division', 'Overtime / Shift', 'Productivity Trend (7-day)', 'Total Labor Hours'],
  },
    example_questions: ['Where are we working the most overtime?', 'What is the cost impact of overtime by project?', 'Is overtime actually helping productivity or hurting it?', 'Which phases consistently require overtime?'],
    calc_function: 'productivity.overtime_impact',
    sql_templates: {
      prod_data: `SELECT source_file, fields->'Total Labor Hours'->>'value' as total_labor_hours, fields->'Overtime / Shift'->>'value' as overtime_shift, fields->'Activity Type'->>'value' as activity_type, fields->'Production Rate (calculated)'->>'value' as production_rate, fields->'Productivity Trend (7-day)'->>'value' as productivity_trend FROM extracted_records WHERE skill_id = 'production_activity' AND project_id = {{project_id}}`,
    },
  },
  {
    card_name: 'crew_composition_optimization',
    display_name: 'Crew Composition Optimization',
    description: 'Optimize crew mix ratios by analyzing which compositions yield the best production rates for each activity type.',
    trigger_concepts: ['crew mix', 'crew composition', 'staffing optimization', 'crew size', 'optimal crew'],
    skills_involved: ['daily_report', 'job_cost_report', 'production_activity'],
    business_logic: `To optimize crew composition:
1. Query production_activity: Crew Composition, Production Rate, Productive Rate (adjusted), Daily Production vs Plan, Estimated Production Rate. Group by Activity Type × Crew Composition.
2. Compare rates: Same activity with different crew mixes — which composition yields the best Production Rate?
3. Validate with daily_report: Crews on Site, Productivity Indicator, Work Performed.
4. Cost efficiency via JCR: Labor Productivity Rate ($/hr), Labor-to-Material Ratio, Quantity (hours). Trade/Scope and Work Phase segmentation.
5. Optimal crew = highest production rate at lowest $/unit by activity type.
6. Trace: Daily Report → Production Activity (link_type: daily_to_production). JCR → Production Activity (link_type: production_vs_jcr).
Key metric: Best crew composition per Activity Type = highest Production Rate ÷ blended labor rate.`,
    key_fields: {
    daily_report: ['Crews on Site (Structured)', 'Productivity Indicator', 'Work Performed (Structured)'],
    job_cost_report: ['Labor Productivity Rate ($/hr)', 'Labor-to-Material Ratio', 'Quantity (labor hours or units)', 'Trade / Scope', 'Work Phase / Activity'],
    production_activity: ['Activity Type', 'CSI Division', 'Crew Composition', 'Daily Production vs Plan', 'Estimated Production Rate', 'Production Rate (calculated)', 'Productive Rate (adjusted)', 'Quantity Installed', 'Total Labor Hours', 'Unit of Measure'],
  },
    example_questions: ['What is the optimal crew mix for each activity?', 'How does crew composition affect production rates?', 'Are we overstaffing or understaffing certain activities?'],
    calc_function: 'productivity.crew_optimization',
    sql_templates: {
      prod_data: `SELECT source_file, fields->'Crew Composition'->>'value' as crew_composition, fields->'Production Rate (calculated)'->>'value' as production_rate, fields->'Activity Type'->>'value' as activity_type, fields->'Total Labor Hours'->>'value' as total_labor_hours, fields->'Quantity Installed'->>'value' as quantity_installed FROM extracted_records WHERE skill_id = 'production_activity' AND project_id = {{project_id}}`,
    },
  },
  {
    card_name: 'apprentice_journeyman_ratio',
    display_name: 'Apprentice-to-Journeyman Ratio Impact',
    description: 'Analyze how apprentice-to-journeyman ratios affect productivity, cost, and quality across project types.',
    trigger_concepts: ['apprentice ratio', 'journeyman', 'apprentice impact', 'labor mix', 'skill level impact'],
    skills_involved: ['daily_report', 'job_cost_report', 'production_activity'],
    business_logic: `To analyze apprentice/journeyman ratio impact:
1. Query production_activity: Crew Composition (apprentice/journeyman counts), Production Rate, Cumulative Production Efficiency, Daily Production vs Plan. Group by ratio buckets.
2. Compare: Same Activity Type and CSI Division with different ratios — does higher apprentice % reduce production rate?
3. Validate with daily_report: Crews on Site for headcount verification.
4. Cost analysis via JCR: Estimated Labor Rate (bid assumption) vs actual Labor Productivity Rate. Lower apprentice rate × more hours may cost more than higher journeyman rate × fewer hours.
5. Factor: Quantity (labor hours), Cost Category = Labor, Trade/Scope.
6. Trace: JCR → Production Activity (link_type: production_vs_jcr) validates rates.
Key metric: Productivity delta per 10% change in apprentice ratio, by activity type.`,
    key_fields: {
    daily_report: ['Crews on Site (Structured)'],
    job_cost_report: ['Cost Category', 'Estimated Labor Rate (from bid)', 'Labor Productivity Rate ($/hr)', 'Quantity (labor hours or units)', 'Trade / Scope'],
    production_activity: ['Activity Type', 'CSI Division', 'Crew Composition', 'Cumulative Production Efficiency', 'Daily Production vs Plan', 'Production Rate (calculated)', 'Total Labor Hours'],
  },
    example_questions: ['How does the apprentice ratio affect our productivity?', 'What is the optimal apprentice-to-journeyman ratio?', 'Is it cheaper to use more apprentices or fewer journeymen?'],
    calc_function: 'productivity.apprentice_ratio_impact',
    sql_templates: {
      prod_data: `SELECT source_file, fields->'Crew Composition'->>'value' as crew_composition, fields->'Production Rate (calculated)'->>'value' as production_rate, fields->'Activity Type'->>'value' as activity_type, fields->'Cumulative Production Efficiency'->>'value' as cumulative_production_efficiency, fields->'Total Labor Hours'->>'value' as total_labor_hours FROM extracted_records WHERE skill_id = 'production_activity' AND project_id = {{project_id}}`,
    },
  },
  {
    card_name: 'travel_mobilization_cost',
    display_name: 'Travel Time and Mobilization Cost',
    description: 'Quantify non-productive travel and mobilization time as a percentage of total labor cost by project location and size.',
    trigger_concepts: ['travel time', 'mobilization', 'mob/demob', 'non-productive hours', 'travel cost'],
    skills_involved: ['daily_report', 'estimate', 'production_activity'],
    business_logic: `To quantify travel and mobilization costs:
1. Query production_activity: Total Labor Hours, CSI Division. Look for mobilization/travel entries in activity types.
2. Calculate non-productive ratio: travel hours / total hours by project.
3. Correlate with project size: estimate Gross Square Footage — smaller projects = higher mob cost as % of total.
4. Validate with daily_report: Crews on Site timing data.
5. Benchmark: Compare mob cost as % across project sizes to find the breakeven point.
Key metric: Mobilization Cost % = Travel/Mob Hours × Rate / Total Project Labor Cost.`,
    key_fields: {
    daily_report: ['Crews on Site (Structured)'],
    estimate: ['Gross Square Footage'],
    production_activity: ['CSI Division', 'Total Labor Hours'],
  },
    example_questions: ['How much are we spending on travel and mobilization?', 'Which projects have the highest mob costs as a percentage?', 'Is there a project size below which mob costs kill the margin?'],
    calc_function: 'productivity.mobilization_cost',
    sql_templates: {
      prod_data: `SELECT source_file, fields->'Total Labor Hours'->>'value' as total_labor_hours, fields->'CSI Division'->>'value' as csi_division FROM extracted_records WHERE skill_id = 'production_activity' AND project_id = {{project_id}}`,
      estimate_data: `SELECT source_file, fields->'Gross Square Footage'->>'value' as gross_square_footage FROM extracted_records WHERE skill_id = 'estimate' AND project_id = {{project_id}}`,
    },
  },
  {
    card_name: 'design_change_impact',
    display_name: 'Design Change Impact Quantification',
    description: 'Trace the full cost and schedule impact of design changes through the RFI→ASI→CO pipeline, including rework, disruptions, and productivity loss.',
    trigger_concepts: ['design change', 'ASI impact', 'design modification', 'RFI to CO', 'design cost', 'scope change'],
    skills_involved: ['change_order', 'daily_report', 'design_change', 'estimate', 'job_cost_report', 'production_activity', 'rfi', 'submittal'],
    business_logic: `To quantify design change impact:
1. Query design_change: Document Type (PR/PCO/COR), ASI Type (Correction vs Enhancement vs Coordination), Cost Impact, CSI Divisions Affected, Schedule Impact. Track Originating Event, Pipeline Duration, Stall Points.
2. Trace full chain: RFI → ASI (link_type: rfi_triggers_asi), ASI → PR/PCO (link_type: asi_generates_co), PR/PCO → CO (link_type: pco_rolled_into_co), CCD → CO (link_type: ccd_to_co). Measure velocity at each stage.
3. Cost impact: change_order GC Proposed vs Owner Approved by originating design change. Negotiation Delta. Originating Document Chain links back to root cause.
4. Schedule impact: RFI Response Time and Schedule Impact, daily_report Delay Cause Category and Issues/Delays, submittal Review Cycle Time and Schedule Impact of Late Review.
5. Production impact: production_activity Disruption Events, Disruption Cost, Total Disruption Hours, Design/Information Issues. Responsible Party attributes fault.
6. Rework: Rework Required flag on design changes, production Rework Labor Hours at blended rate.
7. Upstream cause: estimate Design Completeness at Bid — incomplete CDs predict more changes. RFI Root Cause (Design Conflict vs Field Condition vs Owner).
8. JCR: Variance Root Cause = Design Changes quantifies total cost impact.
Key metric: Total Design Change Cost = CO amounts + rework cost + disruption cost + schedule delay cost per design change origin.`,
    key_fields: {
    change_order: ['Change Reason (Root Cause)', 'GC Proposed Amount', 'Negotiation Delta ($)', 'Originating Document Chain', 'Owner Approved Amount'],
    daily_report: ['Delay Cause Category', 'Issues / Delays Reported', 'RFI / Issue Cross-Reference', 'Work Performed (Structured)'],
    design_change: ['ASI Type', 'CSI Division(s) Affected', 'Classification (Bulletin)', 'Cost Impact (ASI)', 'Date Issued (ASI)', 'Date Issued / Date Effective (CCD)', 'Days CCD to Price Agreement', 'Document Type (PR/PCO/COR)', 'Estimated Missed Revenue', 'Originating Event', 'PR/CO Generated? (Bulletin)', 'Pipeline Duration (days)', 'Proposed Amount (PR)', 'Resulting PR/CO', 'Rework Required?', 'Schedule Impact (ASI)', 'Stall Point (if delayed)', 'Triggering Document'],
    estimate: ['Design Completeness at Bid'],
    job_cost_report: ['Variance Root Cause (per line)'],
    production_activity: ['Design / Information Issues', 'Disruption Cause Categories', 'Disruption Cost', 'Disruption Events (structured)', 'Responsible Party', 'Total Disruption Hours'],
    rfi: ['CSI Division (Primary)', 'Dates (Submit / Required / Response)', 'Recurring Pattern', 'Response Time (calendar days)', 'Responsibility Attribution', 'Root Cause (Level 1)', 'Root Cause (Level 2)', 'Schedule Impact (Estimated Range)'],
    submittal: ['Dates (Submitted/Required/Returned)', 'Review Cycle Time (days)', 'Schedule Impact of Late Review'],
  },
    example_questions: ['What is the total cost of design changes on this project?', 'How do design changes flow through the RFI to CO pipeline?', 'Which design changes caused the most rework?', 'What is the schedule impact of design changes?'],
    calc_function: 'design_and_rework.design_change_cost_rollup',
    sql_templates: {
      dc_data: `SELECT source_file, fields->'Cost Impact (ASI)'->>'value' as cost_impact, fields->'ASI Type'->>'value' as asi_type, fields->'CSI Division(s) Affected'->>'value' as csi_divisions, fields->'Schedule Impact (ASI)'->>'value' as schedule_impact, fields->'Rework Required?'->>'value' as rework_required FROM extracted_records WHERE skill_id = 'design_change' AND project_id = {{project_id}}`,
      co_data: `SELECT source_file, fields->'GC Proposed Amount'->>'value' as gc_proposed_amount, fields->'Owner Approved Amount'->>'value' as owner_approved_amount, fields->'Change Reason (Root Cause)'->>'value' as change_reason FROM extracted_records WHERE skill_id = 'change_order' AND project_id = {{project_id}}`,
      prod_data: `SELECT source_file, fields->'Rework Cost'->>'value' as rework_cost, fields->'Disruption Cost'->>'value' as disruption_cost, fields->'Total Disruption Hours'->>'value' as total_disruption_hours FROM extracted_records WHERE skill_id = 'production_activity' AND project_id = {{project_id}}`,
    },
  },
  {
    card_name: 'punch_list_cost_pattern',
    display_name: 'Punch List Cost Pattern Analysis',
    description: 'Analyze punch list items by trade, root cause, and cost to find patterns that can be prevented on future projects.',
    trigger_concepts: ['punch list', 'punch items', 'closeout cost', 'punch list pattern', 'deficiency'],
    skills_involved: ['design_change', 'production_activity', 'project_admin', 'rfi'],
    business_logic: `To analyze punch list cost patterns:
1. Query project_admin: Total Punch Items, Items by Trade (Punch), Days to Complete Punch List, Back-Charges Issued, Warranty Items (post-closeout).
2. Trace root causes: production_activity Rework Today flag, Rework Cause (Workmanship vs Design), Rework Cost, Rework Labor Hours.
3. Design origin: design_change Rework Required flag, CSI Divisions Affected. RFI CSI Division ties coordination issues to punch items.
4. Cross-doc: Punch List → Retention Release (link_type: punchlist_to_retention) — completion timing drives cash flow. Warranty Item → Production/Crew (link_type: warranty_to_production) traces failures to crews.
5. Pattern: Group by trade, root cause, project type. Trades with highest punch count AND highest rework cost = priority for prevention.
Key metric: Punch Cost per Trade = (Rework Labor Hours × Rate + Material) grouped by Rework Cause.`,
    key_fields: {
    design_change: ['CSI Division(s) Affected', 'Rework Required?'],
    production_activity: ['Rework Cause', 'Rework Cost', 'Rework Labor Hours', 'Rework Today?'],
    project_admin: ['Back-Charges Issued?', 'Days to Complete Punch List', 'Items by Trade (Punch)', 'Total Punch Items', 'Warranty Items (post-closeout)'],
    rfi: ['CSI Division (Primary)'],
  },
    example_questions: ['Which trades generate the most punch list items?', 'What are the main causes of punch list items?', 'How much does our punch list cost us per project?', 'What is the pattern between punch lists and warranty callbacks?'],
    calc_function: 'design_and_rework.punch_list_cost',
    sql_templates: {
      admin_data: `SELECT source_file, fields->'Total Punch Items'->>'value' as total_punch_items, fields->'Items by Trade (Punch)'->>'value' as items_by_trade, fields->'Days to Complete Punch List'->>'value' as days_to_complete_punch_list, fields->'Warranty Items (post-closeout)'->>'value' as warranty_items FROM extracted_records WHERE skill_id = 'project_admin' AND project_id = {{project_id}}`,
      prod_data: `SELECT source_file, fields->'Rework Cost'->>'value' as rework_cost, fields->'Rework Cause'->>'value' as rework_cause, fields->'Rework Labor Hours'->>'value' as rework_labor_hours FROM extracted_records WHERE skill_id = 'production_activity' AND project_id = {{project_id}}`,
    },
  },
  {
    card_name: 'coordination_rework_reduction',
    display_name: 'Coordination-Driven Rework Reduction',
    description: 'Identify rework caused by coordination failures between trades and design team, and quantify reduction opportunities.',
    trigger_concepts: ['coordination', 'rework', 'clash', 'trade coordination', 'design conflict', 'rework reduction'],
    skills_involved: ['change_order', 'daily_report', 'design_change', 'job_cost_report', 'production_activity', 'rfi', 'submittal'],
    business_logic: `To reduce coordination-driven rework:
1. Query production_activity: Rework Today flag, Rework Cause, Rework Cost, Rework Labor Hours, Disruption Cause Categories, Design/Information Issues, Responsible Party.
2. Trace coordination failures: RFI Root Cause Level 1 (Design Conflict vs Field Condition), Root Cause Level 2 (granular), CSI Division, Response Time, Recurring Pattern.
3. Design team contribution: design_change ASI Type (Coordination issues), CSI Divisions Affected, Triggering Document, Rework Required.
4. Submittal delays: Review Cycle Time, Procurement Critical, Schedule Impact of Late Review.
5. Cost quantification: change_order Change Reason = coordination/rework. JCR Variance Root Cause = Rework or Design Changes.
6. Daily documentation: daily_report Delay Cause Category, Issues/Delays, RFI/Issue Cross-Reference.
7. Trace: RFI → ASI (link_type: rfi_triggers_asi). Inspection → RFI (link_type: inspection_to_rfi).
Key metric: Coordination Rework Cost = SUM(Rework Cost where Rework Cause = Design or Coordination) per project.`,
    key_fields: {
    change_order: ['Change Reason (Root Cause)'],
    daily_report: ['Delay Cause Category', 'Issues / Delays Reported', 'RFI / Issue Cross-Reference'],
    design_change: ['ASI Type', 'CSI Division(s) Affected', 'Date Issued (ASI)', 'Rework Required?', 'Triggering Document'],
    job_cost_report: ['Variance Root Cause (per line)'],
    production_activity: ['Design / Information Issues', 'Disruption Cause Categories', 'Disruption Events (structured)', 'Responsible Party', 'Rework Cause', 'Rework Cost', 'Rework Labor Hours', 'Rework Today?', 'Total Disruption Hours'],
    rfi: ['CSI Division (Primary)', 'Dates (Submit / Required / Response)', 'Recurring Pattern', 'Response Time (calendar days)', 'Responsibility Attribution', 'Root Cause (Level 1)', 'Root Cause (Level 2)', 'Schedule Impact (Estimated Range)'],
    submittal: ['Dates (Submitted/Required/Returned)', 'Procurement Critical?', 'Review Cycle Time (days)', 'Schedule Impact of Late Review'],
  },
    example_questions: ['How much rework is caused by coordination failures?', 'Which trades have the most coordination issues?', 'What is the cost of rework from design conflicts?', 'Are there recurring coordination patterns across projects?'],
    calc_function: 'design_and_rework.coordination_rework_total',
    sql_templates: {
      prod_data: `SELECT source_file, fields->'Rework Cost'->>'value' as rework_cost, fields->'Rework Cause'->>'value' as rework_cause, fields->'Rework Labor Hours'->>'value' as rework_labor_hours, fields->'Disruption Cause Categories'->>'value' as disruption_cause_categories FROM extracted_records WHERE skill_id = 'production_activity' AND project_id = {{project_id}}`,
      rfi_data: `SELECT source_file, fields->'Root Cause (Level 1)'->>'value' as root_cause_level_1, fields->'CSI Division (Primary)'->>'value' as csi_division FROM extracted_records WHERE skill_id = 'rfi' AND project_id = {{project_id}}`,
    },
  },
  {
    card_name: 'schedule_delay_cost_attribution',
    display_name: 'Schedule Delay Cost Attribution',
    description: 'Attribute schedule delay costs to specific causes (RFIs, design changes, weather, GC coordination) with evidence for claims.',
    trigger_concepts: ['schedule delay', 'delay cost', 'delay claim', 'time extension', 'delay attribution', 'liquidated damages'],
    skills_involved: ['change_order', 'contract', 'daily_report', 'design_change', 'job_cost_report', 'production_activity', 'project_admin', 'rfi', 'submittal'],
    business_logic: `To attribute schedule delay costs:
1. Query daily_report: Delay Cause Category, Issues/Delays Reported (contemporaneous evidence), RFI/Issue Cross-Reference, Crews on Site, Productivity Indicator, Work Performed.
2. Production impact: production_activity Disruption Events, Disruption Cost, Total Disruption Hours, Disruption Cause Categories, Responsible Party, Productivity Trend, Design/Information Issues.
3. Design delays: design_change Date Issued, Days CCD to Price Agreement, Schedule Impact (ASI). RFI Response Time, Schedule Impact, Responsibility Attribution, Root Cause.
4. Submittal delays: Review Cycle Time, Procurement Critical, Schedule Impact of Late Review.
5. Contract context: Clause Category (LD, no-damage-for-delay), Risk Direction. Notice compliance: project_admin Contractual Notice, Notice Timeliness.
6. Cost: change_order Originating Document Chain attributes CO costs to delays. JCR Over/Under Budget per line where Variance Root Cause = delay.
7. Cross-doc: RFI → ASI (link_type: rfi_triggers_asi), CCD → CO (link_type: ccd_to_co), Daily Report → Production (link_type: daily_to_production).
Key metric: Delay Cost = SUM(Disruption Cost + OT premium + productivity loss) by cause category with responsible party attribution.`,
    key_fields: {
    change_order: ['Change Reason (Root Cause)', 'Originating Document Chain'],
    contract: ['Clause Category (12 types)', 'Risk Direction'],
    daily_report: ['Crews on Site (Structured)', 'Delay Cause Category', 'Issues / Delays Reported', 'Productivity Indicator', 'RFI / Issue Cross-Reference', 'Work Performed (Structured)'],
    design_change: ['Date Issued (ASI)', 'Date Issued / Date Effective (CCD)', 'Days CCD to Price Agreement', 'Schedule Impact (ASI)'],
    job_cost_report: ['Over/Under Budget — $ (line)', 'Variance Root Cause (per line)'],
    production_activity: ['Activity Type', 'CSI Division', 'Design / Information Issues', 'Disruption Cause Categories', 'Disruption Cost', 'Disruption Events (structured)', 'Productivity Trend (7-day)', 'Responsible Party', 'Total Disruption Hours', 'Total Labor Hours'],
    project_admin: ['Contractual Notice?', 'Notice Timeliness'],
    rfi: ['Dates (Submit / Required / Response)', 'Response Time (calendar days)', 'Responsibility Attribution', 'Root Cause (Level 1)', 'Schedule Impact (Estimated Range)'],
    submittal: ['Dates (Submitted/Required/Returned)', 'Procurement Critical?', 'Review Cycle Time (days)', 'Schedule Impact of Late Review'],
  },
    example_questions: ['What is the cost of schedule delays on this project?', 'Who is responsible for the delays?', 'Do we have documentation to support a delay claim?', 'What is causing the most schedule disruption?'],
    calc_function: 'schedule.delay_cost_attribution',
    sql_templates: {
      prod_data: `SELECT source_file, fields->'Disruption Cost'->>'value' as disruption_cost, fields->'Total Disruption Hours'->>'value' as total_disruption_hours, fields->'Disruption Cause Categories'->>'value' as disruption_cause_categories, fields->'Responsible Party'->>'value' as responsible_party FROM extracted_records WHERE skill_id = 'production_activity' AND project_id = {{project_id}}`,
      daily_data: `SELECT source_file, fields->'Delay Cause Category'->>'value' as delay_cause_category, fields->'Issues / Delays Reported'->>'value' as issues_delays FROM extracted_records WHERE skill_id = 'daily_report' AND project_id = {{project_id}}`,
      rfi_data: `SELECT source_file, fields->'Schedule Impact (Estimated Range)'->>'value' as schedule_impact, fields->'Response Time (calendar days)'->>'value' as response_time FROM extracted_records WHERE skill_id = 'rfi' AND project_id = {{project_id}}`,
    },
  },
  {
    card_name: 'value_engineering_tracking',
    display_name: 'Value Engineering Decision Tracking',
    description: 'Track VE decisions and their downstream consequences on rework, RFIs, and project performance.',
    trigger_concepts: ['value engineering', 'VE', 'VE decision', 'design alternative', 'cost saving', 'VE consequence'],
    skills_involved: ['change_order', 'design_change', 'estimate', 'job_cost_report', 'production_activity', 'rfi'],
    business_logic: `To track VE decision consequences:
1. Query design_change: ASI Type (Enhancement/VE), Cost Impact, CSI Divisions Affected, Originating Event, Rework Required flag.
2. Downstream effects: change_order Change Reason traces VE-related COs. production_activity Rework Today + Rework Cause = Design indicates VE-related rework.
3. RFI patterns: Root Cause Level 1 and Level 2 for VE-related clarifications. Recurring Pattern identifies systemic VE issues.
4. Estimate context: Design Completeness at Bid, Key Assumptions & Exclusions, Variance Explanation by Division.
5. Cost impact: JCR Variance Root Cause, Lessons Learned / Estimating Flag for future bid adjustments.
6. Trace: JCR → Estimate feedback loop (link_type: estimate_vs_jcr).
Key metric: VE Net Value = Intended savings - (rework cost + additional RFIs + CO scope creep) per VE decision.`,
    key_fields: {
    change_order: ['Change Reason (Root Cause)'],
    design_change: ['ASI Type', 'CSI Division(s) Affected', 'Cost Impact (ASI)', 'Originating Event', 'Rework Required?'],
    estimate: ['Design Completeness at Bid', 'Key Assumptions & Exclusions', 'Variance Explanation by Division'],
    job_cost_report: ['Lessons Learned / Estimating Flag', 'Variance Root Cause (per line)'],
    production_activity: ['Rework Cause', 'Rework Today?'],
    rfi: ['Recurring Pattern', 'Root Cause (Level 1)', 'Root Cause (Level 2)'],
  },
    example_questions: ['Have our VE decisions actually saved money?', 'Which VE decisions caused rework or problems?', 'Track the downstream impact of value engineering choices'],
    calc_function: 'design_and_rework.ve_net_value',
    sql_templates: {
      dc_data: `SELECT source_file, fields->'ASI Type'->>'value' as asi_type, fields->'Cost Impact (ASI)'->>'value' as cost_impact, fields->'Rework Required?'->>'value' as rework_required FROM extracted_records WHERE skill_id = 'design_change' AND project_id = {{project_id}}`,
      prod_data: `SELECT source_file, fields->'Rework Cost'->>'value' as rework_cost, fields->'Rework Cause'->>'value' as rework_cause FROM extracted_records WHERE skill_id = 'production_activity' AND project_id = {{project_id}}`,
    },
  },
  {
    card_name: 'cash_flow_bottleneck',
    display_name: 'Cash Flow Bottleneck Identification',
    description: 'Identify where cash gets stuck: slow CO approvals, disputed items, pending design changes, submittal delays, and slow GC payments.',
    trigger_concepts: ['cash flow', 'bottleneck', 'cash stuck', 'payment delay', 'billing blockage', 'cash position'],
    skills_involved: ['change_order', 'contract', 'daily_report', 'design_change', 'project_admin', 'submittal'],
    business_logic: `To identify cash flow bottlenecks:
1. Query project_admin: Days to Payment, Payment Received Date, Billed This Period, Retainage Held, Disputed/Held Items, Current Contract Value, Scheduled Value, Contractual Notice, Notice Timeliness.
2. CO pipeline blockage: change_order Dates (approval lag), Disputed outcomes. design_change Pipeline Duration, Stall Point, Proposed Amount (cash in limbo), Days CCD to Price Agreement.
3. Pending revenue: design_change Approval Status (pending = blocked cash), Conversion Rate Flag (unconverted = stuck), GC Proposed Amount (CCD) = dollar value awaiting pricing. Disputed CCDs block cash for months.
4. Procurement delays: submittal Dates, Review Cycle Time, Procurement Critical.
5. Contract risk: Clause Category (payment terms, retention), Risk Score.
6. Daily context: Issues/Delays that trigger payment holds.
7. Cross-doc: CO → Pay App (link_type: co_billed_in_payapp), Contract → Payment Terms (link_type: contract_to_payment_terms), PR/PCO → CO (link_type: pco_rolled_into_co), JCR → Pay App (link_type: payapp_vs_jcr).
Key metric: Cash Stuck = (Pending CO $ + Disputed Items $ + Unbilled Retention + Pipeline PR/COR $) by project and cause.`,
    key_fields: {
    change_order: ['Dates (Initiated / Approved / Closed)', 'Disputed (Y/N) + Outcome'],
    contract: ['Clause Category (12 types)', 'Risk Score (1–5)'],
    daily_report: ['Issues / Delays Reported'],
    design_change: ['Approval Status', 'Conversion Rate Flag', 'Days CCD to Price Agreement', 'Disputed? (CCD)', 'GC Proposed Amount (CCD)', 'Pipeline Duration (days)', 'Proposed Amount (PR)', 'Stall Point (if delayed)'],
    project_admin: ['Billed This Period', 'Contractual Notice?', 'Current Contract Value', 'Days to Payment', 'Disputed / Held Items', 'Notice Timeliness', 'Payment Received Date', 'Retainage Held', 'Scheduled Value (original SOV)'],
    submittal: ['Dates (Submitted/Required/Returned)', 'Procurement Critical?', 'Review Cycle Time (days)'],
  },
    example_questions: ['Where is our cash stuck?', 'What are the biggest cash flow bottlenecks?', 'How much money is tied up in pending COs and disputes?', 'Which projects have the worst cash flow?'],
    calc_function: 'cash_flow.cash_flow_bottleneck',
    sql_templates: {
      admin_data: `SELECT source_file, project_id, document_type, fields->'Retainage Held'->>'value' as retainage_held, fields->'Disputed / Held Items'->>'value' as disputed_held_items, fields->'Days to Payment'->>'value' as days_to_payment, fields->'Billed This Period'->>'value' as billed_this_period FROM extracted_records WHERE skill_id = 'project_admin' AND project_id = {{project_id}}`,
      co_data: `SELECT source_file, fields->'GC Proposed Amount'->>'value' as gc_proposed_amount, fields->'Disputed (Y/N) + Outcome'->>'value' as disputed FROM extracted_records WHERE skill_id = 'change_order' AND project_id = {{project_id}}`,
      dc_data: `SELECT source_file, fields->'Approval Status'->>'value' as approval_status, fields->'Proposed Amount (PR)'->>'value' as proposed_amount, fields->'Cost Impact (ASI)'->>'value' as cost_impact FROM extracted_records WHERE skill_id = 'design_change' AND project_id = {{project_id}}`,
    },
  },
  {
    card_name: 'project_true_profitability',
    display_name: 'Project-Level True Profitability',
    description: 'Calculate true project profitability including all hidden costs: CO shrinkage, rework, disruptions, payment delays, back-charges, and retention float.',
    trigger_concepts: ['true profitability', 'real margin', 'project profit', 'hidden costs', 'all-in cost', 'profitability analysis'],
    skills_involved: ['change_order', 'contract', 'design_change', 'estimate', 'job_cost_report', 'production_activity', 'project_admin'],
    business_logic: `To calculate true project profitability:
1. Start with JCR headline numbers: Total Revised Budget, Total Job-to-Date Cost, Total Over/Under Budget, Estimated Margin at Completion, Total Change Orders.
2. Deep dive by phase: % Budget Consumed, Over/Under Budget, Variance Root Cause per line (THE most valuable field), Cost-to-Complete, Work Phase/Activity.
3. Revenue side: estimate Total Bid Amount, Contract Amount, Fee/Markup Structure. change_order GC Proposed vs Owner Approved (Negotiation Delta = margin erosion). Markup Applied consistency.
4. Hidden costs: production_activity Rework Cost + Rework Labor Hours, Disruption Cost + Total Disruption Hours, Overtime/Shift premium. Responsible Party for attribution.
5. Payment/cash costs: project_admin Days to Payment, Retainage Held, Back-Charges, Disputed Items, Warranty Items. Billing: Billed This Period, Scheduled Value, Current Contract Value.
6. Design change costs: design_change Estimated Missed Revenue, Cost Impact, CCD Final Approved vs Proposed delta.
7. Contract context: Risk Score, Recommended Contingency %.
8. Cross-doc: Estimate → Actual (link_type: estimate_vs_jcr), JCR → CO (link_type: co_absorption_jcr), JCR → Production (link_type: production_vs_jcr), JCR → Pay App (link_type: payapp_vs_jcr), Punch → Retention (link_type: punchlist_to_retention).
Key metric: True Profit = Revenue - (JTD Cost + CO shrinkage + rework + disruption + payment delay cost + back-charges + warranty) per project.`,
    key_fields: {
    change_order: ['Change Reason (Root Cause)', 'Dates (Initiated / Approved / Closed)', 'Disputed (Y/N) + Outcome', 'GC Proposed Amount', 'Markup Applied', 'Negotiation Delta ($)', 'Originating Document Chain', 'Owner Approved Amount'],
    contract: ['Recommended Contingency %', 'Risk Score (1–5)'],
    design_change: ['Cost Impact (ASI)', 'Estimated Missed Revenue', 'Final Approved Amount (CCD)', 'GC Proposed Amount (CCD)'],
    estimate: ['Contract Amount (if won)', 'Fee / Markup Structure', 'Final Project Cost (if complete)', 'Total Bid Amount'],
    job_cost_report: ['% Budget Consumed (line)', 'CO Absorption Rate (line)', 'Change Orders (line)', 'Cost Category', 'Cost-to-Complete Estimate', 'Estimated Margin at Completion', 'Job-to-Date Cost (line)', 'Labor Productivity Rate ($/hr)', 'Line Item Forecast to Complete', 'Material Price Variance', 'Over/Under Budget — $ (line)', 'Overall % Budget Consumed', 'Quantity (labor hours or units)', 'Report Period', 'Revised Budget (line)', 'Total Change Orders', 'Total Job-to-Date Cost', 'Total Over/Under Budget', 'Total Revised Budget', 'Variance Root Cause (per line)', 'Variance Trend (vs prior period)', 'Work Phase / Activity'],
    production_activity: ['Disruption Cause Categories', 'Disruption Cost', 'Disruption Events (structured)', 'Overtime / Shift', 'Responsible Party', 'Rework Cost', 'Rework Labor Hours', 'Total Disruption Hours', 'Total Labor Hours'],
    project_admin: ['Back-Charges Issued?', 'Billed This Period', 'Current Contract Value', 'Days to Complete Punch List', 'Days to Payment', 'Disputed / Held Items', 'Items by Trade (Punch)', 'Payment Received Date', 'Retainage Held', 'Scheduled Value (original SOV)', 'Total Punch Items', 'Warranty Items (post-closeout)'],
  },
    example_questions: ['What is the true profitability of this project?', 'What are all the hidden costs eating our margin?', 'Compare estimated margin to actual margin including all costs', 'Which cost categories are hurting profitability the most?', 'How does our true profit compare across projects?'],
    calc_function: 'financial.project_profitability',
    sql_templates: {
      jcr_data: `SELECT source_file, fields->'Total Revised Budget'->>'value' as total_revised_budget, fields->'Total Job-to-Date Cost'->>'value' as total_jtd_cost, fields->'Total Over/Under Budget'->>'value' as total_over_under_budget, fields->'Estimated Margin at Completion'->>'value' as estimated_margin_at_completion, fields->'Total Change Orders'->>'value' as total_change_orders, fields->>'net_job_profit' as net_job_profit_raw, fields->>'ar_total' as ar_total_raw, fields->>'ap_total' as ap_total_raw, fields->>'pr_total' as pr_total_raw FROM extracted_records WHERE skill_id = 'job_cost_report' AND project_id = {{project_id}}`,
      co_data: `SELECT source_file, fields->'GC Proposed Amount'->>'value' as gc_proposed_amount, fields->'Owner Approved Amount'->>'value' as owner_approved_amount FROM extracted_records WHERE skill_id = 'change_order' AND project_id = {{project_id}}`,
      prod_data: `SELECT source_file, fields->'Rework Cost'->>'value' as rework_cost, fields->'Disruption Cost'->>'value' as disruption_cost FROM extracted_records WHERE skill_id = 'production_activity' AND project_id = {{project_id}}`,
      estimate_data: `SELECT source_file, fields->'Total Bid Amount'->>'value' as total_bid_amount, fields->'Contract Amount (if won)'->>'value' as contract_amount FROM extracted_records WHERE skill_id = 'estimate' AND project_id = {{project_id}}`,
    },
  },
  {
    card_name: 'invoice_rejection_pattern',
    display_name: 'Invoice Rejection Pattern Analysis',
    description: 'Analyze pay application rejection patterns by GC, reason, and timing to reduce billing friction.',
    trigger_concepts: ['invoice rejection', 'pay app rejection', 'billing dispute', 'payment rejection', 'invoice pattern'],
    skills_involved: ['change_order', 'project_admin'],
    business_logic: `To analyze invoice rejection patterns:
1. Query project_admin: Disputed/Held Items, Billed This Period, Days to Payment, Payment Received Date, Scheduled Value, Current Contract Value.
2. Track rejection timing: CO → Pay App (link_type: co_billed_in_payapp) — rejections due to CO billing issues. JCR → Pay App (link_type: payapp_vs_jcr) — overbilling/underbilling catches.
3. CO-related rejections: change_order Dates (Initiated/Approved/Closed) — billing COs before full approval causes rejections.
4. Group by GC to find patterns: which GCs reject most, what reasons, what timing.
Key metric: Rejection Rate = Rejected invoices / Total invoices by GC and rejection reason.`,
    key_fields: {
    change_order: ['Dates (Initiated / Approved / Closed)'],
    project_admin: ['Billed This Period', 'Current Contract Value', 'Days to Payment', 'Disputed / Held Items', 'Payment Received Date', 'Scheduled Value (original SOV)'],
  },
    example_questions: ['Why are our invoices being rejected?', 'Which GCs reject the most pay applications?', 'What is the pattern in our billing disputes?', 'How much revenue is delayed by invoice rejections?'],
    calc_function: 'cash_flow.invoice_rejection_rate',
    sql_templates: {
      admin_data: `SELECT source_file, project_id, document_type, fields->'Billed This Period'->>'value' as billed_this_period, fields->'Disputed / Held Items'->>'value' as disputed_held_items, fields->'Days to Payment'->>'value' as days_to_payment FROM extracted_records WHERE skill_id = 'project_admin' AND project_id = {{project_id}}`,
    },
  },
  {
    card_name: 'project_type_profitability',
    display_name: 'Project Type Profitability Optimization',
    description: 'Compare profitability across project types, building types, and size ranges to optimize the project mix strategy.',
    trigger_concepts: ['project type profitability', 'portfolio optimization', 'best project type', 'margin by type', 'strategic mix'],
    skills_involved: ['change_order', 'contract', 'design_change', 'estimate', 'job_cost_report', 'production_activity', 'project_admin', 'rfi'],
    business_logic: `To optimize project type profitability:
1. Query estimate: Project Type, Building Type, Gross Square Footage, Total Bid Amount, Contract Amount, Cost Breakdown/Final Cost by Division, Total Cost per SF, Fee/Markup, Bid Result, Win/Loss Analysis.
2. Match to outcomes: JCR Estimated Margin at Completion, Overall % Budget Consumed, Total Over/Under Budget, Variance Root Cause per line. Segment by Project Type and CSI Division.
3. Phase-level detail: JCR Work Phase/Activity, Cost Category, Trade/Scope, Labor-to-Material Ratio, Material Price Variance.
4. Change order impact by type: change_order Change Reason patterns. design_change CSI Divisions Affected.
5. Operational quality: project_admin Days to Payment, Retainage, Punch Items, Warranty Items by project type. RFI CSI Division frequency. production_activity CSI Division productivity.
6. Contract risk: Risk Score averages by project type.
7. Cross-doc: Estimate → Actual, JCR → Estimate feedback loops.
Key metric: True Margin by Project Type = (Revenue - All-In Cost) / Revenue ranked by type.`,
    key_fields: {
    change_order: ['Change Reason (Root Cause)'],
    contract: ['Risk Score (1–5)'],
    design_change: ['CSI Division(s) Affected'],
    estimate: ['Bid Result', 'Building Type', 'Contract Amount (if won)', 'Cost Breakdown by Division', 'Fee / Markup Structure', 'Final Cost by Division', 'Final Project Cost (if complete)', 'Gross Square Footage', 'Project Type', 'Total Bid Amount', 'Total Cost per SF (Bid)', 'Win/Loss Analysis Notes'],
    job_cost_report: ['% Budget Consumed (line)', 'CSI Division (Primary) — JCR', 'Cost Category', 'Cost-to-Complete Estimate', 'Estimated Margin at Completion', 'Job-to-Date Cost (line)', 'Labor-to-Material Ratio', 'Lessons Learned / Estimating Flag', 'Line Item Forecast to Complete', 'Material Price Variance', 'Over/Under Budget — $ (line)', 'Overall % Budget Consumed', 'Project Type', 'Report Period', 'Revised Budget (line)', 'Total Change Orders', 'Total Job-to-Date Cost', 'Total Over/Under Budget', 'Total Revised Budget', 'Trade / Scope', 'Variance Root Cause (per line)', 'Variance Trend (vs prior period)', 'Work Phase / Activity'],
    production_activity: ['CSI Division'],
    project_admin: ['Days to Payment', 'Items by Trade (Punch)', 'Payment Received Date', 'Retainage Held', 'Total Punch Items', 'Warranty Items (post-closeout)'],
    rfi: ['CSI Division (Primary)'],
  },
    example_questions: ['Which project types are most profitable for us?', 'Should we pursue more of a certain project type?', 'Compare margins across project types and sizes', 'What is our cost per SF by project type?'],
    calc_function: 'financial.project_type_margin',
    sql_templates: {
      estimate_data: `SELECT source_file, project_id, fields->'Project Type'->>'value' as project_type, fields->'Building Type'->>'value' as building_type, fields->'Total Bid Amount'->>'value' as total_bid_amount, fields->'Contract Amount (if won)'->>'value' as contract_amount, fields->'Total Cost per SF (Bid)'->>'value' as cost_per_sf FROM extracted_records WHERE skill_id = 'estimate'`,
      jcr_data: `SELECT source_file, project_id, fields->'Estimated Margin at Completion'->>'value' as estimated_margin_at_completion, fields->'Total Revised Budget'->>'value' as total_revised_budget, fields->'Project Type'->>'value' as project_type FROM extracted_records WHERE skill_id = 'job_cost_report'`,
    },
  },
  {
    card_name: 'subcontractor_benchmarking',
    display_name: 'Subcontractor Tier Benchmarking',
    description: 'Benchmark subcontractor performance across pricing, CO rates, productivity, rework, RFI volume, and submittal quality.',
    trigger_concepts: ['sub benchmark', 'vendor comparison', 'subcontractor ranking', 'best subs', 'sub performance', 'sub tier'],
    skills_involved: ['change_order', 'estimate', 'job_cost_report', 'production_activity', 'project_admin', 'rfi', 'submittal'],
    business_logic: `To benchmark subcontractors:
1. Query estimate: Bid Result, Cost Breakdown by Division, Total Cost per SF, Overall Estimating Accuracy Score by sub-performed scopes. Market Condition at Bid.
2. CO quality: change_order Change Reason, Owner Approved Amount by sub. Sub Bid → Sub CO Rate (link_type: subbid_vs_co) — low bidder vs 2nd/3rd CO rate comparison.
3. Cost performance: JCR line-level % Budget Consumed, CO Absorption Rate, Over/Under Budget, Variance Root Cause by Trade/Scope. Labor Productivity Rate, Labor-to-Material Ratio, Material Price Variance.
4. Production quality: production_activity Production Rate, Productive Rate (adjusted), Cumulative Production Efficiency, Rework Cost, Rework Cause, Unit of Measure standardized.
5. Coordination quality: RFI CSI Division frequency, Recurring Pattern, Root Cause Level 2. submittal Resubmittal Count = quality indicator.
6. Payment: project_admin Days to Payment by sub-heavy projects.
7. Cross-doc: Sub Bid → Sub Performance (link_type: subbid_vs_co), Estimate → Actual (link_type: estimate_vs_jcr), JCR → Production (link_type: production_vs_jcr).
Key metric: Sub Tier Score = weighted(bid competitiveness, CO rate, budget performance, rework rate, RFI volume, submittal quality).`,
    key_fields: {
    change_order: ['Change Reason (Root Cause)', 'Owner Approved Amount'],
    estimate: ['Bid Result', 'Cost Breakdown by Division', 'Final Cost by Division', 'Final Project Cost (if complete)', 'Gross Square Footage', 'Market Condition at Bid', 'Overall Estimating Accuracy Score', 'Project Type', 'Total Bid Amount', 'Total Cost per SF (Bid)'],
    job_cost_report: ['% Budget Consumed (line)', 'CO Absorption Rate (line)', 'CSI Division (Primary) — JCR', 'Change Orders (line)', 'Cost Category', 'Estimated Labor Rate (from bid)', 'Estimated Margin at Completion', 'Job-to-Date Cost (line)', 'Labor Productivity Rate ($/hr)', 'Labor-to-Material Ratio', 'Lessons Learned / Estimating Flag', 'Material Price Variance', 'Over/Under Budget — $ (line)', 'Overall % Budget Consumed', 'Project Type', 'Quantity (labor hours or units)', 'Report Period', 'Revised Budget (line)', 'Total Change Orders', 'Total Job-to-Date Cost', 'Total Over/Under Budget', 'Total Revised Budget', 'Trade / Scope', 'Variance Root Cause (per line)', 'Variance Trend (vs prior period)', 'Work Phase / Activity'],
    production_activity: ['CSI Division', 'Cumulative Production Efficiency', 'Production Rate (calculated)', 'Productive Rate (adjusted)', 'Rework Cause', 'Rework Cost', 'Unit of Measure'],
    project_admin: ['Days to Payment'],
    rfi: ['CSI Division (Primary)', 'Recurring Pattern', 'Root Cause (Level 2)'],
    submittal: ['Resubmittal Count'],
  },
    example_questions: ['Who are our best subcontractors?', 'Rank subs by overall performance', 'Do low-bid subs end up costing more in COs?', 'Which subs have the most rework and coordination issues?', 'Compare subcontractor performance across projects'],
    calc_function: 'risk_and_scoring.sub_benchmark_score',
    sql_templates: {
      prod_data: `SELECT source_file, fields->'Production Rate (calculated)'->>'value' as production_rate, fields->'Rework Cost'->>'value' as rework_cost, fields->'CSI Division'->>'value' as csi_division, fields->'Cumulative Production Efficiency'->>'value' as cumulative_production_efficiency FROM extracted_records WHERE skill_id = 'production_activity' AND project_id = {{project_id}}`,
    },
  },
  {
    card_name: 'project_document_completeness',
    display_name: 'Document Completeness Check',
    description: 'Assess whether all expected document types are present for a project and identify coverage gaps.',
    trigger_concepts: ['document completeness', 'missing documents', 'coverage check', 'what data do we have', 'data gaps'],
    skills_involved: [],
    business_logic: `To check document completeness:
1. Use project_overview tool to get document_inventory.
2. Expected types for full analysis: estimate, contract, sub_bid, submittal, rfi, design_change, change_order, daily_report, production_activity, job_cost_report, safety_inspection, project_admin.
3. For financial analysis: need at minimum estimate + job_cost_report + change_order.
4. For operations analysis: need daily_report + production_activity.
5. For revenue recovery: need change_order + design_change + project_admin.
6. Completeness score: (types with data) / (expected types) × 100.
7. Flag types with 0 records and recommend which use cases are unlocked vs blocked.`,
    key_fields: {},
    example_questions: ['What data do we have for this project?', 'Are we missing any document types?', 'How complete is our project documentation?', 'Which analyses can we run with the data we have?'],
    calc_function: null,
    sql_templates: {},
  },
  {
    card_name: 'billing_progress_summary',
    display_name: 'Billing Progress & Cash Collection',
    description: 'Deduplicated billing summary from pay applications showing billing progress, retainage, days to payment, and over/under billing vs JTD cost.',
    trigger_concepts: ['billing', 'billing progress', 'pay application', 'billed amount', 'total billed', 'cash collection', 'billing status', 'how much have we billed'],
    skills_involved: ['project_admin', 'job_cost_report', 'change_order'],
    business_logic: `To analyze billing progress:
1. Query project_admin for pay application records (filter by document type to exclude SOVs, lien releases, meeting minutes).
2. Sum Billed This Period across pay apps for total billed. Get Current Contract Value for the baseline.
3. Calculate billing progress: Total Billed / Contract Value.
4. Check retainage: sum Retainage Held across pay apps.
5. Average Days to Payment for cash velocity.
6. Compare billing to JCR Total Job-to-Date Cost: overbilling = billed > cost, underbilling = cost > billed.
7. Factor COs: approved COs not yet billed = unbilled revenue.
Key metric: Billing Progress % and Over/Under Billing vs JTD Cost.`,
    key_fields: {
      project_admin: ['Billed This Period', 'Current Contract Value', 'Days to Payment', 'Retainage Held', 'Scheduled Value (original SOV)'],
      job_cost_report: ['Total Job-to-Date Cost'],
      change_order: ['Owner Approved Amount'],
    },
    example_questions: ['How much have we billed on this project?', 'What is our billing progress?', 'Are we overbilling or underbilling?', 'What is our total billed vs contract value?'],
    calc_function: 'billing.billing_summary',
    sql_templates: {
      admin_data: `SELECT source_file, document_type, fields->'Billed This Period'->>'value' as billed_this_period, fields->'Scheduled Value (original SOV)'->>'value' as scheduled_value, fields->'Current Contract Value'->>'value' as current_contract_value, fields->'Retainage Held'->>'value' as retainage_held, fields->'Days to Payment'->>'value' as days_to_payment FROM extracted_records WHERE skill_id = 'project_admin' AND project_id = {{project_id}}`,
      jcr_data: `SELECT source_file, fields->'Total Job-to-Date Cost'->>'value' as total_jtd_cost, fields->>'ap_total' as ap_total_raw FROM extracted_records WHERE skill_id = 'job_cost_report' AND project_id = {{project_id}}`,
    },
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
  const toUpdate = SEED_CARDS.filter(c => existingNames.has(c.card_name));

  let seeded = 0;
  let updated = 0;
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

  for (const card of toUpdate) {
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
        console.error(`Failed to re-embed card ${card.card_name}:`, err);
      }
    }

    const updatePayload: Record<string, unknown> = {
      display_name: card.display_name,
      description: card.description,
      trigger_concepts: card.trigger_concepts,
      skills_involved: card.skills_involved,
      business_logic: card.business_logic,
      key_fields: card.key_fields,
      example_questions: card.example_questions,
      sql_templates: (card as Record<string, unknown>).sql_templates || {},
      calc_function: (card as Record<string, unknown>).calc_function || null,
    };
    if (embeddingStr) {
      updatePayload.embedding = embeddingStr;
    }

    const { error } = await sb
      .from('context_cards')
      .update(updatePayload)
      .eq('org_id', orgId)
      .eq('card_name', card.card_name);

    if (error) {
      errors.push(`update ${card.card_name}: ${error.message}`);
    } else {
      updated++;
    }
  }

  return Response.json({
    message: `Seeded ${seeded} new, updated ${updated} existing${errors.length > 0 ? `, ${errors.length} errors` : ''}`,
    seeded,
    updated,
    errors: errors.length > 0 ? errors : undefined,
  });
}
