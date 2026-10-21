-- Late arrival rules: reason asked at punch-in, half day (as leave) when late by the shift's threshold.

-- AlterTable
ALTER TABLE "AttendanceDay" ADD COLUMN     "lateHalfDay" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lateReason" TEXT,
ADD COLUMN     "lateReasonAt" TIMESTAMP(3);

-- AlterTable (existing tenants: the late half-day → leave rule applies from the day this ships, never to older days)
ALTER TABLE "AttendancePolicy" ADD COLUMN     "lateHalfDayAsLeave" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "lateHalfDayLeaveFrom" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "lateReasonRequired" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "LeaveRequest" ADD COLUMN     "autoReason" TEXT;
