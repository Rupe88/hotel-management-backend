import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Role as PrismaRole } from '@prisma/client';
import { Role } from '../../common/enums/role.enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard, RolesGuard } from '../../common/guards/auth.guards';
import { PaymentsService } from './payments.service';
import { CheckoutDto } from './dto/payment.dto';

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('checkout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create Stripe checkout session' })
  checkout(@CurrentUser('id') userId: string, @Body() dto: CheckoutDto) {
    return this.paymentsService.createCheckoutSession(dto.bookingId, userId);
  }

  @Get(':bookingId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get payment status for booking' })
  getStatus(
    @Param('bookingId') bookingId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: PrismaRole,
  ) {
    return this.paymentsService.getPaymentStatus(
      bookingId,
      userId,
      role === PrismaRole.ADMIN,
    );
  }

  @Post('webhook')
  @ApiOperation({ summary: 'Stripe webhook handler' })
  webhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('stripe-signature') signature: string,
  ) {
    return this.paymentsService.handleWebhook(req.rawBody as Buffer, signature);
  }
}

@ApiTags('Admin Payments')
@Controller('admin/payments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@ApiBearerAuth()
export class AdminPaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get(':bookingId')
  @ApiOperation({ summary: 'Check payment status (admin)' })
  getStatus(@Param('bookingId') bookingId: string, @CurrentUser('id') userId: string) {
    return this.paymentsService.getPaymentStatus(bookingId, userId, true);
  }
}
