import {
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import { User } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { Role } from '../../common/enums/role.enum';

export type GoogleProfileInput = {
  googleId: string;
  email: string;
  firstName: string;
  lastName: string;
  avatar?: string;
};

@Injectable()
export class GoogleOAuthService {
  private oauthClient: OAuth2Client | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  isEnabled(): boolean {
    return Boolean(
      this.configService.get<string>('google.clientId') &&
        this.configService.get<string>('google.clientSecret'),
    );
  }

  assertEnabled(): void {
    if (!this.isEnabled()) {
      throw new ServiceUnavailableException(
        'Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.',
      );
    }
  }

  getPublicConfig() {
    const appUrl = this.configService.get<string>('appUrl') ?? 'http://localhost:3000';
    return {
      enabled: this.isEnabled(),
      userAuthMethod: 'google_oauth',
      loginUrl: `${appUrl}/api/v1/auth/google`,
      tokenUrl: `${appUrl}/api/v1/auth/google/token`,
      callbackUrl:
        this.configService.get<string>('google.callbackUrl') ??
        `${appUrl}/api/v1/auth/google/callback`,
    };
  }

  async findOrCreateFromGoogleProfile(profile: GoogleProfileInput): Promise<User> {
    const byGoogleId = await this.prisma.user.findUnique({
      where: { googleId: profile.googleId },
    });

    if (byGoogleId) {
      this.assertNotAdminGoogleLogin(byGoogleId);
      return this.syncGoogleProfile(byGoogleId, profile);
    }

    const byEmail = await this.prisma.user.findUnique({
      where: { email: profile.email },
    });

    if (byEmail) {
      this.assertNotAdminGoogleLogin(byEmail);

      if (byEmail.googleId && byEmail.googleId !== profile.googleId) {
        throw new UnauthorizedException(
          'This email is linked to a different Google account',
        );
      }

      return this.prisma.user.update({
        where: { id: byEmail.id },
        data: {
          googleId: profile.googleId,
          firstName: profile.firstName,
          lastName: profile.lastName,
          avatar: profile.avatar ?? byEmail.avatar,
          emailVerified: true,
        },
      });
    }

    return this.prisma.user.create({
      data: {
        email: profile.email,
        googleId: profile.googleId,
        firstName: profile.firstName,
        lastName: profile.lastName,
        avatar: profile.avatar,
        emailVerified: true,
        role: Role.USER,
      },
    });
  }

  async verifyIdToken(idToken: string): Promise<User> {
    this.assertEnabled();

    const clientId = this.configService.getOrThrow<string>('google.clientId');
    const client = this.getOAuthClient();

    let payload;
    try {
      const ticket = await client.verifyIdToken({
        idToken,
        audience: clientId,
      });
      payload = ticket.getPayload();
    } catch {
      throw new UnauthorizedException('Invalid Google ID token');
    }

    if (!payload?.email || !payload.sub) {
      throw new UnauthorizedException('Google token is missing required claims');
    }

    if (payload.email_verified === false) {
      throw new UnauthorizedException('Google email is not verified');
    }

    return this.findOrCreateFromGoogleProfile({
      googleId: payload.sub,
      email: payload.email,
      firstName: payload.given_name ?? 'Google',
      lastName: payload.family_name ?? 'User',
      avatar: payload.picture,
    });
  }

  private getOAuthClient(): OAuth2Client {
    if (!this.oauthClient) {
      this.oauthClient = new OAuth2Client(
        this.configService.getOrThrow<string>('google.clientId'),
      );
    }
    return this.oauthClient;
  }

  private assertNotAdminGoogleLogin(user: User): void {
    if (user.role === Role.ADMIN) {
      throw new ForbiddenException(
        'Admin accounts must sign in with email and password at /auth/admin/login',
      );
    }
  }

  private syncGoogleProfile(user: User, profile: GoogleProfileInput): Promise<User> {
    return this.prisma.user.update({
      where: { id: user.id },
      data: {
        firstName: profile.firstName,
        lastName: profile.lastName,
        avatar: profile.avatar ?? user.avatar,
        emailVerified: true,
      },
    });
  }
}
