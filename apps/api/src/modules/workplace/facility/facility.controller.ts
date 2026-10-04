import { Body, Controller, Get, Headers, Ip, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import QRCode from 'qrcode';
import { z } from 'zod';
import {
  availabilityQuery,
  bookingCheckQuery,
  bookingCreateSchema,
  bookingUpdateSchema,
  facilityListQuery,
  roomUpsertSchema,
  visitorCreateSchema,
  visitorLookupSchema,
  wpCancelSchema,
  type BookingCreateInput,
  type VisitorCreateInput,
} from '@lexisora/shared';
import { Public, RequirePerm } from '../../../core/auth/decorators';
import { ZodPipe } from '../../../core/http/zod.pipe';
import { AppError, notFound } from '../../../core/http/errors';
import { rateLimiter } from '../common/http';
import { FacilityService, passUrlFor } from './facility.service';

const roomsQuery = z.object({ all: z.enum(['0', '1', 'true', 'false']).optional().transform((v) => v === '1' || v === 'true') });
const passLimit = rateLimiter(30, 60_000);

/** Rooms & visitors — /facility (spec §8.4). */
@Controller('facility')
export class FacilityController {
  constructor(private readonly facility: FacilityService) {}

  @Get()
  @RequirePerm('facility.use', 'facility.manage')
  list(@Query(new ZodPipe(facilityListQuery)) q: z.infer<typeof facilityListQuery>) {
    return this.facility.list(q);
  }

  @Get('rooms')
  @RequirePerm('facility.use', 'facility.manage')
  rooms(@Query(new ZodPipe(roomsQuery)) q: z.infer<typeof roomsQuery>) {
    return this.facility.rooms(q.all);
  }

  @Post('rooms')
  @RequirePerm('facility.manage')
  createRoom(@Body(new ZodPipe(roomUpsertSchema)) dto: z.infer<typeof roomUpsertSchema>) {
    return this.facility.upsertRoom(null, dto);
  }

  @Patch('rooms/:id')
  @RequirePerm('facility.manage')
  updateRoom(@Param('id') id: string, @Body(new ZodPipe(roomUpsertSchema)) dto: z.infer<typeof roomUpsertSchema>) {
    return this.facility.upsertRoom(id, dto);
  }

  @Get('rooms/availability')
  @RequirePerm('facility.use', 'facility.manage')
  availability(@Query(new ZodPipe(availabilityQuery)) q: z.infer<typeof availabilityQuery>) {
    return this.facility.availability(q.date);
  }

  @Get('bookings/check')
  @RequirePerm('facility.use', 'facility.manage')
  check(@Query(new ZodPipe(bookingCheckQuery)) q: z.infer<typeof bookingCheckQuery>) {
    return this.facility.check(q);
  }

  @Post('bookings')
  @RequirePerm('facility.use', 'facility.manage')
  book(@Body(new ZodPipe(bookingCreateSchema)) dto: BookingCreateInput) {
    return this.facility.book(dto);
  }

  @Patch('bookings/:id')
  @RequirePerm('facility.use', 'facility.manage')
  updateBooking(@Param('id') id: string, @Body(new ZodPipe(bookingUpdateSchema)) dto: z.infer<typeof bookingUpdateSchema>) {
    return this.facility.updateBooking(id, dto);
  }

  @Post('bookings/:id/cancel')
  @RequirePerm('facility.use', 'facility.manage')
  cancelBooking(@Param('id') id: string, @Body(new ZodPipe(wpCancelSchema)) dto: z.infer<typeof wpCancelSchema>) {
    return this.facility.cancelBooking(id, dto.reason);
  }

  @Post('visitors')
  @RequirePerm('facility.use', 'facility.manage')
  register(@Body(new ZodPipe(visitorCreateSchema)) dto: VisitorCreateInput) {
    return this.facility.registerVisitor(dto);
  }

  @Post('visitors/:id/resend-pass')
  @RequirePerm('facility.use', 'facility.manage')
  resend(@Param('id') id: string) {
    return this.facility.resendPass(id);
  }

  @Post('visitors/:id/cancel')
  @RequirePerm('facility.use', 'facility.manage')
  cancelVisitor(@Param('id') id: string, @Body(new ZodPipe(wpCancelSchema)) dto: z.infer<typeof wpCancelSchema>) {
    return this.facility.cancelVisitor(id, dto.reason);
  }

  // ── Front desk (facility.manage) ────────────────────────────────────────
  @Get('frontdesk')
  @RequirePerm('facility.manage')
  frontDesk() {
    return this.facility.frontDesk();
  }

  @Post('visitors/lookup')
  @RequirePerm('facility.manage')
  lookup(@Body(new ZodPipe(visitorLookupSchema)) dto: z.infer<typeof visitorLookupSchema>) {
    return this.facility.lookup(dto.code);
  }

  @Post('visitors/:id/check-in')
  @RequirePerm('facility.manage')
  checkIn(@Param('id') id: string) {
    return this.facility.checkIn(id);
  }

  @Post('visitors/:id/check-out')
  @RequirePerm('facility.manage')
  checkOut(@Param('id') id: string) {
    return this.facility.checkOut(id);
  }
}

/** Public e-pass page (the QR target): HTML for browsers, JSON for `Accept: application/json`. Never returns phone or email. */
@Controller('facility/pass')
export class FacilityPassController {
  constructor(private readonly facility: FacilityService) {}

  @Public()
  @Get(':token')
  async pass(@Param('token') token: string, @Ip() ip: string, @Res() res: Response, @Headers('accept') accept?: string) {
    if (!passLimit(ip ?? 'unknown')) throw new AppError(429, 'RATE_LIMITED', 'Too many requests — try again in a minute');
    const p = await this.facility.publicPass(token);
    if (!p) throw notFound('Pass');
    res.setHeader('Cache-Control', 'no-store');
    if ((accept ?? '').includes('application/json')) res.json(p.json);
    else res.type('html').send(p.html);
  }

  @Public()
  @Get(':token/qr.png')
  async qr(@Param('token') token: string, @Ip() ip: string, @Res() res: Response) {
    if (!passLimit(ip ?? 'unknown')) throw new AppError(429, 'RATE_LIMITED', 'Too many requests — try again in a minute');
    const p = await this.facility.publicPass(token);
    if (!p || !p.json.valid) throw notFound('Pass');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.send(await QRCode.toBuffer(passUrlFor(token), { type: 'png', margin: 1, width: 360 }));
  }
}
