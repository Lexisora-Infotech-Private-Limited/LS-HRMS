import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  approveDeviceSchema,
  deviceHrDecisionSchema,
  devicePairDecisionSchema,
  deviceRevokeSchema,
  devicesQuery,
  type ApproveDeviceInput,
  type DevicePairDecisionInput,
  type DeviceRevokeInput,
  type DevicesQuery,
} from '@lexisora/shared';
import type { z } from 'zod';
import { RequirePerm } from '../../core/auth/decorators';
import { ZodPipe } from '../../core/http/zod.pipe';
import { DevicesService } from './devices.service';
import { UserSessionGuard } from './tracker.guards';

/**
 * Web side of device management:
 *   Profile → Devices (own devices, "Pair device" with the 6-digit code, revoke)
 *   /devices admin (HR: all devices, AWAITING_HR approvals, revoke with reason)
 */
@UseGuards(UserSessionGuard)
@Controller('devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Get('me')
  mine() {
    return this.devices.myDevices();
  }

  /** Preview the pairing request behind a code (hostname, OS, version, permissions). */
  @Post('lookup')
  @HttpCode(200)
  lookup(@Body(new ZodPipe(approveDeviceSchema)) dto: ApproveDeviceInput) {
    return this.devices.lookup(dto.code);
  }

  /** Owner approves (or rejects) the device showing this code. */
  @Post('approve')
  @HttpCode(200)
  approve(@Body(new ZodPipe(devicePairDecisionSchema)) dto: DevicePairDecisionInput) {
    return this.devices.approveByCode(dto.code, dto.decision);
  }

  @Post(':id/revoke')
  @HttpCode(200)
  revoke(@Param('id') id: string, @Body(new ZodPipe(deviceRevokeSchema)) dto: DeviceRevokeInput) {
    return this.devices.revoke(id, dto.reason);
  }

  @Get('employee/:employeeId')
  employeeDevices(@Param('employeeId') employeeId: string) {
    return this.devices.employeeDevices(employeeId);
  }

  @RequirePerm('devices.manage')
  @Get()
  list(@Query(new ZodPipe(devicesQuery)) q: DevicesQuery) {
    return this.devices.adminList(q);
  }

  @RequirePerm('devices.manage')
  @Post(':id/hr-decision')
  @HttpCode(200)
  hrDecision(@Param('id') id: string, @Body(new ZodPipe(deviceHrDecisionSchema)) dto: z.infer<typeof deviceHrDecisionSchema>) {
    return this.devices.hrDecision(id, dto.decision, dto.reason);
  }
}
