/**
 * Seeded chart of accounts. `key` = systemKey used by auto-postings (never renamed/deleted).
 * AR (1130) and AP (2100) are groups: every client / vendor gets its own sub-ledger.
 */
export type CoaEntry = {
  code: string;
  name: string;
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';
  parent?: string; // parent code
  group?: boolean;
  key?: string;
};

export const CHART_OF_ACCOUNTS: CoaEntry[] = [
  { code: '1000', name: 'Assets', type: 'ASSET', group: true },
  { code: '1100', name: 'Current assets', type: 'ASSET', parent: '1000', group: true },
  { code: '1110', name: 'HDFC Current A/c', type: 'ASSET', parent: '1100', key: 'BANK' },
  { code: '1120', name: 'Cash in hand', type: 'ASSET', parent: '1100', key: 'CASH' },
  { code: '1130', name: 'Sundry debtors', type: 'ASSET', parent: '1100', group: true, key: 'AR' },
  { code: '1140', name: 'Input CGST', type: 'ASSET', parent: '1100', key: 'GST_INPUT_CGST' },
  { code: '1141', name: 'Input SGST', type: 'ASSET', parent: '1100', key: 'GST_INPUT_SGST' },
  { code: '1142', name: 'Input IGST', type: 'ASSET', parent: '1100', key: 'GST_INPUT_IGST' },
  { code: '1150', name: 'TDS receivable', type: 'ASSET', parent: '1100', key: 'TDS_RECEIVABLE' },
  { code: '1160', name: 'Advances to employees', type: 'ASSET', parent: '1100' },
  { code: '1200', name: 'Fixed assets', type: 'ASSET', parent: '1000', group: true },
  { code: '1210', name: 'Laptops & computers', type: 'ASSET', parent: '1200', key: 'LAPTOPS' },
  { code: '1220', name: 'Furniture & fixtures', type: 'ASSET', parent: '1200' },
  { code: '2000', name: 'Liabilities', type: 'LIABILITY', group: true },
  { code: '2100', name: 'Sundry creditors', type: 'LIABILITY', parent: '2000', group: true, key: 'AP' },
  { code: '2110', name: 'Output CGST', type: 'LIABILITY', parent: '2000', key: 'GST_OUTPUT_CGST' },
  { code: '2111', name: 'Output SGST', type: 'LIABILITY', parent: '2000', key: 'GST_OUTPUT_SGST' },
  { code: '2112', name: 'Output IGST', type: 'LIABILITY', parent: '2000', key: 'GST_OUTPUT_IGST' },
  { code: '2120', name: 'Salary payable', type: 'LIABILITY', parent: '2000', key: 'SALARY_PAYABLE' },
  { code: '2121', name: 'PF payable', type: 'LIABILITY', parent: '2000', key: 'PF_PAYABLE' },
  { code: '2123', name: 'Professional tax payable', type: 'LIABILITY', parent: '2000', key: 'PT_PAYABLE' },
  { code: '2124', name: 'TDS payable – salary (192)', type: 'LIABILITY', parent: '2000', key: 'TDS_PAYABLE' },
  { code: '2130', name: 'Employee reimbursements payable', type: 'LIABILITY', parent: '2000', key: 'REIMB_PAYABLE' },
  { code: '3000', name: 'Equity', type: 'EQUITY', group: true },
  { code: '3100', name: 'Capital account', type: 'EQUITY', parent: '3000', key: 'CAPITAL' },
  { code: '3200', name: 'Retained earnings', type: 'EQUITY', parent: '3000', key: 'RETAINED_EARNINGS' },
  { code: '4000', name: 'Income', type: 'INCOME', group: true },
  { code: '4100', name: 'Sales – IT services', type: 'INCOME', parent: '4000', key: 'SALES_SERVICES' },
  { code: '4200', name: 'Other income', type: 'INCOME', parent: '4000', key: 'OTHER_INCOME' },
  { code: '4900', name: 'Round off', type: 'INCOME', parent: '4000', key: 'ROUND_OFF' },
  { code: '5000', name: 'Expenses', type: 'EXPENSE', group: true },
  { code: '5100', name: 'Salaries & wages', type: 'EXPENSE', parent: '5000', key: 'SALARY_EXPENSE' },
  { code: '5110', name: 'Employer PF contribution', type: 'EXPENSE', parent: '5000', key: 'EMPLOYER_PF_EXPENSE' },
  { code: '5200', name: 'Rent', type: 'EXPENSE', parent: '5000', key: 'RENT' },
  { code: '5210', name: 'Office supplies', type: 'EXPENSE', parent: '5000', key: 'OFFICE_SUPPLIES' },
  { code: '5220', name: 'Staff welfare', type: 'EXPENSE', parent: '5000', key: 'STAFF_WELFARE' },
  { code: '5225', name: 'Computer peripherals', type: 'EXPENSE', parent: '5000', key: 'PERIPHERALS' },
  { code: '5230', name: 'Software & subscriptions', type: 'EXPENSE', parent: '5000', key: 'SOFTWARE' },
  { code: '5240', name: 'Internet & telephone', type: 'EXPENSE', parent: '5000', key: 'INTERNET' },
  { code: '5250', name: 'Travel & conveyance', type: 'EXPENSE', parent: '5000', key: 'TRAVEL' },
  { code: '5260', name: 'Repairs & maintenance', type: 'EXPENSE', parent: '5000', key: 'REPAIRS' },
  { code: '5270', name: 'Professional fees', type: 'EXPENSE', parent: '5000', key: 'PROFESSIONAL_FEES' },
  { code: '5275', name: 'Subcontracting charges', type: 'EXPENSE', parent: '5000', key: 'SUBCONTRACT' },
  { code: '5280', name: 'Bank charges', type: 'EXPENSE', parent: '5000', key: 'BANK_CHARGES' },
  { code: '5290', name: 'Electricity', type: 'EXPENSE', parent: '5000', key: 'ELECTRICITY' },
];

