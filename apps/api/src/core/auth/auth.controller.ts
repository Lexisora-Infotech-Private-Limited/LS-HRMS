import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  type LoginInput,
} from '@lexisora/shared';
import { env } from '../../config/env';
import { ZodPipe } from '../http/zod.pipe';
import { AppError } from '../http/errors';
import { requireContext } from '../context/request-context';
import { AuthService } from './auth.service';
import { Public } from './decorators';

const COOKIE = 'lx_rt';
const cookieOpts = () => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : env.NODE_ENV === 'production',
  path: '/api/v1/auth',
  maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86400_000,
});
const meta = (req: Request) => ({ ip: req.ip, userAgent: req.headers['user-agent'] });

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body(new ZodPipe(loginSchema)) dto: LoginInput, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const r = await this.auth.login(dto, meta(req));
    // Browser clients keep the refresh token in an httpOnly cookie; native clients get it in the body.
    if (dto.client === 'web') {
      res.cookie(COOKIE, r.refreshToken, cookieOpts());
      const { refreshToken: _omit, ...rest } = r;
      return rest;
    }
    return r;
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: { refreshToken?: string }) {
    const token = req.cookies?.[COOKIE] ?? body?.refreshToken;
    if (!token) throw new AppError(401, 'SESSION_EXPIRED', 'Please sign in again');
    const r = await this.auth.refresh(token, meta(req));
    if (req.cookies?.[COOKIE]) {
      res.cookie(COOKIE, r.refreshToken, cookieOpts());
      const { refreshToken: _omit, ...rest } = r;
      return rest;
    }
    return r;
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: { refreshToken?: string }) {
    await this.auth.logout(req.cookies?.[COOKIE] ?? body?.refreshToken);
    res.clearCookie(COOKIE, { path: '/api/v1/auth' });
  }

  @Get('me')
  me() {
    return this.auth.sessionUser(requireContext().userId!);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(204)
  async forgot(@Body(new ZodPipe(forgotPasswordSchema)) dto: z.infer<typeof forgotPasswordSchema>) {
    await this.auth.forgotPassword(dto.workspace, dto.email);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(204)
  async reset(@Body(new ZodPipe(resetPasswordSchema)) dto: z.infer<typeof resetPasswordSchema>) {
    await this.auth.resetPassword(dto.token, dto.password);
  }

  @Post('change-password')
  @HttpCode(204)
  async change(@Body(new ZodPipe(changePasswordSchema)) dto: z.infer<typeof changePasswordSchema>) {
    await this.auth.changePassword(requireContext().userId!, dto.currentPassword, dto.newPassword);
  }

  @Public()
  @Post('accept-invite')
  @HttpCode(200)
  async acceptInvite(
    @Body(new ZodPipe(z.object({ token: z.string().min(10), password: z.string().min(8, 'At least 8 characters') }))) dto: { token: string; password: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.auth.acceptInvite(dto.token, dto.password, meta(req));
    res.cookie(COOKIE, r.refreshToken, cookieOpts());
    const { refreshToken: _omit, ...rest } = r;
    return rest;
  }

  /** "Use SSO" on the login screen. SAML/OIDC is configured per tenant (adapter); until then, explain. */
  @Public()
  @Post('sso/start')
  @HttpCode(200)
  async ssoStart(@Body(new ZodPipe(z.object({ workspace: z.string().min(1) }))) dto: { workspace: string }) {
    const t = await this.auth.resolveTenant(dto.workspace);
    throw new AppError(501, 'SSO_NOT_CONFIGURED', `Single sign-on is not configured for ${t.domain}. Ask your admin to enable it.`);
  }
}
