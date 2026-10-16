import ExcelJS from 'exceljs';
import { EMPLOYEE_IMPORT_COLUMNS } from '@lexisora/shared';

/** Heading colours in the Excel template: required columns red, optional columns black. */
export const REQUIRED_RED = 'FFFF0000';
export const OPTIONAL_BLACK = 'FF000000';
const ROWS = 1000; // rows that get drop-downs

export type TemplateLists = { departments: string[]; designations: string[]; branches: string[] };

/** The Excel template: an "Employees" sheet to fill in (red headings = required) and a "How to fill" sheet. */
export async function buildEmployeeTemplate(lists: TemplateLists): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Lexisora HRMS';
  const cols = EMPLOYEE_IMPORT_COLUMNS;

  const ws = wb.addWorksheet('Employees', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = cols.map((c) => ({ header: c.header, key: c.key, width: Math.max(20, c.header.length + 8), style: { numFmt: '@' } }));
  const head = ws.getRow(1);
  head.height = 24;
  cols.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.font = { bold: true, size: 11, color: { argb: c.required ? REQUIRED_RED : OPTIONAL_BLACK } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F1EF' } };
    cell.border = { bottom: { style: 'medium', color: { argb: c.required ? REQUIRED_RED : 'FF9A9696' } } };
    cell.alignment = { vertical: 'middle' };
    cell.note = `${c.required ? 'Required. ' : 'Optional. '}${c.hint}`;
  });

  // S.No: numbered 1..200 down the first column, so any problem can be reported against it. A blank S.No is not data.
  const sCol = cols.findIndex((c) => c.key === 's_no') + 1;
  if (sCol > 0) {
    ws.getColumn(sCol).width = 8;
    for (let r = 2; r <= 201; r++) {
      const cell = ws.getCell(r, sCol);
      cell.value = r - 1;
      cell.numFmt = '0';
      cell.font = { color: { argb: 'FF605D5D' } };
      cell.alignment = { horizontal: 'center' };
    }
  }

  // Drop-down choices live on a hidden sheet.
  const lv = wb.addWorksheet('Lists', { state: 'hidden' });
  const put = (col: number, items: string[]) => items.forEach((v, r) => (lv.getCell(r + 1, col).value = v));
  put(1, lists.departments);
  put(2, lists.designations);
  put(3, lists.branches);
  const idx = (key: string) => cols.findIndex((c) => c.key === key) + 1;
  const listRef = (col: string, n: number) => `Lists!$${col}$1:$${col}$${n}`;
  const rule = (key: string, formula: string, strict: boolean) => {
    const col = idx(key);
    for (let r = 2; r <= ROWS + 1; r++) {
      ws.getCell(r, col).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [formula],
        showErrorMessage: true,
        errorStyle: strict ? 'stop' : 'warning',
        errorTitle: strict ? 'Pick from the list' : 'Not in the list',
        error: strict ? 'Choose one of the listed values.' : 'This is not in the list. It can only be imported if you tick "Create departments, designations and branches that do not exist yet".',
      };
    }
  };
  rule('employment_type', '"Full-time,Intern,Contract"', true);
  rule('work_mode', '"Office,Remote,Hybrid"', true);
  if (lists.departments.length) rule('department', listRef('A', lists.departments.length), false);
  if (lists.designations.length) rule('designation', listRef('B', lists.designations.length), false);
  if (lists.branches.length) rule('branch', listRef('C', lists.branches.length), false);

  const how = wb.addWorksheet('How to fill');
  how.columns = [{ width: 22 }, { width: 14 }, { width: 62 }, { width: 32 }];
  how.addRow(['Employee import: how to fill the Employees sheet']).font = { bold: true, size: 14 };
  how.addRow([]);
  how.addRow(['Red heading = required. Black heading = optional.']).font = { bold: true };
  how.addRow(['Enter one employee per row, starting at row 2 of the Employees sheet. Do not rename or move the columns. Up to 5,000 rows.']);
  how.addRow([]);
  const hr = how.addRow(['Column', 'Required?', 'What to enter', 'Example']);
  hr.font = { bold: true };
  hr.eachCell((c) => (c.border = { bottom: { style: 'thin' } }));
  for (const c of cols) {
    const row = how.addRow([c.header, c.required ? 'Required' : 'Optional', c.hint, c.example]);
    row.getCell(1).font = { bold: true, color: { argb: c.required ? REQUIRED_RED : OPTIONAL_BLACK } };
    row.getCell(2).font = { color: { argb: c.required ? REQUIRED_RED : OPTIONAL_BLACK } };
  }
  how.getColumn(3).alignment = { wrapText: true, vertical: 'top' };

  return Buffer.from(await wb.xlsx.writeBuffer());
}

const norm = (h: unknown) => {
  const k = String(h ?? '').trim().toLowerCase().replace(/\*/g, '').replace(/[\s-]+/g, '_').replace(/_+$/, '');
  return /^s_?\.?_?no\.?$/.test(k) ? 's_no' : k; // "S.No", "S. No", "s no", "sno" all mean the serial number
};

function cellText(v: ExcelJS.CellValue | undefined): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((t) => t.text).join('').trim();
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue);
    if ('text' in v) return cellText(v.text as unknown as ExcelJS.CellValue);
    return '';
  }
  return String(v).trim();
}

/** Rows of the Excel file as { column_key: text }, using the same keys as the CSV import. Empty rows are skipped. */
export async function readEmployeesXlsx(buffer: Buffer): Promise<Record<string, string>[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as never);
  const ws = wb.getWorksheet('Employees') ?? wb.worksheets.find((w) => w.state !== 'hidden');
  if (!ws) return [];
  const keys: string[] = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (cell, i) => {
    keys[i] = norm(cellText(cell.value));
  });
  const out: Record<string, string>[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const rec: Record<string, string> = {};
    let any = false;
    keys.forEach((k, i) => {
      if (!k) return;
      const v = row.getCell(i).value;
      // A date pasted from another sheet can arrive as an Excel serial number (days since 30 Dec 1899).
      const t = k === 'joining_date' && typeof v === 'number' && v > 20000 && v < 80000 ? new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86_400_000).toISOString().slice(0, 10) : cellText(v);
      if (t && k !== 's_no') any = true;
      rec[k] = t;
    });
    if (any) out.push(rec);
  }
  return out;
}
