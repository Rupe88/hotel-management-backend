import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { BookingStatus } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { JwtAuthGuard, RolesGuard } from '../../common/guards/auth.guards';
import { ReportsService } from './reports.service';

@ApiTags('Reports')
@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@ApiBearerAuth()
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Dashboard KPIs' })
  dashboard() {
    return this.reportsService.dashboard();
  }

  @Get('revenue')
  @ApiOperation({ summary: 'Revenue report' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  revenue(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reportsService.revenueReport(from, to);
  }

  @Get('bookings')
  @ApiOperation({ summary: 'Booking report' })
  @ApiQuery({ name: 'status', required: false, enum: BookingStatus })
  bookings(@Query('status') status?: BookingStatus) {
    return this.reportsService.bookingReport(status);
  }

  @Get('occupancy')
  @ApiOperation({ summary: 'Occupancy report' })
  occupancy() {
    return this.reportsService.occupancyReport();
  }

  @Get('users')
  @ApiOperation({ summary: 'User report' })
  users() {
    return this.reportsService.userReport();
  }
}
