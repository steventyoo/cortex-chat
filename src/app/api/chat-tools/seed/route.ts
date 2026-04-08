import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE, SessionPayload } from '@/lib/auth-v2';
import { getSupabase } from '@/lib/supabase';

const DEFAULT_TOOLS = [
  {
    tool_name: 'query_job_costs',
    display_name: 'Query Job Costs',
    description: 'Search job cost records by cost code, description, or vendor name. Returns matching extracted_records for the current project where skill_id is job_cost_report.',
    input_schema: {
      properties: {
        search_term: { type: 'string', description: 'Cost code, description, or vendor name to search for' },
        cost_type: { type: 'string', description: 'Optional: filter by cost type (labor, material, equipment, subcontract, other)' },
      },
      required: ['search_term'],
    },
    implementation_type: 'rag_search',
    implementation_config: {
      skill_id: 'job_cost_report',
      match_count: 20,
      similarity_threshold: 0.35,
    },
    sample_prompts: [
      'What are the costs for electrical work?',
      'Show me the job costs for cost code 03',
      'How much have we spent on concrete?',
    ],
  },
  {
    tool_name: 'query_change_orders',
    display_name: 'Query Change Orders',
    description: 'Search change order records by status, amount, description, or reason. Returns matching extracted_records for the current project where skill_id is change_order.',
    input_schema: {
      properties: {
        search_term: { type: 'string', description: 'Description, reason, or status to search for' },
        status: { type: 'string', description: 'Optional: filter by status (pending, approved, rejected)' },
      },
      required: ['search_term'],
    },
    implementation_type: 'rag_search',
    implementation_config: {
      skill_id: 'change_order',
      match_count: 20,
      similarity_threshold: 0.35,
    },
    sample_prompts: [
      'Show me all pending change orders',
      'What change orders are over $50,000?',
      'List the approved COs this month',
    ],
  },
  {
    tool_name: 'search_documents',
    display_name: 'Search Documents',
    description: 'Search extracted document records by semantic similarity. Finds documents matching a natural language query across all processed documents.',
    input_schema: {
      properties: {
        query: { type: 'string', description: 'Natural language search query describing what documents to find' },
      },
      required: ['query'],
    },
    implementation_type: 'rag_search',
    implementation_config: {
      similarity_threshold: 0.4,
      match_count: 10,
    },
    sample_prompts: [
      'Find documents about the HVAC system',
      'Search for anything related to foundation work',
      'What documents mention weather delays?',
    ],
  },
  {
    tool_name: 'project_health',
    display_name: 'Project Health',
    description: 'Get project health metrics including budget status, schedule, and key indicators. Provides an at-a-glance view of project health.',
    input_schema: {
      properties: {
        metric: { type: 'string', description: 'Optional: specific metric to focus on (budget, schedule, safety, quality)' },
      },
      required: [],
    },
    implementation_type: 'api_call',
    implementation_config: {
      endpoint: '/api/dashboard',
      method: 'POST',
    },
    sample_prompts: [
      'How is the project doing?',
      'What is the project health status?',
      'Are we over budget?',
    ],
  },
  {
    tool_name: 'coverage_analysis',
    display_name: 'Coverage Analysis',
    description: 'Run JCR coverage analysis to check how well project documents cover the Job Cost Report line items. Shows which cost codes have supporting documentation.',
    input_schema: {
      properties: {
        focus_area: { type: 'string', description: 'Optional: specific cost area or division to focus the analysis on' },
      },
      required: [],
    },
    implementation_type: 'api_call',
    implementation_config: {
      endpoint: '/api/pipeline/coverage',
      method: 'POST',
    },
    sample_prompts: [
      'Run a coverage analysis',
      'Which cost codes are missing documentation?',
      'How complete is the document coverage?',
    ],
  },
];

