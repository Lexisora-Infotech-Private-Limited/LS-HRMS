import { z } from 'zod';
import { REGION_CODES, type RegionCode, type RegionConfig } from '../region';

export const setRegionSchema = z.object({
  region: z.enum(REGION_CODES),
  /** Platform admins may switch a tenant that already has finalised pay runs or issued invoices. */
  force: z.boolean().optional(),
});
export type SetRegionInput = z.infer<typeof setRegionSchema>;

/** UK VAT registration number: GB + 9 or 12 digits, or GBGD/GBHA + 3 digits. Empty = not VAT registered. */
export const UK_VAT_NUMBER_RE = /^GB(\d{9}|\d{12}|GD\d{3}|HA\d{3})$/;
export const setCompanyTaxSchema = z.object({
  vatNumber: z
    .string()
    .trim()
    .toUpperCase()
    .transform((s) => s.replace(/\s+/g, ''))
    .transform((s) => (s && !s.startsWith('GB') ? `GB${s}` : s))
    .refine((s) => s === '' || UK_VAT_NUMBER_RE.test(s), 'Enter a UK VAT number, e.g. GB123456789'),
});
export type SetCompanyTaxInput = z.input<typeof setCompanyTaxSchema>;

export type RegionChecklistItem = {
  key: string;
  label: string;
  done: boolean;
  detail: string;
  /** Web route that fixes it. */
  link: string;
};

export type RegionStatusDto = {
  region: RegionCode;
  config: RegionConfig;
  /** Every region the product supports, for the switch. */
  options: RegionConfig[];
  /** Reasons the region cannot be switched now (empty = can switch). */
  blockers: string[];
  /** Setup steps for the current region (UK only; empty for India). */
  checklist: RegionChecklistItem[];
  /** UK: VAT registration number (empty when not VAT registered). */
  vatNumber: string | null;
};

/** UK nations whose bank holidays differ. */
export const UK_NATIONS = ['ENG_WLS', 'SCT', 'NIR'] as const;
export type UkNation = (typeof UK_NATIONS)[number];
export const UK_NATION_LABELS: Record<UkNation, string> = {
  ENG_WLS: 'England and Wales',
  SCT: 'Scotland',
  NIR: 'Northern Ireland',
};
