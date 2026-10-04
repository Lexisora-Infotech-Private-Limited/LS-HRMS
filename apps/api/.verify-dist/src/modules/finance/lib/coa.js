/**
 * Seeded chart of accounts. `key` = systemKey used by auto-postings (never renamed/deleted).
 * AR (1130) and AP (2100) are groups: every client / vendor gets its own sub-ledger.
 */ "use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: Object.getOwnPropertyDescriptor(all, name).get
    });
}
_export(exports, {
    get CHART_OF_ACCOUNTS () {
        return CHART_OF_ACCOUNTS;
    },
    get PURCHASE_CATEGORIES () {
        return PURCHASE_CATEGORIES;
    },
    get SYSTEM_FOLDERS () {
        return SYSTEM_FOLDERS;
    }
});
const CHART_OF_ACCOUNTS = [
    {
        code: '1000',
        name: 'Assets',
        type: 'ASSET',
        group: true
    },
    {
        code: '1100',
        name: 'Current assets',
        type: 'ASSET',
        parent: '1000',
        group: true
    },
    {
        code: '1110',
        name: 'HDFC Current A/c',
        type: 'ASSET',
        parent: '1100',
        key: 'BANK'
    },
    {
        code: '1120',
        name: 'Cash in hand',
        type: 'ASSET',
        parent: '1100',
        key: 'CASH'
    },
    {
        code: '1130',
        name: 'Sundry debtors',
        type: 'ASSET',
        parent: '1100',
        group: true,
        key: 'AR'
    },
    {
        code: '1140',
        name: 'Input CGST',
        type: 'ASSET',
        parent: '1100',
        key: 'GST_INPUT_CGST'
    },
    {
        code: '1141',
        name: 'Input SGST',
        type: 'ASSET',
        parent: '1100',
        key: 'GST_INPUT_SGST'
    },
    {
        code: '1142',
        name: 'Input IGST',
        type: 'ASSET',
        parent: '1100',
        key: 'GST_INPUT_IGST'
    },
    {
        code: '1150',
        name: 'TDS receivable',
        type: 'ASSET',
        parent: '1100',
        key: 'TDS_RECEIVABLE'
    },
    {
        code: '1160',
        name: 'Advances to employees',
        type: 'ASSET',
        parent: '1100'
    },
    {
        code: '1200',
        name: 'Fixed assets',
        type: 'ASSET',
        parent: '1000',
        group: true
    },
    {
        code: '1210',
        name: 'Laptops & computers',
        type: 'ASSET',
        parent: '1200',
        key: 'LAPTOPS'
    },
    {
        code: '1220',
        name: 'Furniture & fixtures',
        type: 'ASSET',
        parent: '1200'
    },
    {
        code: '2000',
        name: 'Liabilities',
        type: 'LIABILITY',
        group: true
    },
    {
        code: '2100',
        name: 'Sundry creditors',
        type: 'LIABILITY',
        parent: '2000',
        group: true,
        key: 'AP'
    },
    {
        code: '2110',
        name: 'Output CGST',
        type: 'LIABILITY',
        parent: '2000',
        key: 'GST_OUTPUT_CGST'
    },
    {
        code: '2111',
        name: 'Output SGST',
        type: 'LIABILITY',
        parent: '2000',
        key: 'GST_OUTPUT_SGST'
    },
    {
        code: '2112',
        name: 'Output IGST',
        type: 'LIABILITY',
        parent: '2000',
        key: 'GST_OUTPUT_IGST'
    },
    {
        code: '2120',
        name: 'Salary payable',
        type: 'LIABILITY',
        parent: '2000',
        key: 'SALARY_PAYABLE'
    },
    {
        code: '2121',
        name: 'PF payable',
        type: 'LIABILITY',
        parent: '2000',
        key: 'PF_PAYABLE'
    },
    {
        code: '2123',
        name: 'Professional tax payable',
        type: 'LIABILITY',
        parent: '2000',
        key: 'PT_PAYABLE'
    },
    {
        code: '2124',
        name: 'TDS payable – salary (192)',
        type: 'LIABILITY',
        parent: '2000',
        key: 'TDS_PAYABLE'
    },
    {
        code: '2130',
        name: 'Employee reimbursements payable',
        type: 'LIABILITY',
        parent: '2000',
        key: 'REIMB_PAYABLE'
    },
    {
        code: '3000',
        name: 'Equity',
        type: 'EQUITY',
        group: true
    },
    {
        code: '3100',
        name: 'Capital account',
        type: 'EQUITY',
        parent: '3000',
        key: 'CAPITAL'
    },
    {
        code: '3200',
        name: 'Retained earnings',
        type: 'EQUITY',
        parent: '3000',
        key: 'RETAINED_EARNINGS'
    },
    {
        code: '4000',
        name: 'Income',
        type: 'INCOME',
        group: true
    },
    {
        code: '4100',
        name: 'Sales – IT services',
        type: 'INCOME',
        parent: '4000',
        key: 'SALES_SERVICES'
    },
    {
        code: '4200',
        name: 'Other income',
        type: 'INCOME',
        parent: '4000',
        key: 'OTHER_INCOME'
    },
    {
        code: '4900',
        name: 'Round off',
        type: 'INCOME',
        parent: '4000',
        key: 'ROUND_OFF'
    },
    {
        code: '5000',
        name: 'Expenses',
        type: 'EXPENSE',
        group: true
    },
    {
        code: '5100',
        name: 'Salaries & wages',
        type: 'EXPENSE',
        parent: '5000',
        key: 'SALARY_EXPENSE'
    },
    {
        code: '5110',
        name: 'Employer PF contribution',
        type: 'EXPENSE',
        parent: '5000',
        key: 'EMPLOYER_PF_EXPENSE'
    },
    {
        code: '5200',
        name: 'Rent',
        type: 'EXPENSE',
        parent: '5000',
        key: 'RENT'
    },
    {
        code: '5210',
        name: 'Office supplies',
        type: 'EXPENSE',
        parent: '5000',
        key: 'OFFICE_SUPPLIES'
    },
    {
        code: '5220',
        name: 'Staff welfare',
        type: 'EXPENSE',
        parent: '5000',
        key: 'STAFF_WELFARE'
    },
    {
        code: '5225',
        name: 'Computer peripherals',
        type: 'EXPENSE',
        parent: '5000',
        key: 'PERIPHERALS'
    },
    {
        code: '5230',
        name: 'Software & subscriptions',
        type: 'EXPENSE',
        parent: '5000',
        key: 'SOFTWARE'
    },
    {
        code: '5240',
        name: 'Internet & telephone',
        type: 'EXPENSE',
        parent: '5000',
        key: 'INTERNET'
    },
    {
        code: '5250',
        name: 'Travel & conveyance',
        type: 'EXPENSE',
        parent: '5000',
        key: 'TRAVEL'
    },
    {
        code: '5260',
        name: 'Repairs & maintenance',
        type: 'EXPENSE',
        parent: '5000',
        key: 'REPAIRS'
    },
    {
        code: '5270',
        name: 'Professional fees',
        type: 'EXPENSE',
        parent: '5000',
        key: 'PROFESSIONAL_FEES'
    },
    {
        code: '5275',
        name: 'Subcontracting charges',
        type: 'EXPENSE',
        parent: '5000',
        key: 'SUBCONTRACT'
    },
    {
        code: '5280',
        name: 'Bank charges',
        type: 'EXPENSE',
        parent: '5000',
        key: 'BANK_CHARGES'
    },
    {
        code: '5290',
        name: 'Electricity',
        type: 'EXPENSE',
        parent: '5000',
        key: 'ELECTRICITY'
    }
];
const PURCHASE_CATEGORIES = [
    {
        name: 'Stationery',
        key: 'OFFICE_SUPPLIES',
        rateBp: 1800,
        itc: true
    },
    {
        name: 'Peripherals',
        key: 'PERIPHERALS',
        rateBp: 1800,
        itc: true,
        asset: true
    },
    {
        name: 'Laptops',
        key: 'LAPTOPS',
        rateBp: 1800,
        itc: true,
        asset: true
    },
    {
        name: 'Software & SaaS',
        key: 'SOFTWARE',
        rateBp: 1800,
        itc: true
    },
    {
        name: 'Internet & telecom',
        key: 'INTERNET',
        rateBp: 1800,
        itc: true
    },
    {
        name: 'Rent',
        key: 'RENT',
        rateBp: 1800,
        itc: true
    },
    {
        name: 'Repairs',
        key: 'REPAIRS',
        rateBp: 1800,
        itc: true
    },
    {
        name: 'Professional fees',
        key: 'PROFESSIONAL_FEES',
        rateBp: 1800,
        itc: true
    },
    {
        name: 'Staff welfare / Food',
        key: 'STAFF_WELFARE',
        rateBp: 500,
        itc: false
    },
    {
        name: 'Travel',
        key: 'TRAVEL',
        rateBp: 500,
        itc: false
    }
];
const SYSTEM_FOLDERS = [
    {
        key: 'BILLS',
        name: 'Bills & receipts'
    },
    {
        key: 'GST_RETURNS',
        name: 'GST returns'
    },
    {
        key: 'INCOME_TAX',
        name: 'Income tax'
    },
    {
        key: 'CONTRACTS',
        name: 'Contracts & NDAs'
    },
    {
        key: 'REGISTRATION',
        name: 'Company registration'
    },
    {
        key: 'VENDOR_AGREEMENTS',
        name: 'Vendor agreements'
    },
    {
        key: 'SALES_INVOICES',
        name: 'Sales invoices',
        parent: 'BILLS'
    }
];

//# sourceMappingURL=coa.js.map