const UC_TOOLS = [
  {
    tool_name: 'uc1_unbilled_co_recovery',
    display_name: 'UC1: Unbilled Change Order Recovery',
    description: 'Identify change orders that have been executed but not yet billed, or where billing is incomplete relative to approved amounts. Cross-references change order records, contract clauses, design changes, job cost reports, daily reports, and production activity to find revenue leakage from unbilled work.',
    input_schema: { properties: { query: { type: 'string', description: 'Describe the unbilled work, change order, or billing gap you want to investigate' } }, required: ['query'] },
    implementation_type: 'rag_search',
    implementation_config: { skill_ids: ['change_order', 'contract', 'design_change', 'job_cost_report', 'project_admin', 'daily_report', 'production_activity'], match_count: 15, similarity_threshold: 0.35 },
    sample_prompts: ['Are there any approved change orders we haven\'t billed yet?', 'Find unbilled work that has supporting documentation', 'Which COs have a gap between approved and billed amounts?'],
  },
  {
    tool_name: 'uc2_retention_float_acceleration',
    display_name: 'UC2: Retention Float Acceleration',
    description: 'Analyze retention schedules and identify opportunities to accelerate retention release. Cross-references design change milestones, project admin records, and job cost data to find retention that could be released earlier based on completion status.',
    input_schema: { properties: { query: { type: 'string', description: 'Describe the retention or milestone completion question' } }, required: ['query'] },
    implementation_type: 'rag_search',
    implementation_config: { skill_ids: ['design_change', 'project_admin', 'job_cost_report'], match_count: 15, similarity_threshold: 0.35 },
    sample_prompts: ['What retention amounts are eligible for early release?', 'Which completed milestones have unreleased retention?', 'Analyze our retention float opportunities'],
  },
  {
    tool_name: 'uc3_tm_work_under_billing',
    display_name: 'UC3: T&M Work Under-Billing Detection',
    description: 'Detect time-and-materials work that is under-billed by comparing daily reports, production activity logs, and job cost records against change order billing. Identifies labor hours, materials, and equipment usage documented in the field but not captured in T&M billing.',
    input_schema: { properties: { query: { type: 'string', description: 'Describe the T&M work, billing discrepancy, or labor/material question' } }, required: ['query'] },
    implementation_type: 'rag_search',
    implementation_config: { skill_ids: ['change_order', 'design_change', 'daily_report', 'production_activity', 'job_cost_report'], match_count: 15, similarity_threshold: 0.35 },
    sample_prompts: ['Is there any T&M work we haven\'t fully billed?', 'Compare daily report labor hours to T&M billing', 'Find under-billed time and materials work'],
  },
  {
    tool_name: 'uc4_back_charge_defense',
    display_name: 'UC4: Back-Charge Defense',
    description: 'Build defense documentation against back-charges by gathering change orders, contract clauses, RFIs, daily reports, production logs, project admin records, and estimates that support your position. Identifies documentation that proves work was authorized or completed per specification.',
    input_schema: { properties: { query: { type: 'string', description: 'Describe the back-charge, disputed work, or defense documentation needed' } }, required: ['query'] },
    implementation_type: 'rag_search',
    implementation_config: { skill_ids: ['change_order', 'contract', 'rfi', 'daily_report', 'production_activity', 'project_admin', 'estimate'], match_count: 15, similarity_threshold: 0.35 },
    sample_prompts: ['What documentation supports our defense against the drywall back-charge?', 'Find evidence that this work was authorized by the GC', 'Gather back-charge defense materials for the HVAC dispute'],
  },
  {
    tool_name: 'uc5_warranty_callback_cost_reduction',
    display_name: 'UC5: Warranty Callback Cost Reduction',
    description: 'Analyze warranty callback patterns by cross-referencing design changes, production activity, safety/inspection records, project admin, and job cost data. Identifies recurring defect types, root causes, and cost patterns to reduce future warranty exposure.',
    input_schema: { properties: { query: { type: 'string', description: 'Describe the warranty issue, callback pattern, or defect type to investigate' } }, required: ['query'] },
    implementation_type: 'rag_search',
    implementation_config: { skill_ids: ['design_change', 'production_activity', 'safety_inspection', 'project_admin', 'job_cost_report'], match_count: 15, similarity_threshold: 0.35 },
    sample_prompts: ['What are our most common warranty callbacks?', 'Which installation methods correlate with warranty issues?', 'Analyze warranty costs by defect type'],
  },
  {
    tool_name: 'uc6_gc_profitability_contradiction',
    display_name: 'UC6: GC Profitability Contradiction',
    description: 'Detect contradictions in GC profitability — projects where a GC relationship appears profitable on paper but hidden costs (CO delays, scope creep, rework) erode margins. Analyzes change orders, contracts, design changes, estimates, sub bids, job costs, production activity, and project admin.',
    input_schema: { properties: { query: { type: 'string', description: 'Describe the GC, project, or profitability concern to investigate' } }, required: ['query'] },
    implementation_type: 'rag_search',
    implementation_config: { skill_ids: ['change_order', 'contract', 'design_change', 'estimate', 'sub_bid', 'job_cost_report', 'production_activity', 'project_admin'], match_count: 15, similarity_threshold: 0.35 },
    sample_prompts: ['Is our work with ABC Construction actually profitable after hidden costs?', 'Which GC relationships have profitability contradictions?', 'Compare stated margins vs true costs for our top GCs'],
  },
  {
    tool_name: 'uc7_gc_payment_velocity_scoring',
    display_name: 'UC7: GC Payment Velocity Scoring',
    description: 'Score GCs by how quickly they process and pay change orders and invoices. Cross-references change order approval timelines, contract payment terms, design change processing, and project admin records to rank GC payment performance.',
    input_schema: { properties: { query: { type: 'string', description: 'Describe the GC or payment timing question' } }, required: ['query'] },
    implementation_type: 'rag_search',
    implementation_config: { skill_ids: ['change_order', 'contract', 'design_change', 'project_admin'], match_count: 15, similarity_threshold: 0.35 },
    sample_prompts: ['Which GCs pay the fastest?', 'How long does it take ABC Construction to approve change orders?', 'Score our GCs by payment velocity'],
  },
  {
    tool_name: 'uc8_gc_co_approval_rate',
    display_name: 'UC8: GC CO Approval Rate Analysis',
    description: 'Analyze change order approval rates by GC — what percentage of submitted COs get approved, modified, or rejected. Cross-references change orders, contract terms, design changes, and job cost data to identify patterns in GC CO decision-making.',
    input_schema: { properties: { query: { type: 'string', description: 'Describe the GC or change order approval pattern to investigate' } }, required: ['query'] },
    implementation_type: 'rag_search',
    implementation_config: { skill_ids: ['change_order', 'contract', 'design_change', 'job_cost_report'], match_count: 15, similarity_threshold: 0.35 },
    sample_prompts: ['What is our CO approval rate with XYZ Builders?', 'Which GCs reject the most change orders?', 'Analyze CO approval patterns across our GCs'],
  },
  {
    tool_name: 'uc9_gc_risk_concentration',
    display_name: 'UC9: GC Risk Concentration Alert',
    description: 'Identify risk concentration across GC relationships — when too much revenue, backlog, or exposure is concentrated with a single GC. Analyzes change order volumes and contract values to flag dangerous concentration levels.',
    input_schema: { properties: { query: { type: 'string', description: 'Describe the GC risk or concentration concern' } }, required: ['query'] },
    implementation_type: 'rag_search',
    implementation_config: { skill_ids: ['change_order', 'contract'], match_count: 15, similarity_threshold: 0.35 },
    sample_prompts: ['Are we too dependent on any single GC?', 'What percentage of our work is with our top GC?', 'Flag any GC risk concentration issues'],
  },
  {
    tool_name: 'uc10_gc_pm_performance',
    display_name: 'UC10: GC PM Performance Tracking',
    description: 'Track GC project manager performance patterns — how different PMs handle design changes, affect job costs, and influence production efficiency. Identifies which GC PMs are easiest or hardest to work with.',
    input_schema: { properties: { query: { type: 'string', description: 'Describe the GC PM or project management performance question' } }, required: ['query'] },
    implementation_type: 'rag_search',
    implementation_config: { skill_ids: ['design_change', 'job_cost_report', 'production_activity'], match_count: 15, similarity_threshold: 0.35 },
    sample_prompts: ['Which GC project managers cause the most delays?', 'Compare PM responsiveness across our GC relationships', 'How does PM performance affect our project costs?'],
  },
];

