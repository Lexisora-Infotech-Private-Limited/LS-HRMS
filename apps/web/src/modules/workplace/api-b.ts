import type {
  BookingCheck,
  BookingCreateInput,
  CallJoin,
  CameraRow,
  CctvListResponse,
  CctvSessionRow,
  CctvView,
  ChannelCreateInput,
  ChatBrowseRow,
  ChatChannelRow,
  ChatChannelsResponse,
  ChatMemberRow,
  ChatMessageRow,
  ChatMessagesPage,
  ChatPerson,
  ChatSearchHit,
  CourseCreateInput,
  CourseDetail,
  CourseReportRow,
  FacilityListResponse,
  FacilityRow,
  FrontDeskCard,
  GameKey,
  GameResult,
  GameStart,
  LeaderboardResponse,
  LessonProgressResult,
  LmsTilesResponse,
  ManageCourseRow,
  RoomAvailability,
  RoomRow,
  VisitorCreateInput,
  VisitorPassResult,
  WellnessToday,
} from '@lexisora/shared';
import { del, get, patch, post } from '@/lib/api';

/** API client for the comms hub, learning, rooms & visitors, wellness and CCTV screens. */

export type ChatSendBody = { body: string; clientMsgId: string; attachments: { fileId: string; name: string; mime: string; size: number }[]; replyToId?: string | null };
export type FacilityQuery = { tab: 'bookings' | 'visitors'; scope: 'mine' | 'all'; date?: string; roomId?: string; upcoming?: '1' };
export type RoomInput = { name: string; capacity: number; amenities: string[]; branchId?: string | null; active: boolean };
export type CameraInput = { name: string; location: string; branchId?: string | null; rtspUrl?: string | null; enabled: boolean; sortOrder: number };
export type WellnessSettingsView = { enabledGames: GameKey[]; unlockTime: string; breakOnly: boolean; canManage: boolean };
export type AssignmentInput = { audienceType: string; refId?: string | null; label?: string | null; required: boolean; dueInDays?: number | null };

export const hubKeys = {
  chat: ['workplace', 'chat'] as const,
  channels: ['workplace', 'chat', 'channels'] as const,
  messages: (id: string) => ['workplace', 'chat', 'messages', id] as const,
  members: (id: string) => ['workplace', 'chat', 'members', id] as const,
  people: ['workplace', 'chat', 'people'] as const,
  browse: ['workplace', 'chat', 'browse'] as const,
  lms: ['workplace', 'lms'] as const,
  lmsTiles: (tab: string) => ['workplace', 'lms', 'tiles', tab] as const,
  lmsManage: ['workplace', 'lms', 'manage'] as const,
  course: (id: string) => ['workplace', 'lms', 'course', id] as const,
  courseReport: (id: string) => ['workplace', 'lms', 'report', id] as const,
  facility: ['workplace', 'facility'] as const,
  facilityList: (q: FacilityQuery) => ['workplace', 'facility', 'list', q] as const,
  rooms: (all: boolean) => ['workplace', 'facility', 'rooms', all] as const,
  availability: (date: string) => ['workplace', 'facility', 'availability', date] as const,
  frontDesk: ['workplace', 'facility', 'frontdesk'] as const,
  wellness: ['workplace', 'wellness'] as const,
  wellnessToday: ['workplace', 'wellness', 'today'] as const,
  leaderboard: (week: string) => ['workplace', 'wellness', 'board', week] as const,
  wellnessSettings: ['workplace', 'wellness', 'settings'] as const,
  cctv: ['workplace', 'cctv'] as const,
  cameras: (location: string) => ['workplace', 'cctv', 'cameras', location] as const,
  cctvSessions: ['workplace', 'cctv', 'sessions'] as const,
};

