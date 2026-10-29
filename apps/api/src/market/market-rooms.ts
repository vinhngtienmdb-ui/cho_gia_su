import { Body, Controller, Get, HttpCode, Inject, Injectable, Optional, Param, Post, Req } from '@nestjs/common';
import type { MarketplaceDatabase, MarketRoomRole, MarketRoomTimings } from '@cho-gia-su/database';
import { ApplicationError } from '../common/server.js';
import { videoGrantsFor } from '../common/shared.js';
import type { Request } from 'express';
import type { Kysely, Selectable, Transaction } from 'kysely';
import { PublicEndpoint } from '../common/public-endpoint.js';
import type { RequestBody } from '../common/request-fields.js';
import { VIDEO_PROVIDER, type VideoRoomEvent, type VideoRoomProvider } from '../common/video-provider.js';
import { MarketAccountsService } from './market-accounts.js';
import { MarketBookingsService } from './market-bookings.js';
import { MarketContext, marketNotFound, type MarketAccount } from './market-context.js';
import {
  attendanceOf,
  childMustConfirm,
  parseRoomIdentity,
  roomIdentity,
  roomOpensAt,
  roomWindowOpen,
  sessionEndsAt,
  tutorNoShowAllowed,
} from './market-room-rules.js';

type RecordingResult = NonNullable<VideoRoomEvent['recording']>;

// Phòng học video của chợ gia sư (DT-27 phần 27j, YCTD-362; tài liệu 47 mục 19.12; GD-164, quyết định của Eric ngày 2026-10-29):
// - phụ huynh đồng ý ghi hình một lần cho mọi buổi của một con với một gia sư, rút lại được; con từ đủ 7 tuổi cùng xác nhận. Buổi có trẻ
//   vị thành niên chỉ vào phòng được khi có đồng ý còn hiệu lực;
// - phòng vào được từ lúc mở (mặc định 10 phút trước giờ học) đến hết giờ, chỉ buổi đã trả tiền; gia sư mở phòng (`session/start` của
//   27i, bắt đầu ghi hình), người của buổi vào phòng chờ, gia sư cho vào, cho nói, cho chia sẻ màn hình, mời ra; phụ huynh vào xem luôn
//   tắt micro trừ khi gia sư cho nói;
// - mỗi lần vào, ra ghi vào nhật ký (từ ứng dụng và từ sự kiện của máy chủ video); điểm danh tính theo khoảng có mặt trong giờ học;
// - gia sư chưa vào phòng quá mốc (mặc định 10 phút) thì phụ huynh báo vắng, buổi hủy và hoàn đủ; gia sư xác nhận đã dạy kèm nhận xét,
//   không xác nhận thì việc định kỳ tự xác nhận sau mốc (mặc định 24 giờ, `MarketBookingsService.runDue`)
type Database = Kysely<MarketplaceDatabase>;
type Executor = Database | Transaction<MarketplaceDatabase>;
type Booking = Selectable<MarketplaceDatabase['market_bookings']>;
type Participant = Selectable<MarketplaceDatabase['market_session_participants']>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MARKET_ROOM_PREFIX = 'market-';

export function marketRoomName(bookingId: string): string {
  return `${MARKET_ROOM_PREFIX}${bookingId}`;
}

const INCIDENTS = ['none', 'student_absent', 'network', 'report'] as const;

@Injectable()
export class MarketRoomsService {
  constructor(
    private readonly market: MarketContext,
    private readonly accounts: MarketAccountsService,
    private readonly bookings: MarketBookingsService,
    @Optional() @Inject(VIDEO_PROVIDER) private readonly video: VideoRoomProvider | null = null,
  ) {}

  private requireVideo(): VideoRoomProvider {
    if (!this.video) throw new ApplicationError('ERR_CONFLICT', 'Phòng video chưa bật ở bản triển khai này');
    return this.video;
  }

  private async timings(): Promise<MarketRoomTimings> {
    return (await this.market.settings()).room;
  }

  private async bookingOf(account: MarketAccount, id: string): Promise<Booking> {
    const booking = UUID.test(id)
      ? await this.market.database
          .selectFrom('market_bookings')
          .selectAll()
          .where('id', '=', id)
          .where(account.kind === 'tutor' ? 'tutor_account_id' : 'parent_account_id', '=', account.id)
          .executeTakeFirst()
      : undefined;
    if (!booking) throw marketNotFound();
    return booking;
  }

