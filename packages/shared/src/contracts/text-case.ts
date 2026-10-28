/** Letter case for text printed on payslips and ID cards: as saved, UPPERCASE, lowercase, or Title Case. */
export const TEXT_CASES = ['NONE', 'UPPER', 'LOWER', 'TITLE'] as const;
export type TextCase = (typeof TEXT_CASES)[number];
export const TEXT_CASE_LABELS: Record<TextCase, string> = { NONE: 'As typed / saved', UPPER: 'UPPERCASE', LOWER: 'lowercase', TITLE: 'Title Case' };

/** Apply a letter case. Title Case capitalises the first letter of each word (after a space, hyphen, slash or bracket) and lowers the rest. */
export function applyTextCase(text: string, c: TextCase | null | undefined): string {
  switch (c) {
    case 'UPPER': return text.toUpperCase();
    case 'LOWER': return text.toLowerCase();
    case 'TITLE': return text.toLowerCase().replace(/(^|[\s\-/(])(\p{L})/gu, (_, pre: string, ch: string) => pre + ch.toUpperCase());
    default: return text;
  }
}