export const hubApi = {
  // Comms hub
  channels: () => get<ChatChannelsResponse>('/chat/channels'),
  browse: () => get<ChatBrowseRow[]>('/chat/channels/browse'),
  channel: (id: string) => get<ChatChannelRow>(`/chat/channels/${id}`),
  createChannel: (b: ChannelCreateInput) => post<ChatChannelRow>('/chat/channels', b),
  joinChannel: (id: string) => post<ChatChannelRow>(`/chat/channels/${id}/join`),
  leaveChannel: (id: string) => post<{ ok: true }>(`/chat/channels/${id}/leave`),
  mute: (id: string, muted: boolean) => patch<ChatChannelRow>(`/chat/channels/${id}/me`, { muted }),
  archiveChannel: (id: string, archived: boolean) => post<{ ok: true }>(`/chat/channels/${id}/archive`, { archived }),
  members: (id: string) => get<ChatMemberRow[]>(`/chat/channels/${id}/members`),
  addMembers: (id: string, userIds: string[]) => post<ChatMemberRow[]>(`/chat/channels/${id}/members`, { userIds }),
  removeMember: (id: string, userId: string) => del<ChatMemberRow[]>(`/chat/channels/${id}/members/${userId}`),
  messages: (id: string, q: { beforeSeq?: number; afterSeq?: number; limit?: number } = {}) => get<ChatMessagesPage>(`/chat/channels/${id}/messages`, q),
  send: (id: string, b: ChatSendBody) => post<ChatMessageRow>(`/chat/channels/${id}/messages`, b),
  read: (id: string, seq: number) => post<{ ok: true; lastReadSeq: number }>(`/chat/channels/${id}/read`, { seq }),
  editMessage: (id: string, body: string) => patch<ChatMessageRow>(`/chat/messages/${id}`, { body }),
  deleteMessage: (id: string) => del<{ ok: true }>(`/chat/messages/${id}`),
  openDm: (userIds: string[]) => post<ChatChannelRow>('/chat/dms', { userIds }),
  people: () => get<ChatPerson[]>('/chat/people'),
  search: (q: string, channelId?: string) => get<ChatSearchHit[]>('/chat/search', { q, channelId }),
  activeCall: (channelId: string) => get<CallJoin | null>(`/chat/channels/${channelId}/call`),
  startCall: (channelId: string, kind: 'AUDIO' | 'VIDEO' | 'SCREEN') => post<CallJoin>(`/chat/channels/${channelId}/calls`, { kind }),
  joinCall: (callId: string) => post<CallJoin>(`/chat/calls/${callId}/join`),
  leaveCall: (callId: string) => post<{ ok: true; ended: boolean }>(`/chat/calls/${callId}/leave`),
  recording: (callId: string, on: boolean) => post<CallJoin>(`/chat/calls/${callId}/recording`, { on }),

  // Learning
  tiles: (tab: 'my' | 'catalogue' | 'certificates') => get<LmsTilesResponse>('/lms', { tab }),
  manageCourses: () => get<ManageCourseRow[]>('/lms/manage'),
  course: (id: string) => get<CourseDetail>(`/lms/courses/${id}`),
  enroll: (id: string) => post<CourseDetail>(`/lms/courses/${id}/enroll`),
  heartbeat: (lessonId: string, positionSec: number, playbackRate: number) => post<LessonProgressResult>(`/lms/lessons/${lessonId}/progress`, { positionSec, playbackRate }),
  completeLesson: (lessonId: string) => post<LessonProgressResult>(`/lms/lessons/${lessonId}/complete`),
  createCourse: (b: CourseCreateInput) => post<CourseDetail>('/lms/courses', b),
  updateCourse: (id: string, b: { title?: string; description?: string | null; category?: string; certificateOnCompletion?: boolean }) => patch<CourseDetail>(`/lms/courses/${id}`, b),
  addLesson: (id: string, b: { title: string; type: 'VIDEO' | 'DOCUMENT'; fileId?: string | null; durationMin: number; content?: string | null }) => post<CourseDetail>(`/lms/courses/${id}/lessons`, b),
  reorderLessons: (id: string, lessonIds: string[]) => post<CourseDetail>(`/lms/courses/${id}/lessons/reorder`, { lessonIds }),
  deleteLesson: (lessonId: string) => del<CourseDetail>(`/lms/lessons/${lessonId}`),
  publishCourse: (id: string) => post<CourseDetail>(`/lms/courses/${id}/publish`),
  archiveCourse: (id: string) => post<CourseDetail>(`/lms/courses/${id}/archive`),
  addAssignment: (id: string, b: AssignmentInput) => post<CourseDetail>(`/lms/courses/${id}/assignments`, b),
  deleteAssignment: (id: string) => del<CourseDetail>(`/lms/assignments/${id}`),
  courseReport: (id: string) => get<CourseReportRow[]>(`/lms/courses/${id}/report`),

  // Rooms & visitors
  facility: (q: FacilityQuery) => get<FacilityListResponse>('/facility', q),
  rooms: (all = false) => get<RoomRow[]>('/facility/rooms', all ? { all: '1' } : {}),
  createRoom: (b: RoomInput) => post<RoomRow[]>('/facility/rooms', b),
  updateRoom: (id: string, b: RoomInput) => patch<RoomRow[]>(`/facility/rooms/${id}`, b),
  availability: (date: string) => get<RoomAvailability>('/facility/rooms/availability', { date }),
  checkBooking: (q: { roomId: string; date: string; from: string; to: string; excludeId?: string }) => get<BookingCheck>('/facility/bookings/check', q),
  book: (b: BookingCreateInput) => post<FacilityRow>('/facility/bookings', b),
  updateBooking: (id: string, b: { date: string; from: string; to: string }) => patch<FacilityRow>(`/facility/bookings/${id}`, b),
  cancelBooking: (id: string, reason?: string | null) => post<FacilityRow>(`/facility/bookings/${id}/cancel`, { reason: reason ?? null }),
  registerVisitor: (b: Partial<VisitorCreateInput> & { name: string; date: string }) => post<VisitorPassResult>('/facility/visitors', b),
  resendPass: (id: string) => post<VisitorPassResult>(`/facility/visitors/${id}/resend-pass`),
  cancelVisitor: (id: string) => post<FacilityRow>(`/facility/visitors/${id}/cancel`, {}),
  frontDesk: () => get<FrontDeskCard[]>('/facility/frontdesk'),
  lookupPass: (code: string) => post<FrontDeskCard>('/facility/visitors/lookup', { code }),
  checkIn: (id: string) => post<FrontDeskCard>(`/facility/visitors/${id}/check-in`),
  checkOut: (id: string) => post<FrontDeskCard>(`/facility/visitors/${id}/check-out`),

  // Wellness
  wellnessToday: () => get<WellnessToday>('/wellness/today'),
  startGame: (game: GameKey) => post<GameStart>(`/wellness/${game}/start`),
  completeGame: (game: GameKey, b: { startToken: string; solution: unknown; hintsUsed: number; moves?: number; revealed: boolean }) => post<GameResult>(`/wellness/${game}/complete`, b),
  leaderboard: (week: 'current' | 'last') => get<LeaderboardResponse>('/wellness/leaderboard', { week }),
  wellnessSettings: () => get<WellnessSettingsView>('/wellness/settings'),
  updateWellnessSettings: (b: { enabledGames?: GameKey[]; unlockTime?: string }) => patch<WellnessSettingsView>('/wellness/settings', b),

  // CCTV
  cameras: (location?: string) => get<CctvListResponse>('/cctv/cameras', location ? { location } : {}),
  createCamera: (b: CameraInput) => post<CameraRow>('/cctv/cameras', b),
  updateCamera: (id: string, b: Partial<CameraInput>) => patch<CameraRow>(`/cctv/cameras/${id}`, b),
  deleteCamera: (id: string) => del<{ ok: true }>(`/cctv/cameras/${id}`),
  testCamera: (id: string) => post<CameraRow & { message: string }>(`/cctv/cameras/${id}/test`),
  reconnectCamera: (id: string) => post<CameraRow & { message: string }>(`/cctv/cameras/${id}/reconnect`),
  viewCamera: (id: string) => post<CctvView>(`/cctv/cameras/${id}/view`),
  heartbeatView: (sid: string) => post<CctvView>(`/cctv/sessions/${sid}/heartbeat`),
  endView: (sid: string) => post<{ ok: true }>(`/cctv/sessions/${sid}/end`),
  cctvSessions: () => get<CctvSessionRow[]>('/cctv/sessions'),
};

/** "29 Sep 2026" style key → "Tue, 29 Sep" */
export function dayHeading(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const key = (x: Date) => x.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  if (key(d) === key(today)) return 'Today';
  if (key(d) === key(new Date(today.getTime() - 86_400_000))) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
}

export function istTodayKey(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

export function newClientId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
