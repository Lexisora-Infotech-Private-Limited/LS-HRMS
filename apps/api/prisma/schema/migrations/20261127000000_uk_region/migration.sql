-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "bankSortCode" TEXT,
ADD COLUMN     "niNumberEnc" TEXT,
ADD COLUMN     "niNumberLast4" TEXT;

-- AlterTable
ALTER TABLE "EmployeePayrollProfile" ADD COLUMN     "ukProfile" JSONB;

-- AlterTable
ALTER TABLE "PayrollItem" ADD COLUMN     "ukStatutory" JSONB;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "region" TEXT NOT NULL DEFAULT 'IN';

-- AlterTable
ALTER TABLE "WorkLocation" ADD COLUMN     "ukNation" TEXT;

-- CreateTable
CREATE TABLE "RightToWorkCheck" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "shareCode" TEXT,
    "result" TEXT NOT NULL,
    "permissionExpiresOn" DATE,
    "followUpOn" DATE,
    "checkedOn" DATE NOT NULL,
    "checkedById" TEXT,
    "evidenceFileId" TEXT,
    "sponsored" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RightToWorkCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RightToWorkCheck_tenantId_employeeId_idx" ON "RightToWorkCheck"("tenantId", "employeeId");

-- CreateIndex
CREATE INDEX "RightToWorkCheck_tenantId_followUpOn_idx" ON "RightToWorkCheck"("tenantId", "followUpOn");

