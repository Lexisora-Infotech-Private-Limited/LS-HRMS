import type {
  AppraisalCycleInput,
  AppraisalCycleRow,
  AppraisalReviewInput,
  AssetDetail,
  AssetInput,
  AssetRow,
  BankStepInput,
  CandidateDetail,
  CandidateInput,
  CandidateRow,
  CreateEmployeeInput,
  DocsStepInput,
  EmployeeCounts,
  EmployeeListQuery,
  EnvelopeDto,
  EsignInput,
  ExitCaseDto,
  HireInput,
  IdCardPreviewData,
  IdCardRow,
  IdCardSettings,
  IdCardTemplateDto,
  IdCardTemplateInput,
  ImportPreview,
  InterviewDetail,
  InterviewRow,
  JobInput,
  JobOfferInput,
  JobRow,
  KitItemDto,
  KitRow,
  KitStepInput,
  KraTemplateDto,
  KraTemplateInput,
  MyReviewRow,
  OnboardingDto,
  OnboardingListRow,
  OnboardingStepKey,
  Paginated,
  ParticipantRow,
  PeopleMasterRow,
  ProfileAssetRow,
  ProfileAttendanceRow,
  ProfileDocumentRow,
  ProfileDto,
  ProfilePayRow,
  ReviewDetail,
  ScheduleInterviewInput,
  ScorecardInput,
  StartExitInput,
  UpdateEmployeeInput,
  UpdateSelfInput,
  VaultRow,
  VaultUploadInput,
  VCardDto,
  EmployeeRow,
} from '@lexisora/shared';
import { api, del, get, patch, post, put } from '@/lib/api';

/** People domain API client (employees, masters, profile, vault, onboarding, recruitment, appraisals, assets, kits, ID & visiting cards). */

export type EmployeeList = Paginated<EmployeeRow> & { counts: EmployeeCounts };
export type MastersDto = { departments: PeopleMasterRow[]; designations: PeopleMasterRow[]; branches: PeopleMasterRow[] };
export type OnboardingDetail = OnboardingDto & { bank: { holder: string | null; account: string; ifsc: string | null; bank: string | null; taxRegime: string; uan: string | null; pan: string } };
export type QueueRow = VaultRow & { employeeId: string; employee: string; empCode: string; captured: string | null };
export type MasterKind = 'departments' | 'designations' | 'branches';

// Recruitment
export type JobList = { items: JobRow[]; counts: { open: number; closed: number } };
export type JobDetail = JobRow & { designationId: string | null; branchId: string | null; experienceMinYrs: number | null; experienceMaxYrs: number | null; hiringManagerId: string | null; roundNames: string[]; pipeline: Record<string, number> };
export type RoundRow = { id: string; name: string; defaultDurationMin: number; criteria: { key: string; label: string }[] };
export type CandidateTab = 'all' | 'screening' | 'interview' | 'offered' | 'rejected';
export type CandidateList = { items: CandidateRow[]; counts: Record<CandidateTab, number>; canManage: boolean };
export type InterviewTab = 'upcoming' | 'past' | 'all';
export type InterviewList = { items: InterviewRow[]; canManage: boolean; counts: Record<InterviewTab, number> };
export type HireResult = { employee: { id: string; empCode: string; fullName: string }; inviteSent: boolean; candidateId: string };

// Assets & kits
export type AssetTab = 'all' | 'assigned' | 'in_stock' | 'under_repair' | 'returned';
export type AssetList = Paginated<AssetRow> & { counts: Record<AssetTab, number>; kpis: { total: number; assigned: number; inStock: number; expiring30: number } };
export type AssetCategoryRow = { id: string; name: string; requiresSerial: boolean; assets: number };
export type KitList = { items: KitItemDto[]; rows: KitRow[] };
export type KitItemInput = { name: string; sizes: string[]; stock: Record<string, number>; lowStockThreshold: number; isActive: boolean };