/** Seeded purchase categories: name → account systemKey, default GST, ITC default. */
export const PURCHASE_CATEGORIES: { name: string; key: string; rateBp: number; itc: boolean; asset?: boolean }[] = [
  { name: 'Stationery', key: 'OFFICE_SUPPLIES', rateBp: 1800, itc: true },
  { name: 'Peripherals', key: 'PERIPHERALS', rateBp: 1800, itc: true, asset: true },
  { name: 'Laptops', key: 'LAPTOPS', rateBp: 1800, itc: true, asset: true },
  { name: 'Software & SaaS', key: 'SOFTWARE', rateBp: 1800, itc: true },
  { name: 'Internet & telecom', key: 'INTERNET', rateBp: 1800, itc: true },
  { name: 'Rent', key: 'RENT', rateBp: 1800, itc: true },
  { name: 'Repairs', key: 'REPAIRS', rateBp: 1800, itc: true },
  { name: 'Professional fees', key: 'PROFESSIONAL_FEES', rateBp: 1800, itc: true },
  { name: 'Staff welfare / Food', key: 'STAFF_WELFARE', rateBp: 500, itc: false },
  { name: 'Travel', key: 'TRAVEL', rateBp: 500, itc: false },
];

/**
 * UK (region GB) chart. Keys the shared code looks up (BANK, CASH, AR, AP, SALES_SERVICES,
 * ROUND_OFF, SALARY_EXPENSE, SALARY_PAYABLE, REIMB_PAYABLE, expense keys…) keep their names;
 * UK-only keys: VAT_OUTPUT, VAT_INPUT, PAYE_NI_PAYABLE, PENSION_PAYABLE, EMPLOYER_NI_EXPENSE,
 * EMPLOYER_PENSION_EXPENSE, ENTERTAINMENT. New UK accounts use codes the India chart doesn't,
 * so a GB tenant that already had the India chart seeded still gets them.
 */
