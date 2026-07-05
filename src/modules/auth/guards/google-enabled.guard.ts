import { CanActivate, Injectable } from '@nestjs/common';
import { GoogleOAuthService } from '../google-oauth.service';

@Injectable()
export class GoogleEnabledGuard implements CanActivate {
  constructor(private readonly googleOAuthService: GoogleOAuthService) {}

  canActivate(): boolean {
    this.googleOAuthService.assertEnabled();
    return true;
  }
}
