import { Body, Controller, Get, Headers, HttpCode, Param, Patch, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  billingProfileSchema,
  checkoutSchema,
  confirmPaymentSchema,
  contactSalesSchema,
  promoSchema,
  quoteSchema,
  seatsSchema,
  type BillingProfileInput,
  type CheckoutInput,
  type ConfirmPaymentInput,
  type ContactSalesInput,
  type PromoInput,
  type QuoteInput,
  type SeatsInput,
} from '@lexisora/shared';
import { Public, RequirePerm } from '../../../core/auth/decorators';
import { ZodPipe } from '../../../core/http/zod.pipe';
import { BillingService } from './billing.service';

/** Subscription & billing (`billing.manage`): plans, checkout, seats, promo codes, SaaS invoices. */
@Controller('billing')
@RequirePerm('billing.manage')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('overview')
  overview() {
    return this.billing.overview();
  }

  @Post('quote')
  @HttpCode(200)
  quote(@Body(new ZodPipe(quoteSchema)) dto: QuoteInput) {
    return this.billing.quote(dto);
  }

  /** Upgrade / renew / change cycle → creates a pending order on the gateway. */
  @Post('checkout')
  checkout(@Body(new ZodPipe(checkoutSchema)) dto: CheckoutInput) {
    return this.billing.checkout(dto);
  }

  @Get('checkout/:orderId')
  checkoutDetail(@Param('orderId') orderId: string) {
    return this.billing.checkoutDetail(orderId);
  }

  /** Mock gateway checkout page → "Pay" / "Fail" (posts a signed event to ourselves). */
  @Post('checkout/:orderId/confirm')
  @HttpCode(200)
  confirm(@Param('orderId') orderId: string, @Body(new ZodPipe(confirmPaymentSchema)) dto: ConfirmPaymentInput) {
    return this.billing.confirmMock(orderId, dto.outcome);
  }

  @Post('seats/quote')
  @HttpCode(200)
  seatQuote(@Body(new ZodPipe(seatsSchema)) dto: SeatsInput) {
    return this.billing.seatQuote(dto.quantity);
  }

  @Post('seats')
  seats(@Body(new ZodPipe(seatsSchema)) dto: SeatsInput) {
    return this.billing.changeSeats(dto.quantity);
  }

  @Post('downgrade')
  downgrade() {
    return this.billing.downgrade();
  }

  @Post('downgrade/cancel')
  cancelDowngrade() {
    return this.billing.cancelDowngrade();
  }

  @Post('promo')
  promo(@Body(new ZodPipe(promoSchema)) dto: PromoInput) {
    return this.billing.applyPromo(dto.code);
  }

  @Post('contact-sales')
  contactSales(@Body(new ZodPipe(contactSalesSchema)) dto: ContactSalesInput) {
    return this.billing.contactSales(dto);
  }

  @Patch('profile')
  profile(@Body(new ZodPipe(billingProfileSchema)) dto: BillingProfileInput) {
    return this.billing.updateProfile(dto);
  }

  @Get('invoices')
  invoices() {
    return this.billing.invoices();
  }

  @Get('invoices/:id/pdf')
  async invoicePdf(@Param('id') id: string, @Res() res: Response) {
    const pdf = await this.billing.invoicePdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${pdf.filename}"`);
    res.send(pdf.data);
  }

  /** "Pay now" on an issued / overdue invoice. */
  @Post('invoices/:id/pay')
  pay(@Param('id') id: string) {
    return this.billing.payInvoice(id);
  }

  /** Payment gateway webhooks (Razorpay / mock): signature-verified and idempotent. */
  @Public()
  @Post('webhooks/:gateway')
  @HttpCode(200)
  webhook(@Param('gateway') gateway: string, @Headers() headers: Record<string, string | string[] | undefined>, @Body() body: unknown) {
    return this.billing.handleWebhook(gateway, headers, body);
  }
}
