import type { CompanyProfile } from '@lexisora/shared';

/** Everything the page shows. Contact details are already filtered by what the employee chose to share. */
export type ScanPageData = {
  valid: boolean;
  statusLabel: string;
  company: { name: string; legalName: string; address: string | null; logo: string | null; officePhone: string | null };
  profile: CompanyProfile;
  employee: { name: string; designation: string | null; department: string | null; empCode: string; serial: string; email: string; phone: string | null; linkedin: string | null; photo: string | null; /** where the photo sits in its round frame, in % (the same zoom / position HR set for the ID card photo) */ photoFrame: { left: number; top: number; width: number; height: number } | null };
  /** False for a revoked / unissued card, or when the employee turned their public card off: only the name and role are shown. */
  showContacts: boolean;
  /** Root-relative link that downloads the contact file (null when contacts are hidden). */
  vcfUrl: string | null;
};

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
/** Only web links are ever put in an href. */
const safeUrl = (u: string | null | undefined) => (u && /^https?:\/\/\S+$/i.test(u.trim()) ? u.trim() : null);
const safeColor = (c: string, fallback: string) => (/^#[0-9a-f]{6}$/i.test(c) ? c : fallback);
const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
};
const telHref = (p: string) => `tel:${p.replace(/[^\d+]/g, '')}`;

const ICON = {
  phone: '<path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/>',
  mobile: '<path d="M17 1.01L7 1c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-1.99-2-1.99zM17 19H7V5h10v14z"/>',
  mail: '<path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>',
  globe: '<path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zm6.93 6h-2.95c-.32-1.25-.78-2.45-1.38-3.56 1.84.63 3.37 1.91 4.33 3.56zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14C4.1 13.36 4 12.69 4 12s.1-1.36.26-2h3.38c-.08.66-.14 1.32-.14 2 0 .68.06 1.34.14 2H4.26zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56-1.84-.63-3.37-1.9-4.33-3.56zm2.95-8H5.08c.96-1.66 2.49-2.93 4.33-3.56C8.81 5.55 8.35 6.75 8.03 8zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96zM14.34 14H9.66c-.09-.66-.16-1.32-.16-2 0-.68.07-1.35.16-2h4.68c.09.65.16 1.32.16 2 0 .68-.07 1.34-.16 2zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95c-.96 1.65-2.49 2.93-4.33 3.56zM16.36 14c.08-.66.14-1.32.14-2 0-.68-.06-1.34-.14-2h3.38c.16.64.26 1.31.26 2s-.1 1.36-.26 2h-3.38z"/>',
  user: '<path d="M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>',
  pin: '<path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>',
  chevron: '<path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
} as const;
const svg = (path: string, size = 22) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" aria-hidden="true">${path}</svg>`;

const SOCIAL: Record<string, { label: string; bg: string; glyph: string }> = {
  linkedin: { label: 'LinkedIn', bg: '#0a66c2', glyph: '<text x="12" y="16.500" text-anchor="middle" font-size="12" font-weight="700" font-family="Arial,sans-serif" fill="#fff">in</text>' },
  instagram: { label: 'Instagram', bg: '#d6249f', glyph: '<rect x="6.500" y="6.500" width="11" height="11" rx="3.200" fill="none" stroke="#fff" stroke-width="1.600"/><circle cx="12" cy="12" r="2.600" fill="none" stroke="#fff" stroke-width="1.600"/><circle cx="15.600" cy="8.400" r=".9" fill="#fff"/>' },
};

