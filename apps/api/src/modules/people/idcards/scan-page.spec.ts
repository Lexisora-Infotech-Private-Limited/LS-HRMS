import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_COMPANY_PROFILE, companyProfileSchema } from '@lexisora/shared';
import { renderScanPage, type ScanPageData } from './scan-page';

const base = (over: Partial<ScanPageData> = {}, profile: Partial<ScanPageData['profile']> = {}, employee: Partial<ScanPageData['employee']> = {}): ScanPageData => ({
  valid: true,
  statusLabel: 'Valid',
  company: { name: 'Lexisora Infotech', legalName: 'Lexisora Infotech Pvt Ltd', address: '5, Vinayagar Koil Street, GN Palayam, Villianur, Puducherry - 605110, India', logo: null, officePhone: '+91 44 1234 5678' },
  profile: { ...DEFAULT_COMPANY_PROFILE, website: 'https://www.lexisorainfotech.com', officeEmail: 'hr@lexisorainfotech.com', linkedin: 'https://www.linkedin.com/company/lexisora', instagram: 'https://instagram.com/lexisora', ...profile },
  employee: { name: 'Kavya Iyer', designation: 'HR Manager', department: 'Human Resources', empCode: 'LX-0142', serial: 'IDC-2026-0002', email: 'kavya.iyer@lexisora.com', phone: '+91 98250 44851', linkedin: 'https://www.linkedin.com/in/kavya', photo: null, photoFrame: null, ...employee },
  showContacts: true,
  vcfUrl: '/api/v1/id-cards/verify/abc/contact.vcf',
  ...over,
});

describe('ID card scan page', () => {
  it('shows the profile, every contact tile, Save Contact and the company information', () => {
    const html = renderScanPage(base());
    for (const t of ['Kavya Iyer', 'HR Manager', 'Human Resources', 'Lexisora Infotech', 'Office Number', '+91 44 1234 5678', 'Contact Number', '+91 98250 44851', 'Office Email', 'hr@lexisorainfotech.com', 'Work Email', 'kavya.iyer@lexisora.com', 'LinkedIn Profile', 'Company Website', 'Save Contact', 'Company Information', 'Villianur', 'Valid ID card']) expect(html).toContain(t);
    expect(html).toContain('href="tel:+914412345678"');
    expect(html).toContain('href="mailto:hr@lexisorainfotech.com"');
    expect(html).toContain('/api/v1/id-cards/verify/abc/contact.vcf');
    for (const s of ['LinkedIn', 'Instagram']) expect(html).toContain(`aria-label="${s}"`);
    for (const gone of ['YouTube', 'aria-label="X"']) expect(html).not.toContain(gone);
  });

  it('leaves out a contact the employee does not share or the company has not set', () => {
    const html = renderScanPage(base({}, { officeEmail: '', website: '' }, { phone: null, linkedin: null }));
    for (const t of ['Contact Number', 'Office Email', 'Company Website', 'LinkedIn Profile']) expect(html).not.toContain(t);
    expect(html).toContain('Work Email');
    expect(html).toContain('Save Contact');
  });

  it('a revoked card or a private card shows no contact details and no Save Contact', () => {
    const html = renderScanPage(base({ valid: false, statusLabel: 'Revoked', showContacts: false, vcfUrl: null }));
    expect(html).toContain('Revoked ID card');
    for (const t of ['Office Number', 'Work Email', 'Save Contact', 'kavya.iyer@lexisora.com', '98250']) expect(html).not.toContain(t);
    expect(html).toContain('Kavya Iyer');
    expect(html).toContain('Company Information');
  });

  it('escapes typed text and only links to web addresses', () => {
    const html = renderScanPage(base({}, { website: 'javascript:alert(1)', instagram: 'javascript:alert(2)' }, { name: '<script>alert(1)</script>', linkedin: 'javascript:alert(3)' }));
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('javascript:');
  });

  it('draws the photo with the ID card frame (zoomed, face end of the picture) or centred as a fallback', () => {
    const pic = 'data:image/png;base64,AAAA';
    const framed = renderScanPage(base({}, {}, { photo: pic, photoFrame: { left: -33.5, top: 0, width: 167, height: 290 } }));
    expect(framed).toContain('left:-33.50%;top:0.00%;width:167.00%;height:290.00%');
    expect(framed).not.toContain('class="fill"');
    const plain = renderScanPage(base({}, {}, { photo: pic, photoFrame: null }));
    expect(plain).toContain('class="fill"');
    expect(renderScanPage(base())).toContain('class="av ini"'); // no photo: initials
  });

  it('shows the company details address when set, else the company record address', () => {
    expect(renderScanPage(base({}, { address: '5, Vinayagar Koil Street, Puducherry - 605110' }))).toContain('5, Vinayagar Koil Street, Puducherry - 605110');
    expect(renderScanPage(base())).toContain('GN Palayam, Villianur');
  });

  it('writes a sample page when asked (for a visual check)', () => {
    if (process.env.SCAN_SAMPLE_OUT) writeFileSync(process.env.SCAN_SAMPLE_OUT, renderScanPage(base()));
  });
});

describe('company details', () => {
  it('start with the page colours and tagline, and blank links', () => {
    expect(DEFAULT_COMPANY_PROFILE).toMatchObject({ primaryColor: '#e91e8c', secondaryColor: '#12a3c6', tagline: 'People | Technology | Growth', website: '', linkedin: '' });
  });
  it('add https:// to a bare domain and refuse anything that is not a web address', () => {
    expect(companyProfileSchema.parse({ website: 'www.lexisorainfotech.com/' }).website).toBe('https://www.lexisorainfotech.com');
    expect(companyProfileSchema.safeParse({ website: 'not a site' }).success).toBe(false);
    expect(companyProfileSchema.safeParse({ instagram: 'javascript:alert(1)' }).success).toBe(false);
    expect(companyProfileSchema.safeParse({ officeEmail: 'nope' }).success).toBe(false);
    expect(companyProfileSchema.safeParse({ primaryColor: 'pink' }).success).toBe(false);
  });
});