  private activeConsent(executor: Executor, booking: Booking) {
    if (!booking.child_id) return Promise.resolve(undefined);
    return executor
      .selectFrom('market_recording_consents')
      .select(['id', 'child_confirmed', 'consented_at'])
      .where('child_id', '=', booking.child_id)
      .where('tutor_account_id', '=', booking.tutor_account_id)
      .where('withdrawn_at', 'is', null)
      .executeTakeFirst();
  }

  private roomRow(executor: Executor, bookingId: string) {
    return executor
      .selectFrom('market_session_rooms')
      .selectAll()
      .where('booking_id', '=', bookingId)
      .executeTakeFirst();
  }

  private attendanceRows(executor: Executor, bookingId: string) {
    return executor
      .selectFrom('market_session_attendance')
      .select(['identity', 'role', 'joined_at', 'left_at'])
      .where('booking_id', '=', bookingId)
      .orderBy('joined_at')
      .execute();
  }

  private async childBirthYear(booking: Booking): Promise<number | null> {
    if (!booking.child_id) return null;
    const child = await this.market.database
      .selectFrom('market_children')
      .select('birth_year')
      .where('id', '=', booking.child_id)
      .executeTakeFirst();
    return child?.birth_year ?? null;
  }

  // Điểm danh theo người: gom các lần vào ra theo định danh, tính đến lúc đóng phòng (hoặc bây giờ khi phòng còn mở)
  private async attendance(booking: Booking, until: Date, timings: MarketRoomTimings) {
    const rows = await this.attendanceRows(this.market.database, booking.id);
    const participants = await this.market.database
      .selectFrom('market_session_participants')
      .select(['identity', 'role', 'display_name'])
      .where('booking_id', '=', booking.id)
      .execute();
    return participants.map((participant) => {
      const intervals = rows.filter((row) => row.identity === participant.identity);
      const summary = attendanceOf(intervals, booking.starts_at, booking.minutes, until, timings);
      return {
        identity: participant.identity,
        role: participant.role,
        display_name: participant.display_name,
        first_join: summary.firstJoin,
        last_leave: intervals.at(-1)?.left_at ?? null,
        rejoins: Math.max(0, intervals.length - 1),
        present_minutes: summary.presentMinutes,
        // Phụ huynh vào xem không tính điểm danh
        result: participant.role === 'guardian' ? null : summary.result,
      };
    });
  }

  private async openInterval(executor: Executor, bookingId: string, identity: string, role: MarketRoomRole, at: Date) {
    const open = await executor
      .selectFrom('market_session_attendance')
      .select('id')
      .where('booking_id', '=', bookingId)
      .where('identity', '=', identity)
      .where('left_at', 'is', null)
      .executeTakeFirst();
    if (!open) {
      await executor
        .insertInto('market_session_attendance')
        .values({ booking_id: bookingId, identity, role, joined_at: at, source: 'app' })
        .execute();
    }
  }

  private closeIntervals(executor: Executor, bookingId: string, at: Date, identity?: string) {
    let query = executor
      .updateTable('market_session_attendance')
      .set({ left_at: at })
      .where('booking_id', '=', bookingId)
      .where('left_at', 'is', null);
    if (identity) query = query.where('identity', '=', identity);
    return query.execute();
  }

  private joinInfo(booking: Booking, participant: Participant, token: string, recording: boolean) {
    const video = this.requireVideo();
    return {
      status: 'ready' as const,
      room_id: marketRoomName(booking.id),
      title: `${booking.subject} · ${booking.child_name}`,
      role: participant.role,
      identity: participant.identity,
      url: video.clientUrl,
      token,
      recording,
      can_speak: participant.role !== 'guardian' || participant.can_speak,
      can_share: participant.role === 'host' || participant.can_share,
    };
  }

  private grantsOf(participant: Participant) {
    return videoGrantsFor(participant.role, { speak: participant.can_speak, share: participant.can_share });
  }

  private async recordingOn(bookingId: string): Promise<boolean> {
    const row = await this.market.database
      .selectFrom('market_session_recordings')
      .select('status')
      .where('booking_id', '=', bookingId)
      .executeTakeFirst();
    return row?.status === 'recording';
  }

  // ---------- Phía phụ huynh

