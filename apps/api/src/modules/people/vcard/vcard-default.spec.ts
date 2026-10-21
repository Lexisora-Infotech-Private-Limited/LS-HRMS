import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { idCardElementSchema } from '@lexisora/shared';
import { qrDataUrl, renderCardSvg, svgToPng } from '../idcards/card-render';
import { H_MM, W_MM, defaultVisitingFront } from './vcard-default';

const data = {
  'tenant.name': 'Lexisora Infotech',
  'employee.full_name': 'Kavya Iyer',
  'employee.designation': 'HR Manager',
  'employee.department': 'HR',
  'employee.email': 'kavya.iyer@lexisora.com',
  'employee.mobile': '+91 98250 44851',
};

describe('default visiting card layout', () => {
  it('only uses elements the designer can edit and save', () => {
    for (const el of defaultVisitingFront()) expect(idCardElementSchema.safeParse(el).success, el.id).toBe(true);
  });

  it('draws the employee details on a 3.5 x 2 in card at 300 DPI', async () => {
    const svg = renderCardSvg({ widthMm: W_MM, heightMm: H_MM, elements: defaultVisitingFront() }, data, { qr: await qrDataUrl('https://example.test/c/x') });
    for (const text of ['Lexisora Infotech', 'Kavya Iyer', 'HR Manager · HR', 'kavya.iyer@lexisora.com', '+91 98250 44851']) expect(svg).toContain(text);
    const meta = await sharp(await svgToPng(svg)).metadata();
    expect([meta.width, meta.height]).toEqual([1050, 600]);
  });

  it('leaves the phone out when the employee does not share one', () => {
    const svg = renderCardSvg({ widthMm: W_MM, heightMm: H_MM, elements: defaultVisitingFront() }, { ...data, 'employee.mobile': null }, {});
    expect(svg).not.toContain('98250');
    expect(svg).toContain('kavya.iyer@lexisora.com');
  });
});