export const UK_CHART_OF_ACCOUNTS: CoaEntry[] = [
  { code: '1000', name: 'Assets', type: 'ASSET', group: true },
  { code: '1100', name: 'Current assets', type: 'ASSET', parent: '1000', group: true },
  { code: '1110', name: 'Bank current account', type: 'ASSET', parent: '1100', key: 'BANK' },
  { code: '1120', name: 'Petty cash', type: 'ASSET', parent: '1100', key: 'CASH' },
  { code: '1130', name: 'Trade debtors', type: 'ASSET', parent: '1100', group: true, key: 'AR' },
  { code: '1145', name: 'VAT on purchases (input VAT)', type: 'ASSET', parent: '1100', key: 'VAT_INPUT' },
  { code: '1160', name: 'Staff advances', type: 'ASSET', parent: '1100' },
  { code: '1200', name: 'Fixed assets', type: 'ASSET', parent: '1000', group: true },
  { code: '1210', name: 'Computer equipment', type: 'ASSET', parent: '1200', key: 'LAPTOPS' },
  { code: '1220', name: 'Office furniture & equipment', type: 'ASSET', parent: '1200' },
  { code: '2000', name: 'Liabilities', type: 'LIABILITY', group: true },
  { code: '2100', name: 'Trade creditors', type: 'LIABILITY', parent: '2000', group: true, key: 'AP' },
  { code: '2115', name: 'VAT on sales (output VAT)', type: 'LIABILITY', parent: '2000', key: 'VAT_OUTPUT' },
  { code: '2120', name: 'Net wages payable', type: 'LIABILITY', parent: '2000', key: 'SALARY_PAYABLE' },
  { code: '2125', name: 'PAYE & NI payable to HMRC', type: 'LIABILITY', parent: '2000', key: 'PAYE_NI_PAYABLE' },
  { code: '2126', name: 'Pension contributions payable', type: 'LIABILITY', parent: '2000', key: 'PENSION_PAYABLE' },
  { code: '2130', name: 'Employee expenses payable', type: 'LIABILITY', parent: '2000', key: 'REIMB_PAYABLE' },
  { code: '2140', name: 'Corporation tax payable', type: 'LIABILITY', parent: '2000', key: 'CORPORATION_TAX_PAYABLE' },
  { code: '3000', name: 'Equity', type: 'EQUITY', group: true },
  { code: '3100', name: 'Share capital', type: 'EQUITY', parent: '3000', key: 'CAPITAL' },
  { code: '3200', name: 'Retained earnings', type: 'EQUITY', parent: '3000', key: 'RETAINED_EARNINGS' },
  { code: '4000', name: 'Income', type: 'INCOME', group: true },
  { code: '4100', name: 'Sales – services', type: 'INCOME', parent: '4000', key: 'SALES_SERVICES' },
  { code: '4200', name: 'Other income', type: 'INCOME', parent: '4000', key: 'OTHER_INCOME' },
  { code: '4900', name: 'Rounding', type: 'INCOME', parent: '4000', key: 'ROUND_OFF' },
  { code: '5000', name: 'Expenses', type: 'EXPENSE', group: true },
  { code: '5100', name: 'Wages & salaries', type: 'EXPENSE', parent: '5000', key: 'SALARY_EXPENSE' },
  { code: '5115', name: "Employer's National Insurance", type: 'EXPENSE', parent: '5000', key: 'EMPLOYER_NI_EXPENSE' },
  { code: '5116', name: 'Employer pension contributions', type: 'EXPENSE', parent: '5000', key: 'EMPLOYER_PENSION_EXPENSE' },
  { code: '5200', name: 'Rent & rates', type: 'EXPENSE', parent: '5000', key: 'RENT' },
  { code: '5210', name: 'Office stationery', type: 'EXPENSE', parent: '5000', key: 'OFFICE_SUPPLIES' },
  { code: '5220', name: 'Staff welfare', type: 'EXPENSE', parent: '5000', key: 'STAFF_WELFARE' },
  { code: '5225', name: 'Computer peripherals', type: 'EXPENSE', parent: '5000', key: 'PERIPHERALS' },
  { code: '5230', name: 'Software & subscriptions', type: 'EXPENSE', parent: '5000', key: 'SOFTWARE' },
  { code: '5240', name: 'Telephone & internet', type: 'EXPENSE', parent: '5000', key: 'INTERNET' },
  { code: '5250', name: 'Travel & subsistence', type: 'EXPENSE', parent: '5000', key: 'TRAVEL' },
  { code: '5260', name: 'Repairs & maintenance', type: 'EXPENSE', parent: '5000', key: 'REPAIRS' },
  { code: '5270', name: 'Accountancy & legal fees', type: 'EXPENSE', parent: '5000', key: 'PROFESSIONAL_FEES' },
  { code: '5275', name: 'Subcontractors', type: 'EXPENSE', parent: '5000', key: 'SUBCONTRACT' },
  { code: '5280', name: 'Bank charges', type: 'EXPENSE', parent: '5000', key: 'BANK_CHARGES' },
  { code: '5290', name: 'Light & heat', type: 'EXPENSE', parent: '5000', key: 'ELECTRICITY' },
  { code: '5300', name: 'Business entertainment', type: 'EXPENSE', parent: '5000', key: 'ENTERTAINMENT' },
];

