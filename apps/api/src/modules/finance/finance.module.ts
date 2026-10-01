import { Module } from '@nestjs/common';
import { LedgerService } from './ledger.service';
import { InvoiceService } from './invoice.service';
import { PurchaseService } from './purchase.service';
import { FilingService } from './filing.service';
import { ComplianceService } from './compliance.service';
import { SpineReader } from './spine';
import { FinanceRegistry } from './finance.registry';
import { AccountsController, LedgerController, VouchersController } from './ledger.controller';
import { InvoicesController } from './invoice.controller';
import { PurchasesController, VendorsController } from './purchase.controller';
import { FilingController } from './filing.controller';

/**
 * Finance domain (docs/specs/spec-workfin.md Modules G–J): chart of accounts + double-entry
 * ledger (manual, HR and auto-posted vouchers), GST invoices from approved billable hours,
 * purchases & input GST (bill OCR, GSTR-3B), filing cabinet with auto-filing and the
 * compliance calendar. Imports nothing from other domains (ARCHITECTURE §5): spine models are
 * read via Prisma (`SpineReader`), payroll arrives as the `payroll.finalized` event.
 */
@Module({
  imports: [],
  controllers: [LedgerController, VouchersController, AccountsController, InvoicesController, PurchasesController, VendorsController, FilingController],
  providers: [SpineReader, LedgerService, FilingService, InvoiceService, PurchaseService, ComplianceService, FinanceRegistry],
  exports: [LedgerService],
})
export class FinanceModule {}
