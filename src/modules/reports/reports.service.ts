import { Injectable } from '@nestjs/common';
import { BookingStatus, PaymentStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { decimalToNumber } from '../../common/utils/helpers';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async dashboard() {
    const [
      totalBookings,
      completedPayments,
      activeUsers,
      totalRooms,
      occupiedRooms,
    ] = await Promise.all([
      this.prisma.booking.count(),
      this.prisma.payment.findMany({
        where: { status: PaymentStatus.COMPLETED },
        select: { amount: true },
      }),
      this.prisma.user.count({ where: { role: 'USER' } }),
      this.prisma.room.count(),
      this.prisma.room.count({ where: { status: 'OCCUPIED' } }),
    ]);

    const totalRevenue = completedPayments.reduce(
      (sum, p) => sum + decimalToNumber(p.amount),
      0,
    );

    const occupancyRate =
      totalRooms === 0 ? 0 : Math.round((occupiedRooms / totalRooms) * 10000) / 100;

    return {
      totalBookings,
      totalRevenue,
      occupancyRate,
      activeUsers,
    };
  }

  async revenueReport(from?: string, to?: string) {
    const payments = await this.prisma.payment.findMany({
      where: {
        status: PaymentStatus.COMPLETED,
        ...(from || to
          ? {
              paidAt: {
                ...(from ? { gte: new Date(from) } : {}),
                ...(to ? { lte: new Date(to) } : {}),
              },
            }
          : {}),
      },
      include: {
        booking: {
          include: { hotel: { select: { name: true } } },
        },
      },
      orderBy: { paidAt: 'desc' },
    });

    const total = payments.reduce((sum, p) => sum + decimalToNumber(p.amount), 0);

    return {
      total,
      count: payments.length,
      items: payments.map((p) => ({
        paymentId: p.id,
        amount: decimalToNumber(p.amount),
        paidAt: p.paidAt,
        hotel: p.booking.hotel.name,
        bookingCode: p.booking.bookingCode,
      })),
    };
  }

  async bookingReport(status?: BookingStatus) {
    const bookings = await this.prisma.booking.findMany({
      where: status ? { status } : {},
      include: {
        hotel: { select: { name: true } },
        user: { select: { email: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      total: bookings.length,
      items: bookings.map((b) => ({
        id: b.id,
        bookingCode: b.bookingCode,
        status: b.status,
        totalAmount: decimalToNumber(b.totalAmount),
        hotel: b.hotel.name,
        guest: `${b.user.firstName} ${b.user.lastName}`,
        checkInDate: b.checkInDate,
        checkOutDate: b.checkOutDate,
      })),
    };
  }

  async occupancyReport() {
    const hotels = await this.prisma.hotel.findMany({
      include: {
        rooms: { select: { status: true } },
        _count: { select: { bookings: true } },
      },
    });

    return hotels.map((hotel) => {
      const total = hotel.rooms.length;
      const occupied = hotel.rooms.filter((r) => r.status === 'OCCUPIED').length;
      return {
        hotelId: hotel.id,
        hotelName: hotel.name,
        totalRooms: total,
        occupiedRooms: occupied,
        occupancyRate: total === 0 ? 0 : Math.round((occupied / total) * 10000) / 100,
        totalBookings: hotel._count.bookings,
      };
    });
  }

  async userReport() {
    const users = await this.prisma.user.findMany({
      include: { _count: { select: { bookings: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return users.map((u) => ({
      id: u.id,
      email: u.email,
      name: `${u.firstName} ${u.lastName}`,
      role: u.role,
      bookingCount: u._count.bookings,
      createdAt: u.createdAt,
    }));
  }
}
