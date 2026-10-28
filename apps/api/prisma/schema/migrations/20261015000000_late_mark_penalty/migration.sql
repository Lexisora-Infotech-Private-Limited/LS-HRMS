-- AlterTable
ALTER TABLE "AttendancePolicy" ALTER COLUMN "lateMarksPerPenalty" SET DEFAULT 1;

-- AlterTable
ALTER TABLE "PayrollItem" ADD COLUMN     "lateMarks" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "latePenaltyLeaveDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "latePenaltyLopDays" DOUBLE PRECISION NOT NULL DEFAULT 0;
