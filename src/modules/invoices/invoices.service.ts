import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BookingStatus } from '@prisma/client';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../../database/prisma.service';
import { StorageService } from '../storage/storage.service';
import { StorageFolder } from '../storage/storage.constants';
import { decimalToNumber } from '../../common/utils/helpers';

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
  ) {}

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

    const pdfBuffer = await this.buildPdf(booking, {
      invoiceNumber,
      subtotal,
      taxAmount,
      totalAmount,
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
        issuedAt: new Date(),
      },
      create: {
        bookingId,
        invoiceNumber,
        pdfUrl,
        subtotal,
        taxAmount,
        totalAmount,
      },
    });
  }

  async findByBooking(bookingId: string) {
    const invoice = await this.prisma.invoice.findUnique({ where: { bookingId } });
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    return invoice;
  }

  async getPdfBuffer(bookingId: string): Promise<{ buffer: Buffer; invoiceNumber: string }> {
    const invoice = await this.findByBooking(bookingId);

    if (invoice.pdfUrl?.startsWith('data:')) {
      const base64 = invoice.pdfUrl.split(',')[1];
      return { buffer: Buffer.from(base64, 'base64'), invoiceNumber: invoice.invoiceNumber };
    }

    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { hotel: true, room: true, user: true, guests: true },
    });

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    const buffer = await this.buildPdf(booking, {
      invoiceNumber: invoice.invoiceNumber,
      subtotal: decimalToNumber(invoice.subtotal),
      taxAmount: decimalToNumber(invoice.taxAmount),
      totalAmount: decimalToNumber(invoice.totalAmount),
    });

    return { buffer, invoiceNumber: invoice.invoiceNumber };
  }

  private buildPdf(
    booking: {
      bookingCode: string;
      checkInDate: Date;
      checkOutDate: Date;
      hotel: { name: string; address: string; city: string };
      room: { name: string; roomNumber: string };
      user: { firstName: string; lastName: string; email: string };
      guests: { firstName: string; lastName: string }[];
    },
    totals: {
      invoiceNumber: string;
      subtotal: number;
      taxAmount: number;
      totalAmount: number;
    },
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50 });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(20).text('Hotel Invoice', { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text(`Invoice #: ${totals.invoiceNumber}`);
      doc.text(`Booking Code: ${booking.bookingCode}`);
      doc.text(`Date: ${new Date().toLocaleDateString()}`);
      doc.moveDown();
      doc.text(`Hotel: ${booking.hotel.name}`);
      doc.text(`Address: ${booking.hotel.address}, ${booking.hotel.city}`);
      doc.text(`Room: ${booking.room.name} (${booking.room.roomNumber})`);
      doc.moveDown();
      doc.text(`Guest: ${booking.user.firstName} ${booking.user.lastName}`);
      doc.text(`Email: ${booking.user.email}`);
      doc.text(
        `Stay: ${booking.checkInDate.toISOString().slice(0, 10)} → ${booking.checkOutDate.toISOString().slice(0, 10)}`,
      );
      doc.moveDown();
      doc.text(`Subtotal: $${totals.subtotal.toFixed(2)}`);
      doc.text(`Tax (13%): $${totals.taxAmount.toFixed(2)}`);
      doc.fontSize(14).text(`Total: $${totals.totalAmount.toFixed(2)}`, { underline: true });
      doc.end();
    });
  }
}