  // Trạng thái phòng của một buổi để trang chuẩn bị vào phòng hiện đúng bước
  async parentRoom(request: Request, id: string) {
    const account = await this.accounts.requireReady(request, 'parent');
    const booking = await this.bookingOf(account, id);
    const timings = await this.timings();
    const now = this.market.now();
    const [room, consent, birthYear] = await Promise.all([
      this.roomRow(this.market.database, booking.id),
      this.activeConsent(this.market.database, booking),
      this.childBirthYear(booking),
    ]);
    const mine = await this.market.database
      .selectFrom('market_session_participants')
      .select(['identity', 'role', 'admitted_at', 'removed_at'])
      .where('booking_id', '=', booking.id)
      .where('account_id', '=', account.id)
      .execute();
    const ended = room?.closed_at ?? (now > sessionEndsAt(booking.starts_at, booking.minutes) ? now : null);
    return {
      booking_id: booking.id,
      subject: booking.subject,
      child_name: booking.child_name,
      status: booking.status,
      starts_at: booking.starts_at,
      ends_at: sessionEndsAt(booking.starts_at, booking.minutes),
      opens_at: roomOpensAt(booking.starts_at, timings),
      window_open: roomWindowOpen(booking.starts_at, booking.minutes, now, timings),
      recording_required: booking.recording_required,
      consent: consent ?? null,
      child_must_confirm: birthYear !== null && childMustConfirm(birthYear, now),
      tutor_opened: Boolean(room),
      closed: Boolean(room?.closed_at),
      no_show_allowed:
        booking.status === 'paid' &&
        tutorNoShowAllowed(booking.starts_at, booking.minutes, now, Boolean(room), timings),
      participants: mine,
      timings: {
        opens_before_minutes: timings.opensBeforeMinutes,
        late_absent_minutes: timings.lateAbsentMinutes,
        tutor_no_show_minutes: timings.tutorNoShowMinutes,
        full_attendance_percent: timings.fullAttendancePercent,
      },
      attendance: ended ? await this.attendance(booking, ended, timings) : null,
      confirmed: room?.confirmed_at ? { at: room.confirmed_at, by: room.confirmed_by } : null,
      tutor_note: room?.tutor_note ?? null,
    };
  }

  // Đồng ý ghi hình cho mọi buổi của con với gia sư của buổi này; con từ đủ 7 tuổi phải cùng xác nhận
  async consent(request: Request, id: string, body: RequestBody) {
    const account = await this.accounts.requireReady(request, 'parent');
    const booking = await this.bookingOf(account, id);
    if (!booking.child_id) throw new ApplicationError('ERR_CONFLICT', 'Hồ sơ con của buổi đã bị xóa');
    const birthYear = await this.childBirthYear(booking);
    const childConfirmed = body?.child_confirmed === true;
    if (body?.parent_confirmed !== true) {
      throw new ApplicationError('ERR_VALIDATION', 'Cần xác nhận của cha, mẹ hoặc người giám hộ');
    }
    if (birthYear !== null && childMustConfirm(birthYear, this.market.now()) && !childConfirmed) {
      throw new ApplicationError('ERR_VALIDATION', 'Con từ đủ 7 tuổi cần cùng xác nhận đồng ý ghi hình');
    }
    const existing = await this.activeConsent(this.market.database, booking);
    if (!existing) {
      await this.market.database
        .insertInto('market_recording_consents')
        .values({
          parent_account_id: account.id,
          child_id: booking.child_id,
          tutor_account_id: booking.tutor_account_id,
          child_confirmed: childConfirmed,
          consented_at: this.market.now(),
        })
        .execute();
      await this.market.audit({
        actorType: 'account',
        actorId: account.id,
        action: 'recording.consent',
        target: booking.child_id,
        details: { tutor: booking.tutor_account_id, child_confirmed: childConfirmed },
      });
    }
    return this.parentRoom(request, id);
  }

  async consents(request: Request) {
    const account = await this.accounts.requireReady(request, 'parent');
    const rows = await this.market.database
      .selectFrom('market_recording_consents')
      .innerJoin('market_children', 'market_children.id', 'market_recording_consents.child_id')
      .innerJoin('market_accounts as tutor', 'tutor.id', 'market_recording_consents.tutor_account_id')
      .select([
        'market_recording_consents.id',
        'market_recording_consents.child_id',
        'market_children.display_name as child_name',
        'tutor.display_name as tutor_name',
        'market_recording_consents.child_confirmed',
        'market_recording_consents.consented_at',
      ])
      .where('market_recording_consents.parent_account_id', '=', account.id)
      .where('market_recording_consents.withdrawn_at', 'is', null)
      .orderBy('market_recording_consents.consented_at', 'desc')
      .execute();
    return { consents: rows };
  }

