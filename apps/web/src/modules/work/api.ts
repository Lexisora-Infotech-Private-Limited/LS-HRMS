import type {
  ArchiveDetail,
  ArchiveRow,
  BoardInfo,
  BoardView,
  ClientDetail,
  ClientRow,
  GitIntegrationView,
  InternContext,
  InternSheetRow,
  InternWeek,
  Paginated,
  ProjectDetail,
  ProjectKpis,
  ProjectRow,
  TaskDetail,
  TaskMoveResult,
} from '@lexisora/shared';
import { del, get, patch, post, put } from '@/lib/api';

/** Work domain API (clients, projects, boards, tasks, GitLab, archive, interns). */

export type ProjectList = Paginated<ProjectRow> & { canCreate: boolean };
export type ClientList = Paginated<ClientRow> & { counts: { ALL: number; ACTIVE: number; INACTIVE: number } };
export type ArchiveList = Paginated<ArchiveRow> & {
  counts: { all: number; web: number; mobile: number; internal: number };
  canManage: boolean;
  archivable: { value: string; label: string }[];
};
export type BoardMembersView = {
  department: string;
  leadEmployeeId: string | null;
  leadName: string | null;
  canAllocate: boolean;
  members: { employeeId: string; name: string; designation: string | null; allocatedBy: string | null; allocatedAt: string }[];
  candidates: { value: string; label: string }[];
};
export type DocInput = { fileId: string; title?: string; kind: string };

export const workKeys = {
  all: ['work'] as const,
  projects: ['work', 'projects'] as const,
  project: (id: string) => ['work', 'project', id] as const,
  kpis: ['work', 'projects', 'kpis'] as const,
  clients: ['work', 'clients'] as const,
  client: (id: string) => ['work', 'client', id] as const,
  boards: (projectId: string) => ['work', 'boards', projectId] as const,
  board: (projectId: string, deptId: string) => ['work', 'board', projectId, deptId] as const,
  boardMembers: (projectId: string, deptId: string) => ['work', 'boardMembers', projectId, deptId] as const,
  task: (id: string) => ['work', 'task', id] as const,
  archive: ['work', 'archive'] as const,
  archiveItem: (id: string) => ['work', 'archiveItem', id] as const,
  interns: ['work', 'interns'] as const,
  git: ['work', 'git'] as const,
};

