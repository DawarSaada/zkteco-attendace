import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { ReportResult } from './engine';

/**
 * Export writers.
 *
 * All three read `ReportResult.columns` and `ReportResult.rows`, so the Excel
 * file, the CSV and the PDF cannot disagree about a figure or a column. Each is
 * a browser download of a byte buffer produced on the server, which keeps the
 * heavy lifting off the main thread.
 */

function headerRows(result: ReportResult): string[][] {
  const rows = [
    [result.title],
    [`Period: ${result.from} to ${result.to}`],
    [`Generated: ${result.generatedAt.slice(0, 19).replace('T', ' ')}`],
  ];
  if (result.truncated) {
    rows.push([`Range capped at ${result.from} → ${result.to}`]);
  }
  return rows;
}

function bodyRows(result: ReportResult): (string | number | null)[][] {
  return result.rows.map((row) => result.columns.map((column) => row[column.key] ?? ''));
}

export function reportToXlsx(result: ReportResult): Buffer {
  const sheetData: (string | number | null)[][] = [
    ...headerRows(result),
    [],
    result.columns.map((column) => column.label),
    ...bodyRows(result),
  ];

  if (Object.keys(result.totals).length > 0) {
    sheetData.push([]);
    sheetData.push(['Totals']);
    for (const [key, value] of Object.entries(result.totals)) {
      sheetData.push([key, value]);
    }
  }

  const worksheet = XLSX.utils.aoa_to_sheet(sheetData);
  worksheet['!cols'] = result.columns.map((column) => ({ wch: column.width ?? 14 }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Report');

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export function reportToCsv(result: ReportResult): string {
  const escape = (value: unknown) => {
    const text = value === null || value === undefined ? '' : String(value);
    if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  };

  const lines: string[] = [
    ...headerRows(result).map((row) => row.map(escape).join(',')),
    '',
    result.columns.map((column) => escape(column.label)).join(','),
  ];

  for (const row of result.rows) {
    lines.push(result.columns.map((column) => escape(row[column.key] ?? '')).join(','));
  }

  for (const [key, value] of Object.entries(result.totals)) {
    lines.push(`${escape('totals')},${escape(key)},${escape(value)}`);
  }

  return lines.join('\n');
}

export function reportToPdf(result: ReportResult): Uint8Array {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text(result.title, 10, 10);

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.text(`Period: ${result.from} to ${result.to}`, 10, 15);
  doc.text(`Generated: ${result.generatedAt.slice(0, 19).replace('T', ' ')}`, 10, 19);
  if (result.truncated) {
    doc.text(`Range capped at ${result.from} -> ${result.to}`, 10, 23);
  }

  autoTable(doc, {
    head: [result.columns.map((column) => column.label)],
    body: bodyRows(result).map((row) => row.map((cell) => (cell === null ? '' : String(cell)))),
    startY: result.truncated ? 27 : 23,
    margin: { top: 26, bottom: 8, left: 8, right: 8 },
    theme: 'grid',
    styles: { fontSize: 7, cellPadding: 0.8, overflow: 'ellipsize' },
    headStyles: { fillColor: [238, 242, 248], textColor: [20, 20, 20], fontStyle: 'bold' },
    columnStyles: Object.fromEntries(
      result.columns.map((column, index) => [index, { halign: column.numeric ? 'right' : 'left' }]),
    ),
    foot: Object.keys(result.totals).length
      ? [[`Totals: ${Object.entries(result.totals).map(([key, value]) => `${key}=${value}`).join('  ')}`]]
      : undefined,
  });

  return new Uint8Array(doc.output('arraybuffer') as ArrayBuffer);
}

export function reportFileName(result: ReportResult, extension: string): string {
  return `${result.type}_${result.from}_to_${result.to}.${extension}`;
}
