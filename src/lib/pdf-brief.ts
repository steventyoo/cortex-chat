import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { ProjectData } from './types';

function fmtCurrency(value: unknown): string {
  const num = Number(value);
  if (isNaN(num)) return '$0';
  if (Math.abs(num) >= 1000) {
    return `$${(num / 1000).toFixed(0)}K`;
  }
  return `$${num.toLocaleString()}`;
}

function fmtCurrencyFull(value: unknown): string {
  const num = Number(value);
  if (isNaN(num)) return '$0';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(num);
}

function fmtPercent(value: unknown): string {
  const num = Number(value);
  if (isNaN(num)) return '0%';
  return `${Math.round(num)}%`;
}

export function generateProjectBrief(
  data: ProjectData,
  projectName: string,
  logoBase64?: string
): ArrayBuffer {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 15;
  let y = 15;

  // --- HEADER ---
  // Logo (if provided)
  if (logoBase64) {
    try {
      doc.addImage(logoBase64, 'PNG', margin, y, 50, 10);
    } catch {
      // Skip logo if it fails
    }
  }

  // Date (right-aligned)
  doc.setFontSize(9);
  doc.setTextColor(150, 150, 150);
  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  doc.text(today, pageWidth - margin, y + 6, { align: 'right' });

  y += 18;

  // --- TITLE ---
  doc.setFontSize(16);
  doc.setTextColor(26, 26, 26);
  doc.setFont('helvetica', 'bold');
  doc.text('ONE WAY PLUMBING LLC', margin, y);
  y += 7;

  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 100, 100);
  doc.text(`${projectName} — Project Brief`, margin, y);
  y += 3;

  // Divider line
  doc.setDrawColor(230, 230, 230);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageWidth - margin, y);
  y += 6;

  // --- PROJECT OVERVIEW ---
  const p = data.project;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(26, 26, 26);
  doc.text('PROJECT OVERVIEW', margin, y);
  y += 2;

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['Field', 'Value']],
    body: [
      ['Contract Value', fmtCurrencyFull(p?.['Contract Value'])],
      ['Job to Date', fmtCurrencyFull(p?.['Job to Date'])],
      ['Total COs', fmtCurrencyFull(p?.['Total COs'])],
      ['% Complete', fmtPercent(p?.['Percent Complete Cost'])],
    ],
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [245, 245, 245], textColor: [80, 80, 80], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [252, 252, 252] },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 40 } },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 6;

  // --- JOB COSTS ---
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(26, 26, 26);
  doc.text(`KEY VARIANCES (${data.jobCosts.length} line items from Job Report)`, margin, y);
  y += 2;

  // Sort by absolute variance and take top 5
  const sortedCosts = [...data.jobCosts]
    .filter((jc) => jc['Over Under'] !== undefined)
    .sort((a, b) => Math.abs(Number(b['Over Under'])) - Math.abs(Number(a['Over Under'])))
    .slice(0, 5);

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['Item', 'Budget', 'Actual', '%', 'Flag']],
    body: sortedCosts.map((jc) => {
      const variance = String(jc['Variance Status'] || '');
      const isOver = variance.toLowerCase().includes('over');
      return [
        String(jc['Item Description'] || jc['Item Code'] || ''),
        fmtCurrency(jc['Revised Budget']),
        fmtCurrency(jc['Job to Date']),
        fmtPercent(jc['Pct of Budget']),
        isOver ? 'OVER' : 'UNDER',
      ];
    }),
    styles: { fontSize: 7.5, cellPadding: 1.5 },
    headStyles: { fillColor: [245, 245, 245], textColor: [80, 80, 80], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [252, 252, 252] },
    columnStyles: {
      0: { cellWidth: 45 },
      4: { cellWidth: 18 },
    },
    didParseCell: (hookData) => {
      if (hookData.column.index === 4 && hookData.section === 'body') {
        const val = String(hookData.cell.raw);
        if (val === 'OVER') {
          hookData.cell.styles.textColor = [220, 38, 38]; // red
          hookData.cell.styles.fontStyle = 'bold';
        } else if (val === 'UNDER') {
          hookData.cell.styles.textColor = [22, 163, 74]; // green
          hookData.cell.styles.fontStyle = 'bold';
        }
      }
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 6;

  // --- PRODUCTION ---
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(26, 26, 26);
  doc.text(`PRODUCTION METRICS (${data.production.length} cost code groups)`, margin, y);
  y += 2;

  const prodRows = data.production.map((pr) => {
    const ratio = Number(pr['Performance Ratio'] || 0);
    const indicator = String(pr['Productivity Indicator'] || '');
    let status = 'On Track';
    if (indicator.toLowerCase().includes('above')) status = 'Above Expected';
    else if (indicator.toLowerCase().includes('significantly'))
      status = 'Significantly Behind';
    else if (indicator.toLowerCase().includes('below')) status = 'Below Expected';
    return [
      String(pr['Activity Description'] || pr['Cost Code'] || ''),
      ratio.toFixed(3),
      status,
    ];
  });

  // Add PROJECT TOTAL row
  const totalBudgetHrs = data.production.reduce(
    (sum, pr) => sum + Number(pr['Budget Labor Hours'] || 0),
    0
  );
  const totalActualHrs = data.production.reduce(
    (sum, pr) => sum + Number(pr['Actual Labor Hours'] || 0),
    0
  );
  const totalRatio = totalBudgetHrs > 0 ? totalActualHrs / totalBudgetHrs : 0;
  const overPct = totalRatio > 1 ? ((totalRatio - 1) * 100).toFixed(1) : '0';
  prodRows.push(['PROJECT TOTAL', totalRatio.toFixed(3), `${overPct}% over hours`]);

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['Activity', 'Perf. Ratio', 'Status']],
    body: prodRows,
    styles: { fontSize: 7.5, cellPadding: 1.5 },
    headStyles: { fillColor: [245, 245, 245], textColor: [80, 80, 80], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [252, 252, 252] },
    columnStyles: { 0: { cellWidth: 55 } },
    didParseCell: (hookData) => {
      if (hookData.section === 'body') {
        const val = String(hookData.cell.raw);
        // Color status column
        if (hookData.column.index === 2) {
          if (val.includes('Above') || val === 'On Track') {
            hookData.cell.styles.textColor = [22, 163, 74];
          } else if (val.includes('Behind') || val.includes('Below')) {
            hookData.cell.styles.textColor = [220, 38, 38];
            hookData.cell.styles.fontStyle = 'bold';
          }
        }
        // Bold PROJECT TOTAL row
        if (hookData.column.index === 0 && val === 'PROJECT TOTAL') {
          hookData.cell.styles.fontStyle = 'bold';
        }
      }
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 6;

  // --- CHANGE ORDERS ---
  if (data.changeOrders.length > 0) {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(26, 26, 26);
    doc.text(`CHANGE ORDERS (${data.changeOrders.length} records)`, margin, y);
    y += 2;

    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [['CO ID', 'Scope', 'GC Proposed', 'Status']],
      body: data.changeOrders.map((co) => [
        String(co['CO ID'] || ''),
        String(co['Scope Description'] || '').substring(0, 60),
        fmtCurrencyFull(co['GC Proposed Amount']),
        String(co['Approval Status'] || ''),
      ]),
      styles: { fontSize: 7.5, cellPadding: 1.5 },
      headStyles: { fillColor: [245, 245, 245], textColor: [80, 80, 80], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [252, 252, 252] },
      columnStyles: { 1: { cellWidth: 70 } },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable.finalY + 6;
  }

  // --- RECORDS SUMMARY ---
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(120, 120, 120);
  const counts = data.meta.recordCounts;
  const recordLine = `Records: PROJECTS 1 | DOCUMENTS ${counts.documents || 0} | CHANGE ORDERS ${counts.changeOrders || 0} | JOB COSTS ${counts.jobCosts || 0} | PRODUCTION ${counts.production || 0}`;
  doc.text(recordLine, margin, y);
  y += 5;

  // Footer
  doc.setFontSize(7);
  doc.setTextColor(180, 180, 180);
  doc.text('Generated by Project Cortex', margin, y);

  return doc.output('arraybuffer');
}
