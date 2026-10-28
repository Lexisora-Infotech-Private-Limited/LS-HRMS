import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { EMPLOYEE_IMPORT_COLUMNS } from '@lexisora/shared';
import { OPTIONAL_BLACK, REQUIRED_RED, buildEmployeeTemplate, readEmployeesXlsx } from './employee-xlsx';
import { validateCsvRows } from '../people.rules';

const lists = { departments: ['Development', 'Design'], designations: ['React Developer', 'Intern'], branches: ['Ahmedabad'] };
const load = async (buf: Buffer) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as never);
  return wb;
};

describe('employee import Excel template', () => {
  it('shows required column headings in red and optional ones in black', async () => {
    const wb = await load(await buildEmployeeTemplate(lists));
    const ws = wb.getWorksheet('Employees')!;
    expect(ws).toBeTruthy();
    EMPLOYEE_IMPORT_COLUMNS.forEach((c, i) => {
      const cell = ws.getRow(1).getCell(i + 1);
      expect(cell.value).toBe(c.header);
      expect(cell.font?.color?.argb).toBe(c.required ? REQUIRED_RED : OPTIONAL_BLACK);
      expect(cell.font?.bold).toBe(true);
    });
    const required = EMPLOYEE_IMPORT_COLUMNS.filter((c) => c.required).map((c) => c.key);
    expect(required).toEqual(['full_name', 'official_email', 'phone', 'department', 'designation', 'joining_date']);
  });

  it('offers drop-down lists, explains each column, and starts with no sample employees to import by accident', async () => {
    const wb = await load(await buildEmployeeTemplate(lists));
    const ws = wb.getWorksheet('Employees')!;
    const col = (k: string) => EMPLOYEE_IMPORT_COLUMNS.findIndex((c) => c.key === k) + 1;
    expect(ws.getCell(2, col('employment_type')).dataValidation?.formulae?.[0]).toContain('Full-time,Intern,Contract');
    expect(ws.getCell(2, col('work_mode')).dataValidation?.formulae?.[0]).toContain('Office,Remote,Hybrid');
    expect(ws.getCell(2, col('department')).dataValidation?.formulae?.[0]).toBe('Lists!$A$1:$A$2');
    expect(ws.getCell(2, col('department')).dataValidation?.errorStyle).toBe('warning'); // a new department can still be typed
    expect(ws.getCell(2, col('full_name')).value).toBeNull();
    expect(wb.getWorksheet('Lists')?.state).toBe('hidden');
    const how = wb.getWorksheet('How to fill')!;
    const names: string[] = [];
    how.eachRow((r) => names.push(String(r.getCell(1).value ?? '')));
    for (const c of EMPLOYEE_IMPORT_COLUMNS) expect(names).toContain(c.header);
  });
});

