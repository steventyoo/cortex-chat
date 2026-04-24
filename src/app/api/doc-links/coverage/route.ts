import { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE, SessionPayload } from '@/lib/auth-v2';
import { getSupabase } from '@/lib/supabase';
import type { LinkStatus } from '@/lib/schemas/enums';

const CHAIN_GROUPS: Record<string, string[]> = {
  'Revenue Pipeline': [
    'rfi_triggers_asi', 'asi_generates_co', 'rfi_originates_co',
    'co_billed_in_payapp', 'pco_rolled_into_co',
  ],
  'Estimating Feedback': [
    'estimate_vs_production', 'estimate_vs_co', 'subbid_vs_co',
    'subbid_vs_rfi', 'estimate_vs_jcr',
    'estimate_to_subbid', 'rfi_to_estimate', 'jcr_to_estimate',
  ],
  'JCR Hub': [
    'co_absorption_jcr', 'production_vs_jcr', 'daily_report_vs_jcr',
    'payapp_vs_jcr', 'jcr_to_production',
  ],
  'Safety & Quality': [
    'inspection_to_daily', 'inspection_to_production',
    'inspection_to_punchlist',
    'inspection_to_rfi', 'punchlist_to_retention', 'warranty_to_production',
  ],
  'Contract & Admin': [
    'contract_clause_to_co', 'contract_to_submittal',
    'submittal_generates_rfi', 'meeting_refs_rfi_co', 'meeting_refs_co',
    'contract_to_payment_terms', 'contract_to_backcharge',
  ],
  'Design Changes': [
    'ccd_to_co', 'bulletin_to_asi',
  ],
  'Productivity': [
    'rfi_impacts_production', 'weather_impacts_production',
    'daily_to_production', 'rfi_to_daily',
  ],
  'Sub Performance': [
    'subbid_vs_punchlist',
  ],
};

interface LinkTypeCoverage {
  linkTypeKey: string;
  displayName: string;
  sourceSkill: string;
  targetSkill: string;
  sourceDocs: number;
  targetDocs: number;
  actualLinks: number;
  avgConfidence: number;
  status: LinkStatus;
}

interface ChainCoverage {
  chainName: string;
  linkTypes: LinkTypeCoverage[];
  overallStatus: LinkStatus;
  completionPct: number;
}

interface ProjectCoverage {
  projectId: string;
  projectName: string;
  docCount: number;
  skillBreakdown: Record<string, number>;
  chains: ChainCoverage[];
  overallCompletionPct: number;
}

function computeStatus(sourceDocs: number, targetDocs: number, actualLinks: number): LinkStatus {
  if (sourceDocs === 0 || targetDocs === 0) return 'not_applicable';
  if (actualLinks === 0) return 'missing';
  const expectedPairs = Math.min(sourceDocs, targetDocs);
  const ratio = actualLinks / expectedPairs;
  return ratio >= 0.75 ? 'complete' : 'partial';
}

function computeChainStatus(linkTypes: LinkTypeCoverage[]): { status: LinkStatus; pct: number } {
  const applicable = linkTypes.filter(lt => lt.status !== 'not_applicable');
  if (applicable.length === 0) return { status: 'not_applicable', pct: 0 };

  const complete = applicable.filter(lt => lt.status === 'complete').length;
  const partial = applicable.filter(lt => lt.status === 'partial').length;
  const pct = Math.round(((complete + partial * 0.5) / applicable.length) * 100);

  if (complete === applicable.length) return { status: 'complete', pct: 100 };
  if (complete + partial === 0) return { status: 'missing', pct: 0 };
  return { status: 'partial', pct };
}