  // Rút đồng ý: buổi sau với gia sư đó phải đồng ý lại mới vào được phòng; buổi đang diễn ra không bị cắt ngang
  async withdrawConsent(request: Request, consentId: string) {
    const account = await this.accounts.requireReady(request, 'parent');
    if (!UUID.test(consentId)) throw marketNotFound();
    const updated = await this.market.database
      .updateTable('market_recording_consents')
      .set({ withdrawn_at: this.market.now() })
      .where('id', '=', consentId)
      .where('parent_account_id', '=', account.id)
      .where('withdrawn_at', 'is', null)
      .returning('child_id')
      .executeTakeFirst();
    if (!updated) throw marketNotFound();
    await this.market.audit({
      actorType: 'account',
      actorId: account.id,
      action: 'recording.consent-withdraw',
      target: updated.child_id,
    });
    return this.consents(request);
  }

  // Vào phòng chờ (hoặc vào phòng khi đã được cho vào): `as` là `student` (con học trên máy này) hoặc `guardian` (phụ huynh vào xem)
  async enter(request: Request, id: string, body: RequestBody) {
    const account = await this.accounts.requireReady(request, 'parent');
    const booking = await this.bookingOf(account, id);
    const role: MarketRoomRole = body?.as === 'guardian' ? 'guardian' : 'student';
    const timings = await this.timings();
    const now = this.market.now();
    if (booking.status !== 'paid' || !roomWindowOpen(booking.starts_at, booking.minutes, now, timings)) {
      throw new ApplicationError(
        'ERR_CONFLICT',
        `Phòng chỉ mở cho buổi đã trả tiền, từ ${timings.opensBeforeMinutes} phút trước giờ học đến hết giờ`,
      );
    }
    if (booking.recording_required && !(await this.activeConsent(this.market.database, booking))) {
      throw new ApplicationError('ERR_CONFLICT', 'Cần đồng ý ghi hình trước khi vào phòng');
    }
    const identity = roomIdentity(role, account.id);
    const displayName = role === 'student' ? booking.child_name : `${account.display_name} (cha mẹ)`;
    const participant = await this.market.database
      .insertInto('market_session_participants')
      .values({ booking_id: booking.id, identity, account_id: account.id, role, display_name: displayName })
      .onConflict((conflict) => conflict.columns(['booking_id', 'identity']).doUpdateSet({ display_name: displayName }))
      .returningAll()
      .executeTakeFirstOrThrow();
    if (participant.removed_at) {
      throw new ApplicationError('ERR_FORBIDDEN', 'Gia sư đã mời ra khỏi phòng');
    }
    const room = await this.roomRow(this.market.database, booking.id);
    const base = {
      room_id: marketRoomName(booking.id),
      title: `${booking.subject} · ${booking.child_name}`,
      role,
      identity,
    };
    if (!room || room.closed_at) {
      return { ...base, status: 'waiting' as const, tutor_opened: false, closed: Boolean(room?.closed_at) };
    }
    const recording = await this.recordingOn(booking.id);
    if (booking.recording_required && !recording) {
      return { ...base, status: 'waiting' as const, tutor_opened: true, closed: false };
    }
    if (!participant.admitted_at) {
      return { ...base, status: 'waiting' as const, tutor_opened: true, closed: false };
    }
    const video = this.requireVideo();
    const token = await video.issueToken({
      roomName: marketRoomName(booking.id),
      identity,
      displayName,
      grants: this.grantsOf(participant),
    });
    await this.openInterval(this.market.database, booking.id, identity, role, now);
    return this.joinInfo(booking, participant, token, recording);
  }

  async leave(request: Request, id: string, body: RequestBody) {
    const account = await this.accounts.requireReady(request, 'parent');
    const booking = await this.bookingOf(account, id);
    const role: MarketRoomRole = body?.as === 'guardian' ? 'guardian' : 'student';
    await this.closeIntervals(this.market.database, booking.id, this.market.now(), roomIdentity(role, account.id));
    return { left: true };
  }

