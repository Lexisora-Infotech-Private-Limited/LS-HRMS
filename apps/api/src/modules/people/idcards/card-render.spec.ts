import { describe, expect, it } from 'vitest';
import { ID_CARD_FONTS, idCardFontCss, applyTextCase, idCardShrinks, idCardDrawOrder, idCardBgPlacement, idCardPhotoPlacement, idCardLabelsToText, idCardTextToLabels, idCardElementSchema, layoutIdCardText, type IdCardElement } from '@lexisora/shared';
import { cardDate, cardMobile, elementText, renderCardSvg } from './card-render';

const data = { 'employee.blood_group': 'B+', 'employee.dob': '05/10/2002', 'employee.address': '2, Periya Thoppu, Sellipattu, Sellipet, Puducherry-605501', 'employee.full_name': 'Aruna' };
const el = (over: Partial<IdCardElement>): IdCardElement => idCardElementSchema.parse({ id: 'x', type: 'STATIC', xMm: 2, yMm: 2, wMm: 40, hMm: 6, z: 1, ...over });

describe('ID card typed text', () => {
  it('fills employee values typed into the text, and still supports the older bound field with a prefix', () => {
    expect(elementText(el({ text: 'Blood : {{employee.blood_group}}' }), data)).toBe('Blood : B+');
    expect(elementText(el({ type: 'TEXT', text: 'D.O.B  ', binding: 'employee.dob' }), data)).toBe('D.O.B  05/10/2002');
    expect(elementText(el({ type: 'TEXT', text: '{{employee.full_name}} ({{employee.blood_group}})' }), data)).toBe('Aruna (B+)');
    expect(elementText(el({ text: 'Fixed words only' }), data)).toBe('Fixed words only');
  });

  it('shows employee values as [Label] while editing and stores them as fields', () => {
    const shown = idCardTextToLabels('Mobile {{employee.mobile}} · {{employee.dob}}');
    expect(shown).toBe('Mobile [Mobile number] · [Date of birth]');
    expect(idCardLabelsToText(shown)).toBe('Mobile {{employee.mobile}} · {{employee.dob}}');
    expect(idCardLabelsToText('[not a field]')).toBe('[not a field]');
  });

  it('wraps a long address in a tall box, but shrinks a long name in a short one', () => {
    const addr = layoutIdCardText(data['employee.address'], 8, 40, 14);
    expect(addr.lines.length).toBeGreaterThan(1);
    expect(addr.lines.length * addr.sizePt * (25.4 / 72) * 1.25).toBeLessThanOrEqual(14.01);
    const name = layoutIdCardText('A very long employee name here', 22, 30, 8);
    expect(name.lines).toHaveLength(1);
    expect(name.sizePt).toBeLessThan(22);
  });
});

describe('ID card image element', () => {
  it('draws an uploaded picture at its place, and nothing if none is chosen', () => {
    const withImage = renderCardSvg({ widthMm: 54, heightMm: 86, elements: [el({ type: 'IMAGE', fileId: 'f1', wMm: 10, hMm: 10 })] }, data, { custom: { f1: 'data:image/png;base64,AAAA' } });
    expect(withImage).toContain('href="data:image/png;base64,AAAA"');
    const none = renderCardSvg({ widthMm: 54, heightMm: 86, elements: [el({ type: 'IMAGE', fileId: null })] }, data, {});
    expect(none).not.toContain('<image');
  });

  it('prints typed text with its employee values and wraps the address', () => {
    const svg = renderCardSvg({ widthMm: 54, heightMm: 86, elements: [el({ text: 'Blood : {{employee.blood_group}}' }), el({ id: 'a', text: 'Address: {{employee.address}}', yMm: 20, wMm: 40, hMm: 16, font: { size: 8, weight: 'normal', color: '#201f1d', align: 'left', family: 'sans' } })] }, data, {});
    expect(svg).toContain('Blood : B+');
    expect((svg.match(/<text /g) ?? []).length).toBeGreaterThan(2); // the address spans several lines
  });
});