const UC_TOOLS_2 = [
  {
    tool_name: 'uc11_bid_accuracy_by_type',
    display_name: 'UC11: Bid Accuracy by Project Type',
    description: 'Analyze how accurate our estimates are by project type, comparing original bid estimates to actual job costs and production data. Identifies which project types we consistently over- or under-estimate.',
    input_schema: { properties: { query: { type: 'string', description: 'Describe the project type, estimate, or bid accuracy question' } }, required: ['query'] },
    implementation_type: 'rag_search',
    implementation_config: { skill_ids: ['estimate', 'job_cost_report', 'production_activity'], match_count: 15, similarity_threshold: 0.35 },
    sample_prompts: ['How accurate are our bids for healthcare projects?', 'Which project types do we most often under-estimate?', 'Compare bid estimates to actuals by project category'],
  },
  {
    tool_name: 'uc12_bid_sweet_spot',
    display_name: 'UC12: Bid Sweet Spot Identification',
    description: 'Identify the optimal project size and type ranges where we are most profitable. Compares estimate data against job cost actuals to find our bidding sweet spot — project characteristics that yield the best margins.',
    input_schema: { properties: { query: { type: 'string', description: 'Describe the bid size, project type, or profitability sweet spot question' } }, required: ['query'] },
    implementation_type: 'rag_search',
    implementation_config: { skill_ids: ['estimate', 'job_cost_report'], match_count: 15, similarity_threshold: 0.35 },
    sample_prompts: ['What size projects are we most profitable on?', 'Where is our bidding sweet spot?', 'Which project characteristics yield the best margins?'],
  },
  {
    tool_name: 'uc13_labor_hour_estimation_variance',
    display_name: 'UC13: Labor Hour Estimation Variance',
    description: 'Compare estimated labor hours to actual hours by trade, task, and project. Cross-references estimates, job cost reports, production activity, and daily reports to identify systematic labor estimation errors.',
    input_schema: { properties: { query: { type: 'string', description: 'Describe the labor hour estimate, trade, or variance question' } }, required: ['query'] },
    implementation_type: 'rag_search',
    implementation_config: { skill_ids: ['estimate', 'job_cost_report', 'production_activity', 'daily_report'], match_count: 15, similarity_threshold: 0.35 },
    sample_prompts: ['How do our estimated labor hours compare to actuals for electrical work?', 'Where are our biggest labor hour variances?', 'Which trades do we consistently under-estimate hours for?'],
  },
  {
    tool_name: 'uc14_material_cost_escalation',
    display_name: 'UC14: Material Cost Escalation Tracking',
    description: 'Track material cost escalation by comparing estimated material costs to actual job cost data. Identifies materials with the largest price increases and projects most affected by escalation.',
    input_schema: { properties: { query: { type: 'string', description: 'Describe the material, cost escalation, or pricing question' } }, required: ['query'] },
    implementation_type: 'rag_search',
    implementation_config: { skill_ids: ['estimate', 'job_cost_report'], match_count: 15, similarity_threshold: 0.35 },
    sample_prompts: ['Which materials have seen the biggest cost increases?', 'How much have copper prices affected our project costs?', 'Track material escalation impact across our projects'],
  },
  {
    tool_name: 'uc15_panic_pricing_elimination',
    display_name: 'UC15: Panic Pricing Elimination',
    description: 'Identify bids where pricing was rushed or panic-driven by analyzing estimate completeness, contract terms, and subsequent job cost overruns. Flags projects where insufficient estimating time led to margin erosion.',
    input_schema: { properties: { query: { type: 'string', description: 'Describe the bid, pricing pressure, or rushed estimate question' } }, required: ['query'] },
    implementation_type: 'rag_search',
    implementation_config: { skill_ids: ['estimate', 'contract', 'job_cost_report'], match_count: 15, similarity_threshold: 0.35 },
    sample_prompts: ['Which bids show signs of panic pricing?', 'Did rushed estimates lead to cost overruns?', 'Identify projects where we left money on the table due to bid timing'],
  },
  {
    tool_name: 'uc16_foreman_productivity_gap',
    display_name: 'UC16: Foreman Productivity Gap Analysis',
    description: 'Analyze productivity differences between foremen by comparing production activity, daily reports, and job cost data. Identifies which foremen consistently exceed or miss productivity targets and the contributing factors.',
    input_schema: { properties: { query: { type: 'string', description: 'Describe the foreman, crew, or productivity question' } }, required: ['query'] },
    implementation_type: 'rag_search',
    implementation_config: { skill_ids: ['production_activity', 'daily_report', 'job_cost_report'], match_count: 15, similarity_threshold: 0.35 },
    sample_prompts: ['Which foremen have the best productivity rates?', 'Compare foreman performance on similar tasks', 'What factors explain productivity gaps between crews?'],
  },
  {
    tool_name: 'uc17_overtime_pattern_detection',
    display_name: 'UC17: Overtime Pattern Detection',
    description: 'Detect overtime patterns by analyzing production activity, daily reports, and job cost data. Identifies which projects, phases, or crews consistently require overtime and the root causes driving it.',
    input_schema: { properties: { query: { type: 'string', description: 'Describe the overtime, scheduling, or labor cost question' } }, required: ['query'] },
    implementation_type: 'rag_search',
    implementation_config: { skill_ids: ['production_activity', 'daily_report', 'job_cost_report'], match_count: 15, similarity_threshold: 0.35 },
    sample_prompts: ['Where are we spending the most on overtime?', 'Which projects have excessive overtime?', 'What patterns lead to overtime on our jobs?'],
  },
  {
    tool_name: 'uc18_crew_composition_optimization',
    display_name: 'UC18: Crew Composition Optimization',
    description: 'Analyze crew composition impact on productivity and cost by comparing production activity logs against job cost data. Identifies optimal crew sizes and skill mixes for different task types.',
    input_schema: { properties: { query: { type: 'string', description: 'Describe the crew, staffing, or composition question' } }, required: ['query'] },
    implementation_type: 'rag_search',
    implementation_config: { skill_ids: ['production_activity', 'job_cost_report'], match_count: 15, similarity_threshold: 0.35 },
    sample_prompts: ['What is the optimal crew size for concrete pours?', 'How does crew composition affect our productivity?', 'Which crew configurations yield the best cost performance?'],
  },
  {
    tool_name: 'uc19_apprentice_journeyman_ratio',
    display_name: 'UC19: Apprentice-to-Journeyman Ratio Impact',
    description: 'Measure the impact of apprentice-to-journeyman ratios on project cost and productivity. Analyzes production activity and job cost data to find the optimal training ratio that balances labor cost savings with productivity.',
    input_schema: { properties: { query: { type: 'string', description: 'Describe the apprentice, journeyman, training, or labor mix question' } }, required: ['query'] },
    implementation_type: 'rag_search',
    implementation_config: { skill_ids: ['production_activity', 'job_cost_report'], match_count: 15, similarity_threshold: 0.35 },
    sample_prompts: ['What apprentice-to-journeyman ratio works best?', 'How do apprentice ratios affect our productivity?', 'Compare labor costs at different apprentice mix levels'],
  },
  {
    tool_name: 'uc20_travel_mobilization_cost',
    display_name: 'UC20: Travel Time & Mobilization Cost',
    description: 'Analyze travel time and mobilization costs from production activity records. Identifies projects or locations where mobilization overhead is disproportionately high and opportunities to reduce non-productive time.',
    input_schema: { properties: { query: { type: 'string', description: 'Describe the travel, mobilization, or non-productive time question' } }, required: ['query'] },
    implementation_type: 'rag_search',
    implementation_config: { skill_ids: ['production_activity'], match_count: 15, similarity_threshold: 0.35 },
    sample_prompts: ['How much are we spending on travel and mobilization?', 'Which projects have the highest mobilization costs?', 'What percentage of labor hours are non-productive travel time?'],
  },
];

