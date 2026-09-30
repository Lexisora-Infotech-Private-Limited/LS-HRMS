import type {
  BankStepInput,
  CreateEmployeeInput,
  DocsStepInput,
  EmployeeCounts,
  EmployeeListQuery,
  EnvelopeDto,
  EsignInput,
  ExitCaseDto,
  ImportPreview,
  KitStepInput,
  OnboardingDto,
  OnboardingListRow,
  OnboardingStepKey,
  Paginated,
  PeopleMasterRow,
  ProfileAssetRow,
  ProfileAttendanceRow,
  ProfileDocumentRow,
  ProfileDto,
  ProfilePayRow,
  StartExitInput,
  UpdateEmployeeInput,
  UpdateSelfInput,
  VaultRow,
  VaultUploadInput,
  EmployeeRow,
} from '@lexisora/shared';
import { api, del, get, patch, post, put } from '@/lib/api';

/** People domain API client (employees, masters, profile, vault, onboarding). */

export type EmployeeList = Paginated<EmployeeRow> & { counts: EmployeeCounts };
export type MastersDto = { departments: PeopleMasterRow[]; designations: PeopleMasterRow[]; branches: PeopleMasterRow[] };
export type OnboardingDetail = OnboardingDto & { bank: { holder: string | null; account: string; ifsc: string | null; bank: string | null; taxRegime: string; uan: string | null; pan: string } };
export type QueueRow = VaultRow & { employeeId: string; employee: string; empCode: string; captured: string | null };
export type MasterKind = 'departments' | 'designations' | 'branches';

export const peopleKeys = {
  employees: ['people', 'employees'] as const,
  profile: (id: string) => ['people', 'profile', id] as const,
  masters: ['people', 'masters'] as const,
  vault: ['people', 'vault'] as const,
  onboardingMe: ['people', 'onboarding', 'me'] as const,
  onboardingList: ['people', 'onboarding', 'list'] as const,
  onboardingDetail: (id: string) => ['people', 'onboarding', 'detail', id] as const,
  queue: ['people', 'onboarding', 'queue'] as const,
};

export const peopleApi = {
  // Employees
  employees: (q: Partial<EmployeeListQuery>) => get<EmployeeList>('/employees', q as Record<string, unknown>),
  createEmployee: (b: CreateEmployeeInput) => post<{ employee: { id: string; empCode: string; fullName: string }; inviteSent: boolean; idCardStatus: string }>('/employees', b),
  updateEmployee: (id: string, b: UpdateEmployeeInput) => patch<unknown>(`/employees/${id}`, b),
  updateSelf: (b: UpdateSelfInput) => patch<unknown>('/employees/me', b),
  resendInvite: (id: string) => post<{ inviteSent: boolean }>(`/employees/${id}/invite`),
  startExit: (id: string, b: StartExitInput) => post<unknown>(`/employees/${id}/exit`, b),
  exitCase: (id: string) => get<ExitCaseDto | null>(`/employees/${id}/exit`),
  updateChecklist: (id: string, key: string, status: 'PENDING' | 'DONE' | 'NA', note?: string | null) => put<unknown>(`/employees/${id}/exit/checklist/${key}`, { status, note }),
  withdrawExit: (id: string) => post<unknown>(`/employees/${id}/exit/withdraw`),
  completeExit: (id: string, overrideReason?: string | null) => post<unknown>(`/employees/${id}/exit/complete`, { overrideReason }),
  convertIntern: (id: string, effectiveDate: string, designationId: string) => post<unknown>(`/employees/${id}/convert`, { effectiveDate, designationId }),
  validateImport: (file: File, createMissingMasters: boolean) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('createMissingMasters', String(createMissingMasters));
    return api<ImportPreview>('/employees/import', { method: 'POST', body: fd });
  },
  commitImport: (id: string, b: { sendInvites: boolean; createMissingMasters: boolean }) => post<ImportPreview & { imported?: number }>(`/employees/import/${id}/commit`, b),

  // Masters
  masters: () => get<MastersDto>('/masters'),
  saveMaster: (kind: MasterKind, id: string | null, b: Record<string, unknown>) => (id ? put<unknown>(`/masters/${kind}/${id}`, b) : post<unknown>(`/masters/${kind}`, b)),
  removeMaster: (kind: MasterKind, id: string) => del<unknown>(`/masters/${kind}/${id}`),

  // Profile
  profile: (id: string) => get<ProfileDto>(`/profile/${id}`),
  profileDocuments: (id: string) => get<ProfileDocumentRow[]>(`/profile/${id}/documents`),
  profileAssets: (id: string) => get<{ rows: ProfileAssetRow[] }>(`/profile/${id}/assets`),
  profilePay: (id: string) => get<{ rows: ProfilePayRow[]; effectiveFrom: string | null; source: string | null }>(`/profile/${id}/pay`),
  profileAttendance: (id: string) => get<{ rows: ProfileAttendanceRow[] }>(`/profile/${id}/attendance`),

  // Vault & documents
  vault: (category?: string) => get<VaultRow[]>('/vault', category ? { category } : undefined),
  uploadVault: (b: VaultUploadInput) => post<unknown>('/vault', b),
  uploadFor: (employeeId: string, b: VaultUploadInput) => post<unknown>(`/documents/employee/${employeeId}`, b),
  verifyDoc: (id: string, decision: 'VERIFIED' | 'REJECTED', reason?: string | null) => post<unknown>(`/documents/${id}/verify`, { decision, reason }),
  removeDoc: (id: string) => del<unknown>(`/documents/${id}`),

  // Onboarding (joiner)
  myOnboarding: () => get<OnboardingDto>('/onboarding/me'),
  sign: (key: 'offer' | 'nda', b: EsignInput) => post<OnboardingDto>(`/onboarding/me/sign/${key}`, b),
  decline: (reason: string) => post<unknown>('/onboarding/me/decline', { reason }),
  submitDocs: (b: DocsStepInput) => post<OnboardingDto>('/onboarding/me/docs', b),
  submitBank: (b: BankStepInput) => post<OnboardingDto>('/onboarding/me/bank', b),
  finish: (b: KitStepInput) => post<OnboardingDto>('/onboarding/me/finish', b),
  envelope: (id: string) => get<EnvelopeDto>(`/esign/${id}`),

  // Onboarding (HR)
  onboardings: (status?: string) => get<OnboardingListRow[]>('/onboarding', status ? { status } : undefined),
  onboardingDetail: (employeeId: string) => get<OnboardingDetail>(`/onboarding/${employeeId}`),
  queue: (employeeId?: string) => get<QueueRow[]>('/onboarding/verification', employeeId ? { employeeId } : undefined),
  reopen: (employeeId: string, key: OnboardingStepKey, reason: string) => post<OnboardingDetail>(`/onboarding/${employeeId}/reopen`, { key, reason }),
  override: (employeeId: string, reason: string) => post<OnboardingDetail>(`/onboarding/${employeeId}/override`, { reason }),
  verifyBank: (employeeId: string, decision: 'VERIFIED' | 'REJECTED', reason?: string | null) => post<OnboardingDetail>(`/onboarding/${employeeId}/bank/verify`, { decision, reason }),
};
