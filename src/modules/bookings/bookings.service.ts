import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BookingStatus,
  PaymentStatus,
  Prisma,
  Role,
  RoomStatus,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { paginate, PaginationDto } from '../../common/dto/pagination.dto';
import { calculateNights, decimalToNumber } from '../../common/utils/helpers';
import { StorageService } from '../storage/storage.service';
import {
  BookingQueryDto,
  CreateBookingDto,
  GuestDocumentDto,
  GuestPhotoDto,
  RejectBookingDto,
  SearchAvailabilityDto,
} from './dto/booking.dto';

const bookingInclude = {
  hotel: { select: { id: true, name: true, slug: true, city: true, address: true } },
  room: { include: { category: true, images: true } },
  user: { select: { id: true, email: true, firstName: true, lastName: true, phone: true } },
  guests: true,
  documents: true,
  photos: true,
  payment: true,
  invoice: true,
};

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
  ) {}

  async searchAvailability(query: SearchAvailabilityDto) {
    this.validateDates(query.checkInDate, query.checkOutDate);

    const checkIn = new Date(query.checkInDate);
    const checkOut = new Date(query.checkOutDate);

    const conflictingBookingRoomIds = await this.prisma.booking.findMany({
      where: {
        status: {
          in: [
            BookingStatus.PENDING,
            BookingStatus.CONFIRMED,
            BookingStatus.APPROVED,
            BookingStatus.CHECKED_IN,
          ],
        },
        checkInDate: { lt: checkOut },
        checkOutDate: { gt: checkIn },
      },
      select: { roomId: true },
    });

    const blockedRoomIds = conflictingBookingRoomIds.map((b) => b.roomId);

    const rooms = await this.prisma.room.findMany({
      where: {
        status: RoomStatus.AVAILABLE,
        id: { notIn: blockedRoomIds },
        ...(query.guests ? { capacity: { gte: query.guests } } : {}),
        ...(query.hotelId ? { hotelId: query.hotelId } : {}),
        hotel: {
          status: 'ACTIVE',
          ...(query.city ? { city: { contains: query.city, mode: 'insensitive' } } : {}),
        },
      },
      include: {
        hotel: { select: { id: true, name: true, slug: true, city: true, starRating: true } },
        category: true,
        images: { where: { isPrimary: true }, take: 1 },
      },
      orderBy: { pricePerNight: 'asc' },
    });

    const nights = calculateNights(checkIn, checkOut);

    return Promise.all(
      rooms.map(async (room) => ({
        ...room,
        images: await this.storageService.resolveAccessibleUrls(room.images),
        pricePerNight: decimalToNumber(room.pricePerNight),
        nights,
        estimatedTotal: decimalToNumber(room.pricePerNight) * nights,
        available: true,
      })),
    );
  }

  async create(userId: string, dto: CreateBookingDto) {
    this.validateDates(dto.checkInDate, dto.checkOutDate);

    const room = await this.prisma.room.findUnique({
      where: { id: dto.roomId },
      include: { hotel: true },
    });

    if (!room || room.status !== RoomStatus.AVAILABLE) {
      throw new BadRequestException('Room is not available');
    }

    if (room.capacity < dto.guestCount) {
      throw new BadRequestException('Room capacity exceeded');
    }

    const checkIn = new Date(dto.checkInDate);
    const checkOut = new Date(dto.checkOutDate);

    const conflict = await this.prisma.booking.findFirst({
      where: {
        roomId: dto.roomId,
        status: {
          in: [
            BookingStatus.PENDING,
            BookingStatus.CONFIRMED,
            BookingStatus.APPROVED,
            BookingStatus.CHECKED_IN,
          ],
        },
        checkInDate: { lt: checkOut },
        checkOutDate: { gt: checkIn },
      },
    });

    if (conflict) {
      throw new BadRequestException('Room is not available for selected dates');
    }

    const nights = calculateNights(checkIn, checkOut);
    const totalAmount = decimalToNumber(room.pricePerNight) * nights;

    return this.prisma.booking.create({
      data: {
        userId,
        hotelId: room.hotelId,
        roomId: room.id,
        checkInDate: checkIn,
        checkOutDate: checkOut,
        guestCount: dto.guestCount,
        totalAmount,
        specialNotes: dto.specialNotes,
        guests: { create: dto.guests },
      },
      include: bookingInclude,
    });
  }

  async findMyBookings(userId: string, pagination: PaginationDto) {
    const { skip, take, page, limit } = paginate(pagination.page, pagination.limit);

    const [items, total] = await Promise.all([
      this.prisma.booking.findMany({
        where: { userId },
        skip,
        take,
        include: bookingInclude,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.booking.count({ where: { userId } }),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findAll(query: BookingQueryDto, pagination: PaginationDto) {
    const { skip, take, page, limit } = paginate(pagination.page, pagination.limit);
    const where: Prisma.BookingWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.hotelId ? { hotelId: query.hotelId } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.booking.findMany({
        where,
        skip,
        take,
        include: bookingInclude,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.booking.count({ where }),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, userId: string, role: Role) {
    const booking = await this.prisma.booking.findUnique({
      where: { id },
      include: bookingInclude,
    });

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    if (role !== Role.ADMIN && booking.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    return booking;
  }

  async approve(id: string) {
    const booking = await this.ensureBooking(id);
    this.assertStatus(booking.status, [BookingStatus.CONFIRMED, BookingStatus.PENDING]);

    const payment = await this.prisma.payment.findUnique({ where: { bookingId: id } });
    if (!payment || payment.status !== PaymentStatus.COMPLETED) {
      throw new BadRequestException('Payment must be completed before approval');
    }

    const docs = await this.prisma.guestDocument.count({ where: { bookingId: id } });
    if (docs === 0) {
      throw new BadRequestException('Guest documents required before approval');
    }

    return this.prisma.booking.update({
      where: { id },
      data: { status: BookingStatus.APPROVED },
      include: bookingInclude,
    });
  }

  async reject(id: string, dto: RejectBookingDto) {
    const booking = await this.ensureBooking(id);
    this.assertStatus(booking.status, [
      BookingStatus.PENDING,
      BookingStatus.CONFIRMED,
      BookingStatus.APPROVED,
    ]);

    return this.prisma.booking.update({
      where: { id },
      data: {
        status: BookingStatus.REJECTED,
        specialNotes: dto.reason
          ? `${booking.specialNotes ?? ''}\nRejected: ${dto.reason}`.trim()
          : booking.specialNotes,
      },
      include: bookingInclude,
    });
  }

  async verifyGuestDocuments(id: string) {
    await this.ensureBooking(id);
    await this.prisma.guestDocument.updateMany({
      where: { bookingId: id },
      data: { verified: true },
    });

    return this.prisma.booking.findUnique({
      where: { id },
      include: bookingInclude,
    });
  }

  async checkIn(id: string) {
    const booking = await this.ensureBooking(id);
    this.assertStatus(booking.status, [BookingStatus.APPROVED]);

    const [updatedBooking] = await this.prisma.$transaction([
      this.prisma.booking.update({
        where: { id },
        data: { status: BookingStatus.CHECKED_IN },
        include: bookingInclude,
      }),
      this.prisma.room.update({
        where: { id: booking.roomId },
        data: { status: RoomStatus.OCCUPIED },
      }),
    ]);

    return updatedBooking;
  }

  async checkOut(id: string) {
    const booking = await this.ensureBooking(id);
    this.assertStatus(booking.status, [BookingStatus.CHECKED_IN]);

    const [updatedBooking] = await this.prisma.$transaction([
      this.prisma.booking.update({
        where: { id },
        data: { status: BookingStatus.CHECKED_OUT },
        include: bookingInclude,
      }),
      this.prisma.room.update({
        where: { id: booking.roomId },
        data: { status: RoomStatus.AVAILABLE },
      }),
    ]);

    return updatedBooking;
  }

  async complete(id: string) {
    const booking = await this.ensureBooking(id);
    this.assertStatus(booking.status, [BookingStatus.CHECKED_OUT]);

    return this.prisma.booking.update({
      where: { id },
      data: { status: BookingStatus.COMPLETED },
      include: bookingInclude,
    });
  }

  async addDocument(bookingId: string, userId: string, dto: GuestDocumentDto) {
    const booking = await this.ensureBooking(bookingId);
    if (booking.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    return this.prisma.guestDocument.create({
      data: {
        bookingId,
        userId,
        url: dto.url,
        type: dto.type ?? 'ID',
      },
    });
  }

  async addPhoto(bookingId: string, userId: string, dto: GuestPhotoDto) {
    const booking = await this.ensureBooking(bookingId);
    if (booking.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    return this.prisma.guestPhoto.create({
      data: { bookingId, userId, url: dto.url },
    });
  }

  async validateBooking(id: string, userId: string, role: Role) {
    const booking = await this.findOne(id, userId, role);
    const payment = booking.payment;
    const hasDocuments = booking.documents.length > 0;
    const hasPhotos = booking.photos.length > 0;
    const paymentCompleted = payment?.status === PaymentStatus.COMPLETED;

    return {
      bookingId: id,
      status: booking.status,
      paymentCompleted,
      hasDocuments,
      hasPhotos,
      documentsVerified: booking.documents.every((d) => d.verified),
      readyForApproval:
        paymentCompleted && hasDocuments && booking.status === BookingStatus.CONFIRMED,
    };
  }

  async markConfirmedAfterPayment(bookingId: string) {
    return this.prisma.booking.update({
      where: { id: bookingId },
      data: { status: BookingStatus.CONFIRMED },
      include: bookingInclude,
    });
  }

  private validateDates(checkIn: string, checkOut: string) {
    const inDate = new Date(checkIn);
    const outDate = new Date(checkOut);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (inDate >= outDate) {
      throw new BadRequestException('Check-out must be after check-in');
    }

    if (inDate < today) {
      throw new BadRequestException('Check-in date cannot be in the past');
    }
  }

  private async ensureBooking(id: string) {
    const booking = await this.prisma.booking.findUnique({ where: { id } });
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }
    return booking;
  }

  private assertStatus(current: BookingStatus, allowed: BookingStatus[]) {
    if (!allowed.includes(current)) {
      throw new BadRequestException(`Cannot transition from status ${current}`);
    }
  }
}