const UC_TOOLS_3 = [
  {
    tool_name: 'uc21_design_change_impact',
    display_name: 'UC21: Design Change Impact Quantification',
    description: 'Quantify the full impact of design changes across cost, schedule, and labor. Cross-references change orders, design changes, RFIs, daily reports, production activity, job costs, submittals, and project admin to trace ripple effects of design modifications.',
    input_schema: { properties: { query: { type: 'string', description: 'Describe the design change, modification, or impact question' } }, required: ['query'] },
    implementation_type: 'rag_search',
    implementation_config: { skill_ids: ['change_order', 'design_change', 'rfi', 'daily_report', 'production_activity', 'job_cost_report', 'submittal', 'project_admin'], match_count: 15, similarity_threshold: 0.35 },
    sample_prompts: ['What was the total impact of the mechanical redesign?', 'How do design changes affect our project costs?', 'Trace the ripple effects of RFI-driven design modifications'],
  },
  {
    tool_name: 'uc22_punch_list_cost_patterns',
    display_name: 'UC22: Punch List Cost Pattern Analysis',
    description: 'Analyze punch list cost patterns by cross-referencing production activity, safety/inspection records, project admin, and job cost data. Identifies recurring punch list items, their root causes, and the true cost of rework.',
    input_schema: { properties: { query: { type: 'string', description: 'Describe the punch list, closeout, or rework cost question' } }, required: ['query'] },
    implementation_type: 'rag_search',
    implementation_config: { skill_ids: ['production_activity', 'safety_inspection', 'project_admin', 'job_cost_report'], match_count: 15, similarity_threshold: 0.35 },
    sample_prompts: ['What are our most expensive punch list items?', 'Which types of work generate the most punch list rework?', 'Analyze the cost patterns in our project closeouts'],
  },
  {
    tool_name: 'uc23_coordination_rework_reduction',
    display_name: 'UC23: Coordination-Driven Rework Reduction',
    description: 'Identify rework caused by coordination failures between trades. Cross-references RFIs, production activity, safety/inspection records, submittals, and daily reports to find coordination gaps that lead to costly rework.',
    input_schema: { properties: { query: { type: 'string', description: 'Describe the coordination issue, rework, or trade conflict question' } }, required: ['query'] },
    implementation_type: 'rag_search',
    implementation_config: { skill_ids: ['rfi', 'production_activity', 'safety_inspection', 'submittal', 'daily_report'], match_count: 15, similarity_threshold: 0.35 },
    sample_prompts: ['What rework was caused by coordination failures?', 'Which trade conflicts are costing us the most?', 'How can we reduce coordination-driven rework?'],
  },
  {
    tool_name: 'uc24_schedule_delay_cost_attribution',
    display_name: 'UC24: Schedule Delay Cost Attribution',
    description: 'Attribute schedule delay costs to their root causes. Analyzes change orders, contracts, design changes, RFIs, daily reports, production activity, job costs, submittals, and project admin to determine who or what caused delays and their financial impact.',
    input_schema: { properties: { query: { type: 'string', description: 'Describe the schedule delay, impact, or cost attribution question' } }, required: ['query'] },
    implementation_type: 'rag_search',
    implementation_config: { skill_ids: ['change_order', 'contract', 'design_change', 'rfi', 'daily_report', 'production_activity', 'job_cost_report', 'submittal', 'project_admin'], match_count: 15, similarity_threshold: 0.35 },
    sample_prompts: ['What caused the schedule delays on this project?', 'How much did weather delays cost us?', 'Attribute delay costs to responsible parties'],
  },
  {
    tool_name: 'uc25_value_engineering_tracking',
    display_name: 'UC25: Value Engineering Decision Tracking',
    description: 'Track value engineering decisions and their outcomes. Cross-references change orders, design changes, RFIs, estimates, production activity, and job costs to measure whether VE proposals actually delivered the promised savings.',
    input_schema: { properties: { query: { type: 'string', description: 'Describe the value engineering, cost savings, or VE proposal question' } }, required: ['query'] },
    implementation_type: 'rag_search',
    implementation_config: { skill_ids: ['change_order', 'design_change', 'rfi', 'estimate', 'production_activity', 'job_cost_report'], match_count: 15, similarity_threshold: 0.35 },
    sample_prompts: ['Did our value engineering proposals actually save money?', 'Track the outcomes of VE decisions on this project', 'Which VE proposals had the best cost-to-savings ratio?'],
  },
  {
    tool_name: 'uc26_cash_flow_bottleneck',
    display_name: 'UC26: Cash Flow Bottleneck Identification',
    description: 'Identify cash flow bottlenecks by analyzing change order payment timelines, contract terms, design change impacts, daily report progress, project admin records, submittal delays, and job cost burn rates. Pinpoints where cash gets stuck in the project lifecycle.',
    input_schema: { properties: { query: { type: 'string', description: 'Describe the cash flow, payment, or billing bottleneck question' } }, required: ['query'] },
    implementation_type: 'rag_search',
    implementation_config: { skill_ids: ['change_order', 'contract', 'design_change', 'daily_report', 'project_admin', 'submittal', 'job_cost_report'], match_count: 15, similarity_threshold: 0.35 },
    sample_prompts: ['Where are our cash flow bottlenecks?', 'Which projects have the worst cash flow timing?', 'What is slowing down our payment cycle?'],
  },
  {
    tool_name: 'uc27_project_true_profitability',
    display_name: 'UC27: Project-Level True Profitability',
    description: 'Calculate true project profitability including all hidden costs. Analyzes change orders, contracts, design changes, estimates, sub bids, job costs, production activity, and project admin to reveal the full cost picture beyond the P&L.',
    input_schema: { properties: { query: { type: 'string', description: 'Describe the project, profitability, or margin question' } }, required: ['query'] },
    implementation_type: 'rag_search',
    implementation_config: { skill_ids: ['change_order', 'contract', 'design_change', 'estimate', 'sub_bid', 'job_cost_report', 'production_activity', 'project_admin'], match_count: 15, similarity_threshold: 0.35 },
    sample_prompts: ['What is the true profitability of this project?', 'Are there hidden costs eroding our margins?', 'Compare stated margin vs actual all-in cost'],
  },
  {
    tool_name: 'uc28_invoice_rejection_patterns',
    display_name: 'UC28: Invoice Rejection Pattern Analysis',
    description: 'Analyze invoice rejection patterns by examining change order records, project admin communications, and job cost data. Identifies common rejection reasons, which GCs reject most often, and documentation gaps that cause rejections.',
    input_schema: { properties: { query: { type: 'string', description: 'Describe the invoice rejection, billing dispute, or documentation gap question' } }, required: ['query'] },
    implementation_type: 'rag_search',
    implementation_config: { skill_ids: ['change_order', 'project_admin', 'job_cost_report'], match_count: 15, similarity_threshold: 0.35 },
    sample_prompts: ['Why are our invoices getting rejected?', 'Which GCs reject invoices most often?', 'What documentation gaps cause invoice rejections?'],
  },
  {
    tool_name: 'uc29_project_type_profitability',
    display_name: 'UC29: Project Type Profitability Optimization',
    description: 'Optimize project type selection by analyzing profitability across all project types. Cross-references change orders, contracts, design changes, estimates, sub bids, RFIs, job costs, production activity, safety/inspection, and project admin to rank project types by true return.',
    input_schema: { properties: { query: { type: 'string', description: 'Describe the project type, market segment, or strategic profitability question' } }, required: ['query'] },
    implementation_type: 'rag_search',
    implementation_config: { skill_ids: ['change_order', 'contract', 'design_change', 'estimate', 'sub_bid', 'rfi', 'job_cost_report', 'production_activity', 'safety_inspection', 'project_admin'], match_count: 15, similarity_threshold: 0.35 },
    sample_prompts: ['Which project types are most profitable for us?', 'Should we focus more on healthcare or commercial projects?', 'Rank our market segments by true profitability'],
  },
  {
    tool_name: 'uc30_sub_tier_benchmarking',
    display_name: 'UC30: Subcontractor Tier Benchmarking',
    description: 'Benchmark subcontractor performance across tiers. Analyzes change orders, estimates, sub bids, RFIs, job costs, production activity, submittals, and project admin to rank subs by reliability, quality, cost performance, and responsiveness.',
    input_schema: { properties: { query: { type: 'string', description: 'Describe the subcontractor, vendor, or performance benchmarking question' } }, required: ['query'] },
    implementation_type: 'rag_search',
    implementation_config: { skill_ids: ['change_order', 'estimate', 'sub_bid', 'rfi', 'job_cost_report', 'production_activity', 'submittal', 'project_admin'], match_count: 15, similarity_threshold: 0.35 },
    sample_prompts: ['Which subcontractors perform best?', 'Compare our electrical subs by cost and quality', 'Rank our subs by reliability and responsiveness'],
  },
];

