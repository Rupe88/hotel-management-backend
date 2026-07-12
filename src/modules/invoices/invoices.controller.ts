import {
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Role as PrismaRole } from '@prisma/client';
import { Role } from '../../common/enums/role.enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard, RolesGuard } from '../../common/guards/auth.guards';
import { InvoicesService } from './invoices.service';
import { PrismaService } from '../../database/prisma.service';
import { InvoiceQueryDto } from './dto/invoice.dto';

@ApiTags('Invoices')
@Controller('invoices')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class InvoicesController {
  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly prisma: PrismaService,
  ) {}

  @Post(':bookingId')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Generate invoice for booking (admin)' })
  generate(@Param('bookingId') bookingId: string) {
    return this.invoicesService.generate(bookingId);
  }

  @Get(':bookingId')
  @ApiOperation({ summary: 'Get invoice metadata' })
  async findOne(
    @Param('bookingId') bookingId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: PrismaRole,
  ) {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }
    if (role !== Role.ADMIN && booking.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }
    return this.invoicesService.findByBooking(bookingId);
  }

  @Get(':bookingId/pdf')
  @ApiOperation({ summary: 'Download invoice PDF' })
  @Header('Content-Type', 'application/pdf')
  async downloadPdf(
    @Param('bookingId') bookingId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: PrismaRole,
    @Res() res: Response,
  ) {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }
    if (role !== Role.ADMIN && booking.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    const { buffer, invoiceNumber } = await this.invoicesService.getPdfBuffer(bookingId);
    res.setHeader('Content-Disposition', `attachment; filename="${invoiceNumber}.pdf"`);
    res.send(buffer);
  }
}

@ApiTags('Admin Invoices')
@Controller('admin/invoices')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@ApiBearerAuth()
export class AdminInvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Get()
  @ApiOperation({ summary: 'List invoices with search and pagination (admin)' })
  findAll(@Query() query: InvoiceQueryDto) {
    return this.invoicesService.findAll(query);
  }
}
