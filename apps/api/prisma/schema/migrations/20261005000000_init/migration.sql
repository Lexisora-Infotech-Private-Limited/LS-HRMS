-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'FREE_TIER', 'PAYMENT_DUE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "TenantIsolation" AS ENUM ('SHARED', 'DEDICATED');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('INVITED', 'ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('FULL_TIME', 'INTERN', 'CONTRACT');

-- CreateEnum
CREATE TYPE "WorkMode" AS ENUM ('OFFICE', 'REMOTE', 'HYBRID');

-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('ONBOARDING', 'ACTIVE', 'NOTICE_PERIOD', 'EXITED');

-- CreateEnum
CREATE TYPE "TaxRegime" AS ENUM ('OLD', 'NEW');

-- CreateEnum
CREATE TYPE "FinAccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "FinVoucherType" AS ENUM ('PAYMENT', 'RECEIPT', 'JOURNAL', 'HR', 'SALES', 'PURCHASE', 'CREDIT_NOTE', 'PAYROLL');

-- CreateEnum
CREATE TYPE "FinVoucherSource" AS ENUM ('MANUAL', 'INVOICE', 'INVOICE_PAYMENT', 'PURCHASE', 'CREDIT_NOTE', 'PAYROLL_RUN', 'REVERSAL');

-- CreateEnum
CREATE TYPE "FinInvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'EMAILED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FinSupplyType" AS ENUM ('INTRA', 'INTER');

-- CreateEnum
CREATE TYPE "FinGstSource" AS ENUM ('OCR', 'ESTIMATED', 'MANUAL');

-- CreateEnum
CREATE TYPE "LeaveRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'CANCELLATION_PENDING', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LeaveAccrualFrequency" AS ENUM ('YEARLY', 'MONTHLY', 'QUARTERLY', 'ON_APPROVAL', 'NONE');

-- CreateEnum
CREATE TYPE "LeaveLedgerTx" AS ENUM ('OPENING', 'ACCRUAL', 'PRORATED_ACCRUAL', 'MANUAL_CREDIT', 'MANUAL_DEBIT', 'COMP_OFF_GRANT', 'AVAIL', 'AVAIL_REVERSAL', 'CARRY_FORWARD_IN', 'CARRY_FORWARD_OUT', 'LAPSE', 'EXPIRY', 'ENCASHMENT');

-- CreateEnum
CREATE TYPE "LeaveCreditBatchType" AS ENUM ('ANNUAL', 'MONTHLY', 'QUARTERLY', 'JOINING_PRORATION', 'YEAR_END', 'MANUAL');

-- CreateEnum
CREATE TYPE "LeaveBatchStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "CompOffStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'PARTIALLY_USED', 'USED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PayrollPayType" AS ENUM ('SALARY', 'STIPEND');