// ID & visiting cards
export type IdPreview = { employeeId: string; name: string; data: IdCardPreviewData; qrDataUrl: string };
export type Generatable = { count: number; waiting: { cardId: string; employeeId: string; name: string; missing: string[] }[]; ready: number };
export type PrintBatchRow = { id: string; code: string; sentAt: string | null; cards: number; vendor: string; status: string; pdfFileId: string; sentBy: string | null };
export type VCardFull = VCardDto & { slug: string; tenantSlug: string; vcf: string };

export const peopleKeys = {
  employees: ['people', 'employees'] as const,
  profile: (id: string) => ['people', 'profile', id] as const,
  masters: ['people', 'masters'] as const,
  vault: ['people', 'vault'] as const,
  onboardingMe: ['people', 'onboarding', 'me'] as const,
  onboardingList: ['people', 'onboarding', 'list'] as const,
  onboardingDetail: (id: string) => ['people', 'onboarding', 'detail', id] as const,
  queue: ['people', 'onboarding', 'queue'] as const,
  jobs: ['people', 'jobs'] as const,
  rounds: ['people', 'rounds'] as const,
  candidates: ['people', 'candidates'] as const,
  candidate: (id: string) => ['people', 'candidates', 'detail', id] as const,
  interviews: ['people', 'interviews'] as const,
  interview: (id: string) => ['people', 'interviews', 'detail', id] as const,
  appraisals: ['people', 'appraisals'] as const,
  assets: ['people', 'assets'] as const,
  kits: ['people', 'kits'] as const,
  idcards: ['people', 'idcards'] as const,
  vcard: ['people', 'vcard'] as const,
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

  // Jobs
  jobs: (tab: 'open' | 'closed') => get<JobList>('/jobs', { tab }),
  job: (id: string) => get<JobDetail>(`/jobs/${id}`),
  saveJob: (id: string | null, b: JobInput) => (id ? put<JobDetail>(`/jobs/${id}`, b) : post<JobDetail>('/jobs', b)),
  jobStatus: (id: string, status: 'DRAFT' | 'OPEN' | 'ON_HOLD' | 'CLOSED', reason?: string | null) => post<JobDetail>(`/jobs/${id}/status`, { status, reason }),
  rounds: () => get<RoundRow[]>('/jobs/rounds'),
  createRound: (b: { name: string; defaultDurationMin: number; criteria: string[] }) => post<unknown>('/jobs/rounds', b),
  deactivateRound: (id: string) => post<unknown>(`/jobs/rounds/${id}/deactivate`),

  // Candidates
  candidates: (q: { tab: CandidateTab; q?: string; jobId?: string }) => get<CandidateList>('/candidates', q),
  candidate: (id: string) => get<CandidateDetail>(`/candidates/${id}`),
  addCandidate: (b: CandidateInput) => post<{ candidateId: string; applicationId: string }>('/candidates', b),
  addApplication: (candidateId: string, jobId: string) => post<CandidateDetail>(`/candidates/${candidateId}/applications`, { jobId }),
  anonymise: (candidateId: string) => post<unknown>(`/candidates/${candidateId}/anonymise`),
  moveStage: (applicationId: string, to: string, reason?: string | null) => post<CandidateDetail>(`/candidates/applications/${applicationId}/stage`, { to, reason }),
  saveOffer: (applicationId: string, b: JobOfferInput) => post<CandidateDetail>(`/candidates/applications/${applicationId}/offer`, b),
  hire: (applicationId: string, b: HireInput) => post<HireResult>(`/candidates/applications/${applicationId}/hire`, b),

  // Interviews (panelists see their own — audit G2)
  interviews: (tab: InterviewTab, mine?: boolean) => get<InterviewList>('/interviews', mine ? { tab, mine: true } : { tab }),
  interview: (id: string) => get<InterviewDetail>(`/interviews/${id}`),
  schedule: (b: ScheduleInterviewInput) => post<{ id: string; emailed: boolean }>('/interviews', b),
  reschedule: (id: string, b: { date: string; time: string; durationMin?: number }) => post<{ ok: boolean; emailed: boolean }>(`/interviews/${id}/reschedule`, b),
  cancelInterview: (id: string, reason?: string | null) => post<unknown>(`/interviews/${id}/cancel`, { reason }),
  noShow: (id: string) => post<InterviewDetail>(`/interviews/${id}/no-show`),
  scorecard: (id: string, b: ScorecardInput) => put<InterviewDetail>(`/interviews/${id}/scorecard`, b),
  interviewResult: (id: string, result: 'PENDING' | 'SELECTED' | 'REJECTED' | 'ON_HOLD') => post<InterviewDetail>(`/interviews/${id}/result`, { result }),

  // Appraisals
  cycles: () => get<AppraisalCycleRow[]>('/appraisals/cycles'),
  createCycle: (b: AppraisalCycleInput) => post<{ id: string; participants: number }>('/appraisals/cycles', b),
  advanceCycle: (id: string) => post<{ status: string }>(`/appraisals/cycles/${id}/advance`),
  participants: (cycleId: string) => get<ParticipantRow[]>(`/appraisals/cycles/${cycleId}/participants`),
  addParticipants: (cycleId: string, b: { employeeIds: string[]; departmentId?: string | null }) => post<{ added: number; skipped: number }>(`/appraisals/cycles/${cycleId}/participants`, b),
  updateParticipant: (id: string, b: { reviewerEmployeeId?: string; templateId?: string }) => patch<unknown>(`/appraisals/participants/${id}`, b),
  removeParticipant: (id: string) => del<unknown>(`/appraisals/participants/${id}`),
  kraTemplates: () => get<KraTemplateDto[]>('/appraisals/templates'),
  createKraTemplate: (b: KraTemplateInput) => post<{ id: string }>('/appraisals/templates', b),
  publishKraTemplate: (id: string) => post<unknown>(`/appraisals/templates/${id}/publish`),
  myReviews: () => get<MyReviewRow[]>('/appraisals/mine'),
  review: (id: string) => get<ReviewDetail>(`/appraisals/reviews/${id}`),
  saveReview: (id: string, b: AppraisalReviewInput) => put<ReviewDetail>(`/appraisals/reviews/${id}`, b),
  calibrate: (id: string, score: number, note?: string | null) => post<ReviewDetail>(`/appraisals/reviews/${id}/calibrate`, { score, note }),
  acknowledge: (id: string, comment?: string | null) => post<ReviewDetail>(`/appraisals/reviews/${id}/acknowledge`, { comment }),

  // Assets
  assets: (q: { tab: AssetTab; q?: string; page?: number; pageSize?: number; categoryId?: string }) => get<AssetList>('/assets', q),
  asset: (id: string) => get<AssetDetail>(`/assets/${id}`),
  saveAsset: (id: string | null, b: AssetInput) => (id ? put<AssetDetail>(`/assets/${id}`, b) : post<AssetDetail>('/assets', b)),
  assignAsset: (id: string, employeeId: string, assignedOn: string) => post<AssetDetail>(`/assets/${id}/assign`, { employeeId, assignedOn }),
  returnAsset: (id: string, b: { condition: string; notes?: string | null; returnedOn?: string | null }) => post<AssetDetail & { suggestRepair: boolean }>(`/assets/${id}/return`, b),
  inspectAsset: (id: string, to: 'IN_STOCK' | 'UNDER_REPAIR' | 'RETIRED') => post<AssetDetail>(`/assets/${id}/inspect`, { to }),
  repairAsset: (id: string, b: { issue: string; vendor?: string | null; expectedBack?: string | null }) => post<AssetDetail>(`/assets/${id}/repair`, b),
  repairDone: (id: string, costPaise?: number | null) => post<AssetDetail>(`/assets/${id}/repair/complete`, { costPaise }),
  lostAsset: (id: string, note: string) => post<AssetDetail>(`/assets/${id}/lost`, { note }),
  assetCategories: () => get<AssetCategoryRow[]>('/assets/categories'),
  createAssetCategory: (b: { name: string; requiresSerial: boolean }) => post<unknown>('/assets/categories', b),

  // Welcome kits
  kits: (status?: string) => get<KitList>('/welcome-kits', status ? { status } : undefined),
  kitItems: () => get<KitItemDto[]>('/welcome-kits/items'),
  saveKitItem: (id: string | null, b: KitItemInput) => (id ? put<unknown>(`/welcome-kits/items/${id}`, b) : post<unknown>('/welcome-kits/items', b)),
  issueKit: (b: { employeeId: string; itemIds: string[]; issuedOn: string; force?: boolean }) => post<{ ok: boolean; warnings: string[] }>('/welcome-kits/issue', b),
  toggleKitLine: (issueId: string, itemId: string, b: { issued: boolean; size?: string | null; force?: boolean }) => put<{ ok: boolean }>(`/welcome-kits/${issueId}/lines/${itemId}`, b),

  // ID cards
  idSettings: () => get<IdCardSettings>('/id-cards/settings'),
  saveIdSettings: (b: IdCardSettings) => put<IdCardSettings>('/id-cards/settings', b),
  idTemplates: () => get<IdCardTemplateDto[]>('/id-cards/templates'),
  createIdTemplate: (b: IdCardTemplateInput) => post<IdCardTemplateDto>('/id-cards/templates', b),
  updateIdTemplate: (id: string, b: IdCardTemplateInput) => put<IdCardTemplateDto>(`/id-cards/templates/${id}`, b),
  setDefaultIdTemplate: (id: string) => post<unknown>(`/id-cards/templates/${id}/default`),
  idPreviewData: (employeeId?: string | null) => get<IdPreview>('/id-cards/preview-data', employeeId ? { employeeId } : undefined),
  idCards: (status?: string, q?: string) => get<IdCardRow[]>('/id-cards', { status, q }),
  generatable: () => get<Generatable>('/id-cards/generatable'),
  generateCards: (b: { cardIds?: string[]; allGeneratable?: boolean }) => post<{ generated: number; skipped: string[] }>('/id-cards/generate', b),
  sendToPrint: (b: { cardIds?: string[]; allReady?: boolean }) => post<{ batchId: string; code: string; cards: number; vendorEmail: string }>('/id-cards/print', b),
  printBatches: () => get<PrintBatchRow[]>('/id-cards/batches'),
  batchStatus: (id: string, status: 'acknowledged' | 'delivered') => post<unknown>(`/id-cards/batches/${id}/${status}`),
  issueCard: (id: string) => post<unknown>(`/id-cards/${id}/issue`),
  revokeCard: (id: string, reason: string) => post<unknown>(`/id-cards/${id}/revoke`, { reason }),
  reissueCard: (employeeId: string, reason: string) => post<IdCardRow>(`/id-cards/employee/${employeeId}/reissue`, { reason }),
  myIdCard: () => get<IdCardRow | null>('/id-cards/mine'),

  // Visiting card
  vcard: () => get<VCardFull>('/vcard'),
  saveVcard: (b: { showPhone?: boolean; workPhone?: string | null; linkedinUrl?: string | null; isPublic?: boolean }) => put<unknown>('/vcard', b),
  shareVcardEmail: (to: string[], message?: string | null) => post<{ sent: number }>('/vcard/share/email', { to, message }),
  shareVcardWhatsapp: (phone?: string | null) => post<{ mode: 'deeplink'; url: string }>('/vcard/share/whatsapp', { phone: phone || null }),
};

/** Extra lookup types the People module registers (not in the core LookupType union). */
export type PeopleLookupType = 'jobs' | 'candidates' | 'interviewRounds' | 'kraTemplates' | 'assetCategories' | 'kitItems' | 'newJoiners' | 'employees' | 'managers' | 'departments' | 'designations' | 'branches' | 'shifts';
export const lookupsFor = (types: PeopleLookupType[]) => get<Record<string, { value: string; label: string }[]>>('/lookups', { types: types.join(',') });