/** The public page a scanned ID card opens: a digital profile card with the employee's details and a Save Contact button. */
export function renderScanPage(d: ScanPageData): string {
  const p1 = safeColor(d.profile.primaryColor, '#e91e8c');
  const p2 = safeColor(d.profile.secondaryColor, '#12a3c6');
  const e = d.employee;
  const company = d.company.name;
  const tag = d.profile.tagline.split('|').map((s) => s.trim()).filter(Boolean);

  const tiles: { label: string; value: string; href: string; icon: keyof typeof ICON; color: string }[] = [];
  if (d.showContacts) {
    const officePhone = d.profile.officePhone || d.company.officePhone;
    if (officePhone) tiles.push({ label: 'Office Number', value: officePhone, href: telHref(officePhone), icon: 'phone', color: p1 });
    if (e.phone) tiles.push({ label: 'Contact Number', value: e.phone, href: telHref(e.phone), icon: 'mobile', color: p2 });
    if (d.profile.officeEmail) tiles.push({ label: 'Office Email', value: d.profile.officeEmail, href: `mailto:${d.profile.officeEmail}`, icon: 'mail', color: p2 });
    if (e.email) tiles.push({ label: 'Work Email', value: e.email, href: `mailto:${e.email}`, icon: 'mail', color: p1 });
    const li = safeUrl(e.linkedin);
    if (li) tiles.push({ label: 'LinkedIn Profile', value: 'View my LinkedIn profile', href: li, icon: 'globe', color: '#4b3fb3' });
    const site = safeUrl(d.profile.website);
    if (site) tiles.push({ label: 'Company Website', value: `Visit ${company}`, href: site, icon: 'globe', color: p2 });
  }
  const tileHtml = tiles
    .map(
      (t) =>
        `<a class="tile" href="${esc(t.href)}"${/^https?:/.test(t.href) ? ' target="_blank" rel="noopener noreferrer"' : ''} style="background:${rgba(t.color, 0.07)}"><span class="ic" style="background:${rgba(t.color, 0.14)};color:${t.color}">${svg(ICON[t.icon])}</span><span class="tx"><b>${esc(t.label)}</b><em>${esc(t.value)}</em></span><span class="ch">${svg(ICON.chevron, 18)}</span></a>`,
    )
    .join('');

  const socials = (['linkedin', 'instagram'] as const)
    .map((k) => ({ k, url: safeUrl(d.profile[k]) }))
    .filter((s) => s.url)
    .map((s) => `<a href="${esc(s.url!)}" target="_blank" rel="noopener noreferrer" aria-label="${SOCIAL[s.k]!.label}" style="background:${SOCIAL[s.k]!.bg}"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">${SOCIAL[s.k]!.glyph}</svg></a>`)
    .join('');

  const logo = d.company.logo ? `<img class="logo" src="${d.company.logo}" alt="${esc(company)}">` : `<div class="wm"><b style="color:${p1}">${esc(company.split(' ')[0]!.toUpperCase())}</b>${company.split(' ').length > 1 ? `<span style="color:${p2}">${esc(company.split(' ').slice(1).join(' '))}</span>` : ''}${d.profile.slogan ? `<small>${esc(d.profile.slogan)}</small>` : ''}</div>`;
  const f = e.photoFrame;
  const avatar = e.photo ? `<div class="av">${f ? `<img src="${e.photo}" alt="" style="left:${f.left.toFixed(2)}%;top:${f.top.toFixed(2)}%;width:${f.width.toFixed(2)}%;height:${f.height.toFixed(2)}%">` : `<img class="fill" src="${e.photo}" alt="">`}</div>` : `<div class="av ini" style="background:${rgba(p1, 0.12)};color:${p1}">${esc(e.name.split(/\s+/).map((w) => w[0] ?? '').slice(0, 2).join('').toUpperCase())}</div>`;
  const role = [e.department, company].filter((x): x is string => !!x).map(esc).join('<i>|</i>');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(e.name)} · ${esc(company)}</title><meta name="robots" content="noindex"><style>
