import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { StorageModule } from '../storage/storage.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GoogleOAuthService } from './google-oauth.service';
import { GoogleEnabledGuard } from './guards/google-enabled.guard';
import { GoogleStrategy, JwtStrategy } from './strategies/auth.strategies';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    StorageModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('jwt.secret'),
        signOptions: {
          expiresIn: (configService.get<string>('jwt.expiresIn') ??
            '7d') as `${number}d`,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    GoogleOAuthService,
    GoogleEnabledGuard,
    JwtStrategy,
    {
      provide: 'GOOGLE_STRATEGY_INIT',
      useFactory: (
        configService: ConfigService,
        googleOAuthService: GoogleOAuthService,
      ) => {
        const clientId = configService.get<string>('google.clientId');
        const clientSecret = configService.get<string>('google.clientSecret');

        if (clientId && clientSecret) {
          return new GoogleStrategy(configService, googleOAuthService);
        }

        return null;
      },
      inject: [ConfigService, GoogleOAuthService],
    },
  ],
  exports: [AuthService, GoogleOAuthService, JwtModule],
})
export class AuthModule {}
