import { plainToInstance, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  ValidateIf,
  validateSync,
} from 'class-validator';

class EnvironmentVariables {
  @IsString()
  @IsNotEmpty()
  DATABASE_URL: string;

  @IsString()
  @IsNotEmpty()
  DIRECT_URL: string;

  @IsString()
  @IsNotEmpty()
  JWT_SECRET: string;

  @IsString()
  @IsNotEmpty()
  JWT_REFRESH_SECRET: string;

  @IsString()
  @IsOptional()
  JWT_EXPIRES_IN?: string;

  @IsString()
  @IsOptional()
  JWT_REFRESH_EXPIRES_IN?: string;

  @IsString()
  @IsOptional()
  GOOGLE_CLIENT_ID?: string;

  @IsString()
  @IsOptional()
  GOOGLE_CLIENT_SECRET?: string;

  @IsString()
  @IsOptional()
  GOOGLE_CALLBACK_URL?: string;

  @IsUrl({ require_tld: false })
  @IsOptional()
  GOOGLE_SUCCESS_REDIRECT_URL?: string;

  @ValidateIf((env: EnvironmentVariables) => env.NODE_ENV !== 'test')
  @IsString()
  @IsNotEmpty()
  S3_BUCKET?: string;

  @ValidateIf((env: EnvironmentVariables) => env.NODE_ENV !== 'test')
  @IsString()
  @IsNotEmpty()
  S3_REGION?: string;

  @ValidateIf((env: EnvironmentVariables) => env.NODE_ENV !== 'test')
  @IsString()
  @IsNotEmpty()
  S3_ACCESS_KEY_ID?: string;

  @ValidateIf((env: EnvironmentVariables) => env.NODE_ENV !== 'test')
  @IsString()
  @IsNotEmpty()
  S3_SECRET_ACCESS_KEY?: string;

  @IsUrl({ require_tld: false })
  @IsOptional()
  S3_ENDPOINT?: string;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  S3_FORCE_PATH_STYLE?: boolean;

  @IsUrl({ require_tld: false })
  @IsOptional()
  S3_PUBLIC_URL_BASE?: string;

  @IsIn(['development', 'production', 'test'])
  @IsOptional()
  NODE_ENV?: string;
}

export function validateEnv(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validated, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(errors.toString());
  }

  return validated;
}