/** UK purchase categories: default VAT rate and whether the VAT is reclaimable (`itc`). */
export const UK_PURCHASE_CATEGORIES: { name: string; key: string; rateBp: number; itc: boolean; asset?: boolean }[] = [
  { name: 'Stationery', key: 'OFFICE_SUPPLIES', rateBp: 2000, itc: true },
  { name: 'Peripherals', key: 'PERIPHERALS', rateBp: 2000, itc: true, asset: true },
  { name: 'Laptops', key: 'LAPTOPS', rateBp: 2000, itc: true, asset: true },
  { name: 'Software & SaaS', key: 'SOFTWARE', rateBp: 2000, itc: true },
  { name: 'Telephone & internet', key: 'INTERNET', rateBp: 2000, itc: true },
  { name: 'Rent (opted to tax)', key: 'RENT', rateBp: 2000, itc: true },
  { name: 'Repairs', key: 'REPAIRS', rateBp: 2000, itc: true },
  { name: 'Accountancy & legal', key: 'PROFESSIONAL_FEES', rateBp: 2000, itc: true },
  { name: 'Energy (office)', key: 'ELECTRICITY', rateBp: 2000, itc: true },
  { name: 'Staff welfare', key: 'STAFF_WELFARE', rateBp: 2000, itc: true },
  { name: 'Business entertainment', key: 'ENTERTAINMENT', rateBp: 2000, itc: false },
  { name: 'Travel (fares, zero rated)', key: 'TRAVEL', rateBp: 0, itc: false },
];

/** UK filing folders. The keys the code files into (BILLS, SALES_INVOICES) are shared with India. */
export const UK_SYSTEM_FOLDERS: { key: string; name: string; parent?: string }[] = [
  { key: 'BILLS', name: 'Bills & receipts' },
  { key: 'VAT_RETURNS', name: 'VAT returns' },
  { key: 'PAYE_PAYROLL', name: 'PAYE & payroll' },
  { key: 'CORPORATION_TAX', name: 'Corporation tax' },
  { key: 'COMPANIES_HOUSE', name: 'Companies House' },
  { key: 'CONTRACTS', name: 'Contracts & NDAs' },
  { key: 'VENDOR_AGREEMENTS', name: 'Supplier agreements' },
  { key: 'SALES_INVOICES', name: 'Sales invoices', parent: 'BILLS' },
];

/** Seeded system folders (tile order). */
export const SYSTEM_FOLDERS: { key: string; name: string; parent?: string }[] = [
  { key: 'BILLS', name: 'Bills & receipts' },
  { key: 'GST_RETURNS', name: 'GST returns' },
  { key: 'INCOME_TAX', name: 'Income tax' },
  { key: 'CONTRACTS', name: 'Contracts & NDAs' },
  { key: 'REGISTRATION', name: 'Company registration' },
  { key: 'VENDOR_AGREEMENTS', name: 'Vendor agreements' },
  { key: 'SALES_INVOICES', name: 'Sales invoices', parent: 'BILLS' },
];