const SCAN_TOOLS = [
  {
    tool_name: 'project_overview',
    display_name: 'Project Overview',
    description: 'Get project metadata (name, address, trade, status, contract value) and a count of all document records by type. Use this when the user asks general questions about a project or wants to know what data is available.',
    input_schema: {
      properties: {},
      required: [],
    },
    implementation_type: 'project_overview',
    implementation_config: {},
    sample_prompts: [
      'Tell me about this project',
      'What data do we have?',
      'Project overview',
    ],
  },
  {
    tool_name: 'scan_sub_bids',
    display_name: 'Scan All Sub Bids',
    description: 'Retrieve ALL subcontractor bid records for comparison and aggregate analysis. Use this instead of search when the user wants to compare bids, rank vendors, or analyze pricing across all subs. Returns every sub_bid record, not just similar ones.',
    input_schema: {
      properties: {
        skill_id: { type: 'string', description: 'Document type to scan', default: 'sub_bid' },
      },
      required: [],
    },
    implementation_type: 'skill_scan',
    implementation_config: { skill_id: 'sub_bid', limit: 200 },
    sample_prompts: [
      'Compare all subcontractor bids',
      'Who gives us the best pricing?',
      'Rank our sub bids by trade',
    ],
  },
  {
    tool_name: 'scan_estimates',
    display_name: 'Scan All Estimates',
    description: 'Retrieve ALL estimate records for comparison and aggregate analysis. Use this instead of search when the user wants to compare estimates, analyze bid ranges, or summarize all bidding data.',
    input_schema: {
      properties: {
        skill_id: { type: 'string', description: 'Document type to scan', default: 'estimate' },
      },
      required: [],
    },
    implementation_type: 'skill_scan',
    implementation_config: { skill_id: 'estimate', limit: 200 },
    sample_prompts: [
      'Show me all our estimates',
      'What size projects are in our estimates?',
      'Summarize our bidding history',
    ],
  },
  {
    tool_name: 'scan_change_orders',
    display_name: 'Scan All Change Orders',
    description: 'Retrieve ALL change order records for comparison and aggregate analysis. Use this instead of search when the user wants totals, trends, status breakdowns, or comparisons across all COs.',
    input_schema: {
      properties: {
        skill_id: { type: 'string', description: 'Document type to scan', default: 'change_order' },
      },
      required: [],
    },
    implementation_type: 'skill_scan',
    implementation_config: { skill_id: 'change_order', limit: 200 },
    sample_prompts: [
      'Show me all change orders',
      'What is the total CO exposure?',
      'Break down change orders by status',
    ],
  },
  {
    tool_name: 'scan_submittals',
    display_name: 'Scan All Submittals',
    description: 'Retrieve ALL submittal records for comparison and aggregate analysis. Use this for submittal log reviews, status tracking, or approval pipeline analysis.',
    input_schema: {
      properties: {
        skill_id: { type: 'string', description: 'Document type to scan', default: 'submittal' },
      },
      required: [],
    },
    implementation_type: 'skill_scan',
    implementation_config: { skill_id: 'submittal', limit: 200 },
    sample_prompts: [
      'Show me all submittals',
      'What is the submittal approval status?',
      'List pending submittals',
    ],
  },
  {
    tool_name: 'scan_contracts',
    display_name: 'Scan All Contracts',
    description: 'Retrieve ALL contract records for review and analysis. Use for contract comparisons, clause analysis, or coverage review.',
    input_schema: {
      properties: {
        skill_id: { type: 'string', description: 'Document type to scan', default: 'contract' },
      },
      required: [],
    },
    implementation_type: 'skill_scan',
    implementation_config: { skill_id: 'contract', limit: 200 },
    sample_prompts: [
      'Show me all contracts',
      'What are the key contract terms?',
      'Compare contract values',
    ],
  },
  {
    tool_name: 'scan_daily_reports',
    display_name: 'Scan All Daily Reports',
    description: 'Retrieve ALL daily report records. Use for timeline analysis, weather impact tracking, or labor trend analysis across reporting periods.',
    input_schema: {
      properties: {
        skill_id: { type: 'string', description: 'Document type to scan', default: 'daily_report' },
      },
      required: [],
    },
    implementation_type: 'skill_scan',
    implementation_config: { skill_id: 'daily_report', limit: 200 },
    sample_prompts: [
      'Show me all daily reports',
      'What does the daily log show?',
      'Analyze daily report trends',
    ],
  },
  {
    tool_name: 'scan_job_cost_reports',
    display_name: 'Scan All Job Cost Reports',
    description: 'Retrieve ALL job cost report records. Use for budget analysis, cost code breakdowns, or variance tracking across all cost items.',
    input_schema: {
      properties: {
        skill_id: { type: 'string', description: 'Document type to scan', default: 'job_cost_report' },
      },
      required: [],
    },
    implementation_type: 'skill_scan',
    implementation_config: { skill_id: 'job_cost_report', limit: 200 },
    sample_prompts: [
      'Show me all job cost data',
      'What are the biggest cost variances?',
      'Break down costs by category',
    ],
  },
  {
    tool_name: 'scan_production_activity',
    display_name: 'Scan All Production Activity',
    description: 'Retrieve ALL production activity records. Use for labor analysis, productivity tracking, or crew performance comparison across all activities.',
    input_schema: {
      properties: {
        skill_id: { type: 'string', description: 'Document type to scan', default: 'production_activity' },
      },
      required: [],
    },
    implementation_type: 'skill_scan',
    implementation_config: { skill_id: 'production_activity', limit: 200 },
    sample_prompts: [
      'Show me all production data',
      'How is labor productivity?',
      'Compare crew performance',
    ],
  },
];

const ALL_SEED_TOOLS = [...DEFAULT_TOOLS, ...UC_TOOLS, ...UC_TOOLS_2, ...UC_TOOLS_3, ...SCAN_TOOLS];

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateUserSession(token) : null;
  if (!session || !['owner', 'admin'].includes(session.role)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const orgId = (session as SessionPayload).orgId;
  const sb = getSupabase();

  const { data: existing } = await sb
    .from('chat_tools')
    .select('tool_name')
    .eq('org_id', orgId);

  const existingNames = new Set((existing || []).map((t: { tool_name: string }) => t.tool_name));
  const toInsert = ALL_SEED_TOOLS.filter(t => !existingNames.has(t.tool_name));

  if (toInsert.length === 0) {
    return Response.json({ message: 'All default tools already exist', seeded: 0 });
  }

  const rows = toInsert.map(t => ({
    org_id: orgId,
    ...t,
    created_by: session.userId,
  }));

  const { error } = await sb.from('chat_tools').insert(rows);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ message: `Seeded ${toInsert.length} default tools`, seeded: toInsert.length });
}