describe('ID card background fit', () => {
  const card = { w: 53.98, h: 85.6 };
  const img = { w: 591, h: 1004 }; // a picture a little taller than the card
  const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(0.01);

  it('FILL covers the card (the taller picture is cut at the top and bottom), STRETCH matches it exactly, FIT shows it whole', () => {
    const fill = idCardBgPlacement(img, card, { fit: 'FILL', zoom: 100, x: 0, y: 0 });
    near(fill.w, card.w);
    expect(fill.h).toBeGreaterThan(card.h);
    const stretch = idCardBgPlacement(img, card, { fit: 'STRETCH', zoom: 100, x: 0, y: 0 });
    expect([stretch.x, stretch.y, stretch.w, stretch.h].map((n) => Math.round(n * 100) / 100)).toEqual([0, 0, 53.98, 85.6]);
    const fit = idCardBgPlacement(img, card, { fit: 'FIT', zoom: 100, x: 0, y: 0 });
    near(fit.h, card.h);
    expect(fit.w).toBeLessThan(card.w);
  });

  it('zoom grows it around the middle, and x / y move it by a share of the card', () => {
    const z = idCardBgPlacement(img, card, { fit: 'STRETCH', zoom: 200, x: 0, y: 0 });
    near(z.w, card.w * 2);
    near(z.x, -card.w / 2);
    const mv = idCardBgPlacement(img, card, { fit: 'STRETCH', zoom: 100, x: 10, y: -5 });
    near(mv.x, card.w * 0.1);
    near(mv.y, -card.h * 0.05);
  });

  it('the renderer places the background where the editor does', () => {
    const svg = renderCardSvg({ widthMm: card.w, heightMm: card.h, elements: [] }, {}, { bg: 'data:image/png;base64,AAAA', bgSize: img, bgFit: { fit: 'STRETCH', zoom: 100, x: 0, y: 0 } });
    const attr = (name: string) => Number(new RegExp(` ${name}="([0-9.-]+)"`).exec(svg.slice(svg.indexOf('<image')))?.[1]);
    expect(attr('x')).toBe(0);
    expect(attr('y')).toBe(0);
    expect(Math.abs(attr('width') - card.w * (300 / 25.4))).toBeLessThan(1);
    expect(Math.abs(attr('height') - card.h * (300 / 25.4))).toBeLessThan(1);
    expect(svg).toContain('preserveAspectRatio="none"');
    // without a known picture size it falls back to the old cover behaviour
    expect(renderCardSvg({ widthMm: card.w, heightMm: card.h, elements: [] }, {}, { bg: 'data:image/png;base64,AAAA' })).toContain('preserveAspectRatio="xMidYMid slice"');
  });
});

describe('ID card photo framing', () => {
  const frame = { w: 26, h: 26.6 };
  const tall = { w: 400, h: 1000 }; // a full-length photo
  const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(0.01);

  it('fills the frame and keeps the chosen part in view: top for faces, middle, bottom', () => {
    const top = idCardPhotoPlacement(tall, frame, { fit: 'FILL', zoom: 100, fx: 50, fy: 0 });
    near(top.w, frame.w); // covers the width
    near(top.y, 0); // top edge of the picture sits at the top of the frame
    expect(top.h).toBeGreaterThan(frame.h);
    const mid = idCardPhotoPlacement(tall, frame, { fit: 'FILL', zoom: 100, fx: 50, fy: 50 });
    near(mid.y, (frame.h - mid.h) / 2);
    const bottom = idCardPhotoPlacement(tall, frame, { fit: 'FILL', zoom: 100, fx: 50, fy: 100 });
    near(bottom.y + bottom.h, frame.h);
  });

  it('Whole photo shows all of it inside the frame, nothing cropped', () => {
    const whole = idCardPhotoPlacement(tall, frame, { fit: 'FIT', zoom: 100, fx: 50, fy: 0 });
    near(whole.h, frame.h); // the full height fits
    expect(whole.w).toBeLessThan(frame.w); // so it is narrower than the frame (blank space at the sides)
    near(whole.x, (frame.w - whole.w) / 2); // and centred
  });

  it('zooms in around the focus', () => {
    const z = idCardPhotoPlacement(tall, frame, { fit: 'FILL', zoom: 200, fx: 50, fy: 0 });
    near(z.w, frame.w * 2);
    near(z.y, 0);
    near(z.x, (frame.w - z.w) / 2);
  });

  it('prints the photo clipped to its frame at the chosen focus', () => {
    const photo = { ...el({ type: 'PHOTO', binding: 'employee.photo', xMm: 5, yMm: 10, wMm: frame.w, hMm: frame.h }), photo: { fit: 'FILL' as const, zoom: 150, fx: 50, fy: 0 } };
    const svg = renderCardSvg({ widthMm: 54, heightMm: 86, elements: [photo] }, {}, { photo: 'data:image/png;base64,AAAA', photoSize: tall });
    expect(svg).toContain('<clipPath id="ph-x">');
    expect(svg).toContain('clip-path="url(#ph-x)"');
    expect(svg).toContain('preserveAspectRatio="none"');
    // no known size: the old centred fill still works
    expect(renderCardSvg({ widthMm: 54, heightMm: 86, elements: [photo] }, {}, { photo: 'data:image/png;base64,AAAA' })).toContain('xMidYMid slice');
  });
});

