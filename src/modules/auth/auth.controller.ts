import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { User } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import {
  GoogleAuthGuard,
  JwtAuthGuard,
  RolesGuard,
} from '../../common/guards/auth.guards';
import { GoogleEnabledGuard } from './guards/google-enabled.guard';
import { AuthService } from './auth.service';
import {
  GoogleIdTokenDto,
  LoginDto,
  RefreshTokenDto,
  UpdateProfileDto,
} from './dto/auth.dto';
import { GoogleOAuthService } from './google-oauth.service';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly googleOAuthService: GoogleOAuthService,
    private readonly configService: ConfigService,
  ) {}

  @Post('admin/login')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Admin login (email and password)' })
  adminLogin(@Body() dto: LoginDto) {
    return this.authService.adminLogin(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Refresh access token' })
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshTokens(dto.refreshToken);
  }

  @Get('google/status')
  @ApiOperation({ summary: 'Check whether Google OAuth is configured' })
  googleStatus() {
    return this.googleOAuthService.getPublicConfig();
  }

  @Get('google')
  @UseGuards(GoogleEnabledGuard, GoogleAuthGuard)
  @ApiOperation({ summary: 'Initiate Google OAuth login (browser redirect)' })
  googleAuth() {
    return { message: 'Redirecting to Google...' };
  }

  @Get('google/callback')
  @UseGuards(GoogleEnabledGuard, GoogleAuthGuard)
  @ApiOperation({ summary: 'Google OAuth callback' })
  async googleCallback(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = req.user as User;
    const result = await this.authService.loginWithGoogle(user);
    const redirectUrl = this.configService.get<string>('google.successRedirectUrl');

    if (redirectUrl) {
      const url = new URL(redirectUrl);
      url.searchParams.set('accessToken', result.tokens.accessToken);
      url.searchParams.set('refreshToken', result.tokens.refreshToken);
      res.redirect(url.toString());
      return;
    }

    return result;
  }

  @Post('google/token')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Sign in with Google ID token (mobile / SPA Sign-In)',
  })
  async googleToken(@Body() dto: GoogleIdTokenDto) {
    const user = await this.googleOAuthService.verifyIdToken(dto.idToken);
    return this.authService.loginWithGoogle(user);
  }

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile' })
  getProfile(@CurrentUser('id') userId: string) {
    return this.authService.getProfile(userId);
  }

  @Patch('profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update current user profile' })
  updateProfile(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.authService.updateProfile(userId, dto);
  }

  @Get('admin/me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get admin profile' })
  adminProfile(@CurrentUser('id') userId: string) {
    return this.authService.getProfile(userId);
  }
}
