import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BookingStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { StorageService } from '../storage/storage.service';
import { StorageFolder } from '../storage/storage.constants';
import { paginate } from '../../common/dto/pagination.dto';
import { decimalToNumber } from '../../common/utils/helpers';
import { InvoiceQueryDto } from './dto/invoice.dto';
import { buildInvoicePdf } from './invoice-pdf.builder';

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
  ) {}

  async findAll(query: InvoiceQueryDto) {
    const { skip, take, page, limit } = paginate(query.page, query.limit ?? 12);
    const search = query.search?.trim();

    const where: Prisma.InvoiceWhereInput = search
      ? {
          OR: [
            { invoiceNumber: { contains: search, mode: 'insensitive' } },
            { booking: { bookingCode: { contains: search, mode: 'insensitive' } } },
            { booking: { hotel: { name: { contains: search, mode: 'insensitive' } } } },
            { booking: { hotel: { city: { contains: search, mode: 'insensitive' } } } },
            { booking: { user: { email: { contains: search, mode: 'insensitive' } } } },
            { booking: { user: { firstName: { contains: search, mode: 'insensitive' } } } },
            { booking: { user: { lastName: { contains: search, mode: 'insensitive' } } } },
          ],
        }
      : {};

    const [items, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        skip,
        take,
        orderBy: { issuedAt: 'desc' },
        include: {
          booking: {
            select: {
              id: true,
              bookingCode: true,
              status: true,
              checkInDate: true,
              checkOutDate: true,
              totalAmount: true,
              hotel: { select: { id: true, name: true, city: true } },
              room: { select: { id: true, name: true, roomNumber: true } },
              user: {
                select: {
                  id: true,
                  email: true,
                  firstName: true,
                  lastName: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return {
      items: items.map((invoice) => ({
        id: invoice.id,
        bookingId: invoice.bookingId,
        invoiceNumber: invoice.invoiceNumber,
        subtotal: decimalToNumber(invoice.subtotal),
        taxAmount: decimalToNumber(invoice.taxAmount),
        totalAmount: decimalToNumber(invoice.totalAmount),
        issuedAt: invoice.issuedAt,
        booking: {
          ...invoice.booking,
          totalAmount: decimalToNumber(invoice.booking.totalAmount),
        },
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 0,
    };
  }

  async generate(bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        hotel: true,
        room: true,
        user: true,
        guests: true,
        payment: true,
      },
    });

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    const allowedStatuses: BookingStatus[] = [
      BookingStatus.CHECKED_IN,
      BookingStatus.CHECKED_OUT,
      BookingStatus.COMPLETED,
    ];

    if (!allowedStatuses.includes(booking.status)) {
      throw new BadRequestException(
        'Invoice can only be generated after check-in or check-out',
      );
    }

    const subtotal = decimalToNumber(booking.totalAmount);
    const taxAmount = Math.round(subtotal * 0.13 * 100) / 100;
    const totalAmount = subtotal + taxAmount;
    const invoiceNumber = `INV-${Date.now()}-${booking.bookingCode.slice(0, 6).toUpperCase()}`;

    const issuedAt = new Date();
    const pdfBuffer = await buildInvoicePdf(booking, {
      invoiceNumber,
      subtotal,
      taxAmount,
      totalAmount,
      issuedAt,
    });

    let pdfUrl: string | undefined;

    if (this.storageService.isEnabled()) {
      const uploaded = await this.storageService.uploadBuffer(
        `${StorageFolder.INVOICES}/${invoiceNumber}.pdf`,
        pdfBuffer,
        'application/pdf',
      );
      pdfUrl = uploaded.url;
    } else {
      pdfUrl = `data:application/pdf;base64,${pdfBuffer.toString('base64')}`;
    }

    return this.prisma.invoice.upsert({
      where: { bookingId },
      update: {
        invoiceNumber,
        pdfUrl,
        subtotal,
        taxAmount,
        totalAmount,
        issuedAt,
      },
      create: {
        bookingId,
        invoiceNumber,
        pdfUrl,
        subtotal,
        taxAmount,
        totalAmount,
        issuedAt,
      },
    }).then((invoice) => ({
      ...invoice,
      subtotal: decimalToNumber(invoice.subtotal),
      taxAmount: decimalToNumber(invoice.taxAmount),
      totalAmount: decimalToNumber(invoice.totalAmount),
    }));
  }

  async findByBooking(bookingId: string) {
    const invoice = await this.prisma.invoice.findUnique({ where: { bookingId } });
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    return {
      ...invoice,
      subtotal: decimalToNumber(invoice.subtotal),
      taxAmount: decimalToNumber(invoice.taxAmount),
      totalAmount: decimalToNumber(invoice.totalAmount),
    };
  }

  async getPdfBuffer(bookingId: string): Promise<{ buffer: Buffer; invoiceNumber: string }> {
    const invoice = await this.findByBooking(bookingId);

    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        hotel: true,
        room: true,
        user: true,
        guests: true,
        payment: true,
      },
    });

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    // Always rebuild from the current template so design updates apply to existing invoices.
    const buffer = await buildInvoicePdf(booking, {
      invoiceNumber: invoice.invoiceNumber,
      subtotal: decimalToNumber(invoice.subtotal),
      taxAmount: decimalToNumber(invoice.taxAmount),
      totalAmount: decimalToNumber(invoice.totalAmount),
      issuedAt: invoice.issuedAt,
    });

    return { buffer, invoiceNumber: invoice.invoiceNumber };
  }
}