  // Gia sư vắng: chưa vào phòng quá mốc sau giờ học; buổi hủy, phụ huynh được hoàn đủ như khi gia sư hủy
  async reportNoShow(request: Request, id: string) {
    const account = await this.accounts.requireReady(request, 'parent');
    const booking = await this.bookingOf(account, id);
    const timings = await this.timings();
    const room = await this.roomRow(this.market.database, booking.id);
    if (
      booking.status !== 'paid' ||
      !tutorNoShowAllowed(booking.starts_at, booking.minutes, this.market.now(), Boolean(room), timings)
    ) {
      throw new ApplicationError(
        'ERR_CONFLICT',
        `Chỉ báo gia sư vắng khi gia sư chưa vào phòng quá ${timings.tutorNoShowMinutes} phút sau giờ học`,
      );
    }
    await this.market.audit({ actorType: 'account', actorId: account.id, action: 'booking.tutor-no-show', target: id });
    return this.bookings.cancelForTutorNoShow(booking.id, account.id);
  }

  // Phụ huynh không đồng ý ghi hình buổi có trẻ vị thành niên: buổi hủy, hoàn đủ (quyết định của Eric ngày 2026-10-29)
  async declineRecording(request: Request, id: string) {
    const account = await this.accounts.requireReady(request, 'parent');
    const booking = await this.bookingOf(account, id);
    if (booking.status !== 'paid' || !booking.recording_required) {
      throw new ApplicationError('ERR_CONFLICT', 'Chỉ áp dụng cho buổi đã trả tiền, có ghi hình bắt buộc');
    }
    await this.market.audit({ actorType: 'account', actorId: account.id, action: 'recording.decline', target: id });
    return this.bookings.cancelForRecordingDeclined(booking.id, account.id);
  }

  // ---------- Phía gia sư

  // Gia sư mở phòng (gọi từ `session/start` của 27i sau khi bắt đầu ghi hình): ghi phòng đã mở, gia sư là chủ phòng đã vào
  async opened(booking: Booking, tutor: MarketAccount) {
    const now = this.market.now();
    const identity = roomIdentity('host', tutor.id);
    const participant = await this.market.database.transaction().execute(async (trx) => {
      await trx
        .insertInto('market_session_rooms')
        .values({ booking_id: booking.id, opened_at: now })
        .onConflict((conflict) => conflict.column('booking_id').doUpdateSet({ closed_at: null }))
        .execute();
      const row = await trx
        .insertInto('market_session_participants')
        .values({
          booking_id: booking.id,
          identity,
          account_id: tutor.id,
          role: 'host',
          display_name: tutor.display_name,
          admitted_at: now,
          can_speak: true,
          can_share: true,
        })
        .onConflict((conflict) => conflict.columns(['booking_id', 'identity']).doUpdateSet({ removed_at: null }))
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.openInterval(trx, booking.id, identity, 'host', now);
      return row;
    });
    return participant;
  }

  hostJoinInfo(booking: Booking, participant: Participant, token: string, recording: boolean) {
    return this.joinInfo(booking, participant, token, recording);
  }

  // Gia sư kết thúc phòng (gọi từ `session/end` của 27i): đóng phòng, đóng mọi khoảng có mặt còn mở
  async closed(bookingId: string) {
    const now = this.market.now();
    await this.market.database.transaction().execute(async (trx) => {
      await trx
        .updateTable('market_session_rooms')
        .set({ closed_at: now })
        .where('booking_id', '=', bookingId)
        .where('closed_at', 'is', null)
        .execute();
      await this.closeIntervals(trx, bookingId, now);
    });
  }