describe('ID card layering', () => {
  it('draws shapes, then photos and pictures, then text on the same layer, whatever order they were added in', () => {
    const items = [el({ id: 'name', type: 'TEXT' }), el({ id: 'photo', type: 'PHOTO' }), el({ id: 'bar', type: 'SHAPE' }), el({ id: 'qr', type: 'QR' }), el({ id: 'pic', type: 'IMAGE' })];
    expect(idCardDrawOrder(items).map((e) => e.id)).toEqual(['bar', 'photo', 'pic', 'name', 'qr']);
    // an explicit layer still wins: a photo raised above the text is drawn after it
    expect(idCardDrawOrder([{ ...items[1]!, z: 5 }, items[0]!]).map((e) => e.id)).toEqual(['name', 'photo']);
  });

  it('the printed card puts the name above a big photo', () => {
    const photo = el({ id: 'photo', type: 'PHOTO', binding: 'employee.photo', xMm: 2, yMm: 2, wMm: 40, hMm: 60 });
    const name = el({ id: 'name', type: 'TEXT', text: 'Meera', xMm: 2, yMm: 50, wMm: 40, hMm: 8 });
    const svg = renderCardSvg({ widthMm: 54, heightMm: 86, elements: [name, photo] }, {}, { photo: 'data:image/png;base64,AAAA', photoSize: { w: 400, h: 1000 } });
    expect(svg.indexOf('data:image/png;base64,AAAA')).toBeLessThan(svg.indexOf('>Meera<'));
  });
});

describe('ID card text size', () => {
  const address = 'PALAYAM, VILLIANUR, PUDUCHERRY-605110 EXTN G N';
  it('with shrink on, text is made smaller to fit a short box; with shrink off it keeps the exact size and wraps', () => {
    const shrunk = layoutIdCardText(address, 14, 40, 8, true);
    expect(shrunk.sizePt).toBeLessThan(14);
    const exact = layoutIdCardText(address, 14, 40, 8, false);
    expect(exact.sizePt).toBe(14);
    expect(exact.lines.length).toBeGreaterThan(1);
  });

  it('typed text keeps its size by default; names and other employee fields shrink to fit', () => {
    expect(idCardShrinks({ type: 'STATIC' })).toBe(false);
    expect(idCardShrinks({ type: 'TEXT', binding: 'employee.full_name' })).toBe(true);
    expect(idCardShrinks({ type: 'TEXT', binding: null })).toBe(false);
    expect(idCardShrinks({ type: 'STATIC', shrink: true })).toBe(true);
    expect(idCardShrinks({ type: 'TEXT', binding: 'employee.full_name', shrink: false })).toBe(false);
  });

  it('the printed card uses the chosen size for typed text (a bigger size really is bigger)', () => {
    const at = (size: number) => renderCardSvg({ widthMm: 54, heightMm: 86, elements: [el({ text: 'Lexisora Infotech Pvt Ltd', wMm: 40, hMm: 6, font: { size, weight: 'normal', color: '#201f1d', align: 'left', family: 'sans' } })] }, {}, {});
    const sizeOf = (svg: string) => Number(/font-size="([0-9.]+)"/.exec(svg)?.[1]);
    expect(sizeOf(at(14))).toBeGreaterThan(sizeOf(at(8)));
  });
});

describe('text case', () => {
  it('applies UPPER, lower and Title case, leaving the default alone', () => {
    expect(applyTextCase('Meera iyer', 'UPPER')).toBe('MEERA IYER');
    expect(applyTextCase('QA Engineer', 'LOWER')).toBe('qa engineer');
    expect(applyTextCase('mEERA iYER-kumar (QA)', 'TITLE')).toBe('Meera Iyer-Kumar (Qa)');
    expect(applyTextCase('Meera Iyer', 'NONE')).toBe('Meera Iyer');
    expect(applyTextCase('Meera Iyer', undefined)).toBe('Meera Iyer');
    expect(applyTextCase('சென்னை Test', 'UPPER')).toContain('TEST');
  });

  it('an ID card item prints each employee value in the chosen case', () => {
    const data2 = { 'employee.full_name': 'Meera Iyer', 'employee.designation': 'QA Engineer' };
    expect(elementText(el({ type: 'TEXT', binding: 'employee.full_name', textCase: 'UPPER' }), data2)).toBe('MEERA IYER');
    expect(elementText(el({ type: 'TEXT', binding: 'employee.designation', textCase: 'LOWER' }), data2)).toBe('qa engineer');
    expect(elementText(el({ text: 'Dr. {{employee.full_name}}', textCase: 'UPPER' }), data2)).toBe('DR. MEERA IYER');
    expect(elementText(el({ type: 'TEXT', binding: 'employee.full_name' }), data2)).toBe('Meera Iyer'); // default: as saved
  });
});