export const workApi = {
  // Projects
  projects: (q: Record<string, unknown>) => get<ProjectList>('/projects', q),
  kpis: () => get<ProjectKpis>('/projects/kpis'),
  project: (id: string) => get<ProjectDetail>(`/projects/${id}`),
  projectBoards: (id: string) => get<BoardInfo[]>(`/projects/${id}/boards`),
  keySuggestion: (name: string) => get<{ key: string }>('/projects/key-suggestion', { name }),
  createProject: (body: unknown) => post<{ id: string; key: string }>('/projects', body),
  updateProject: (id: string, body: unknown) => patch(`/projects/${id}`, body),
  setProjectStatus: (id: string, body: { status: string; reason?: string; cancelRemaining?: boolean }) => post(`/projects/${id}/status`, body),
  addModule: (id: string, body: { name: string; estimatedHours?: number | null }) => post(`/projects/${id}/modules`, body),
  updateModule: (id: string, moduleId: string, body: unknown) => patch(`/projects/${id}/modules/${moduleId}`, body),
  removeModule: (id: string, moduleId: string) => del(`/projects/${id}/modules/${moduleId}`),
  addMember: (id: string, body: { employeeId: string; role: string; allocationPct?: number | null }) => post(`/projects/${id}/members`, body),
  updateMember: (id: string, memberId: string, body: unknown) => patch(`/projects/${id}/members/${memberId}`, body),
  removeMember: (id: string, memberId: string) => del(`/projects/${id}/members/${memberId}`),
  addDocs: (id: string, documents: DocInput[]) => post(`/projects/${id}/documents`, { documents }),
  removeDoc: (id: string, docId: string) => del(`/projects/${id}/documents/${docId}`),
  linkGit: (id: string) => post<{ status: string; error: string | null }>(`/projects/${id}/git/link`),

  // Clients
  clients: (q: Record<string, unknown>) => get<ClientList>('/clients', q),
  client: (id: string) => get<ClientDetail>(`/clients/${id}`),
  createClient: (body: unknown) => post<{ id: string; code: string; warning?: string | null }>('/clients', body),
  updateClient: (id: string, body: unknown) => patch<{ id: string; warning?: string | null }>(`/clients/${id}`, body),
  setClientStatus: (id: string, status: 'ACTIVE' | 'INACTIVE') => post(`/clients/${id}/status`, { status }),
  removeClient: (id: string) => del(`/clients/${id}`),
  addClientDoc: (id: string, body: DocInput) => post(`/clients/${id}/documents`, body),
  removeClientDoc: (id: string, docId: string) => del(`/clients/${id}/documents/${docId}`),

  // Boards & tasks
  board: (projectId: string, deptId: string, includeDone: boolean) => get<BoardView>(`/boards/${projectId}/${deptId}`, { includeDone: includeDone ? 'true' : undefined }),
  boardMembers: (projectId: string, deptId: string) => get<BoardMembersView>(`/boards/${projectId}/${deptId}/members`),
  allocate: (projectId: string, deptId: string, employeeId: string) => post<{ message: string }>(`/boards/${projectId}/${deptId}/members`, { employeeId }),
  revoke: (projectId: string, deptId: string, employeeId: string) => del<{ message: string }>(`/boards/${projectId}/${deptId}/members/${employeeId}`),
  createTask: (body: unknown) => post<{ id: string; key: string; warning?: string | null }>('/tasks', body),
  task: (id: string) => get<TaskDetail>(`/tasks/${id}`),
  updateTask: (id: string, body: unknown) => patch(`/tasks/${id}`, body),
  moveTask: (id: string, body: { toStatus: string; version?: number; beforeTaskId?: string; reason?: string }) => post<TaskMoveResult>(`/tasks/${id}/move`, body),
  comment: (id: string, body: string) => post(`/tasks/${id}/comments`, { body }),
  retryGit: (id: string) => post<{ message?: string }>(`/tasks/${id}/git/retry`),
  cancelTask: (id: string, reason?: string) => post(`/tasks/${id}/cancel`, { reason }),

  // GitLab
  git: () => get<GitIntegrationView>('/git/integration'),
  saveGit: (body: unknown) => put<GitIntegrationView>('/git/integration', body),
  testGit: () => post<{ ok: boolean; user?: string; message?: string }>('/git/integration/test'),
  rotateGit: () => post<GitIntegrationView>('/git/integration/rotate-secret'),

  // Archive
  archive: (q: Record<string, unknown>) => get<ArchiveList>('/archive', q),
  archiveItem: (id: string) => get<ArchiveDetail>(`/archive/${id}`),
  setArchiveAccess: (id: string, archiveAccess: string) => patch(`/archive/${id}/access`, { archiveAccess }),
  addArchiveDoc: (id: string, body: DocInput) => post(`/archive/${id}/documents`, body),
  archiveProject: (id: string) => post(`/archive/${id}/archive`),
  unarchiveProject: (id: string) => post(`/archive/${id}/unarchive`),

  // Interns
  internContext: () => get<InternContext>('/interns/context'),
  internSheet: (q: { date?: string; mentorEmployeeId?: string }) => get<InternSheetRow[]>('/interns/sheet', q),
  assignIntern: (body: unknown) => post('/interns/tasks', body),
  updateInternTask: (id: string, body: unknown) => patch(`/interns/tasks/${id}`, body),
  removeInternTask: (id: string) => del(`/interns/tasks/${id}`),
  carryOver: (id: string) => post(`/interns/tasks/${id}/carry-over`),
  internWeek: (internId: string, weekStart?: string) => get<InternWeek>(`/interns/${internId}/week`, { weekStart }),
  scoreWeek: (internId: string, body: { weekStart: string; score: number; feedback?: string | null }) => put(`/interns/${internId}/week-score`, body),
};

/** 820h / "8h" / "2.5h" from minutes. */
export function hours(min: number | null | undefined, empty = '—'): string {
  if (min == null) return empty;
  const h = min / 60;
  const r = Math.round(h * 10) / 10;
  return `${r.toLocaleString('en-IN')}h`;
}