  async tutorRoom(request: Request, id: string) {
    const account = await this.accounts.requireReady(request, 'tutor');
    const booking = await this.bookingOf(account, id);
    const timings = await this.timings();
    const now = this.market.now();
    const [room, consent, participants] = await Promise.all([
      this.roomRow(this.market.database, booking.id),
      this.activeConsent(this.market.database, booking),
      this.market.database
        .selectFrom('market_session_participants')
        .select([
          'identity',
          'role',
          'display_name',
          'requested_at',
          'admitted_at',
          'removed_at',
          'can_speak',
          'can_share',
        ])
        .where('booking_id', '=', booking.id)
        .orderBy('requested_at')
        .execute(),
    ]);
    const until = room?.closed_at ?? now;
    return {
      booking_id: booking.id,
      subject: booking.subject,
      child_name: booking.child_name,
      grade: booking.grade,
      status: booking.status,
      starts_at: booking.starts_at,
      ends_at: sessionEndsAt(booking.starts_at, booking.minutes),
      opens_at: roomOpensAt(booking.starts_at, timings),
      window_open: roomWindowOpen(booking.starts_at, booking.minutes, now, timings),
      recording_required: booking.recording_required,
      consent_given: Boolean(consent),
      no_assignment_attested: booking.no_assignment_attested,
      opened: Boolean(room),
      closed: Boolean(room?.closed_at),
      recording: await this.recordingOn(booking.id),
      participants: participants.filter((row) => row.role !== 'host'),
      attendance: room ? await this.attendance(booking, until, timings) : [],
      confirmed: room?.confirmed_at ? { at: room.confirmed_at, by: room.confirmed_by } : null,
      auto_confirm_at: new Date(
        sessionEndsAt(booking.starts_at, booking.minutes).getTime() + timings.autoConfirmHours * 3_600_000,
      ),
    };
  }

  // Gia sư cho vào, cho nói, cho chia sẻ màn hình, mời ra một người của buổi
  async updateParticipant(request: Request, id: string, identity: string, body: RequestBody) {
    const account = await this.accounts.requireReady(request, 'tutor');
    const booking = await this.bookingOf(account, id);
    const parsed = parseRoomIdentity(identity);
    if (!parsed || parsed.role === 'host') throw marketNotFound();
    const participant = await this.market.database
      .selectFrom('market_session_participants')
      .selectAll()
      .where('booking_id', '=', booking.id)
      .where('identity', '=', identity)
      .executeTakeFirst();
    if (!participant) throw marketNotFound();
    const now = this.market.now();
    const changes: Partial<{
      admitted_at: Date;
      removed_at: Date | null;
      can_speak: boolean;
      can_share: boolean;
    }> = {};
    if (body?.admit === true && !participant.admitted_at) changes.admitted_at = now;
    if (typeof body?.can_speak === 'boolean') changes.can_speak = body.can_speak;
    if (typeof body?.can_share === 'boolean' && participant.role === 'student') changes.can_share = body.can_share;
    if (body?.remove === true) changes.removed_at = now;
    if (body?.readmit === true) changes.removed_at = null;
    const updated = await this.market.database
      .updateTable('market_session_participants')
      .set(changes)
      .where('id', '=', participant.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    const video = this.video;
    if (video && updated.admitted_at && !updated.removed_at && ('can_speak' in changes || 'can_share' in changes)) {
      await video
        .updatePermissions(marketRoomName(booking.id), identity, this.grantsOf(updated))
        .catch(() => undefined);
    }
    if (body?.remove === true) {
      await video?.removeParticipant(marketRoomName(booking.id), identity).catch(() => undefined);
      await this.closeIntervals(this.market.database, booking.id, now, identity);
    }
    await this.market.audit({
      actorType: 'account',
      actorId: account.id,
      action: 'room.participant',
      target: booking.id,
      details: { identity, ...changes },
    });
    return this.tutorRoom(request, id);
  }

  // Gia sư xác nhận đã dạy, kèm nhận xét gửi phụ huynh và sự cố trong buổi
  async confirm(request: Request, id: string, body: RequestBody) {
    const account = await this.accounts.requireReady(request, 'tutor');
    const booking = await this.bookingOf(account, id);
    const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 2000) : '';
    const incident = INCIDENTS.find((value) => value === body?.incident) ?? 'none';
    await this.bookings.complete(request, booking.id);
    await this.market.database
      .insertInto('market_session_rooms')
      // Gia sư chưa mở phòng (dạy bù ngoài phòng, mạng hỏng) vẫn xác nhận được: dòng phòng ghi theo giờ học của buổi
      .values({
        booking_id: booking.id,
        opened_at: booking.starts_at,
        closed_at: sessionEndsAt(booking.starts_at, booking.minutes),
        confirmed_at: this.market.now(),
        confirmed_by: 'tutor',
        tutor_note: note || null,
        incident,
      })
      .onConflict((conflict) =>
        conflict.column('booking_id').doUpdateSet({
          confirmed_at: this.market.now(),
          confirmed_by: 'tutor',
          tutor_note: note || null,
          incident,
        }),
      )
      .execute();
    return this.tutorRoom(request, id);
  }