describe('text vertical position', () => {
  it('Top starts the first line at the top of the box; Middle centres it; Bottom ends at the bottom', () => {
    const lineAt = (valign: 'TOP' | 'MIDDLE' | 'BOTTOM') => {
      const svg = renderCardSvg({ widthMm: 54, heightMm: 86, elements: [el({ text: 'Address line', wMm: 40, hMm: 20, yMm: 10, valign, font: { size: 8, weight: 'normal', color: '#000000', align: 'left', family: 'sans' } })] }, {}, {});
      return Number(/<text x="[0-9.]+" y="([0-9.]+)"/.exec(svg)?.[1]);
    };
    const [top, mid, bottom] = [lineAt('TOP'), lineAt('MIDDLE'), lineAt('BOTTOM')];
    expect(top).toBeLessThan(mid);
    expect(mid).toBeLessThan(bottom);
    const px = 300 / 25.4;
    expect(top / px).toBeLessThan(10 + 3); // within the first line height of the box top
    expect(bottom / px).toBeGreaterThan(30 - 3); // within a line of the box bottom (10 + 20)
  });
});

describe('ID card date and mobile formats', () => {
  it('shows dates as dd/mm/yyyy', () => {
    expect(cardDate('1999-08-18')).toBe('18/08/1999');
    expect(cardDate('2024-04-01T00:00:00.000Z')).toBe('01/04/2024');
    expect(cardDate(null)).toBeNull();
    expect(cardDate('not a date')).toBeNull();
  });

  it('drops the +91 country code from a mobile number and leaves the rest as saved', () => {
    expect(cardMobile('+91 98250 14525')).toBe('98250 14525');
    expect(cardMobile('+91-9825014525')).toBe('9825014525');
    expect(cardMobile('+919825014525')).toBe('9825014525');
    expect(cardMobile('919825014525')).toBe('9825014525');
    expect(cardMobile('0091 9825014525')).toBe('9825014525');
    expect(cardMobile('9825014525')).toBe('9825014525'); // already without a code
    expect(cardMobile('9198765432')).toBe('9198765432'); // a ten-digit number that merely starts with 91
    expect(cardMobile('45555555557')).toBe('45555555557');
    expect(cardMobile('')).toBeNull();
    expect(cardMobile(null)).toBeNull();
  });
});

describe('ID card fonts', () => {
  it('every font in the list is chosen by name, draws with its own family, and an unknown name falls back to Arial', () => {
    for (const [key, f] of Object.entries(ID_CARD_FONTS)) {
      const svg = renderCardSvg({ widthMm: 54, heightMm: 86, elements: [el({ text: 'Meera Iyer', font: { size: 10, weight: 'normal', color: '#000000', align: 'left', family: key as never } })] }, {}, {});
      expect(svg).toContain(`font-family="${f.css}"`);
    }
    expect(idCardFontCss('nonsense')).toBe(ID_CARD_FONTS.sans.css);
    expect(idCardFontCss(undefined)).toBe(ID_CARD_FONTS.sans.css);
  });

  it('wide fonts wrap sooner than narrow ones for the same text and box', () => {
    const text = 'aaaa bbbb cccc dddd eeee ffff gggg hhhh';
    const narrow = layoutIdCardText(text, 10, 36, 40, false, ID_CARD_FONTS.calibri.avg);
    const wide = layoutIdCardText(text, 10, 36, 40, false, ID_CARD_FONTS.courier.avg);
    expect(narrow.lines).toHaveLength(2);
    expect(wide.lines).toHaveLength(3);
    expect(layoutIdCardText(text, 10, 36, 40, false)).toEqual(layoutIdCardText(text, 10, 36, 40, false, 0.52)); // unchanged for Arial / Times
  });
});
