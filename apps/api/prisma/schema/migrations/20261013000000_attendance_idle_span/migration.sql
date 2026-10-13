-- CreateTable
CREATE TABLE "AttendanceIdleSpan" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "attendanceDate" DATE NOT NULL,
    "sessionId" TEXT,
    "clientId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceIdleSpan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceIdleSpan_clientId_key" ON "AttendanceIdleSpan"("clientId");

-- CreateIndex
CREATE INDEX "AttendanceIdleSpan_tenantId_employeeId_attendanceDate_idx" ON "AttendanceIdleSpan"("tenantId", "employeeId", "attendanceDate");
