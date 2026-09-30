import { Module } from '@nestjs/common';
import { CrossReader } from './cross';
import { TIME_CONTROLLERS } from './time.controllers';
import { TimeRegistry } from './time.registry';
import { ApprovalService } from './services/approval.service';
import { AttendanceService } from './services/attendance.service';
import { BiometricService } from './services/biometric.service';
import { IdCheckService } from './services/idcheck.service';
import { MastersService } from './services/masters.service';
import { PeriodLockService } from './services/period-lock.service';
import { PolicyService } from './services/policy.service';
import { RegularizationService } from './services/regularization.service';
import { TimesheetService } from './services/timesheet.service';

/**
 * Time domain: attendance (punch, day computation, biometric), shifts, locations, policy,
 * holidays, ID compliance, regularizations, period locks, timesheets + 2-level approvals.
 * Exports AttendanceService (tracker: desktop punches) and PeriodLockService (leavepay).
 */
@Module({
  controllers: TIME_CONTROLLERS,
  providers: [
    CrossReader,
    PolicyService,
    PeriodLockService,
    AttendanceService,
    MastersService,
    IdCheckService,
    RegularizationService,
    BiometricService,
    TimesheetService,
    ApprovalService,
    TimeRegistry,
  ],
  exports: [AttendanceService, PeriodLockService, PolicyService, TimesheetService],
})
export class TimeModule {}
