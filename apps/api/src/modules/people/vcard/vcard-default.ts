import type { IdCardElement } from '@lexisora/shared';

/** 3.5 × 2 in visiting card (88.9 × 50.8 mm); PNG 1050 × 600 px at 300 DPI. */
export const W_MM = 88.9;
export const H_MM = 50.8;

/** The corporate layout a company starts with, until HR changes it in the visiting card designer. */
export function defaultVisitingFront(): IdCardElement[] {
  const f = (size: number, extra: Partial<NonNullable<IdCardElement['font']>> = {}) => ({ size, weight: 'normal' as const, color: '#201f1d', align: 'left' as const, family: 'sans' as const, ...extra });
  return [
    { id: 'company', type: 'TEXT', label: 'Company name', binding: 'tenant.name', xMm: 6.5, yMm: 5, wMm: 55, hMm: 7, z: 1, font: f(12, { family: 'serif' }) },
    { id: 'qr', type: 'QR', label: 'QR code', binding: 'qr.verify_url', xMm: 67, yMm: 5, wMm: 15.5, hMm: 15.5, z: 1 },
    { id: 'name', type: 'TEXT', label: 'Full name', binding: 'employee.full_name', xMm: 6.5, yMm: 21, wMm: 76, hMm: 9, z: 1, font: f(20, { family: 'serif' }) },
    { id: 'title', type: 'STATIC', label: 'Designation', text: '{{employee.designation}} · {{employee.department}}', shrink: true, xMm: 6.5, yMm: 29, wMm: 76, hMm: 5, z: 1, font: f(9, { color: '#8a6326' }) },
    { id: 'rule', type: 'SHAPE', label: 'Line', xMm: 6.5, yMm: 38.5, wMm: 76, hMm: 0.3, fill: '#d7d3d3', z: 0 },
    { id: 'email', type: 'TEXT', label: 'Email', binding: 'employee.email', xMm: 6.5, yMm: 40, wMm: 45, hMm: 5, z: 1, font: f(8) },
    { id: 'phone', type: 'TEXT', label: 'Mobile', binding: 'employee.mobile', xMm: 46, yMm: 40, wMm: 36.5, hMm: 5, z: 1, font: f(8, { align: 'right' }) },
  ];
}
