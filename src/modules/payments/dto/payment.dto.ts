import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CheckoutDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  bookingId: string;
}

export class VerifySessionDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  sessionId: string;
}
