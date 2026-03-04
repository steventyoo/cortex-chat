import { ProjectData } from './types';

function escapeCsv(value: unknown): string {
  const str = String(value ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function row(...values: unknown[]): string {
  return values.map(escapeCsv).join(',');
}

export function generateProjectCsv(data: ProjectData, projectName: string): string {
  const lines: string[] = [];

  // --- PROJECT OVERVIEW ---
  lines.push('=== PROJECT OVERVIEW ===');
  lines.push(row('Field', 'Value'));
  const p = data.project;
  if (p) {
    lines.push(row('Project Name', projectName));
    lines.push(row('Project ID', p['Project ID']));
    lines.push(row('Job Number', p['Job Number']));
    lines.push(row('Client/Owner', p['Client Owner']));
    lines.push(row('GC Prime', p['GC Prime']));
    lines.push(row('Contract Value', p['Contract Value']));
    lines.push(row('Revised Budget', p['Revised Budget']));
    lines.push(row('Job to Date', p['Job to Date']));
    lines.push(row('Total COs', p['Total COs']));
    lines.push(row('% Complete', p['Percent Complete Cost']));
    lines.push(row('Project Status', p['Project Status']));
    lines.push(row('Start Date', p['Start Date']));
    lines.push(row('Substantial Completion', p['Substantial Completion']));
  }
  lines.push('');

  // --- JOB COSTS ---
  lines.push('=== JOB COSTS ===');
  lines.push(
    row(
      'Item Code',
      'Description',
      'Category',
      'Revised Budget',
      'Change Orders',
      'Job to Date',
      '% of Budget',
      'Over/Under',
      'Variance Status'
    )
  );
  data.jobCosts.forEach((jc) => {
    lines.push(
      row(
        jc['Item Code'],
        jc['Item Description'],
        jc['Category'],
        jc['Revised Budget'],
        jc['Change Orders'],
        jc['Job to Date'],
        jc['Pct of Budget'],
        jc['Over Under'],
        jc['Variance Status']
      )
    );
  });
  lines.push('');

  // --- PRODUCTION ---
  lines.push('=== PRODUCTION METRICS ===');
  lines.push(
    row(
      'Cost Code',
      'Activity',
      'Budget Hours',
      'Actual Hours',
      'Performance Ratio',
      'Productivity Indicator',
      'Hrs to Complete'
    )
  );
  data.production.forEach((pr) => {
    lines.push(
      row(
        pr['Cost Code'],
        pr['Activity Description'],
        pr['Budget Labor Hours'],
        pr['Actual Labor Hours'],
        pr['Performance Ratio'],
        pr['Productivity Indicator'],
        pr['Hrs to Complete']
      )
    );
  });
  lines.push('');

  // --- CHANGE ORDERS ---
  lines.push('=== CHANGE ORDERS ===');
  lines.push(
    row(
      'CO ID',
      'Type',
      'Scope',
      'Date Submitted',
      'Approval Status',
      'Labor Subtotal',
      'Material Subtotal',
      'GC Proposed Amount',
      'Owner Approved Amount',
      'CSI Division',
      'Triggering Doc'
    )
  );
  data.changeOrders.forEach((co) => {
    lines.push(
      row(
        co['CO ID'],
        co['CO Type'],
        co['Scope Description'],
        co['Date Submitted'],
        co['Approval Status'],
        co['Labor Subtotal'],
        co['Material Subtotal'],
        co['GC Proposed Amount'],
        co['Owner Approved Amount'],
        co['CSI Division Primary'],
        co['Triggering Doc Ref']
      )
    );
  });
  lines.push('');

  // --- DESIGN CHANGES ---
  if (data.designChanges.length > 0) {
    lines.push('=== DESIGN CHANGES ===');
    lines.push(
      row('Design Doc ID', 'Type', 'Description', 'Issued By', 'Cost Impact', 'Resulting COR/CO')
    );
    data.designChanges.forEach((dc) => {
      lines.push(
        row(
          dc['Design Doc ID'],
          dc['Document Type'],
          dc['Description'],
          dc['Issued By'],
          dc['Cost Impact'],
          dc['Resulting COR CO']
        )
      );
    });
    lines.push('');
  }

  // --- DOCUMENTS ---
  if (data.documents.length > 0) {
    lines.push('=== DOCUMENTS ===');
    lines.push(row('Document ID', 'Type', 'Title', 'Date', 'Labeling Status'));
    data.documents.forEach((doc) => {
      lines.push(
        row(
          doc['Document ID'],
          doc['Document Type'],
          doc['Document Title'],
          doc['Date on Document'],
          doc['Labeling Status']
        )
      );
    });
    lines.push('');
  }

  // --- RECORD COUNTS ---
  lines.push('=== RECORD COUNTS ===');
  const counts = data.meta.recordCounts;
  Object.entries(counts).forEach(([table, count]) => {
    lines.push(row(table, count));
  });

  return lines.join('\n');
}