describe('reading the filled Excel file', () => {
  async function filled() {
    const wb = await load(await buildEmployeeTemplate(lists));
    const ws = wb.getWorksheet('Employees')!;
    const set = (r: number, vals: Record<string, ExcelJS.CellValue>) =>
      Object.entries(vals).forEach(([k, v]) => (ws.getCell(r, EMPLOYEE_IMPORT_COLUMNS.findIndex((c) => c.key === k) + 1).value = v));
    set(2, { full_name: 'Aditya Kulkarni', official_email: 'Aditya.Kulkarni@lexisora.com', phone: '+91 98250 11111', department: 'Development', designation: 'React Developer', joining_date: '12-10-2026', employment_type: 'Full-time' });
    set(3, { full_name: 'Tanvi Shah', official_email: 'tanvi@lexisora.com', phone: 9825022222 as unknown as string, department: 'Design', designation: 'Intern', joining_date: new Date(Date.UTC(2026, 9, 12)), employment_type: 'Intern', work_mode: 'Hybrid', branch: 'Ahmedabad' });
    // row 4 left empty on purpose
    set(5, { full_name: '  Rohan  ', official_email: { text: 'rohan@lexisora.com', hyperlink: 'mailto:rohan@lexisora.com' } as unknown as string, phone: '9825033333', department: 'Design', designation: 'Intern', joining_date: '2026-10-13' });
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  it('reads the rows with the same keys as the CSV import and skips empty rows', async () => {
    const rows = await readEmployeesXlsx(await filled());
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ full_name: 'Aditya Kulkarni', official_email: 'Aditya.Kulkarni@lexisora.com', phone: '+91 98250 11111', joining_date: '12-10-2026' });
    expect(rows[1]).toMatchObject({ phone: '9825022222', joining_date: '2026-10-12', work_mode: 'Hybrid', branch: 'Ahmedabad' }); // a number and a real Excel date both work
    expect(rows[2]).toMatchObject({ full_name: 'Rohan', official_email: 'rohan@lexisora.com' }); // trimmed, hyperlink text
  });

  it('the rows pass the same validation as the CSV import', async () => {
    const rows = await readEmployeesXlsx(await filled());
    const ctx = {
      departments: new Map([['development', 'd1'], ['design', 'd2']]),
      designations: new Map([['react developer', 'g1'], ['intern', 'g2']]),
      branches: new Map([['ahmedabad', 'b1']]),
      managersByEmail: new Map<string, string>(),
      existingEmails: new Set<string>(),
      today: '2026-10-15',
    };
    const { valid, errors } = validateCsvRows(rows, ctx);
    expect(errors).toEqual([]);
    expect(valid.map((v) => v.officialEmail)).toEqual(['aditya.kulkarni@lexisora.com', 'tanvi@lexisora.com', 'rohan@lexisora.com']);
    expect(valid[1]).toMatchObject({ employmentType: 'INTERN', workMode: 'HYBRID', joiningDate: '2026-10-12', branchId: 'b1' });
  });

  it('accepts friendly headings in any case, with an asterisk, as the CSV keys', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    ws.addRow(['Full Name *', 'OFFICIAL EMAIL', 'joining-date']);
    ws.addRow(['A B', 'a@b.co', '2026-10-12']);
    const rows = await readEmployeesXlsx(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(rows[0]).toEqual({ full_name: 'A B', official_email: 'a@b.co', joining_date: '2026-10-12' });
  });
});

describe('S.No in the Excel file', () => {
  it('is the first column, numbered down the sheet, in black, and a numbered but otherwise empty row is not an employee', async () => {
    const wb = await load(await buildEmployeeTemplate(lists));
    const ws = wb.getWorksheet('Employees')!;
    expect(ws.getCell(1, 1).value).toBe('S.No');
    expect(ws.getCell(1, 1).font?.color?.argb).toBe(OPTIONAL_BLACK);
    expect([ws.getCell(2, 1).value, ws.getCell(3, 1).value, ws.getCell(201, 1).value]).toEqual([1, 2, 200]);
    expect(await readEmployeesXlsx(Buffer.from(await wb.xlsx.writeBuffer()))).toEqual([]);
  });

  it('carries the S.No into the problems, so the person can be found in the sheet', async () => {
    const wb = await load(await buildEmployeeTemplate(lists));
    const ws = wb.getWorksheet('Employees')!;
    const col = (k: string) => EMPLOYEE_IMPORT_COLUMNS.findIndex((c) => c.key === k) + 1;
    const fill = (r: number, v: Record<string, string>) => Object.entries(v).forEach(([k, x]) => (ws.getCell(r, col(k)).value = x));
    fill(4, { full_name: 'Row Four', official_email: 'four@lexisora.com', phone: '98250 22222', department: 'Development', designation: 'Intern', joining_date: '16-10-2026' });
    fill(7, { full_name: 'Row Seven', official_email: 'seven@lexisora.com', phone: '98250 22222', department: 'Development', designation: 'Intern', joining_date: '16-10-2026' });
    const rows = await readEmployeesXlsx(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(rows.map((r) => r.s_no)).toEqual(['3', '6']); // the numbers printed in the sheet, not the sheet row
    const ctx = { departments: new Map([['development', 'd']]), designations: new Map([['intern', 'g']]), branches: new Map(), managersByEmail: new Map<string, string>(), existingEmails: new Set<string>(), today: '2026-10-16' };
    const { errors } = validateCsvRows(rows, ctx);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ sNo: '6', field: 'phone' });
    expect(errors[0]!.message).toBe('Same phone number for S.No 3 and S.No 6');
  });
});