  // Dịch vụ an toàn trẻ em đăng ký cách xử lý bản ghi đã ghi xong (mã hóa, lưu); đăng ký thay vì nhận vào hàm dựng để không phụ thuộc
  // vòng giữa hai dịch vụ (YCTD-379)
  private recordingEndedHandler: ((recording: RecordingResult, at: Date) => Promise<boolean>) | null = null;

  onRecordingEnded(handler: (recording: RecordingResult, at: Date) => Promise<boolean>): void {
    this.recordingEndedHandler = handler;
  }

  // ---------- Sự kiện của máy chủ video (vào, ra phòng, ghi xong của chợ); gọi từ VideoWebhookController
  async handleEvent(event: VideoRoomEvent): Promise<{ handled: boolean }> {
    if (!this.market.available || !event.roomName.startsWith(MARKET_ROOM_PREFIX)) {
      return { handled: false };
    }
    if (event.kind === 'recording_ended') {
      if (!event.recording || !this.recordingEndedHandler) return { handled: false };
      return { handled: await this.recordingEndedHandler(event.recording, event.at) };
    }
    if (!event.identity) {
      return { handled: false };
    }
    const bookingId = event.roomName.slice(MARKET_ROOM_PREFIX.length);
    const parsed = parseRoomIdentity(event.identity);
    if (!UUID.test(bookingId) || !parsed) return { handled: false };
    if (event.kind === 'join') {
      await this.openInterval(this.market.database, bookingId, event.identity, parsed.role, event.at);
      await this.market.database
        .updateTable('market_session_attendance')
        .set({ source: 'webhook' })
        .where('booking_id', '=', bookingId)
        .where('identity', '=', event.identity)
        .where('left_at', 'is', null)
        .execute();
      return { handled: true };
    }
    if (event.kind === 'leave') {
      await this.closeIntervals(this.market.database, bookingId, event.at, event.identity);
      return { handled: true };
    }
    return { handled: false };
  }
}

@Controller('market')
@PublicEndpoint()
export class MarketRoomsController {
  constructor(private readonly rooms: MarketRoomsService) {}

  @Get('bookings/:id/room')
  parentRoom(@Req() request: Request, @Param('id') id: string) {
    return this.rooms.parentRoom(request, id);
  }

  @Post('bookings/:id/room/consent')
  @HttpCode(200)
  consent(@Req() request: Request, @Param('id') id: string, @Body() body: RequestBody) {
    return this.rooms.consent(request, id, body);
  }

  @Post('bookings/:id/room/enter')
  @HttpCode(200)
  enter(@Req() request: Request, @Param('id') id: string, @Body() body: RequestBody) {
    return this.rooms.enter(request, id, body);
  }

  @Post('bookings/:id/room/leave')
  @HttpCode(200)
  leave(@Req() request: Request, @Param('id') id: string, @Body() body: RequestBody) {
    return this.rooms.leave(request, id, body);
  }

  @Post('bookings/:id/room/decline-recording')
  @HttpCode(200)
  decline(@Req() request: Request, @Param('id') id: string) {
    return this.rooms.declineRecording(request, id);
  }

  @Post('bookings/:id/tutor-no-show')
  @HttpCode(200)
  noShow(@Req() request: Request, @Param('id') id: string) {
    return this.rooms.reportNoShow(request, id);
  }

  @Get('recording-consents')
  consents(@Req() request: Request) {
    return this.rooms.consents(request);
  }

  @Post('recording-consents/:id/withdraw')
  @HttpCode(200)
  withdraw(@Req() request: Request, @Param('id') id: string) {
    return this.rooms.withdrawConsent(request, id);
  }

  @Get('tutor/bookings/:id/room')
  tutorRoom(@Req() request: Request, @Param('id') id: string) {
    return this.rooms.tutorRoom(request, id);
  }

  @Post('tutor/bookings/:id/room/participants/:identity')
  @HttpCode(200)
  participant(
    @Req() request: Request,
    @Param('id') id: string,
    @Param('identity') identity: string,
    @Body() body: RequestBody,
  ) {
    return this.rooms.updateParticipant(request, id, identity, body);
  }

  @Post('tutor/bookings/:id/room/confirm')
  @HttpCode(200)
  confirm(@Req() request: Request, @Param('id') id: string, @Body() body: RequestBody) {
    return this.rooms.confirm(request, id, body);
  }
}