*{box-sizing:border-box}body{margin:0;background:#eef1f5;font-family:'Segoe UI',Roboto,Arial,sans-serif;color:#1c2540;display:flex;justify-content:center;padding:18px 12px}
.card{position:relative;width:100%;max-width:440px;background:#fff;border-radius:22px;box-shadow:0 10px 40px rgba(20,30,60,.12);overflow:hidden;padding-bottom:0}
.top{position:relative;height:150px;padding:20px 22px}.wave{position:absolute;inset:0;width:100%;height:100%}
.brand{position:relative;z-index:1}.logo{max-height:64px;max-width:190px;display:block}.wm{line-height:1.05}.wm b{display:block;font-size:24px;letter-spacing:.5px}.wm span{display:block;font-size:19px;font-weight:600}.wm small{display:block;font-size:11.5px;color:#4a5568;margin-top:3px}
.tag{position:absolute;z-index:1;right:20px;top:24px;font-size:9.5px;letter-spacing:1.4px;color:#5b6475;text-transform:uppercase;text-align:right}.tag i{font-style:normal;margin:0 6px;opacity:.6}
.av{position:relative;z-index:2;display:block;width:128px;height:128px;border-radius:50%;overflow:hidden;margin:-62px auto 0;border:5px solid #fff;box-shadow:0 6px 20px rgba(20,30,60,.18);background:#fff}.av img{position:absolute;display:block;max-width:none}.av img.fill{inset:0;width:100%;height:100%;object-fit:cover;object-position:50% 0}
.ini{display:flex;align-items:center;justify-content:center;font-size:44px;font-weight:700}
h1{margin:12px 16px 0;text-align:center;font-size:29px;line-height:1.15;color:#101a3d}.role{text-align:center;font-weight:700;font-size:19px;margin-top:4px}
.org{text-align:center;color:#5b6475;font-size:15px;margin-top:6px}.org i{font-style:normal;margin:0 9px;color:#a3a9b8}
.chip{display:table;margin:10px auto 0;padding:3px 12px;border-radius:99px;font-size:12px;font-weight:600}.ok{background:#e7f6ec;color:#157a3c}.bad{background:#fdecec;color:#b42318}.id{text-align:center;color:#8a90a0;font-size:11.5px;margin-top:5px}
hr{border:0;border-top:1px solid #e6e9ef;margin:16px 18px}
.tiles{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:0 18px}.tile{display:flex;align-items:center;gap:9px;padding:11px 9px;border-radius:12px;text-decoration:none;color:inherit;min-width:0}
.ic{flex:none;width:42px;height:42px;border-radius:50%;display:flex;align-items:center;justify-content:center}.tx{min-width:0;flex:1}.tx b{display:block;font-size:13.5px;color:#101a3d}.tx em{display:block;font-style:normal;font-size:12px;color:#5b6475;overflow-wrap:anywhere;margin-top:1px}.ch{color:#8a90a0;flex:none}
.save{display:flex;align-items:center;justify-content:center;gap:12px;margin:12px 18px 0;padding:13px;border-radius:12px;color:#fff;text-decoration:none}.save .ic{background:#fff;width:42px;height:38px;border-radius:8px}.save b{display:block;font-size:19px}.save em{display:block;font-style:normal;font-size:13px;opacity:.92}
h2{margin:0;padding:0 18px;font-size:19px;color:#101a3d}.info{padding:2px 0 4px}.cr{display:flex;gap:14px;padding:14px 18px 6px;align-items:flex-start}.cr .ic{background:${rgba(p1, 0.1)};color:${p1}}.cr b{display:block;font-size:17px;color:#101a3d}.cr p{margin:3px 0 0;color:#4a5568;font-size:15px;line-height:1.4}
.soc{display:flex;justify-content:center;gap:16px;padding:14px 18px 6px;border-top:1px solid #e6e9ef;margin-top:14px}.soc a{width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center}
.foot{text-align:center;font-size:11px;letter-spacing:1.8px;color:#5b6475;text-transform:uppercase;padding:14px 18px 16px}.foot i{font-style:normal;margin:0 9px;opacity:.6}
.bar{display:flex;height:5px}.bar span{flex:1}
</style></head><body><main class="card">
<header class="top"><svg class="wave" viewBox="0 0 440 150" preserveAspectRatio="none" aria-hidden="true"><path d="M0 40C80 18 120 70 200 62S360 20 440 56V0H0z" fill="${rgba(p1, 0.1)}"/><path d="M0 70C70 120 150 100 230 78S380 50 440 100V0H220C300 40 120 20 0 70z" fill="${rgba(p2, 0.12)}"/></svg>
<div class="brand">${logo}</div>${tag.length ? `<div class="tag">${tag.map(esc).join('<i>|</i>')}</div>` : ''}</header>
${avatar}<h1>${esc(e.name)}</h1>${e.designation ? `<div class="role" style="color:${p1}">${esc(e.designation)}</div>` : ''}<div class="org">${role}</div>
<div class="chip ${d.valid ? 'ok' : 'bad'}">${d.valid ? '✓ ' : ''}${esc(d.statusLabel)} ID card</div><div class="id">${esc(e.empCode)} · ${esc(d.employee.serial)}</div>
${d.showContacts ? `<hr>${tileHtml ? `<section class="tiles">${tileHtml}</section>` : ''}${d.vcfUrl ? `<a class="save" href="${esc(d.vcfUrl)}" style="background:${p1}"><span class="ic" style="color:${p1}">${svg(ICON.user, 24)}</span><span><b>Save Contact</b><em>Download vCard</em></span></a>` : ''}` : ''}
<hr><section class="info"><h2>Company Information</h2><div class="cr"><span class="ic">${svg(ICON.pin)}</span><div><b>${esc(d.company.legalName)}</b>${d.profile.address || d.company.address ? `<p>${esc(d.profile.address || d.company.address || '')}</p>` : ''}</div></div></section>
${socials ? `<div class="soc">${socials}</div>` : ''}${tag.length ? `<div class="foot">${tag.map(esc).join('<i>|</i>')}</div>` : ''}
<div class="bar"><span style="background:${p1}"></span><span style="background:${p2}"></span></div></main></body></html>`;
}