-- CreateEnum
CREATE TYPE "PayrollRunStatus" AS ENUM ('DRAFT', 'CALCULATING', 'CALCULATED', 'FINALIZED', 'PAID', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "PayrollItemStatus" AS ENUM ('READY', 'TIMESHEET_PENDING', 'EXCLUDED', 'ON_HOLD', 'ERROR', 'STALE', 'FINALIZED', 'PAID');

-- CreateEnum
CREATE TYPE "PeopleDocCategory" AS ENUM ('OFFER_COMPENSATION', 'GOVERNMENT_ID', 'EDUCATION', 'EMPLOYMENT', 'LEGAL', 'BANK_TAX', 'CAREER', 'EXIT', 'CERTIFICATE', 'OTHER');

-- CreateEnum
CREATE TYPE "PeopleDocType" AS ENUM ('OFFER_LETTER', 'NDA', 'COMPENSATION_BREAKDOWN', 'PAN', 'AADHAAR', 'PASSPORT', 'MARKSHEET_10', 'MARKSHEET_12', 'DEGREE', 'PREV_EMPLOYMENT', 'RELIEVING_LETTER', 'EXPERIENCE_LETTER', 'CANCELLED_CHEQUE', 'RESUME', 'POLICY_ACK', 'CERTIFICATE', 'OTHER');

-- CreateEnum
CREATE TYPE "PeopleDocVerification" AS ENUM ('NOT_REQUIRED', 'PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PeopleDocSource" AS ENUM ('SELF_UPLOAD', 'HR_UPLOAD', 'GENERATED', 'ESIGNED', 'RECRUITMENT');

-- CreateEnum
CREATE TYPE "OnboardingStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OnboardingStepStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'DONE', 'NEEDS_ATTENTION', 'SKIPPED');

-- CreateEnum
CREATE TYPE "EsignStatus" AS ENUM ('CREATED', 'SENT', 'VIEWED', 'COMPLETED', 'DECLINED', 'EXPIRED', 'VOIDED');

-- CreateEnum
CREATE TYPE "ExitType" AS ENUM ('RESIGNATION', 'TERMINATION', 'END_OF_INTERNSHIP', 'ABSCONDING', 'RETIREMENT');

-- CreateEnum
CREATE TYPE "ExitCaseStatus" AS ENUM ('OPEN', 'WITHDRAWN', 'COMPLETED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('DRAFT', 'OPEN', 'ON_HOLD', 'CLOSED');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('FULL_TIME', 'INTERNSHIP', 'CONTRACT', 'PART_TIME');

-- CreateEnum
CREATE TYPE "CandidateSource" AS ENUM ('LINKEDIN', 'REFERRAL', 'NAUKRI', 'CAMPUS', 'CAREERS_PAGE', 'AGENCY', 'WALK_IN', 'OTHER');

-- CreateEnum
CREATE TYPE "ApplicationStage" AS ENUM ('SCREENING', 'INTERVIEW', 'OFFERED', 'HIRED', 'REJECTED', 'OFFER_DECLINED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "InterviewMode" AS ENUM ('VIDEO', 'IN_OFFICE', 'PHONE');

-- CreateEnum
CREATE TYPE "InterviewStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "InterviewResult" AS ENUM ('PENDING', 'SELECTED', 'REJECTED', 'ON_HOLD');

-- CreateEnum
CREATE TYPE "JobOfferStatus" AS ENUM ('DRAFT', 'ISSUED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "AppraisalCycleStatus" AS ENUM ('DRAFT', 'SELF_REVIEW', 'MANAGER_REVIEW', 'CALIBRATION', 'CLOSED');

-- CreateEnum
CREATE TYPE "AppraisalReviewStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('IN_STOCK', 'ASSIGNED', 'UNDER_REPAIR', 'RETURNED', 'RETIRED', 'LOST');

-- CreateEnum
CREATE TYPE "AssetCondition" AS ENUM ('NEW', 'GOOD', 'FAIR', 'DAMAGED');

-- CreateEnum
CREATE TYPE "KitStatus" AS ENUM ('PENDING', 'PARTIAL', 'ISSUED', 'VOID');

-- CreateEnum
CREATE TYPE "IdCardStatus" AS ENUM ('QUEUED', 'READY', 'SENT_TO_PRINT', 'PRINTED', 'ISSUED', 'REVOKED', 'REPLACED', 'SURRENDERED', 'VOID');

-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('FREE', 'ACTIVE', 'PENDING_PAYMENT', 'PAST_DUE', 'READ_ONLY', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SupportSeverity" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "SupportStatus" AS ENUM ('OPEN', 'ENGINEER_ASSIGNED', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "PolicyAudience" AS ENUM ('OFFICE', 'REMOTE');

-- CreateEnum
CREATE TYPE "PunchSource" AS ENUM ('BIOMETRIC', 'WEB', 'DESKTOP', 'MOBILE', 'REGULARIZATION', 'SYSTEM');

-- CreateEnum
CREATE TYPE "DayStatus" AS ENUM ('PENDING', 'PRESENT', 'HALF_DAY', 'ABSENT', 'LEAVE', 'HALF_DAY_LEAVE', 'HOLIDAY', 'WEEKLY_OFF', 'HOLIDAY_WORKED', 'WEEKLY_OFF_WORKED', 'MISSED_PUNCH');

-- CreateEnum
CREATE TYPE "TimesheetStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'PENDING_RM', 'APPROVED', 'RETURNED', 'LOCKED');

-- CreateEnum
CREATE TYPE "PunchDirection" AS ENUM ('IN', 'OUT', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PunchStatus" AS ENUM ('ACCEPTED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "RegularizationType" AS ENUM ('MISSED_PUNCH', 'WRONG_TIME', 'WFH_FORGOT', 'ON_DUTY', 'LATE_EXCUSE');

-- CreateEnum
CREATE TYPE "RegularizationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TimesheetStepStatus" AS ENUM ('PENDING', 'APPROVED', 'RETURNED', 'SKIPPED_SELF', 'SKIPPED_DUPLICATE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'ALLOTTED', 'WIP', 'DEV_COMPLETED', 'QA', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProjectHealth" AS ENUM ('NA', 'ON_TRACK', 'AT_RISK', 'OFF_TRACK');

-- CreateEnum
CREATE TYPE "GitSyncStatus" AS ENUM ('NONE', 'PENDING', 'SYNCED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "InternTaskStatus" AS ENUM ('ASSIGNED', 'IN_PROGRESS', 'DONE', 'NOT_DONE');

-- CreateEnum
CREATE TYPE "WpEventKind" AS ENUM ('TOWN_HALL', 'CELEBRATION', 'TRAINING', 'OTHER');

-- CreateEnum
CREATE TYPE "WpNoticeVisibility" AS ENUM ('GLOBAL', 'TEAM');

-- CreateEnum
CREATE TYPE "WpNoticeStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHED', 'EXPIRED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "WpPostKind" AS ENUM ('BLOG', 'MILESTONE', 'UPDATE', 'EOTM', 'KUDOS');

-- CreateEnum
CREATE TYPE "WpPostStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "WpCertificateType" AS ENUM ('EOTM', 'COURSE');

-- CreateEnum
CREATE TYPE "WpCertStatus" AS ENUM ('PENDING', 'READY', 'FAILED', 'REVOKED');

-- CreateEnum
CREATE TYPE "WpChannelKind" AS ENUM ('PUBLIC', 'PRIVATE', 'DM', 'GROUP_DM');

-- CreateEnum
CREATE TYPE "WpPostingPolicy" AS ENUM ('ALL_MEMBERS', 'ADMINS_ONLY');

-- CreateEnum
CREATE TYPE "WpMessageKind" AS ENUM ('USER', 'SYSTEM', 'CALL_SUMMARY');

-- CreateEnum
CREATE TYPE "WpTicketPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "WpTicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WpSlaState" AS ENUM ('ON_TRACK', 'AT_RISK', 'BREACHED', 'MET');

-- CreateEnum
CREATE TYPE "WpCourseCategory" AS ENUM ('REQUIRED', 'OPTIONAL', 'ONBOARDING');

-- CreateEnum
CREATE TYPE "WpCourseStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "WpEnrollStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "WpBookingStatus" AS ENUM ('BOOKED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "WpVisitorStatus" AS ENUM ('REGISTERED', 'PASS_SENT', 'CHECKED_IN', 'CHECKED_OUT', 'NO_SHOW', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WpPolicyStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "WpCameraStatus" AS ENUM ('ONLINE', 'OFFLINE', 'UNKNOWN', 'DISABLED');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "domain" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "isolation" "TenantIsolation" NOT NULL DEFAULT 'SHARED',
    "gstin" TEXT,
    "pan" TEXT,
    "address" TEXT,
    "city" TEXT,
    "stateCode" TEXT,
    "stateName" TEXT,
    "phone" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "brandAccent" TEXT NOT NULL DEFAULT '#b68235',
    "brandAccent2" TEXT NOT NULL DEFAULT '#2d2b2b',
    "brandName" TEXT,
    "logoFileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "permissions" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "name" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "roleId" TEXT NOT NULL,
    "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMP(3),
    "inviteToken" TEXT,
    "inviteExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "client" TEXT NOT NULL DEFAULT 'web',
    "userAgent" TEXT,
    "ip" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "leadEmployeeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Designation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Designation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "empCode" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "officialEmail" TEXT NOT NULL,
    "personalEmail" TEXT,
    "phone" TEXT,
    "photoFileId" TEXT,
    "departmentId" TEXT,
    "designationId" TEXT,
    "branchId" TEXT,
    "managerId" TEXT,
    "employmentType" "EmploymentType" NOT NULL DEFAULT 'FULL_TIME',
    "workMode" "WorkMode" NOT NULL DEFAULT 'OFFICE',
    "workLocationId" TEXT,
    "shiftId" TEXT,
    "status" "EmployeeStatus" NOT NULL DEFAULT 'ONBOARDING',
    "joiningDate" DATE,
    "confirmationDate" DATE,
    "noticeStartDate" DATE,
    "exitDate" DATE,
    "exitReason" TEXT,
    "dateOfBirth" DATE,
    "gender" TEXT,
    "bloodGroup" TEXT,
    "maritalStatus" TEXT,
    "address" TEXT,
    "emergencyContactName" TEXT,
    "emergencyContactPhone" TEXT,
    "panEnc" TEXT,
    "aadhaarEnc" TEXT,
    "aadhaarLast4" TEXT,
    "uan" TEXT,
    "esicNumber" TEXT,
    "bankAccountEnc" TEXT,
    "bankAccountLast4" TEXT,
    "bankIfsc" TEXT,
    "bankName" TEXT,
    "taxRegime" "TaxRegime" NOT NULL DEFAULT 'NEW',
    "tshirtSize" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "fromLabel" TEXT NOT NULL DEFAULT 'System',
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorName" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "meta" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileObject" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "storageKey" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT,
    "category" TEXT NOT NULL,
    "isPrivate" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileObject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NumberSequence" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "period" TEXT NOT NULL DEFAULT '',
    "nextValue" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "NumberSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "FinAccountType" NOT NULL,
    "parentId" TEXT,
    "isGroup" BOOLEAN NOT NULL DEFAULT false,
    "systemKey" TEXT,
    "partyType" TEXT,
    "partyId" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "openingPaise" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Voucher" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "type" "FinVoucherType" NOT NULL,
    "date" DATE NOT NULL,
    "fy" TEXT NOT NULL,
    "narration" TEXT NOT NULL,
    "sourceType" "FinVoucherSource" NOT NULL DEFAULT 'MANUAL',
    "sourceId" TEXT,
    "sourceRef" TEXT,
    "employeeId" TEXT,
    "attachmentFileId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "reversalOfId" TEXT,
    "reversedById" TEXT,
    "totalPaise" INTEGER NOT NULL,
    "postedByUserId" TEXT,
    "postedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Voucher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoucherLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "debitPaise" INTEGER NOT NULL DEFAULT 0,
    "creditPaise" INTEGER NOT NULL DEFAULT 0,
    "narration" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "VoucherLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT,
    "fy" TEXT,
    "clientId" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "projectId" TEXT,
    "projectName" TEXT,
    "period" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "invoiceDate" DATE,
    "dueDate" DATE,
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 15,
    "placeOfSupply" TEXT,
    "supplyType" "FinSupplyType" NOT NULL,
    "gstRateBp" INTEGER NOT NULL DEFAULT 1800,
    "taxOverrideReason" TEXT,
    "sellerSnapshot" JSONB,
    "buyerSnapshot" JSONB NOT NULL,
    "minutes" INTEGER NOT NULL,
    "sourceMinutes" INTEGER NOT NULL DEFAULT 0,
    "adjustmentNote" TEXT,
    "ratePaise" INTEGER NOT NULL,
    "subtotalPaise" INTEGER NOT NULL,
    "cgstPaise" INTEGER NOT NULL DEFAULT 0,
    "sgstPaise" INTEGER NOT NULL DEFAULT 0,
    "igstPaise" INTEGER NOT NULL DEFAULT 0,
    "roundOffPaise" INTEGER NOT NULL DEFAULT 0,
    "totalPaise" INTEGER NOT NULL,
    "receivedPaise" INTEGER NOT NULL DEFAULT 0,
    "tdsPaise" INTEGER NOT NULL DEFAULT 0,
    "balancePaise" INTEGER NOT NULL,
    "status" "FinInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "emailTo" TEXT[],
    "emailCc" TEXT[],
    "emailedAt" TIMESTAMP(3),
    "lastEmailError" TEXT,
    "paidAt" TIMESTAMP(3),
    "pdfFileId" TEXT,
    "salesVoucherId" TEXT,
    "notes" TEXT,
    "createdByUserId" TEXT,
    "issuedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL,
    "sac" TEXT NOT NULL DEFAULT '998314',
    "minutes" INTEGER NOT NULL,
    "ratePaise" INTEGER NOT NULL,
    "taxablePaise" INTEGER NOT NULL,
    "gstRateBp" INTEGER NOT NULL DEFAULT 1800,
    "cgstPaise" INTEGER NOT NULL DEFAULT 0,
    "sgstPaise" INTEGER NOT NULL DEFAULT 0,
    "igstPaise" INTEGER NOT NULL DEFAULT 0,
    "lineTotalPaise" INTEGER NOT NULL,
    "projectId" TEXT,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceTimeEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "invoiceLineId" TEXT NOT NULL,
    "timesheetCellId" TEXT NOT NULL,
    "employeeId" TEXT,
    "taskId" TEXT,
    "date" DATE NOT NULL,
    "minutes" INTEGER NOT NULL,

    CONSTRAINT "InvoiceTimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoicePayment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "tdsPaise" INTEGER NOT NULL DEFAULT 0,
    "mode" TEXT NOT NULL DEFAULT 'BANK',
    "reference" TEXT,
    "voucherId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoicePayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceCreditNote" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "subtotalPaise" INTEGER NOT NULL,
    "cgstPaise" INTEGER NOT NULL DEFAULT 0,
    "sgstPaise" INTEGER NOT NULL DEFAULT 0,
    "igstPaise" INTEGER NOT NULL DEFAULT 0,
    "roundOffPaise" INTEGER NOT NULL DEFAULT 0,
    "totalPaise" INTEGER NOT NULL,
    "voucherId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceCreditNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gstin" TEXT,
    "pan" TEXT,
    "stateCode" TEXT,
    "email" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseCategory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "defaultGstRateBp" INTEGER NOT NULL DEFAULT 1800,
    "itcEligibleDefault" BOOLEAN NOT NULL DEFAULT true,
    "createsAsset" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PurchaseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "vendorInvoiceNo" TEXT NOT NULL,
    "billDate" DATE NOT NULL,
    "fy" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "taxablePaise" INTEGER NOT NULL,
    "gstRateBp" INTEGER NOT NULL DEFAULT 1800,
    "cgstPaise" INTEGER NOT NULL DEFAULT 0,
    "sgstPaise" INTEGER NOT NULL DEFAULT 0,
    "igstPaise" INTEGER NOT NULL DEFAULT 0,
    "inputGstPaise" INTEGER NOT NULL,
    "gstSource" "FinGstSource" NOT NULL DEFAULT 'ESTIMATED',
    "ocrConfidence" DOUBLE PRECISION,
    "itcEligible" BOOLEAN NOT NULL DEFAULT true,
    "itcPeriod" TEXT NOT NULL,
    "paidVia" TEXT NOT NULL DEFAULT 'BANK',
    "billFileId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RECORDED',
    "voucherId" TEXT,
    "notes" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FilingFolder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "systemKey" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FilingFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FilingDocument" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "mime" TEXT NOT NULL DEFAULT 'application/pdf',
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "tags" TEXT[],
    "fy" TEXT,
    "docDate" DATE,
    "linkedEntityType" TEXT,
    "linkedEntityId" TEXT,
    "linkedRef" TEXT,
    "uploadedByUserId" TEXT,
    "uploadedByName" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "FilingDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveType" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortLabel" TEXT NOT NULL DEFAULT '',
    "color" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "annualQuota" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "accrualFrequency" "LeaveAccrualFrequency" NOT NULL DEFAULT 'YEARLY',
    "prorateOnJoin" BOOLEAN NOT NULL DEFAULT true,
    "carryForwardMax" DOUBLE PRECISION,
    "encashable" BOOLEAN NOT NULL DEFAULT false,
    "appliesTo" TEXT[],
    "isPaid" BOOLEAN NOT NULL DEFAULT true,
    "isCompOff" BOOLEAN NOT NULL DEFAULT false,
    "expiryDays" INTEGER,
    "allowHalfDay" BOOLEAN NOT NULL DEFAULT true,
    "sandwichWeeklyOffs" BOOLEAN NOT NULL DEFAULT false,
    "sandwichHolidays" BOOLEAN NOT NULL DEFAULT false,
    "allowNegative" BOOLEAN NOT NULL DEFAULT false,
    "negativeLimit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "minNoticeDays" INTEGER NOT NULL DEFAULT 0,
    "noticeEnforcement" TEXT NOT NULL DEFAULT 'WARN',
    "maxConsecutiveDays" DOUBLE PRECISION,
    "backdateLimitDays" INTEGER NOT NULL DEFAULT 0,
    "documentRequiredAfterDays" DOUBLE PRECISION,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveCreditRule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "employmentType" TEXT NOT NULL,
    "frequency" "LeaveAccrualFrequency" NOT NULL,
    "daysPerPeriod" DOUBLE PRECISION NOT NULL,
    "creditDay" INTEGER NOT NULL DEFAULT 1,
    "prorateOnJoin" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "lastPeriodKey" TEXT,
    "lastRunStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveCreditRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveCreditBatch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "LeaveCreditBatchType" NOT NULL,
    "leaveTypeId" TEXT,
    "ruleId" TEXT,
    "periodKey" TEXT NOT NULL,
    "leaveYear" INTEGER NOT NULL,
    "status" "LeaveBatchStatus" NOT NULL,
    "employeeCount" INTEGER NOT NULL DEFAULT 0,
    "totalDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "triggeredById" TEXT,
    "note" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "LeaveCreditBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveLedgerEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "leaveYear" INTEGER NOT NULL,
    "txType" "LeaveLedgerTx" NOT NULL,
    "days" DOUBLE PRECISION NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "requestId" TEXT,
    "compOffGrantId" TEXT,
    "batchId" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveBalance" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "opening" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "accrued" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "credited" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "availed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pending" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lapsed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "encashed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "entitlement" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "available" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "requestNo" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    "halfDay" TEXT NOT NULL DEFAULT 'NONE',
    "fromSession" TEXT NOT NULL DEFAULT 'FULL',
    "toSession" TEXT NOT NULL DEFAULT 'FULL',
    "days" DOUBLE PRECISION NOT NULL,
    "paidDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lopDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sandwichDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dayBreakdown" JSONB NOT NULL DEFAULT '[]',
    "reason" TEXT,
    "attachmentFileId" TEXT,
    "status" "LeaveRequestStatus" NOT NULL DEFAULT 'PENDING',
    "approverEmployeeId" TEXT,
    "approverSource" TEXT NOT NULL DEFAULT 'RM',
    "notifyEmployeeIds" TEXT[],
    "appliedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedByName" TEXT,
    "decisionNote" TEXT,
    "cancelReason" TEXT,
    "cancelRequestedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "touchesLockedPeriod" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveRequestDay" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "session" TEXT NOT NULL DEFAULT 'FULL',
    "dayKind" TEXT NOT NULL DEFAULT 'WORKING',
    "units" DOUBLE PRECISION NOT NULL,
    "isSandwich" BOOLEAN NOT NULL DEFAULT false,
    "isPaid" BOOLEAN NOT NULL DEFAULT true,
    "leaveYear" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "LeaveRequestDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompOffGrant" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "workedDate" DATE NOT NULL,
    "units" DOUBLE PRECISION NOT NULL,
    "remaining" DOUBLE PRECISION NOT NULL,
    "expiresOn" DATE NOT NULL,
    "status" "CompOffStatus" NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'REQUEST',
    "reason" TEXT,
    "workedMinutes" INTEGER,
    "approverEmployeeId" TEXT,
    "decidedByName" TEXT,
    "decidedAt" TIMESTAMP(3),
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompOffGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompOffConsumption" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "units" DOUBLE PRECISION NOT NULL,
    "reversedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompOffConsumption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryComponent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "pfWage" BOOLEAN NOT NULL DEFAULT false,
    "esiWage" BOOLEAN NOT NULL DEFAULT true,
    "partOfGross" BOOLEAN NOT NULL DEFAULT true,
    "partOfCtc" BOOLEAN NOT NULL DEFAULT true,
    "showOnPayslip" BOOLEAN NOT NULL DEFAULT true,
    "payslipOrder" INTEGER NOT NULL DEFAULT 0,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalaryComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "payType" "PayrollPayType" NOT NULL DEFAULT 'SALARY',
    "employmentTypes" TEXT[],
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "lines" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalaryTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeSalary" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "ctcAnnualPaise" INTEGER NOT NULL,
    "grossMonthlyPaise" INTEGER NOT NULL,
    "structureEnc" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "payType" "PayrollPayType" NOT NULL DEFAULT 'SALARY',
    "templateId" TEXT,
    "reason" TEXT NOT NULL DEFAULT 'JOINING',
    "note" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeSalary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeePayrollProfile" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "payType" "PayrollPayType" NOT NULL DEFAULT 'SALARY',
    "pfEnabled" BOOLEAN NOT NULL DEFAULT true,
    "pfCeilingOpted" BOOLEAN NOT NULL DEFAULT true,
    "esiMode" TEXT NOT NULL DEFAULT 'AUTO',
    "ptStateCode" TEXT NOT NULL DEFAULT 'GJ',
    "taxRegime" "TaxRegime" NOT NULL DEFAULT 'NEW',
    "declarations" JSONB,
    "payrollHold" BOOLEAN NOT NULL DEFAULT false,
    "holdReason" TEXT,
    "idleDeductionExempt" BOOLEAN NOT NULL DEFAULT false,
    "paymentMode" TEXT NOT NULL DEFAULT 'BANK_TRANSFER',
    "bankVerified" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeePayrollProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "runNo" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "periodYear" INTEGER NOT NULL,
    "periodMonth" INTEGER NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "runType" TEXT NOT NULL DEFAULT 'REGULAR',
    "parentRunId" TEXT,
    "status" "PayrollRunStatus" NOT NULL DEFAULT 'DRAFT',
    "attendanceLockDate" DATE,
    "includeIdleDeduction" BOOLEAN NOT NULL DEFAULT true,
    "pendingTimesheetMode" TEXT NOT NULL DEFAULT 'EXCLUDE',
    "paymentDate" DATE,
    "calcVersion" INTEGER NOT NULL DEFAULT 0,
    "employeeCount" INTEGER NOT NULL DEFAULT 0,
    "internCount" INTEGER NOT NULL DEFAULT 0,
    "timesheetApprovedCount" INTEGER NOT NULL DEFAULT 0,
    "timesheetPendingCount" INTEGER NOT NULL DEFAULT 0,
    "readyCount" INTEGER NOT NULL DEFAULT 0,
    "grossPaise" INTEGER NOT NULL DEFAULT 0,
    "deductionsPaise" INTEGER NOT NULL DEFAULT 0,
    "netPaise" INTEGER NOT NULL DEFAULT 0,
    "employerContribPaise" INTEGER NOT NULL DEFAULT 0,
    "employerPfPaise" INTEGER NOT NULL DEFAULT 0,
    "idleDeductionPaise" INTEGER NOT NULL DEFAULT 0,
    "idleEmployeeCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "createdByName" TEXT,
    "calculatedAt" TIMESTAMP(3),
    "finalizedByName" TEXT,
    "finalizedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "calcVersion" INTEGER NOT NULL DEFAULT 1,
    "status" "PayrollItemStatus" NOT NULL,
    "timesheetGate" TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
    "payType" "PayrollPayType" NOT NULL DEFAULT 'SALARY',
    "taxRegime" "TaxRegime",
    "ptStateCode" TEXT,
    "workingDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "eligibleDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paidLeaveDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unpaidLeaveDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "absentDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lopDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paidDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "projectedDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "holidays" INTEGER NOT NULL DEFAULT 0,
    "weeklyOffs" INTEGER NOT NULL DEFAULT 0,
    "leaveSummary" JSONB NOT NULL DEFAULT '[]',
    "leaveLabel" TEXT NOT NULL DEFAULT '0',
    "idleMinutesRaw" INTEGER NOT NULL DEFAULT 0,
    "idleAllowanceMinutes" INTEGER NOT NULL DEFAULT 0,
    "idleMinutesDeductible" INTEGER NOT NULL DEFAULT 0,
    "hourlyRatePaise" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "perDayRatePaise" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "grossFixedPaise" INTEGER NOT NULL DEFAULT 0,
    "grossEarnedPaise" INTEGER NOT NULL DEFAULT 0,
    "lopAmountPaise" INTEGER NOT NULL DEFAULT 0,
    "idleDeductionPaise" INTEGER NOT NULL DEFAULT 0,
    "adjustmentsPaise" INTEGER NOT NULL DEFAULT 0,
    "totalEarningsPaise" INTEGER NOT NULL DEFAULT 0,
    "totalDeductionsPaise" INTEGER NOT NULL DEFAULT 0,
    "employerContribPaise" INTEGER NOT NULL DEFAULT 0,
    "employerPfPaise" INTEGER NOT NULL DEFAULT 0,
    "pfEePaise" INTEGER NOT NULL DEFAULT 0,
    "esiEePaise" INTEGER NOT NULL DEFAULT 0,
    "ptPaise" INTEGER NOT NULL DEFAULT 0,
    "tdsPaise" INTEGER NOT NULL DEFAULT 0,
    "roundingPaise" INTEGER NOT NULL DEFAULT 0,
    "netPaise" INTEGER NOT NULL DEFAULT 0,
    "taxableMonthlyPaise" INTEGER NOT NULL DEFAULT 0,
    "trace" JSONB NOT NULL DEFAULT '[]',
    "errors" JSONB NOT NULL DEFAULT '[]',
    "holdReason" TEXT,
    "lastCalculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollItemLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "componentCode" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fullAmountPaise" INTEGER,
    "amountPaise" INTEGER NOT NULL,
    "adjustmentId" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PayrollItemLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollAdjustment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "days" DOUBLE PRECISION,
    "amountPaise" INTEGER NOT NULL,
    "forPeriod" TEXT NOT NULL,
    "targetPeriod" TEXT,
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "pfApplicable" BOOLEAN NOT NULL DEFAULT false,
    "esiApplicable" BOOLEAN NOT NULL DEFAULT false,
    "sourceType" TEXT NOT NULL DEFAULT 'MANUAL',
    "sourceId" TEXT,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "appliedRunId" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payslip" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "periodYear" INTEGER NOT NULL,
    "periodMonth" INTEGER NOT NULL,
    "runType" TEXT NOT NULL DEFAULT 'REGULAR',
    "workingDays" DOUBLE PRECISION NOT NULL,
    "paidDays" DOUBLE PRECISION NOT NULL,
    "lopDays" DOUBLE PRECISION NOT NULL,
    "idleMinutes" INTEGER NOT NULL,
    "idleDeductionPaise" INTEGER NOT NULL,
    "grossPaise" INTEGER NOT NULL,
    "deductionsPaise" INTEGER NOT NULL,
    "netPaise" INTEGER NOT NULL,
    "fileId" TEXT,
    "fileSha256" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "publishedAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payslip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankTransferFile" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'GENERIC_NEFT_CSV',
    "fileId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "entryCount" INTEGER NOT NULL,
    "totalPaise" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'GENERATED',
    "excluded" JSONB NOT NULL DEFAULT '[]',
    "generatedBy" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "downloadedAt" TIMESTAMP(3),

    CONSTRAINT "BankTransferFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeDocument" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "category" "PeopleDocCategory" NOT NULL,
    "docType" "PeopleDocType" NOT NULL,
    "title" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "supersedesId" TEXT,
    "source" "PeopleDocSource" NOT NULL,
    "verificationStatus" "PeopleDocVerification" NOT NULL DEFAULT 'PENDING',
    "verifiedByUserId" TEXT,
    "verifiedByName" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "esignEnvelopeId" TEXT,
    "tags" TEXT[],
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedByUserId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Onboarding" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "status" "OnboardingStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "invitedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "bankVerifiedAt" TIMESTAMP(3),
    "bankVerifiedBy" TEXT,
    "overrideReason" TEXT,
    "declinedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Onboarding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingStep" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "onboardingId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "status" "OnboardingStepStatus" NOT NULL DEFAULT 'PENDING',
    "data" JSONB,
    "note" TEXT,
    "esignEnvelopeId" TEXT,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnboardingStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EsignEnvelope" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'local',
    "title" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "subjectEmployeeId" TEXT,
    "docData" JSONB NOT NULL,
    "originalFileId" TEXT NOT NULL,
    "originalSha256" TEXT NOT NULL,
    "signedFileId" TEXT,
    "signedSha256" TEXT,
    "status" "EsignStatus" NOT NULL DEFAULT 'SENT',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "signerName" TEXT NOT NULL,
    "signerEmail" TEXT NOT NULL,
    "signerUserId" TEXT,
    "signatureType" TEXT,
    "typedName" TEXT,
    "typedFont" TEXT,
    "signatureFileId" TEXT,
    "consentText" TEXT,
    "signedAt" TIMESTAMP(3),
    "signerIp" TEXT,
    "signerUserAgent" TEXT,
    "declineReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EsignEnvelope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EsignEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "envelopeId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorEmail" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "meta" JSONB,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EsignEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExitCase" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "exitType" "ExitType" NOT NULL,
    "resignationDate" DATE NOT NULL,
    "lastWorkingDay" DATE NOT NULL,
    "noticeShortfallDays" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT,
    "status" "ExitCaseStatus" NOT NULL DEFAULT 'OPEN',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExitCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExitChecklistItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "exitCaseId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "ownerRole" TEXT NOT NULL,
    "blocking" BOOLEAN NOT NULL DEFAULT false,
    "auto" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "doneByName" TEXT,
    "doneAt" TIMESTAMP(3),
    "note" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ExitChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeImport" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'VALIDATED',
    "options" JSONB NOT NULL,
    "totalRows" INTEGER NOT NULL,
    "validRows" INTEGER NOT NULL,
    "importedRows" INTEGER NOT NULL DEFAULT 0,
    "rows" JSONB NOT NULL,
    "rowErrors" JSONB NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committedAt" TIMESTAMP(3),

    CONSTRAINT "EmployeeImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PeopleAlertLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PeopleAlertLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "designationId" TEXT,
    "jobType" "JobType" NOT NULL DEFAULT 'FULL_TIME',
    "openings" INTEGER NOT NULL DEFAULT 1,
    "branchId" TEXT,
    "description" TEXT,
    "experienceMinYrs" INTEGER,
    "experienceMaxYrs" INTEGER,
    "hiringManagerId" TEXT,
    "roundNames" TEXT[],
    "status" "JobStatus" NOT NULL DEFAULT 'OPEN',
    "publishedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Candidate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "location" TEXT,
    "currentCompany" TEXT,
    "currentCtcPaise" INTEGER,
    "expectedCtcPaise" INTEGER,
    "noticePeriodDays" INTEGER,
    "totalExpMonths" INTEGER,
    "source" "CandidateSource" NOT NULL,
    "referredByEmployeeId" TEXT,
    "tags" TEXT[],
    "resumeFileId" TEXT,
    "consentAt" TIMESTAMP(3),
    "retentionUntil" DATE NOT NULL,
    "anonymisedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Candidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobApplication" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "stage" "ApplicationStage" NOT NULL DEFAULT 'SCREENING',
    "stageChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "score" DOUBLE PRECISION,
    "rejectReason" TEXT,
    "employeeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobApplicationEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "from" "ApplicationStage",
    "to" "ApplicationStage" NOT NULL,
    "byName" TEXT,
    "reason" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobApplicationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewRound" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "defaultDurationMin" INTEGER NOT NULL DEFAULT 60,
    "criteria" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterviewRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Interview" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "roundName" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 1,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "durationMin" INTEGER NOT NULL DEFAULT 60,
    "mode" "InterviewMode" NOT NULL DEFAULT 'VIDEO',
    "location" TEXT,
    "notesToCandidate" TEXT,
    "status" "InterviewStatus" NOT NULL DEFAULT 'SCHEDULED',
    "result" "InterviewResult" NOT NULL DEFAULT 'PENDING',
    "icsUid" TEXT NOT NULL,
    "icsSequence" INTEGER NOT NULL DEFAULT 0,
    "emailedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Interview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewPanelist" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'LEAD',

    CONSTRAINT "InterviewPanelist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewScorecard" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "interviewerEmployeeId" TEXT NOT NULL,
    "ratings" JSONB NOT NULL,
    "overall" DOUBLE PRECISION,
    "recommendation" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterviewScorecard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobOffer" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "designationId" TEXT,
    "departmentId" TEXT,
    "branchId" TEXT,
    "employmentType" TEXT NOT NULL DEFAULT 'FULL_TIME',
    "annualCtcPaise" INTEGER NOT NULL,
    "joiningDate" DATE NOT NULL,
    "expiresOn" DATE NOT NULL,
    "status" "JobOfferStatus" NOT NULL DEFAULT 'DRAFT',
    "employeeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KraTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "ratingLabels" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KraTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KraItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "measurement" TEXT,
    "weight" DOUBLE PRECISION NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "KraItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppraisalCycle" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "periodFrom" DATE NOT NULL,
    "periodTo" DATE NOT NULL,
    "templateId" TEXT NOT NULL,
    "selfReviewDue" DATE NOT NULL,
    "managerReviewDue" DATE NOT NULL,
    "eligibility" JSONB NOT NULL,
    "status" "AppraisalCycleStatus" NOT NULL DEFAULT 'DRAFT',
    "launchedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppraisalCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppraisalParticipant" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "reviewerEmployeeId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "templateSnapshot" JSONB NOT NULL,
    "ratings" JSONB NOT NULL DEFAULT '{}',
    "selfStatus" "AppraisalReviewStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "managerStatus" "AppraisalReviewStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "selfSubmittedAt" TIMESTAMP(3),
    "managerSubmittedAt" TIMESTAMP(3),
    "selfScore" DOUBLE PRECISION,
    "managerScore" DOUBLE PRECISION,
    "calibratedScore" DOUBLE PRECISION,
    "finalScore" DOUBLE PRECISION,
    "band" TEXT,
    "calibrationNote" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "employeeComment" TEXT,
    "withdrawn" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AppraisalParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetCategory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "requiresSerial" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "assetTag" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categoryId" TEXT,
    "make" TEXT,
    "model" TEXT,
    "serialNo" TEXT,
    "purchaseDate" DATE,
    "purchaseCostPaise" INTEGER,
    "vendor" TEXT,
    "warrantyTill" DATE,
    "status" "AssetStatus" NOT NULL DEFAULT 'IN_STOCK',
    "condition" "AssetCondition" NOT NULL DEFAULT 'NEW',
    "branchId" TEXT,
    "currentAssigneeId" TEXT,
    "currentAssignmentId" TEXT,
    "statusBeforeRepair" "AssetStatus",
    "notes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetAssignment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "assignedOn" DATE NOT NULL,
    "assignedByName" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "returnedOn" DATE,
    "returnCondition" "AssetCondition",
    "returnNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetRepair" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "vendor" TEXT,
    "issue" TEXT NOT NULL,
    "sentOn" DATE NOT NULL,
    "expectedBack" DATE,
    "costPaise" INTEGER,
    "completedOn" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetRepair_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WelcomeKitItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sizes" TEXT[],
    "stock" JSONB NOT NULL,
    "lowStockThreshold" INTEGER NOT NULL DEFAULT 5,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WelcomeKitItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WelcomeKitIssue" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "status" "KitStatus" NOT NULL DEFAULT 'PENDING',
    "tshirtSize" TEXT,
    "delivery" TEXT NOT NULL DEFAULT 'HANDOVER',
    "trackingNo" TEXT,
    "lastIssuedName" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WelcomeKitIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WelcomeKitIssueLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "size" TEXT,
    "issued" BOOLEAN NOT NULL DEFAULT false,
    "issuedOn" DATE,
    "issuedByName" TEXT,

    CONSTRAINT "WelcomeKitIssueLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdCardTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "orientation" TEXT NOT NULL DEFAULT 'PORTRAIT',
    "widthMm" DOUBLE PRECISION NOT NULL DEFAULT 53.98,
    "heightMm" DOUBLE PRECISION NOT NULL DEFAULT 85.6,
    "front" JSONB NOT NULL,
    "back" JSONB NOT NULL,
    "frontBgFileId" TEXT,
    "backBgFileId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdCardTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdCard" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "templateId" TEXT,
    "serial" TEXT NOT NULL,
    "status" "IdCardStatus" NOT NULL DEFAULT 'QUEUED',
    "missingFields" TEXT[],
    "printPdfFileId" TEXT,
    "dataSnapshot" JSONB,
    "verifyToken" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3),
    "printBatchId" TEXT,
    "issuedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdCardPrintBatch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "vendorEmail" TEXT NOT NULL,
    "cardCount" INTEGER NOT NULL,
    "pdfFileId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "sentAt" TIMESTAMP(3),
    "sentByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdCardPrintBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VCardProfile" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "showPhone" BOOLEAN NOT NULL DEFAULT true,
    "workPhone" TEXT,
    "linkedinUrl" TEXT,
    "publicSlug" TEXT NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VCardProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VCardShare" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VCardShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "freeSeats" INTEGER NOT NULL DEFAULT 10,
    "maxActiveUsers" INTEGER,
    "monthlyPaisePerSeat" INTEGER,
    "yearlyPaisePerSeat" INTEGER,
    "features" TEXT[],
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planCode" TEXT NOT NULL,
    "cycle" "BillingCycle",
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'FREE',
    "quantity" INTEGER NOT NULL DEFAULT 10,
    "unitPaise" INTEGER,
    "contractPaisePerYear" INTEGER,
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "pendingChange" JSONB,
    "autoRenew" BOOLEAN NOT NULL DEFAULT true,
    "collection" TEXT NOT NULL DEFAULT 'GATEWAY',
    "pastDueSince" TIMESTAMP(3),
    "graceEndsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionChange" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "from" JSONB,
    "to" JSONB,
    "seatDelta" INTEGER NOT NULL DEFAULT 0,
    "actorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromoCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "percentOff" INTEGER,
    "amountOffPaise" INTEGER,
    "planCodes" TEXT[],
    "cycles" "BillingCycle"[],
    "duration" TEXT NOT NULL DEFAULT 'NEXT_INVOICE',
    "durationCycles" INTEGER,
    "maxRedemptions" INTEGER,
    "redeemedCount" INTEGER NOT NULL DEFAULT 0,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromoCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromoRedemption" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "promoId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "cyclesRemaining" INTEGER NOT NULL DEFAULT 1,
    "appliedInvoiceIds" TEXT[],
    "redeemedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromoRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaasInvoice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT,
    "subscriptionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'RENEWAL',
    "fyLabel" TEXT,
    "issueDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "planCode" TEXT NOT NULL,
    "cycle" "BillingCycle",
    "quantity" INTEGER NOT NULL,
    "lines" JSONB NOT NULL,
    "subtotalPaise" INTEGER NOT NULL,
    "discountPaise" INTEGER NOT NULL DEFAULT 0,
    "taxablePaise" INTEGER NOT NULL,
    "cgstPaise" INTEGER NOT NULL DEFAULT 0,
    "sgstPaise" INTEGER NOT NULL DEFAULT 0,
    "igstPaise" INTEGER NOT NULL DEFAULT 0,
    "roundOffPaise" INTEGER NOT NULL DEFAULT 0,
    "totalPaise" INTEGER NOT NULL,
    "placeOfSupply" TEXT NOT NULL,
    "recipientGstin" TEXT,
    "promoRedemptionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaasInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaasPayment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "gateway" TEXT NOT NULL,
    "gatewayOrderId" TEXT NOT NULL,
    "gatewayPaymentId" TEXT,
    "amountPaise" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "failureReason" TEXT,
    "intent" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SaasPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GatewayWebhookEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "gateway" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "signatureValid" BOOLEAN NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "GatewayWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesLead" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "seats" INTEGER,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MrrSnapshot" (
    "date" DATE NOT NULL,
    "mrrPaise" INTEGER NOT NULL,
    "paidTenants" INTEGER NOT NULL,
    "freeTenants" INTEGER NOT NULL,
    "seatsBilled" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MrrSnapshot_pkey" PRIMARY KEY ("date")
);

-- CreateTable
CREATE TABLE "BrandingVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
    "presetKey" TEXT,
    "primaryHex" TEXT NOT NULL,
    "secondaryHex" TEXT NOT NULL,
    "logoFileId" TEXT,
    "productName" TEXT,
    "domain" TEXT NOT NULL,
    "publishedById" TEXT,
    "publishedByName" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrandingVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "openedByUserId" TEXT,
    "openedByName" TEXT NOT NULL,
    "openedByEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'TECHNICAL',
    "severity" "SupportSeverity" NOT NULL DEFAULT 'MEDIUM',
    "status" "SupportStatus" NOT NULL DEFAULT 'OPEN',
    "assigneeUserId" TEXT,
    "assigneeName" TEXT,
    "planAtOpen" TEXT NOT NULL,
    "firstResponseDueAt" TIMESTAMP(3) NOT NULL,
    "firstRespondedAt" TIMESTAMP(3),
    "slaBreachedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "reopenedCount" INTEGER NOT NULL DEFAULT 0,
    "csat" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportMessage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorType" TEXT NOT NULL,
    "authorUserId" TEXT,
    "authorName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkLocation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "address" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "geoRadiusM" INTEGER,
    "geoFenceWebPunch" BOOLEAN NOT NULL DEFAULT false,
    "punchMode" TEXT NOT NULL,
    "isRemote" BOOLEAN NOT NULL DEFAULT false,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shift" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "graceMinutes" INTEGER NOT NULL DEFAULT 15,
    "breakMinutes" INTEGER NOT NULL DEFAULT 60,
    "weeklyOffDays" INTEGER[],
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "minFullDayMinutes" INTEGER NOT NULL DEFAULT 450,
    "minHalfDayMinutes" INTEGER NOT NULL DEFAULT 240,
    "earlyOutGraceMinutes" INTEGER NOT NULL DEFAULT 15,
    "halfDayIfLateByMinutes" INTEGER DEFAULT 120,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftAssignment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "assignedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendancePolicy" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "audience" "PolicyAudience" NOT NULL,
    "biometricMandatory" BOOLEAN NOT NULL,
    "allowWebPunch" BOOLEAN NOT NULL,
    "allowDesktopPunch" BOOLEAN NOT NULL,
    "autoIdleEnabled" BOOLEAN NOT NULL DEFAULT true,
    "autoIdleMinutes" INTEGER NOT NULL DEFAULT 5,
    "screenshotsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "screenshotIntervalMinutes" INTEGER NOT NULL DEFAULT 10,
    "blurScreenshots" BOOLEAN NOT NULL DEFAULT false,
    "deductIdleFromPayroll" BOOLEAN NOT NULL DEFAULT true,
    "monthlyIdleAllowanceMinutes" INTEGER NOT NULL DEFAULT 60,
    "breakReminderMinutes" INTEGER NOT NULL DEFAULT 120,
    "offlineRetentionDays" INTEGER NOT NULL DEFAULT 7,
    "screenshotRetentionDays" INTEGER NOT NULL DEFAULT 90,
    "idleDeductionMode" TEXT NOT NULL DEFAULT 'SHORTFALL_ONLY',
    "lateMarksPerPenalty" INTEGER NOT NULL DEFAULT 3,
    "latePenaltyDays" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "latePenaltySource" TEXT NOT NULL DEFAULT 'LEAVE_THEN_LOP',
    "earlyOutCountsAsLate" BOOLEAN NOT NULL DEFAULT false,
    "missedPunchAutoCloseHours" INTEGER NOT NULL DEFAULT 6,
    "maxRegularizationsPerMonth" INTEGER NOT NULL DEFAULT 3,
    "regularizationWindowDays" INTEGER NOT NULL DEFAULT 7,
    "timesheetRequired" BOOLEAN NOT NULL DEFAULT true,
    "trackerRequired" BOOLEAN NOT NULL DEFAULT false,
    "punchInReminder" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedByName" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendancePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "calendar" TEXT NOT NULL DEFAULT 'National',
    "locationIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceDay" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "DayStatus" NOT NULL,
    "firstInAt" TIMESTAMP(3),
    "lastOutAt" TIMESTAMP(3),
    "primarySource" "PunchSource",
    "workedMinutes" INTEGER NOT NULL DEFAULT 0,
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "idleMinutes" INTEGER NOT NULL DEFAULT 0,
    "isLate" BOOLEAN NOT NULL DEFAULT false,
    "lateByMinutes" INTEGER NOT NULL DEFAULT 0,
    "presentFraction" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "leaveFraction" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "idleDeductibleMinutes" INTEGER NOT NULL DEFAULT 0,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "shiftId" TEXT,
    "effectiveMode" "PolicyAudience",
    "locationId" TEXT,
    "expectedStart" TIMESTAMP(3),
    "expectedEnd" TIMESTAMP(3),
    "presenceMinutes" INTEGER NOT NULL DEFAULT 0,
    "sourcesMask" INTEGER NOT NULL DEFAULT 0,
    "lateExcused" BOOLEAN NOT NULL DEFAULT false,
    "isEarlyOut" BOOLEAN NOT NULL DEFAULT false,
    "leaveTypeCode" TEXT,
    "holidayName" TEXT,
    "overriddenByName" TEXT,
    "overrideReason" TEXT,
    "recomputedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendancePunch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "attendanceDate" DATE NOT NULL,
    "punchedAt" TIMESTAMP(3) NOT NULL,
    "direction" "PunchDirection" NOT NULL,
    "source" "PunchSource" NOT NULL,
    "status" "PunchStatus" NOT NULL,
    "rejectReason" TEXT,
    "locationId" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "accuracyM" INTEGER,
    "distanceM" INTEGER,
    "geoStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "trackerDeviceId" TEXT,
    "biometricDeviceId" TEXT,
    "regularizationId" TEXT,
    "clientEventId" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendancePunch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkSession" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "attendanceDate" DATE NOT NULL,
    "inPunchId" TEXT NOT NULL,
    "outPunchId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "source" "PunchSource" NOT NULL,
    "autoClosed" BOOLEAN NOT NULL DEFAULT false,
    "deviceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceRegularization" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "type" "RegularizationType" NOT NULL,
    "requestedIn" TIMESTAMP(3),
    "requestedOut" TIMESTAMP(3),
    "reason" TEXT NOT NULL,
    "attachmentFileId" TEXT,
    "status" "RegularizationStatus" NOT NULL DEFAULT 'PENDING',
    "approverEmployeeId" TEXT,
    "decidedByName" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionComment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceRegularization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PeriodLock" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "lockedUpTo" DATE NOT NULL,
    "lockedByName" TEXT,
    "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unlockedAt" TIMESTAMP(3),
    "unlockReason" TEXT,
    "payrollRunId" TEXT,

    CONSTRAINT "PeriodLock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdCardCheck" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "locationId" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "wearing" BOOLEAN NOT NULL,
    "photoFileId" TEXT,
    "method" TEXT NOT NULL DEFAULT 'MANUAL_PICK',
    "loggedByUserId" TEXT,
    "loggedByName" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdCardCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BiometricDevice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "locationId" TEXT,
    "model" TEXT,
    "firmware" TEXT,
    "directionMode" TEXT NOT NULL DEFAULT 'FIRST_LAST',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "commKey" TEXT,
    "attLogStamp" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BiometricDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnclaimedBiometricDevice" (
    "serialNumber" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "model" TEXT,

    CONSTRAINT "UnclaimedBiometricDevice_pkey" PRIMARY KEY ("serialNumber")
);

-- CreateTable
CREATE TABLE "BiometricEnrollment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "pin" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BiometricEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BiometricRawLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "pin" TEXT NOT NULL,
    "punchedAtLocal" TEXT NOT NULL,
    "punchedAt" TIMESTAMP(3) NOT NULL,
    "statusCode" INTEGER,
    "verifyCode" INTEGER,
    "workCode" TEXT,
    "raw" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "punchId" TEXT,
    "error" TEXT,
    "employeeId" TEXT,

    CONSTRAINT "BiometricRawLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Timesheet" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "weekEnd" DATE NOT NULL,
    "status" "TimesheetStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "totalMinutes" INTEGER NOT NULL DEFAULT 0,
    "idleMinutes" INTEGER NOT NULL DEFAULT 0,
    "screenshotCount" INTEGER NOT NULL DEFAULT 0,
    "cycle" INTEGER NOT NULL DEFAULT 0,
    "trackedMinutes" INTEGER NOT NULL DEFAULT 0,
    "adjustmentMinutes" INTEGER NOT NULL DEFAULT 0,
    "outsideHoursMinutes" INTEGER NOT NULL DEFAULT 0,
    "idleAsWorkMinutes" INTEGER NOT NULL DEFAULT 0,
    "returnedComment" TEXT,
    "returnedByName" TEXT,
    "hasLateData" BOOLEAN NOT NULL DEFAULT false,
    "lockedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Timesheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimesheetLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "timesheetId" TEXT NOT NULL,
    "projectId" TEXT,
    "taskId" TEXT,
    "label" TEXT NOT NULL,
    "subLabel" TEXT,
    "billable" BOOLEAN NOT NULL,
    "isManual" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimesheetLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimesheetCell" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "trackedMinutes" INTEGER NOT NULL DEFAULT 0,
    "adjustmentMinutes" INTEGER NOT NULL DEFAULT 0,
    "outsideHoursMinutes" INTEGER NOT NULL DEFAULT 0,
    "finalMinutes" INTEGER NOT NULL DEFAULT 0,
    "billedInvoiceLineId" TEXT,
    "idleAsWorkMinutes" INTEGER NOT NULL DEFAULT 0,
    "pendingIdleMinutes" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TimesheetCell_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimesheetIdleDay" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "timesheetId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "idleMinutes" INTEGER NOT NULL,

    CONSTRAINT "TimesheetIdleDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimesheetAdjustment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "timesheetId" TEXT NOT NULL,
    "cellId" TEXT NOT NULL,
    "fromMinutes" INTEGER NOT NULL,
    "toMinutes" INTEGER NOT NULL,
    "deltaMinutes" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "reviewStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
    "createdByName" TEXT,
    "reviewedByName" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimesheetAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutsideHoursEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "timesheetId" TEXT NOT NULL,
    "lineId" TEXT,
    "projectId" TEXT,
    "taskId" TEXT,
    "taskText" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "minutes" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "reviewStatus" TEXT NOT NULL DEFAULT 'PENDING_PL',
    "reviewedByName" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewComment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutsideHoursEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimesheetApprovalStep" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "timesheetId" TEXT NOT NULL,
    "cycle" INTEGER NOT NULL,
    "level" INTEGER NOT NULL,
    "projectId" TEXT,
    "approverEmployeeId" TEXT NOT NULL,
    "status" "TimesheetStepStatus" NOT NULL DEFAULT 'PENDING',
    "actedByName" TEXT,
    "actedAt" TIMESTAMP(3),
    "comment" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "escalatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimesheetApprovalStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimesheetItemDecision" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "timesheetId" TEXT NOT NULL,
    "itemType" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "note" TEXT,
    "decidedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimesheetItemDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimesheetEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "timesheetId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorName" TEXT,
    "level" INTEGER,
    "comment" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimesheetEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackerDevice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "os" TEXT NOT NULL,
    "appVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "pairedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "queueDepth" INTEGER NOT NULL DEFAULT 0,
    "displays" INTEGER NOT NULL DEFAULT 1,
    "liveStatus" TEXT,
    "liveTaskId" TEXT,
    "lastSkewSec" INTEGER,
    "approvalMethod" TEXT,
    "approvedByUserId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,
    "revokeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackerDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DevicePairingRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "sessionTokenHash" TEXT NOT NULL,
    "sessionExpiresAt" TIMESTAMP(3) NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'PUNCH',
    "status" TEXT NOT NULL DEFAULT 'SIGNED_IN',
    "codeHash" TEXT,
    "hostname" TEXT,
    "os" TEXT,
    "appVersion" TEXT,
    "permissions" TEXT[],
    "expiresAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approvedByUserId" TEXT,
    "approvalMethod" TEXT,
    "deviceId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DevicePairingRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DevicePairingAttempt" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DevicePairingAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackerEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "clientAt" TIMESTAMP(3) NOT NULL,
    "workDate" DATE NOT NULL,
    "taskId" TEXT,
    "resolution" TEXT,
    "idleFrom" TIMESTAMP(3),
    "note" TEXT,
    "payload" JSONB,
    "skewSec" INTEGER NOT NULL DEFAULT 0,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackerEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivitySegment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "deviceId" TEXT,
    "workDate" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "taskId" TEXT,
    "projectId" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "durationSec" INTEGER NOT NULL,
    "idleResolution" TEXT,
    "idleCause" TEXT,
    "note" TEXT,
    "keyboardEvents" INTEGER NOT NULL DEFAULT 0,
    "mouseEvents" INTEGER NOT NULL DEFAULT 0,
    "flags" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivitySegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdleClaim" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "segmentId" TEXT,
    "workDate" DATE NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "minutes" INTEGER NOT NULL,
    "taskId" TEXT,
    "projectId" TEXT,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewerEmployeeId" TEXT,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdleClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Screenshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "deviceId" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "workDate" DATE NOT NULL,
    "taskId" TEXT,
    "projectId" TEXT,
    "fileId" TEXT NOT NULL,
    "thumbFileId" TEXT,
    "blurred" BOOLEAN NOT NULL DEFAULT false,
    "inIdle" BOOLEAN NOT NULL DEFAULT false,
    "monitorCount" INTEGER NOT NULL DEFAULT 1,
    "purgeAfter" TIMESTAMP(3),
    "purgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Screenshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackerDaySummary" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "workedSec" INTEGER NOT NULL DEFAULT 0,
    "breakSec" INTEGER NOT NULL DEFAULT 0,
    "idleSec" INTEGER NOT NULL DEFAULT 0,
    "idleDeductedSec" INTEGER NOT NULL DEFAULT 0,
    "idlePendingSec" INTEGER NOT NULL DEFAULT 0,
    "claimApprovedSec" INTEGER NOT NULL DEFAULT 0,
    "screenshotCount" INTEGER NOT NULL DEFAULT 0,
    "perTask" JSONB NOT NULL DEFAULT '[]',
    "timeline" JSONB NOT NULL DEFAULT '[]',
    "firstInAt" TIMESTAMP(3),
    "lastOutAt" TIMESTAMP(3),
    "integrityFlags" INTEGER NOT NULL DEFAULT 0,
    "confirmedAt" TIMESTAMP(3),
    "lastProjectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackerDaySummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackerIntegrityEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "deviceId" TEXT,
    "workDate" DATE NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'INFO',
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "dedupeKey" TEXT NOT NULL,
    "acknowledgedByUserId" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackerIntegrityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "gstRegType" TEXT NOT NULL DEFAULT 'REGULAR',
    "gstin" TEXT,
    "pan" TEXT,
    "address" TEXT,
    "city" TEXT,
    "pincode" TEXT,
    "stateCode" TEXT,
    "countryCode" TEXT NOT NULL DEFAULT 'IN',
    "billingEmails" TEXT[],
    "defaultRatePerHourPaise" INTEGER,
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 15,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "contactName" TEXT,
    "contactPhone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "clientId" TEXT,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "category" TEXT NOT NULL DEFAULT 'WEB',
    "techStack" TEXT[],
    "leadEmployeeId" TEXT,
    "startDate" DATE,
    "deadline" DATE,
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "ratePerHourPaise" INTEGER,
    "estimatedMinutes" INTEGER NOT NULL DEFAULT 0,
    "loggedMinutes" INTEGER NOT NULL DEFAULT 0,
    "openingLoggedMinutes" INTEGER NOT NULL DEFAULT 0,
    "progressPct" INTEGER NOT NULL DEFAULT 0,
    "status" "ProjectStatus" NOT NULL DEFAULT 'PLANNING',
    "health" "ProjectHealth" NOT NULL DEFAULT 'NA',
    "healthReason" TEXT,
    "healthComputedAt" TIMESTAMP(3),
    "boardDepartmentIds" TEXT[],
    "gitRepoUrl" TEXT,
    "gitProjectId" INTEGER,
    "gitTargetBranch" TEXT NOT NULL DEFAULT 'develop',
    "gitLinkStatus" TEXT NOT NULL DEFAULT 'UNLINKED',
    "gitLinkError" TEXT,
    "taskSeq" INTEGER NOT NULL DEFAULT 0,
    "archiveAccess" TEXT NOT NULL DEFAULT 'LEADS_ONLY',
    "closedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "archivedByEmployeeId" TEXT,
    "createdByEmployeeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectModule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "estimatedMinutes" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectModule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMember" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "allocationPct" INTEGER,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectDocument" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT,
    "clientId" TEXT,
    "fileId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'REQUIREMENT',
    "title" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "uploadedByEmployeeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardMember" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "allocatedByEmployeeId" TEXT,
    "allocatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "projectId" TEXT NOT NULL,
    "moduleName" TEXT,
    "departmentId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "rank" INTEGER NOT NULL DEFAULT 0,
    "assigneeEmployeeId" TEXT,
    "reporterEmployeeId" TEXT,
    "estimatedMinutes" INTEGER,
    "loggedMinutes" INTEGER NOT NULL DEFAULT 0,
    "openingLoggedMinutes" INTEGER NOT NULL DEFAULT 0,
    "dueDate" DATE,
    "isStanding" BOOLEAN NOT NULL DEFAULT false,
    "gitBranch" TEXT,
    "gitBranchUrl" TEXT,
    "gitMrUrl" TEXT,
    "gitMrIid" INTEGER,
    "gitMrState" TEXT,
    "gitSyncStatus" "GitSyncStatus" NOT NULL DEFAULT 'NONE',
    "gitSyncError" TEXT,
    "pipelineStatus" TEXT,
    "startedAt" TIMESTAMP(3),
    "devCompletedAt" TIMESTAMP(3),
    "qaAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskComment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "authorEmployeeId" TEXT,
    "authorName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskTransition" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "fromStatus" "TaskStatus",
    "toStatus" "TaskStatus",
    "kind" TEXT NOT NULL DEFAULT 'MOVE',
    "note" TEXT,
    "byEmployeeId" TEXT,
    "byName" TEXT NOT NULL DEFAULT 'System',
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskTransition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GitIntegration" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'GITLAB',
    "baseUrl" TEXT NOT NULL DEFAULT 'https://gitlab.com',
    "tokenEnc" TEXT,
    "tokenLast4" TEXT,
    "webhookSecretHash" TEXT NOT NULL,
    "defaultTargetBranch" TEXT NOT NULL DEFAULT 'develop',
    "branchPattern" TEXT NOT NULL DEFAULT 'feature/{key}',
    "mrTitlePattern" TEXT NOT NULL DEFAULT '{KEY}: {title}',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lastCheckedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GitIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GitWebhookDelivery" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "eventUuid" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "GitWebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GitCommitLink" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "sha" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "authorName" TEXT,
    "committedAt" TIMESTAMP(3) NOT NULL,
    "url" TEXT,

    CONSTRAINT "GitCommitLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternTask" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "internEmployeeId" TEXT NOT NULL,
    "mentorEmployeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "estimatedMinutes" INTEGER,
    "status" "InternTaskStatus" NOT NULL DEFAULT 'ASSIGNED',
    "minutes" INTEGER,
    "internNote" TEXT,
    "mentorScore" DOUBLE PRECISION,
    "mentorFeedback" TEXT,
    "scoredAt" TIMESTAMP(3),
    "scoredByEmployeeId" TEXT,
    "linkedTaskId" TEXT,
    "carriedFromId" TEXT,
    "assignedByEmployeeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InternTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternWeekScore" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "internEmployeeId" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "feedback" TEXT,
    "scoredByEmployeeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InternWeekScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "text" VARCHAR(280) NOT NULL,
    "author" TEXT,
    "scheduledFor" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalTodo" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "note" TEXT,
    "dueDate" DATE,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonalTodo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "kind" "WpEventKind" NOT NULL DEFAULT 'OTHER',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "location" TEXT,
    "audiences" JSONB NOT NULL DEFAULT '[]',
    "createdByEmployeeId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" VARCHAR(150) NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL DEFAULT '',
    "visibility" "WpNoticeVisibility" NOT NULL,
    "status" "WpNoticeStatus" NOT NULL DEFAULT 'DRAFT',
    "authorEmployeeId" TEXT NOT NULL,
    "audiences" JSONB NOT NULL DEFAULT '[]',
    "publishAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "emailRecipients" BOOLEAN NOT NULL DEFAULT false,
    "recipientCount" INTEGER NOT NULL DEFAULT 0,
    "readCount" INTEGER NOT NULL DEFAULT 0,
    "lastRemindedAt" TIMESTAMP(3),
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NoticeAttachment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "noticeId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "mime" TEXT NOT NULL,

    CONSTRAINT "NoticeAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NoticeRecipient" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "noticeId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "userId" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "NoticeRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" "WpPostKind" NOT NULL,
    "status" "WpPostStatus" NOT NULL DEFAULT 'DRAFT',
    "title" VARCHAR(150) NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "excerpt" VARCHAR(300) NOT NULL DEFAULT '',
    "coverFileId" TEXT,
    "authorEmployeeId" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "publishedByEmployeeId" TEXT,
    "reviewNote" TEXT,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "commentCount" INTEGER NOT NULL DEFAULT 0,
    "eotmAwardId" TEXT,
    "kudosId" TEXT,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostLike" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostLike_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostComment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "authorEmployeeId" TEXT NOT NULL,
    "parentId" TEXT,
    "body" VARCHAR(2000) NOT NULL,
    "mentions" TEXT[],
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Badge" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "icon" TEXT NOT NULL DEFAULT 'star',
    "description" TEXT,
    "system" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Badge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Kudos" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "giverEmployeeId" TEXT NOT NULL,
    "recipientEmployeeId" TEXT NOT NULL,
    "badgeId" TEXT NOT NULL,
    "message" VARCHAR(500) NOT NULL,
    "postId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Kudos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EotmAward" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "month" CHAR(7) NOT NULL,
    "citation" VARCHAR(600) NOT NULL,
    "announcedByEmployeeId" TEXT NOT NULL,
    "postId" TEXT,
    "certificateId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EotmAward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Certificate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "WpCertificateType" NOT NULL,
    "recipientEmployeeId" TEXT NOT NULL,
    "holderName" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verificationCode" VARCHAR(12) NOT NULL,
    "fileId" TEXT,
    "sha256" TEXT,
    "status" "WpCertStatus" NOT NULL DEFAULT 'PENDING',
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Certificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatChannel" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" "WpChannelKind" NOT NULL,
    "name" VARCHAR(60),
    "topic" TEXT,
    "linkedType" TEXT,
    "linkedId" TEXT,
    "dmKey" TEXT,
    "postingPolicy" "WpPostingPolicy" NOT NULL DEFAULT 'ALL_MEMBERS',
    "createdByUserId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "lastMessageSeq" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMember" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "lastReadSeq" INTEGER NOT NULL DEFAULT 0,
    "muted" BOOLEAN NOT NULL DEFAULT false,
    "managedBy" TEXT NOT NULL DEFAULT 'MANUAL',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "senderUserId" TEXT,
    "kind" "WpMessageKind" NOT NULL DEFAULT 'USER',
    "body" TEXT,
    "replyToId" TEXT,
    "mentions" TEXT[],
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "clientMsgId" VARCHAR(64),
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatCall" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "roomName" TEXT NOT NULL,
    "startedByUserId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "recording" BOOLEAN NOT NULL DEFAULT false,
    "recordingByUserId" TEXT,
    "participantIds" TEXT[],
    "maxParticipants" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ChatCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportGroup" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "leadEmployeeId" TEXT,
    "memberEmployeeIds" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "roundRobin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketCategory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "restricted" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TicketCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlaPolicy" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "priority" "WpTicketPriority" NOT NULL,
    "firstResponseMins" INTEGER NOT NULL,
    "resolutionMins" INTEGER NOT NULL,

    CONSTRAINT "SlaPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HelpdeskTicket" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "priority" "WpTicketPriority" NOT NULL DEFAULT 'MEDIUM',
    "subject" VARCHAR(150) NOT NULL,
    "description" TEXT NOT NULL,
    "status" "WpTicketStatus" NOT NULL DEFAULT 'OPEN',
    "requesterEmployeeId" TEXT NOT NULL,
    "assigneeEmployeeId" TEXT,
    "firstResponseDueAt" TIMESTAMP(3) NOT NULL,
    "resolutionDueAt" TIMESTAMP(3) NOT NULL,
    "firstRespondedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "pausedMins" INTEGER NOT NULL DEFAULT 0,
    "pausedSince" TIMESTAMP(3),
    "slaState" "WpSlaState" NOT NULL DEFAULT 'ON_TRACK',
    "escalationLevel" INTEGER NOT NULL DEFAULT 0,
    "escalatedToEmployeeIds" TEXT[],
    "resolutionNote" TEXT,
    "csat" INTEGER,
    "reopenCount" INTEGER NOT NULL DEFAULT 0,
    "attachmentFileIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HelpdeskTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketComment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorEmployeeId" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'PUBLIC',
    "kind" TEXT NOT NULL DEFAULT 'COMMENT',
    "body" VARCHAR(5000) NOT NULL,
    "fileIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Course" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" VARCHAR(150) NOT NULL,
    "description" TEXT,
    "category" "WpCourseCategory" NOT NULL DEFAULT 'OPTIONAL',
    "certificateOnCompletion" BOOLEAN NOT NULL DEFAULT true,
    "status" "WpCourseStatus" NOT NULL DEFAULT 'DRAFT',
    "totalDurationSec" INTEGER NOT NULL DEFAULT 0,
    "createdByEmployeeId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lesson" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'VIDEO',
    "fileId" TEXT,
    "durationSec" INTEGER NOT NULL DEFAULT 0,
    "content" TEXT,

    CONSTRAINT "Lesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseAssignment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "audienceType" TEXT NOT NULL,
    "refId" TEXT,
    "label" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "dueInDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourseAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Enrollment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'ASSIGNED',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3),
    "status" "WpEnrollStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "progressPct" INTEGER NOT NULL DEFAULT 0,
    "lessonsDone" INTEGER NOT NULL DEFAULT 0,
    "certificateId" TEXT,
    "assignmentId" TEXT,
    "certificateDownloadedAt" TIMESTAMP(3),
    "lastLessonId" TEXT,

    CONSTRAINT "Enrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LessonProgress" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "positionSec" INTEGER NOT NULL DEFAULT 0,
    "watchedBuckets" INTEGER[],
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "LessonProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT,
    "name" VARCHAR(60) NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 4,
    "amenities" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "maxBookingMins" INTEGER NOT NULL DEFAULT 240,
    "openFrom" TEXT NOT NULL DEFAULT '08:00',
    "openTo" TEXT NOT NULL DEFAULT '21:00',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomBooking" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "hostEmployeeId" TEXT NOT NULL,
    "purpose" VARCHAR(120) NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "attendeeEmployeeIds" TEXT[],
    "status" "WpBookingStatus" NOT NULL DEFAULT 'BOOKED',
    "cancelledByEmployeeId" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoomBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Visitor" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "company" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "hostEmployeeId" TEXT NOT NULL,
    "branchId" TEXT,
    "visitDate" DATE NOT NULL,
    "expectedTime" TEXT NOT NULL,
    "purpose" VARCHAR(160) NOT NULL,
    "status" "WpVisitorStatus" NOT NULL DEFAULT 'REGISTERED',
    "checkedInAt" TIMESTAMP(3),
    "checkedOutAt" TIMESTAMP(3),
    "checkedInByEmployeeId" TEXT,
    "passToken" TEXT NOT NULL,
    "shortCode" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "passRevokedAt" TIMESTAMP(3),
    "deliveries" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Visitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrPolicy" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" VARCHAR(150) NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'HR',
    "requiresAck" BOOLEAN NOT NULL DEFAULT true,
    "ackDueDays" INTEGER NOT NULL DEFAULT 7,
    "status" "WpPolicyStatus" NOT NULL DEFAULT 'DRAFT',
    "currentVersionId" TEXT,
    "holidayYear" INTEGER,
    "audiences" JSONB NOT NULL DEFAULT '[]',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrPolicyVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "fileId" TEXT,
    "pageCount" INTEGER,
    "effectiveFrom" DATE NOT NULL,
    "changeSummary" TEXT,
    "requiresReack" BOOLEAN NOT NULL DEFAULT true,
    "publishedAt" TIMESTAMP(3),
    "publishedByEmployeeId" TEXT,

    CONSTRAINT "HrPolicyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyAck" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "policyVersionId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "acknowledgedAt" TIMESTAMP(3),
    "ackIp" TEXT,
    "ackUserAgent" TEXT,
    "readSeconds" INTEGER,
    "lastRemindedAt" TIMESTAMP(3),

    CONSTRAINT "PolicyAck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameSession" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "gameKey" TEXT NOT NULL,
    "puzzleDate" DATE NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startToken" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "elapsedSec" INTEGER,
    "hintsUsed" INTEGER NOT NULL DEFAULT 0,
    "moves" INTEGER,
    "revealed" BOOLEAN NOT NULL DEFAULT false,
    "points" INTEGER NOT NULL DEFAULT 0,
    "solution" JSONB,

    CONSTRAINT "GameSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Camera" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT,
    "location" TEXT NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "rtspUrlEnc" TEXT,
    "rtspMasked" TEXT,
    "gatewayPath" TEXT NOT NULL,
    "status" "WpCameraStatus" NOT NULL DEFAULT 'UNKNOWN',
    "lastSeenAt" TIMESTAMP(3),
    "lastError" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "lastReconnect" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Camera_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CameraViewSession" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "cameraId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastBeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "CameraViewSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_domain_key" ON "Tenant"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE INDEX "Role_tenantId_idx" ON "Role"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_tenantId_key_key" ON "Role"("tenantId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "User_inviteToken_key" ON "User"("inviteToken");

-- CreateIndex
CREATE INDEX "User_tenantId_idx" ON "User"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "User_tenantId_email_key" ON "User"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_tenantId_idx" ON "PasswordResetToken"("tenantId");

-- CreateIndex
CREATE INDEX "Department_tenantId_idx" ON "Department"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Department_tenantId_name_key" ON "Department"("tenantId", "name");

-- CreateIndex
CREATE INDEX "Designation_tenantId_idx" ON "Designation"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Designation_tenantId_name_key" ON "Designation"("tenantId", "name");

-- CreateIndex
CREATE INDEX "Branch_tenantId_idx" ON "Branch"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_tenantId_name_key" ON "Branch"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_userId_key" ON "Employee"("userId");

-- CreateIndex
CREATE INDEX "Employee_tenantId_status_idx" ON "Employee"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Employee_tenantId_managerId_idx" ON "Employee"("tenantId", "managerId");

-- CreateIndex
CREATE INDEX "Employee_tenantId_departmentId_idx" ON "Employee"("tenantId", "departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_tenantId_empCode_key" ON "Employee"("tenantId", "empCode");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_tenantId_officialEmail_key" ON "Employee"("tenantId", "officialEmail");

-- CreateIndex
CREATE INDEX "Notification_tenantId_userId_readAt_idx" ON "Notification"("tenantId", "userId", "readAt");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_createdAt_idx" ON "AuditLog"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_entity_entityId_idx" ON "AuditLog"("tenantId", "entity", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "FileObject_storageKey_key" ON "FileObject"("storageKey");

-- CreateIndex
CREATE INDEX "FileObject_tenantId_category_idx" ON "FileObject"("tenantId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "NumberSequence_tenantId_key_period_key" ON "NumberSequence"("tenantId", "key", "period");

-- CreateIndex
CREATE UNIQUE INDEX "Setting_tenantId_key_key" ON "Setting"("tenantId", "key");

-- CreateIndex
CREATE INDEX "Account_tenantId_type_idx" ON "Account"("tenantId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Account_tenantId_code_key" ON "Account"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Account_tenantId_systemKey_key" ON "Account"("tenantId", "systemKey");

-- CreateIndex
CREATE UNIQUE INDEX "Account_tenantId_partyType_partyId_key" ON "Account"("tenantId", "partyType", "partyId");

-- CreateIndex
CREATE UNIQUE INDEX "Voucher_reversalOfId_key" ON "Voucher"("reversalOfId");

-- CreateIndex
CREATE INDEX "Voucher_tenantId_date_idx" ON "Voucher"("tenantId", "date");

-- CreateIndex
CREATE INDEX "Voucher_tenantId_type_date_idx" ON "Voucher"("tenantId", "type", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Voucher_tenantId_fy_number_key" ON "Voucher"("tenantId", "fy", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Voucher_tenantId_sourceType_sourceId_key" ON "Voucher"("tenantId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "VoucherLine_tenantId_accountId_idx" ON "VoucherLine"("tenantId", "accountId");

-- CreateIndex
CREATE INDEX "VoucherLine_voucherId_idx" ON "VoucherLine"("voucherId");

-- CreateIndex
CREATE INDEX "Invoice_tenantId_status_idx" ON "Invoice"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Invoice_tenantId_clientId_idx" ON "Invoice"("tenantId", "clientId");

-- CreateIndex
CREATE INDEX "Invoice_tenantId_invoiceDate_idx" ON "Invoice"("tenantId", "invoiceDate");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_tenantId_number_key" ON "Invoice"("tenantId", "number");

-- CreateIndex
CREATE INDEX "InvoiceLine_tenantId_invoiceId_idx" ON "InvoiceLine"("tenantId", "invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceTimeEntry_timesheetCellId_key" ON "InvoiceTimeEntry"("timesheetCellId");

-- CreateIndex
CREATE INDEX "InvoiceTimeEntry_tenantId_invoiceId_idx" ON "InvoiceTimeEntry"("tenantId", "invoiceId");

-- CreateIndex
CREATE INDEX "InvoicePayment_tenantId_invoiceId_idx" ON "InvoicePayment"("tenantId", "invoiceId");

-- CreateIndex
CREATE INDEX "InvoiceCreditNote_tenantId_invoiceId_idx" ON "InvoiceCreditNote"("tenantId", "invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceCreditNote_tenantId_number_key" ON "InvoiceCreditNote"("tenantId", "number");

-- CreateIndex
CREATE INDEX "Vendor_tenantId_gstin_idx" ON "Vendor"("tenantId", "gstin");

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_tenantId_name_key" ON "Vendor"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseCategory_tenantId_name_key" ON "PurchaseCategory"("tenantId", "name");

-- CreateIndex
CREATE INDEX "Purchase_tenantId_billDate_idx" ON "Purchase"("tenantId", "billDate");

-- CreateIndex
CREATE INDEX "Purchase_tenantId_itcPeriod_idx" ON "Purchase"("tenantId", "itcPeriod");

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_tenantId_vendorId_vendorInvoiceNo_fy_key" ON "Purchase"("tenantId", "vendorId", "vendorInvoiceNo", "fy");

-- CreateIndex
CREATE INDEX "FilingFolder_tenantId_parentId_idx" ON "FilingFolder"("tenantId", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "FilingFolder_tenantId_systemKey_key" ON "FilingFolder"("tenantId", "systemKey");

-- CreateIndex
CREATE INDEX "FilingDocument_tenantId_folderId_idx" ON "FilingDocument"("tenantId", "folderId");

-- CreateIndex
CREATE INDEX "FilingDocument_tenantId_linkedEntityType_linkedEntityId_idx" ON "FilingDocument"("tenantId", "linkedEntityType", "linkedEntityId");

-- CreateIndex
CREATE INDEX "LeaveType_tenantId_idx" ON "LeaveType"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveType_tenantId_code_key" ON "LeaveType"("tenantId", "code");

-- CreateIndex
CREATE INDEX "LeaveCreditRule_tenantId_idx" ON "LeaveCreditRule"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveCreditRule_tenantId_leaveTypeId_employmentType_effecti_key" ON "LeaveCreditRule"("tenantId", "leaveTypeId", "employmentType", "effectiveFrom");

-- CreateIndex
CREATE INDEX "LeaveCreditBatch_tenantId_startedAt_idx" ON "LeaveCreditBatch"("tenantId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveCreditBatch_tenantId_type_leaveTypeId_periodKey_key" ON "LeaveCreditBatch"("tenantId", "type", "leaveTypeId", "periodKey");

-- CreateIndex
CREATE INDEX "LeaveLedgerEntry_tenantId_employeeId_leaveTypeId_leaveYear_idx" ON "LeaveLedgerEntry"("tenantId", "employeeId", "leaveTypeId", "leaveYear");

-- CreateIndex
CREATE INDEX "LeaveLedgerEntry_tenantId_txType_createdAt_idx" ON "LeaveLedgerEntry"("tenantId", "txType", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveLedgerEntry_batchId_employeeId_leaveTypeId_key" ON "LeaveLedgerEntry"("batchId", "employeeId", "leaveTypeId");

-- CreateIndex
CREATE INDEX "LeaveBalance_tenantId_year_idx" ON "LeaveBalance"("tenantId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveBalance_employeeId_leaveTypeId_year_key" ON "LeaveBalance"("employeeId", "leaveTypeId", "year");

-- CreateIndex
CREATE INDEX "LeaveRequest_tenantId_employeeId_fromDate_idx" ON "LeaveRequest"("tenantId", "employeeId", "fromDate");

-- CreateIndex
CREATE INDEX "LeaveRequest_tenantId_approverEmployeeId_status_idx" ON "LeaveRequest"("tenantId", "approverEmployeeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveRequest_tenantId_requestNo_key" ON "LeaveRequest"("tenantId", "requestNo");

-- CreateIndex
CREATE INDEX "LeaveRequestDay_tenantId_employeeId_date_idx" ON "LeaveRequestDay"("tenantId", "employeeId", "date");

-- CreateIndex
CREATE INDEX "LeaveRequestDay_requestId_idx" ON "LeaveRequestDay"("requestId");

-- CreateIndex
CREATE INDEX "CompOffGrant_tenantId_employeeId_status_expiresOn_idx" ON "CompOffGrant"("tenantId", "employeeId", "status", "expiresOn");

-- CreateIndex
CREATE INDEX "CompOffConsumption_tenantId_requestId_idx" ON "CompOffConsumption"("tenantId", "requestId");

-- CreateIndex
CREATE INDEX "CompOffConsumption_grantId_idx" ON "CompOffConsumption"("grantId");

-- CreateIndex
CREATE UNIQUE INDEX "SalaryComponent_tenantId_code_key" ON "SalaryComponent"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "SalaryTemplate_tenantId_name_key" ON "SalaryTemplate"("tenantId", "name");

-- CreateIndex
CREATE INDEX "EmployeeSalary_tenantId_employeeId_status_idx" ON "EmployeeSalary"("tenantId", "employeeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeSalary_employeeId_effectiveFrom_key" ON "EmployeeSalary"("employeeId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeePayrollProfile_employeeId_key" ON "EmployeePayrollProfile"("employeeId");

-- CreateIndex
CREATE INDEX "EmployeePayrollProfile_tenantId_idx" ON "EmployeePayrollProfile"("tenantId");

-- CreateIndex
CREATE INDEX "PayrollRun_tenantId_periodYear_periodMonth_idx" ON "PayrollRun"("tenantId", "periodYear", "periodMonth");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRun_tenantId_runNo_key" ON "PayrollRun"("tenantId", "runNo");

-- CreateIndex
CREATE INDEX "PayrollItem_tenantId_employeeId_idx" ON "PayrollItem"("tenantId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollItem_runId_employeeId_key" ON "PayrollItem"("runId", "employeeId");

-- CreateIndex
CREATE INDEX "PayrollItemLine_itemId_idx" ON "PayrollItemLine"("itemId");

-- CreateIndex
CREATE INDEX "PayrollAdjustment_tenantId_employeeId_status_idx" ON "PayrollAdjustment"("tenantId", "employeeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollAdjustment_tenantId_sourceType_sourceId_type_forPeri_key" ON "PayrollAdjustment"("tenantId", "sourceType", "sourceId", "type", "forPeriod");

-- CreateIndex
CREATE UNIQUE INDEX "Payslip_itemId_key" ON "Payslip"("itemId");

-- CreateIndex
CREATE INDEX "Payslip_tenantId_employeeId_periodYear_periodMonth_idx" ON "Payslip"("tenantId", "employeeId", "periodYear", "periodMonth");

-- CreateIndex
CREATE INDEX "Payslip_runId_idx" ON "Payslip"("runId");

-- CreateIndex
CREATE INDEX "BankTransferFile_tenantId_runId_idx" ON "BankTransferFile"("tenantId", "runId");

-- CreateIndex
CREATE INDEX "EmployeeDocument_tenantId_employeeId_category_idx" ON "EmployeeDocument"("tenantId", "employeeId", "category");

-- CreateIndex
CREATE INDEX "EmployeeDocument_tenantId_verificationStatus_idx" ON "EmployeeDocument"("tenantId", "verificationStatus");

-- CreateIndex
CREATE INDEX "EmployeeDocument_tenantId_fileId_idx" ON "EmployeeDocument"("tenantId", "fileId");

-- CreateIndex
CREATE UNIQUE INDEX "Onboarding_employeeId_key" ON "Onboarding"("employeeId");

-- CreateIndex
CREATE INDEX "Onboarding_tenantId_status_idx" ON "Onboarding"("tenantId", "status");

-- CreateIndex
CREATE INDEX "OnboardingStep_tenantId_idx" ON "OnboardingStep"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingStep_onboardingId_key_key" ON "OnboardingStep"("onboardingId", "key");

-- CreateIndex
CREATE INDEX "EsignEnvelope_tenantId_subjectEmployeeId_idx" ON "EsignEnvelope"("tenantId", "subjectEmployeeId");

-- CreateIndex
CREATE INDEX "EsignEnvelope_signedSha256_idx" ON "EsignEnvelope"("signedSha256");

-- CreateIndex
CREATE INDEX "EsignEvent_tenantId_envelopeId_at_idx" ON "EsignEvent"("tenantId", "envelopeId", "at");

-- CreateIndex
CREATE INDEX "ExitCase_tenantId_employeeId_idx" ON "ExitCase"("tenantId", "employeeId");

-- CreateIndex
CREATE INDEX "ExitCase_tenantId_status_idx" ON "ExitCase"("tenantId", "status");

-- CreateIndex
CREATE INDEX "ExitChecklistItem_tenantId_idx" ON "ExitChecklistItem"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ExitChecklistItem_exitCaseId_key_key" ON "ExitChecklistItem"("exitCaseId", "key");

-- CreateIndex
CREATE INDEX "EmployeeImport_tenantId_createdAt_idx" ON "EmployeeImport"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PeopleAlertLog_tenantId_key_key" ON "PeopleAlertLog"("tenantId", "key");

-- CreateIndex
CREATE INDEX "Job_tenantId_status_departmentId_idx" ON "Job"("tenantId", "status", "departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Job_tenantId_code_key" ON "Job"("tenantId", "code");

-- CreateIndex
CREATE INDEX "Candidate_tenantId_phone_idx" ON "Candidate"("tenantId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "Candidate_tenantId_email_key" ON "Candidate"("tenantId", "email");

-- CreateIndex
CREATE INDEX "JobApplication_tenantId_stage_idx" ON "JobApplication"("tenantId", "stage");

-- CreateIndex
CREATE INDEX "JobApplication_tenantId_jobId_stage_idx" ON "JobApplication"("tenantId", "jobId", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "JobApplication_candidateId_jobId_key" ON "JobApplication"("candidateId", "jobId");

-- CreateIndex
CREATE INDEX "JobApplicationEvent_tenantId_applicationId_idx" ON "JobApplicationEvent"("tenantId", "applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "InterviewRound_tenantId_name_key" ON "InterviewRound"("tenantId", "name");

-- CreateIndex
CREATE INDEX "Interview_tenantId_startsAt_idx" ON "Interview"("tenantId", "startsAt");

-- CreateIndex
CREATE INDEX "InterviewPanelist_tenantId_employeeId_idx" ON "InterviewPanelist"("tenantId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "InterviewPanelist_interviewId_employeeId_key" ON "InterviewPanelist"("interviewId", "employeeId");

-- CreateIndex
CREATE INDEX "InterviewScorecard_tenantId_idx" ON "InterviewScorecard"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "InterviewScorecard_interviewId_interviewerEmployeeId_key" ON "InterviewScorecard"("interviewId", "interviewerEmployeeId");

-- CreateIndex
CREATE UNIQUE INDEX "JobOffer_applicationId_key" ON "JobOffer"("applicationId");

-- CreateIndex
CREATE INDEX "JobOffer_tenantId_idx" ON "JobOffer"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "KraTemplate_tenantId_name_version_key" ON "KraTemplate"("tenantId", "name", "version");

-- CreateIndex
CREATE INDEX "KraItem_tenantId_templateId_idx" ON "KraItem"("tenantId", "templateId");

-- CreateIndex
CREATE UNIQUE INDEX "AppraisalCycle_tenantId_name_key" ON "AppraisalCycle"("tenantId", "name");

-- CreateIndex
CREATE INDEX "AppraisalParticipant_tenantId_reviewerEmployeeId_idx" ON "AppraisalParticipant"("tenantId", "reviewerEmployeeId");

-- CreateIndex
CREATE INDEX "AppraisalParticipant_tenantId_employeeId_idx" ON "AppraisalParticipant"("tenantId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "AppraisalParticipant_cycleId_employeeId_key" ON "AppraisalParticipant"("cycleId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "AssetCategory_tenantId_name_key" ON "AssetCategory"("tenantId", "name");

-- CreateIndex
CREATE INDEX "Asset_tenantId_status_idx" ON "Asset"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Asset_tenantId_warrantyTill_idx" ON "Asset"("tenantId", "warrantyTill");

-- CreateIndex
CREATE INDEX "Asset_tenantId_currentAssigneeId_idx" ON "Asset"("tenantId", "currentAssigneeId");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_tenantId_assetTag_key" ON "Asset"("tenantId", "assetTag");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_tenantId_serialNo_key" ON "Asset"("tenantId", "serialNo");

-- CreateIndex
CREATE INDEX "AssetAssignment_tenantId_employeeId_idx" ON "AssetAssignment"("tenantId", "employeeId");

-- CreateIndex
CREATE INDEX "AssetAssignment_tenantId_assetId_idx" ON "AssetAssignment"("tenantId", "assetId");

-- CreateIndex
CREATE INDEX "AssetRepair_tenantId_assetId_idx" ON "AssetRepair"("tenantId", "assetId");

-- CreateIndex
CREATE UNIQUE INDEX "WelcomeKitItem_tenantId_name_key" ON "WelcomeKitItem"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "WelcomeKitIssue_employeeId_key" ON "WelcomeKitIssue"("employeeId");

-- CreateIndex
CREATE INDEX "WelcomeKitIssue_tenantId_status_idx" ON "WelcomeKitIssue"("tenantId", "status");

-- CreateIndex
CREATE INDEX "WelcomeKitIssueLine_tenantId_idx" ON "WelcomeKitIssueLine"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "WelcomeKitIssueLine_issueId_itemId_key" ON "WelcomeKitIssueLine"("issueId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "IdCardTemplate_tenantId_name_key" ON "IdCardTemplate"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "IdCard_verifyToken_key" ON "IdCard"("verifyToken");

-- CreateIndex
CREATE INDEX "IdCard_tenantId_status_idx" ON "IdCard"("tenantId", "status");

-- CreateIndex
CREATE INDEX "IdCard_tenantId_employeeId_idx" ON "IdCard"("tenantId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "IdCard_tenantId_serial_key" ON "IdCard"("tenantId", "serial");

-- CreateIndex
CREATE INDEX "IdCardPrintBatch_tenantId_createdAt_idx" ON "IdCardPrintBatch"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VCardProfile_employeeId_key" ON "VCardProfile"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "VCardProfile_tenantId_publicSlug_key" ON "VCardProfile"("tenantId", "publicSlug");

-- CreateIndex
CREATE INDEX "VCardShare_tenantId_employeeId_createdAt_idx" ON "VCardShare"("tenantId", "employeeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_tenantId_key" ON "Subscription"("tenantId");

-- CreateIndex
CREATE INDEX "Subscription_tenantId_idx" ON "Subscription"("tenantId");

-- CreateIndex
CREATE INDEX "Subscription_status_idx" ON "Subscription"("status");

-- CreateIndex
CREATE INDEX "SubscriptionChange_tenantId_createdAt_idx" ON "SubscriptionChange"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PromoCode_code_key" ON "PromoCode"("code");

-- CreateIndex
CREATE INDEX "PromoRedemption_tenantId_status_idx" ON "PromoRedemption"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PromoRedemption_promoId_tenantId_key" ON "PromoRedemption"("promoId", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "SaasInvoice_number_key" ON "SaasInvoice"("number");

-- CreateIndex
CREATE INDEX "SaasInvoice_tenantId_createdAt_idx" ON "SaasInvoice"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "SaasInvoice_status_idx" ON "SaasInvoice"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SaasPayment_gatewayOrderId_key" ON "SaasPayment"("gatewayOrderId");

-- CreateIndex
CREATE INDEX "SaasPayment_tenantId_createdAt_idx" ON "SaasPayment"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GatewayWebhookEvent_eventId_key" ON "GatewayWebhookEvent"("eventId");

-- CreateIndex
CREATE INDEX "GatewayWebhookEvent_tenantId_idx" ON "GatewayWebhookEvent"("tenantId");

-- CreateIndex
CREATE INDEX "SalesLead_tenantId_idx" ON "SalesLead"("tenantId");

-- CreateIndex
CREATE INDEX "BrandingVersion_tenantId_status_idx" ON "BrandingVersion"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BrandingVersion_tenantId_version_key" ON "BrandingVersion"("tenantId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "SupportTicket_number_key" ON "SupportTicket"("number");

-- CreateIndex
CREATE UNIQUE INDEX "SupportTicket_code_key" ON "SupportTicket"("code");

-- CreateIndex
CREATE INDEX "SupportTicket_tenantId_status_idx" ON "SupportTicket"("tenantId", "status");

-- CreateIndex
CREATE INDEX "SupportTicket_status_firstResponseDueAt_idx" ON "SupportTicket"("status", "firstResponseDueAt");

-- CreateIndex
CREATE INDEX "SupportMessage_tenantId_ticketId_idx" ON "SupportMessage"("tenantId", "ticketId");

-- CreateIndex
CREATE INDEX "WorkLocation_tenantId_idx" ON "WorkLocation"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkLocation_tenantId_name_key" ON "WorkLocation"("tenantId", "name");

-- CreateIndex
CREATE INDEX "Shift_tenantId_idx" ON "Shift"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Shift_tenantId_name_key" ON "Shift"("tenantId", "name");

-- CreateIndex
CREATE INDEX "ShiftAssignment_tenantId_employeeId_effectiveFrom_idx" ON "ShiftAssignment"("tenantId", "employeeId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "ShiftAssignment_tenantId_shiftId_idx" ON "ShiftAssignment"("tenantId", "shiftId");

-- CreateIndex
CREATE UNIQUE INDEX "AttendancePolicy_tenantId_audience_key" ON "AttendancePolicy"("tenantId", "audience");

-- CreateIndex
CREATE INDEX "Holiday_tenantId_date_idx" ON "Holiday"("tenantId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_tenantId_date_name_key" ON "Holiday"("tenantId", "date", "name");

-- CreateIndex
CREATE INDEX "AttendanceDay_tenantId_date_status_idx" ON "AttendanceDay"("tenantId", "date", "status");

-- CreateIndex
CREATE INDEX "AttendanceDay_tenantId_employeeId_date_idx" ON "AttendanceDay"("tenantId", "employeeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceDay_employeeId_date_key" ON "AttendanceDay"("employeeId", "date");

-- CreateIndex
CREATE INDEX "AttendancePunch_tenantId_employeeId_punchedAt_idx" ON "AttendancePunch"("tenantId", "employeeId", "punchedAt");

-- CreateIndex
CREATE INDEX "AttendancePunch_tenantId_attendanceDate_idx" ON "AttendancePunch"("tenantId", "attendanceDate");

-- CreateIndex
CREATE UNIQUE INDEX "AttendancePunch_tenantId_source_clientEventId_key" ON "AttendancePunch"("tenantId", "source", "clientEventId");

-- CreateIndex
CREATE INDEX "WorkSession_tenantId_employeeId_attendanceDate_idx" ON "WorkSession"("tenantId", "employeeId", "attendanceDate");

-- CreateIndex
CREATE INDEX "WorkSession_tenantId_endedAt_idx" ON "WorkSession"("tenantId", "endedAt");

-- CreateIndex
CREATE INDEX "AttendanceRegularization_tenantId_approverEmployeeId_status_idx" ON "AttendanceRegularization"("tenantId", "approverEmployeeId", "status");

-- CreateIndex
CREATE INDEX "AttendanceRegularization_tenantId_employeeId_date_idx" ON "AttendanceRegularization"("tenantId", "employeeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "PeriodLock_tenantId_month_key" ON "PeriodLock"("tenantId", "month");

-- CreateIndex
CREATE INDEX "IdCardCheck_tenantId_date_wearing_idx" ON "IdCardCheck"("tenantId", "date", "wearing");

-- CreateIndex
CREATE UNIQUE INDEX "IdCardCheck_tenantId_employeeId_date_key" ON "IdCardCheck"("tenantId", "employeeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "BiometricDevice_serialNumber_key" ON "BiometricDevice"("serialNumber");

-- CreateIndex
CREATE INDEX "BiometricDevice_tenantId_idx" ON "BiometricDevice"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "BiometricEnrollment_tenantId_pin_key" ON "BiometricEnrollment"("tenantId", "pin");

-- CreateIndex
CREATE UNIQUE INDEX "BiometricEnrollment_tenantId_employeeId_key" ON "BiometricEnrollment"("tenantId", "employeeId");

-- CreateIndex
CREATE INDEX "BiometricRawLog_tenantId_processed_idx" ON "BiometricRawLog"("tenantId", "processed");

-- CreateIndex
CREATE INDEX "BiometricRawLog_tenantId_deviceId_receivedAt_idx" ON "BiometricRawLog"("tenantId", "deviceId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BiometricRawLog_deviceId_pin_punchedAtLocal_key" ON "BiometricRawLog"("deviceId", "pin", "punchedAtLocal");

-- CreateIndex
CREATE INDEX "Timesheet_tenantId_status_idx" ON "Timesheet"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Timesheet_tenantId_weekStart_idx" ON "Timesheet"("tenantId", "weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "Timesheet_employeeId_weekStart_key" ON "Timesheet"("employeeId", "weekStart");

-- CreateIndex
CREATE INDEX "TimesheetLine_tenantId_timesheetId_idx" ON "TimesheetLine"("tenantId", "timesheetId");

-- CreateIndex
CREATE INDEX "TimesheetLine_tenantId_projectId_idx" ON "TimesheetLine"("tenantId", "projectId");

-- CreateIndex
CREATE INDEX "TimesheetLine_tenantId_taskId_idx" ON "TimesheetLine"("tenantId", "taskId");

-- CreateIndex
CREATE INDEX "TimesheetCell_tenantId_date_idx" ON "TimesheetCell"("tenantId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "TimesheetCell_lineId_date_key" ON "TimesheetCell"("lineId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "TimesheetIdleDay_timesheetId_date_key" ON "TimesheetIdleDay"("timesheetId", "date");

-- CreateIndex
CREATE INDEX "TimesheetAdjustment_tenantId_timesheetId_idx" ON "TimesheetAdjustment"("tenantId", "timesheetId");

-- CreateIndex
CREATE INDEX "TimesheetAdjustment_tenantId_cellId_idx" ON "TimesheetAdjustment"("tenantId", "cellId");

-- CreateIndex
CREATE INDEX "OutsideHoursEntry_tenantId_timesheetId_idx" ON "OutsideHoursEntry"("tenantId", "timesheetId");

-- CreateIndex
CREATE INDEX "OutsideHoursEntry_tenantId_employeeId_date_idx" ON "OutsideHoursEntry"("tenantId", "employeeId", "date");

-- CreateIndex
CREATE INDEX "TimesheetApprovalStep_tenantId_approverEmployeeId_status_idx" ON "TimesheetApprovalStep"("tenantId", "approverEmployeeId", "status");

-- CreateIndex
CREATE INDEX "TimesheetApprovalStep_tenantId_status_level_idx" ON "TimesheetApprovalStep"("tenantId", "status", "level");

-- CreateIndex
CREATE UNIQUE INDEX "TimesheetApprovalStep_timesheetId_cycle_level_projectId_key" ON "TimesheetApprovalStep"("timesheetId", "cycle", "level", "projectId");

-- CreateIndex
CREATE INDEX "TimesheetItemDecision_tenantId_timesheetId_idx" ON "TimesheetItemDecision"("tenantId", "timesheetId");

-- CreateIndex
CREATE UNIQUE INDEX "TimesheetItemDecision_tenantId_itemType_refId_key" ON "TimesheetItemDecision"("tenantId", "itemType", "refId");

-- CreateIndex
CREATE INDEX "TimesheetEvent_tenantId_timesheetId_idx" ON "TimesheetEvent"("tenantId", "timesheetId");

-- CreateIndex
CREATE INDEX "TrackerDevice_tenantId_userId_status_idx" ON "TrackerDevice"("tenantId", "userId", "status");

-- CreateIndex
CREATE INDEX "TrackerDevice_tenantId_employeeId_idx" ON "TrackerDevice"("tenantId", "employeeId");

-- CreateIndex
CREATE INDEX "TrackerDevice_tenantId_lastSeenAt_idx" ON "TrackerDevice"("tenantId", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "DevicePairingRequest_sessionTokenHash_key" ON "DevicePairingRequest"("sessionTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "DevicePairingRequest_deviceId_key" ON "DevicePairingRequest"("deviceId");

-- CreateIndex
CREATE INDEX "DevicePairingRequest_tenantId_userId_status_idx" ON "DevicePairingRequest"("tenantId", "userId", "status");

-- CreateIndex
CREATE INDEX "DevicePairingRequest_tenantId_status_expiresAt_idx" ON "DevicePairingRequest"("tenantId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "DevicePairingAttempt_tenantId_userId_createdAt_idx" ON "DevicePairingAttempt"("tenantId", "userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TrackerEvent_clientId_key" ON "TrackerEvent"("clientId");

-- CreateIndex
CREATE INDEX "TrackerEvent_tenantId_employeeId_workDate_idx" ON "TrackerEvent"("tenantId", "employeeId", "workDate");

-- CreateIndex
CREATE INDEX "TrackerEvent_tenantId_deviceId_at_idx" ON "TrackerEvent"("tenantId", "deviceId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "ActivitySegment_clientId_key" ON "ActivitySegment"("clientId");

-- CreateIndex
CREATE INDEX "ActivitySegment_tenantId_employeeId_workDate_idx" ON "ActivitySegment"("tenantId", "employeeId", "workDate");

-- CreateIndex
CREATE INDEX "ActivitySegment_tenantId_taskId_workDate_idx" ON "ActivitySegment"("tenantId", "taskId", "workDate");

-- CreateIndex
CREATE UNIQUE INDEX "IdleClaim_segmentId_key" ON "IdleClaim"("segmentId");

-- CreateIndex
CREATE INDEX "IdleClaim_tenantId_employeeId_workDate_idx" ON "IdleClaim"("tenantId", "employeeId", "workDate");

-- CreateIndex
CREATE INDEX "IdleClaim_tenantId_reviewerEmployeeId_status_idx" ON "IdleClaim"("tenantId", "reviewerEmployeeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Screenshot_clientId_key" ON "Screenshot"("clientId");

-- CreateIndex
CREATE INDEX "Screenshot_tenantId_employeeId_workDate_idx" ON "Screenshot"("tenantId", "employeeId", "workDate");

-- CreateIndex
CREATE INDEX "Screenshot_tenantId_taskId_workDate_idx" ON "Screenshot"("tenantId", "taskId", "workDate");

-- CreateIndex
CREATE INDEX "Screenshot_tenantId_purgeAfter_idx" ON "Screenshot"("tenantId", "purgeAfter");

-- CreateIndex
CREATE INDEX "TrackerDaySummary_tenantId_workDate_idx" ON "TrackerDaySummary"("tenantId", "workDate");

-- CreateIndex
CREATE UNIQUE INDEX "TrackerDaySummary_employeeId_workDate_key" ON "TrackerDaySummary"("employeeId", "workDate");

-- CreateIndex
CREATE UNIQUE INDEX "TrackerIntegrityEvent_dedupeKey_key" ON "TrackerIntegrityEvent"("dedupeKey");

-- CreateIndex
CREATE INDEX "TrackerIntegrityEvent_tenantId_employeeId_workDate_idx" ON "TrackerIntegrityEvent"("tenantId", "employeeId", "workDate");

-- CreateIndex
CREATE INDEX "TrackerIntegrityEvent_tenantId_severity_acknowledgedAt_idx" ON "TrackerIntegrityEvent"("tenantId", "severity", "acknowledgedAt");

-- CreateIndex
CREATE INDEX "Client_tenantId_status_idx" ON "Client"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Client_tenantId_code_key" ON "Client"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Client_tenantId_name_key" ON "Client"("tenantId", "name");

-- CreateIndex
CREATE INDEX "Project_tenantId_status_idx" ON "Project"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Project_tenantId_leadEmployeeId_idx" ON "Project"("tenantId", "leadEmployeeId");

-- CreateIndex
CREATE INDEX "Project_tenantId_clientId_idx" ON "Project"("tenantId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_tenantId_key_key" ON "Project"("tenantId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Project_tenantId_name_key" ON "Project"("tenantId", "name");

-- CreateIndex
CREATE INDEX "ProjectModule_tenantId_projectId_idx" ON "ProjectModule"("tenantId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectModule_projectId_name_key" ON "ProjectModule"("projectId", "name");

-- CreateIndex
CREATE INDEX "ProjectMember_tenantId_employeeId_idx" ON "ProjectMember"("tenantId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMember_projectId_employeeId_key" ON "ProjectMember"("projectId", "employeeId");

-- CreateIndex
CREATE INDEX "ProjectDocument_tenantId_projectId_idx" ON "ProjectDocument"("tenantId", "projectId");

-- CreateIndex
CREATE INDEX "ProjectDocument_tenantId_clientId_idx" ON "ProjectDocument"("tenantId", "clientId");

-- CreateIndex
CREATE INDEX "ProjectDocument_tenantId_fileId_idx" ON "ProjectDocument"("tenantId", "fileId");

-- CreateIndex
CREATE INDEX "BoardMember_tenantId_employeeId_idx" ON "BoardMember"("tenantId", "employeeId");

-- CreateIndex
CREATE INDEX "BoardMember_tenantId_projectId_departmentId_idx" ON "BoardMember"("tenantId", "projectId", "departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "BoardMember_projectId_departmentId_employeeId_key" ON "BoardMember"("projectId", "departmentId", "employeeId");

-- CreateIndex
CREATE INDEX "Task_tenantId_projectId_departmentId_status_idx" ON "Task"("tenantId", "projectId", "departmentId", "status");

-- CreateIndex
CREATE INDEX "Task_tenantId_assigneeEmployeeId_status_idx" ON "Task"("tenantId", "assigneeEmployeeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Task_tenantId_key_key" ON "Task"("tenantId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Task_projectId_number_key" ON "Task"("projectId", "number");

-- CreateIndex
CREATE INDEX "TaskComment_tenantId_taskId_createdAt_idx" ON "TaskComment"("tenantId", "taskId", "createdAt");

-- CreateIndex
CREATE INDEX "TaskTransition_tenantId_taskId_at_idx" ON "TaskTransition"("tenantId", "taskId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "GitIntegration_webhookSecretHash_key" ON "GitIntegration"("webhookSecretHash");

-- CreateIndex
CREATE UNIQUE INDEX "GitIntegration_tenantId_provider_key" ON "GitIntegration"("tenantId", "provider");

-- CreateIndex
CREATE INDEX "GitWebhookDelivery_tenantId_receivedAt_idx" ON "GitWebhookDelivery"("tenantId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "GitWebhookDelivery_tenantId_eventUuid_key" ON "GitWebhookDelivery"("tenantId", "eventUuid");

-- CreateIndex
CREATE INDEX "GitCommitLink_tenantId_taskId_idx" ON "GitCommitLink"("tenantId", "taskId");

-- CreateIndex
CREATE UNIQUE INDEX "GitCommitLink_taskId_sha_key" ON "GitCommitLink"("taskId", "sha");

-- CreateIndex
CREATE INDEX "InternTask_tenantId_internEmployeeId_date_idx" ON "InternTask"("tenantId", "internEmployeeId", "date");

-- CreateIndex
CREATE INDEX "InternTask_tenantId_mentorEmployeeId_date_idx" ON "InternTask"("tenantId", "mentorEmployeeId", "date");

-- CreateIndex
CREATE INDEX "InternWeekScore_tenantId_weekStart_idx" ON "InternWeekScore"("tenantId", "weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "InternWeekScore_internEmployeeId_weekStart_key" ON "InternWeekScore"("internEmployeeId", "weekStart");

-- CreateIndex
CREATE INDEX "Quote_tenantId_active_sortOrder_idx" ON "Quote"("tenantId", "active", "sortOrder");

-- CreateIndex
CREATE INDEX "PersonalTodo_tenantId_employeeId_completedAt_idx" ON "PersonalTodo"("tenantId", "employeeId", "completedAt");

-- CreateIndex
CREATE INDEX "CompanyEvent_tenantId_startsAt_idx" ON "CompanyEvent"("tenantId", "startsAt");

-- CreateIndex
CREATE INDEX "Notice_tenantId_status_publishedAt_idx" ON "Notice"("tenantId", "status", "publishedAt");

-- CreateIndex
CREATE INDEX "NoticeAttachment_tenantId_noticeId_idx" ON "NoticeAttachment"("tenantId", "noticeId");

-- CreateIndex
CREATE INDEX "NoticeRecipient_tenantId_employeeId_readAt_idx" ON "NoticeRecipient"("tenantId", "employeeId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "NoticeRecipient_noticeId_employeeId_key" ON "NoticeRecipient"("noticeId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "Post_eotmAwardId_key" ON "Post"("eotmAwardId");

-- CreateIndex
CREATE UNIQUE INDEX "Post_kudosId_key" ON "Post"("kudosId");

-- CreateIndex
CREATE INDEX "Post_tenantId_status_pinned_publishedAt_idx" ON "Post"("tenantId", "status", "pinned", "publishedAt");

-- CreateIndex
CREATE INDEX "PostLike_tenantId_postId_idx" ON "PostLike"("tenantId", "postId");

-- CreateIndex
CREATE UNIQUE INDEX "PostLike_postId_employeeId_key" ON "PostLike"("postId", "employeeId");

-- CreateIndex
CREATE INDEX "PostComment_tenantId_postId_createdAt_idx" ON "PostComment"("tenantId", "postId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Badge_tenantId_name_key" ON "Badge"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Kudos_postId_key" ON "Kudos"("postId");

-- CreateIndex
CREATE INDEX "Kudos_tenantId_recipientEmployeeId_createdAt_idx" ON "Kudos"("tenantId", "recipientEmployeeId", "createdAt");

-- CreateIndex
CREATE INDEX "Kudos_tenantId_createdAt_idx" ON "Kudos"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EotmAward_postId_key" ON "EotmAward"("postId");

-- CreateIndex
CREATE UNIQUE INDEX "EotmAward_certificateId_key" ON "EotmAward"("certificateId");

-- CreateIndex
CREATE UNIQUE INDEX "EotmAward_tenantId_month_key" ON "EotmAward"("tenantId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_verificationCode_key" ON "Certificate"("verificationCode");

-- CreateIndex
CREATE INDEX "Certificate_tenantId_recipientEmployeeId_idx" ON "Certificate"("tenantId", "recipientEmployeeId");

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_tenantId_sourceType_sourceId_key" ON "Certificate"("tenantId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "ChatChannel_tenantId_idx" ON "ChatChannel"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatChannel_tenantId_name_key" ON "ChatChannel"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ChatChannel_tenantId_dmKey_key" ON "ChatChannel"("tenantId", "dmKey");

-- CreateIndex
CREATE INDEX "ChatMember_tenantId_userId_idx" ON "ChatMember"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatMember_channelId_userId_key" ON "ChatMember"("channelId", "userId");

-- CreateIndex
CREATE INDEX "ChatMessage_tenantId_channelId_seq_idx" ON "ChatMessage"("tenantId", "channelId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "ChatMessage_channelId_seq_key" ON "ChatMessage"("channelId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "ChatMessage_channelId_senderUserId_clientMsgId_key" ON "ChatMessage"("channelId", "senderUserId", "clientMsgId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatCall_roomName_key" ON "ChatCall"("roomName");

-- CreateIndex
CREATE INDEX "ChatCall_tenantId_channelId_idx" ON "ChatCall"("tenantId", "channelId");

-- CreateIndex
CREATE UNIQUE INDEX "SupportGroup_tenantId_name_key" ON "SupportGroup"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "TicketCategory_tenantId_name_key" ON "TicketCategory"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "SlaPolicy_tenantId_priority_key" ON "SlaPolicy"("tenantId", "priority");

-- CreateIndex
CREATE INDEX "HelpdeskTicket_tenantId_requesterEmployeeId_status_idx" ON "HelpdeskTicket"("tenantId", "requesterEmployeeId", "status");

-- CreateIndex
CREATE INDEX "HelpdeskTicket_tenantId_assigneeEmployeeId_status_idx" ON "HelpdeskTicket"("tenantId", "assigneeEmployeeId", "status");

-- CreateIndex
CREATE INDEX "HelpdeskTicket_tenantId_status_resolutionDueAt_idx" ON "HelpdeskTicket"("tenantId", "status", "resolutionDueAt");

-- CreateIndex
CREATE UNIQUE INDEX "HelpdeskTicket_tenantId_number_key" ON "HelpdeskTicket"("tenantId", "number");

-- CreateIndex
CREATE INDEX "TicketComment_tenantId_ticketId_createdAt_idx" ON "TicketComment"("tenantId", "ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "Course_tenantId_status_idx" ON "Course"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Lesson_tenantId_courseId_idx" ON "Lesson"("tenantId", "courseId");

-- CreateIndex
CREATE UNIQUE INDEX "Lesson_courseId_order_key" ON "Lesson"("courseId", "order");

-- CreateIndex
CREATE INDEX "CourseAssignment_tenantId_courseId_idx" ON "CourseAssignment"("tenantId", "courseId");

-- CreateIndex
CREATE INDEX "Enrollment_tenantId_employeeId_status_idx" ON "Enrollment"("tenantId", "employeeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Enrollment_courseId_employeeId_key" ON "Enrollment"("courseId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "LessonProgress_enrollmentId_lessonId_key" ON "LessonProgress"("enrollmentId", "lessonId");

-- CreateIndex
CREATE UNIQUE INDEX "Room_tenantId_name_key" ON "Room"("tenantId", "name");

-- CreateIndex
CREATE INDEX "RoomBooking_tenantId_roomId_startAt_idx" ON "RoomBooking"("tenantId", "roomId", "startAt");

-- CreateIndex
CREATE INDEX "RoomBooking_tenantId_hostEmployeeId_startAt_idx" ON "RoomBooking"("tenantId", "hostEmployeeId", "startAt");

-- CreateIndex
CREATE UNIQUE INDEX "Visitor_passToken_key" ON "Visitor"("passToken");

-- CreateIndex
CREATE INDEX "Visitor_tenantId_visitDate_status_idx" ON "Visitor"("tenantId", "visitDate", "status");

-- CreateIndex
CREATE INDEX "Visitor_tenantId_hostEmployeeId_visitDate_idx" ON "Visitor"("tenantId", "hostEmployeeId", "visitDate");

-- CreateIndex
CREATE UNIQUE INDEX "Visitor_tenantId_number_key" ON "Visitor"("tenantId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "HrPolicy_currentVersionId_key" ON "HrPolicy"("currentVersionId");

-- CreateIndex
CREATE INDEX "HrPolicy_tenantId_status_idx" ON "HrPolicy"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "HrPolicyVersion_policyId_version_key" ON "HrPolicyVersion"("policyId", "version");

-- CreateIndex
CREATE INDEX "PolicyAck_tenantId_employeeId_acknowledgedAt_idx" ON "PolicyAck"("tenantId", "employeeId", "acknowledgedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyAck_policyVersionId_employeeId_key" ON "PolicyAck"("policyVersionId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "GameSession_startToken_key" ON "GameSession"("startToken");

-- CreateIndex
CREATE INDEX "GameSession_tenantId_puzzleDate_gameKey_idx" ON "GameSession"("tenantId", "puzzleDate", "gameKey");

-- CreateIndex
CREATE UNIQUE INDEX "GameSession_tenantId_employeeId_gameKey_puzzleDate_key" ON "GameSession"("tenantId", "employeeId", "gameKey", "puzzleDate");

-- CreateIndex
CREATE UNIQUE INDEX "Camera_gatewayPath_key" ON "Camera"("gatewayPath");

-- CreateIndex
CREATE UNIQUE INDEX "Camera_tenantId_name_key" ON "Camera"("tenantId", "name");

-- CreateIndex
CREATE INDEX "CameraViewSession_tenantId_cameraId_startedAt_idx" ON "CameraViewSession"("tenantId", "cameraId", "startedAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_designationId_fkey" FOREIGN KEY ("designationId") REFERENCES "Designation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherLine" ADD CONSTRAINT "VoucherLine_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "Voucher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherLine" ADD CONSTRAINT "VoucherLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceTimeEntry" ADD CONSTRAINT "InvoiceTimeEntry_invoiceLineId_fkey" FOREIGN KEY ("invoiceLineId") REFERENCES "InvoiceLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoicePayment" ADD CONSTRAINT "InvoicePayment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceCreditNote" ADD CONSTRAINT "InvoiceCreditNote_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "PurchaseCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FilingFolder" ADD CONSTRAINT "FilingFolder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "FilingFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FilingDocument" ADD CONSTRAINT "FilingDocument_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "FilingFolder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveCreditRule" ADD CONSTRAINT "LeaveCreditRule_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveLedgerEntry" ADD CONSTRAINT "LeaveLedgerEntry_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveBalance" ADD CONSTRAINT "LeaveBalance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveBalance" ADD CONSTRAINT "LeaveBalance_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequestDay" ADD CONSTRAINT "LeaveRequestDay_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "LeaveRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompOffGrant" ADD CONSTRAINT "CompOffGrant_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeSalary" ADD CONSTRAINT "EmployeeSalary_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeePayrollProfile" ADD CONSTRAINT "EmployeePayrollProfile_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollItem" ADD CONSTRAINT "PayrollItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollItem" ADD CONSTRAINT "PayrollItem_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollItemLine" ADD CONSTRAINT "PayrollItemLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "PayrollItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingStep" ADD CONSTRAINT "OnboardingStep_onboardingId_fkey" FOREIGN KEY ("onboardingId") REFERENCES "Onboarding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EsignEvent" ADD CONSTRAINT "EsignEvent_envelopeId_fkey" FOREIGN KEY ("envelopeId") REFERENCES "EsignEnvelope"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExitChecklistItem" ADD CONSTRAINT "ExitChecklistItem_exitCaseId_fkey" FOREIGN KEY ("exitCaseId") REFERENCES "ExitCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobApplication" ADD CONSTRAINT "JobApplication_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobApplication" ADD CONSTRAINT "JobApplication_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobApplicationEvent" ADD CONSTRAINT "JobApplicationEvent_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "JobApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "JobApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewPanelist" ADD CONSTRAINT "InterviewPanelist_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewScorecard" ADD CONSTRAINT "InterviewScorecard_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobOffer" ADD CONSTRAINT "JobOffer_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "JobApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KraItem" ADD CONSTRAINT "KraItem_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "KraTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppraisalParticipant" ADD CONSTRAINT "AppraisalParticipant_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "AppraisalCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "AssetCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetAssignment" ADD CONSTRAINT "AssetAssignment_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetRepair" ADD CONSTRAINT "AssetRepair_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WelcomeKitIssueLine" ADD CONSTRAINT "WelcomeKitIssueLine_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "WelcomeKitIssue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionChange" ADD CONSTRAINT "SubscriptionChange_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoRedemption" ADD CONSTRAINT "PromoRedemption_promoId_fkey" FOREIGN KEY ("promoId") REFERENCES "PromoCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaasPayment" ADD CONSTRAINT "SaasPayment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SaasInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftAssignment" ADD CONSTRAINT "ShiftAssignment_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimesheetLine" ADD CONSTRAINT "TimesheetLine_timesheetId_fkey" FOREIGN KEY ("timesheetId") REFERENCES "Timesheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimesheetCell" ADD CONSTRAINT "TimesheetCell_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "TimesheetLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimesheetIdleDay" ADD CONSTRAINT "TimesheetIdleDay_timesheetId_fkey" FOREIGN KEY ("timesheetId") REFERENCES "Timesheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimesheetApprovalStep" ADD CONSTRAINT "TimesheetApprovalStep_timesheetId_fkey" FOREIGN KEY ("timesheetId") REFERENCES "Timesheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectModule" ADD CONSTRAINT "ProjectModule_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectDocument" ADD CONSTRAINT "ProjectDocument_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardMember" ADD CONSTRAINT "BoardMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskTransition" ADD CONSTRAINT "TaskTransition_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitCommitLink" ADD CONSTRAINT "GitCommitLink_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoticeAttachment" ADD CONSTRAINT "NoticeAttachment_noticeId_fkey" FOREIGN KEY ("noticeId") REFERENCES "Notice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoticeRecipient" ADD CONSTRAINT "NoticeRecipient_noticeId_fkey" FOREIGN KEY ("noticeId") REFERENCES "Notice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostLike" ADD CONSTRAINT "PostLike_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostComment" ADD CONSTRAINT "PostComment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Kudos" ADD CONSTRAINT "Kudos_badgeId_fkey" FOREIGN KEY ("badgeId") REFERENCES "Badge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMember" ADD CONSTRAINT "ChatMember_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "ChatChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "ChatChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketCategory" ADD CONSTRAINT "TicketCategory_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "SupportGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketComment" ADD CONSTRAINT "TicketComment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "HelpdeskTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseAssignment" ADD CONSTRAINT "CourseAssignment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonProgress" ADD CONSTRAINT "LessonProgress_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomBooking" ADD CONSTRAINT "RoomBooking_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrPolicyVersion" ADD CONSTRAINT "HrPolicyVersion_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "HrPolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyAck" ADD CONSTRAINT "PolicyAck_policyVersionId_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "HrPolicyVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