export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await validateUserSession(token || '');
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const orgId = (session as SessionPayload).orgId;
  const projectId = request.nextUrl.searchParams.get('projectId');

  const sb = getSupabase();

  const [linkTypesRes, linksRes, projectsRes] = await Promise.all([
    sb.from('document_link_types').select('*').eq('is_active', true),
    (() => {
      let q = sb.from('document_links_v2').select('link_type_id, project_id, confidence').eq('org_id', orgId);
      if (projectId) q = q.eq('project_id', projectId);
      return q;
    })(),
    (() => {
      let q = sb.from('projects').select('project_id, project_name').eq('org_id', orgId);
      if (projectId) q = q.eq('project_id', projectId);
      return q;
    })(),
  ]);

  if (linkTypesRes.error || linksRes.error || projectsRes.error) {
    const msg = linkTypesRes.error?.message || linksRes.error?.message || projectsRes.error?.message;
    return Response.json({ error: msg }, { status: 500 });
  }

  const linkTypes = linkTypesRes.data || [];
  const links = linksRes.data || [];
  const projects = projectsRes.data || [];

  // Fetch doc counts per project per skill from pipeline_log
  let plQuery = sb
    .from('pipeline_log')
    .select('project_id, document_type')
    .eq('org_id', orgId)
    .in('status', ['pending_review', 'tier2_validated', 'pushed'])
    .not('document_type', 'is', null);
  if (projectId) plQuery = plQuery.eq('project_id', projectId);

  const { data: pipelineDocs } = await plQuery;

  // Build skill counts per project: { projectId: { skillId: count } }
  const skillCounts = new Map<string, Record<string, number>>();
  for (const doc of pipelineDocs || []) {
    const pid = doc.project_id as string;
    const skill = doc.document_type as string;
    if (!pid || !skill) continue;
    if (!skillCounts.has(pid)) skillCounts.set(pid, {});
    const counts = skillCounts.get(pid)!;
    counts[skill] = (counts[skill] || 0) + 1;
  }

  // Build link counts per project per link_type_id
  const linkCounts = new Map<string, Map<string, { count: number; totalConf: number }>>();
  for (const link of links) {
    const pid = link.project_id as string;
    const ltId = link.link_type_id as string;
    if (!pid) continue;
    if (!linkCounts.has(pid)) linkCounts.set(pid, new Map());
    const projMap = linkCounts.get(pid)!;
    if (!projMap.has(ltId)) projMap.set(ltId, { count: 0, totalConf: 0 });
    const entry = projMap.get(ltId)!;
    entry.count++;
    entry.totalConf += (link.confidence as number) || 0;
  }

  const result: ProjectCoverage[] = projects.map((proj: Record<string, unknown>) => {
    const pid = proj.project_id as string;
    const pname = proj.project_name as string;
    const skills = skillCounts.get(pid) || {};
    const docCount = Object.values(skills).reduce((a, b) => a + b, 0);
    const projLinks = linkCounts.get(pid) || new Map();

    const chains: ChainCoverage[] = Object.entries(CHAIN_GROUPS).map(([chainName, ltKeys]) => {
      const chainLinkTypes: LinkTypeCoverage[] = ltKeys.map(key => {
        const lt = linkTypes.find((t: Record<string, unknown>) => t.link_type_key === key);
        if (!lt) {
          return {
            linkTypeKey: key, displayName: key, sourceSkill: '', targetSkill: '',
            sourceDocs: 0, targetDocs: 0, actualLinks: 0, avgConfidence: 0, status: 'not_applicable' as LinkStatus,
          };
        }
        const sourceSkill = lt.source_skill as string;
        const targetSkill = lt.target_skill as string;
        const sourceDocs = skills[sourceSkill] || 0;
        const targetDocs = skills[targetSkill] || 0;
        const linkData = projLinks.get(lt.id as string);
        const actualLinks = linkData?.count || 0;
        const avgConfidence = actualLinks > 0 ? Math.round((linkData!.totalConf / actualLinks) * 100) / 100 : 0;
        const status = computeStatus(sourceDocs, targetDocs, actualLinks);

        return {
          linkTypeKey: key,
          displayName: lt.display_name as string,
          sourceSkill,
          targetSkill,
          sourceDocs,
          targetDocs,
          actualLinks,
          avgConfidence,
          status,
        };
      });

      const { status: overallStatus, pct: completionPct } = computeChainStatus(chainLinkTypes);
      return { chainName, linkTypes: chainLinkTypes, overallStatus, completionPct };
    });

    const applicableChains = chains.filter(c => c.overallStatus !== 'not_applicable');
    const overallCompletionPct = applicableChains.length > 0
      ? Math.round(applicableChains.reduce((a, c) => a + c.completionPct, 0) / applicableChains.length)
      : 0;

    return { projectId: pid, projectName: pname, docCount, skillBreakdown: skills, chains, overallCompletionPct };
  });

  return Response.json({ projects: result });
}
