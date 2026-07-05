import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role as PrismaRole } from '@prisma/client';
import { Role } from '../../common/enums/role.enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard, RolesGuard } from '../../common/guards/auth.guards';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { BookingsService } from './bookings.service';
import {
  CreateBookingDto,
  GuestDocumentDto,
  GuestPhotoDto,
  RejectBookingDto,
  SearchAvailabilityDto,
  BookingQueryDto,
} from './dto/booking.dto';

@ApiTags('Bookings')
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Get('search')
  @ApiOperation({ summary: 'Search available rooms' })
  search(@Query() query: SearchAvailabilityDto) {
    return this.bookingsService.searchAvailability(query);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a booking' })
  create(@CurrentUser('id') userId: string, @Body() dto: CreateBookingDto) {
    return this.bookingsService.create(userId, dto);
  }

  @Get('my')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List current user bookings' })
  findMy(@CurrentUser('id') userId: string, @Query() pagination: PaginationDto) {
    return this.bookingsService.findMyBookings(userId, pagination);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get booking details' })
  findOne(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: PrismaRole,
  ) {
    return this.bookingsService.findOne(id, userId, role);
  }

  @Get(':id/validate')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Validate booking readiness (payment + documents)' })
  validate(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: PrismaRole,
  ) {
    return this.bookingsService.validateBooking(id, userId, role);
  }

  @Post(':id/documents')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Attach guest document URL to booking' })
  addDocument(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: GuestDocumentDto,
  ) {
    return this.bookingsService.addDocument(id, userId, dto);
  }

  @Post(':id/photos')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Attach guest photo URL to booking' })
  addPhoto(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: GuestPhotoDto,
  ) {
    return this.bookingsService.addPhoto(id, userId, dto);
  }
}

@ApiTags('Admin Bookings')
@Controller('admin/bookings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@ApiBearerAuth()
export class AdminBookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Get()
  @ApiOperation({ summary: 'List all bookings (admin)' })
  findAll(@Query() query: BookingQueryDto) {
    return this.bookingsService.findAll(query, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get booking by id (admin)' })
  findOne(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.bookingsService.findOne(id, userId, PrismaRole.ADMIN);
  }

  @Patch(':id/approve')
  @ApiOperation({ summary: 'Approve booking (admin)' })
  approve(@Param('id') id: string) {
    return this.bookingsService.approve(id);
  }

  @Patch(':id/reject')
  @ApiOperation({ summary: 'Reject booking (admin)' })
  reject(@Param('id') id: string, @Body() dto: RejectBookingDto) {
    return this.bookingsService.reject(id, dto);
  }

  @Patch(':id/verify')
  @ApiOperation({ summary: 'Verify guest documents (admin)' })
  verify(@Param('id') id: string) {
    return this.bookingsService.verifyGuestDocuments(id);
  }

  @Patch(':id/check-in')
  @ApiOperation({ summary: 'Guest check-in (admin)' })
  checkIn(@Param('id') id: string) {
    return this.bookingsService.checkIn(id);
  }

  @Patch(':id/check-out')
  @ApiOperation({ summary: 'Guest check-out (admin)' })
  checkOut(@Param('id') id: string) {
    return this.bookingsService.checkOut(id);
  }

  @Patch(':id/complete')
  @ApiOperation({ summary: 'Mark booking completed (admin)' })
  complete(@Param('id') id: string) {
    return this.bookingsService.complete(id);
  }
}
