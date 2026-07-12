import PDFDocument from 'pdfkit';

const COLORS = {
  ink: '#14212B',
  muted: '#5C6B76',
  line: '#D7DEE5',
  soft: '#F4F7F9',
  accent: '#1F6F5B',
  accentSoft: '#E8F3EF',
  white: '#FFFFFF',
  total: '#0F3D32',
};

export type InvoicePdfBooking = {
  bookingCode: string;
  checkInDate: Date;
  checkOutDate: Date;
  guestCount: number;
  specialNotes?: string | null;
  hotel: {
    name: string;
    address: string;
    city: string;
    state?: string | null;
    country: string;
    zipCode?: string | null;
  };
  room: {
    name: string;
    roomNumber: string;
    pricePerNight?: { toString(): string } | number | null;
  };
  user: {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string | null;
  };
  guests: { firstName: string; lastName: string }[];
  payment?: {
    status: string;
    currency?: string | null;
    paymentMethod?: string | null;
    paidAt?: Date | null;
    amount?: { toString(): string } | number | null;
  } | null;
};

export type InvoicePdfTotals = {
  invoiceNumber: string;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  issuedAt?: Date;
  taxLabel?: string;
};

function money(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
}

function formatLongDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

function formatShortDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function nightsBetween(checkIn: Date, checkOut: Date): number {
  const ms = checkOut.getTime() - checkIn.getTime();
  return Math.max(1, Math.round(ms / (1000 * 60 * 60 * 24)));
}

function toNumber(value: { toString(): string } | number | null | undefined): number | null {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : Number(value.toString());
  return Number.isFinite(n) ? n : null;
}

function paymentLabel(status?: string | null): string {
  switch (status) {
    case 'COMPLETED':
    case 'PAID':
      return 'Paid';
    case 'PENDING':
      return 'Pending';
    case 'FAILED':
      return 'Failed';
    case 'REFUNDED':
      return 'Refunded';
    default:
      return status ? status.replaceAll('_', ' ') : 'Unpaid';
  }
}

export function buildInvoicePdf(
  booking: InvoicePdfBooking,
  totals: InvoicePdfTotals,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 0,
      info: {
        Title: `Invoice ${totals.invoiceNumber}`,
        Author: 'StayNest',
        Subject: `Hotel invoice for booking ${booking.bookingCode}`,
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const marginX = 48;
    const contentWidth = pageWidth - marginX * 2;
    const currency = booking.payment?.currency || 'USD';
    const issuedAt = totals.issuedAt ?? new Date();
    const nights = nightsBetween(booking.checkInDate, booking.checkOutDate);
    const rateFromRoom = toNumber(booking.room.pricePerNight);
    const nightlyRate =
      rateFromRoom != null && rateFromRoom > 0
        ? rateFromRoom
        : Math.round((totals.subtotal / nights) * 100) / 100;
    const taxLabel = totals.taxLabel ?? 'GST / VAT (13%)';

    // Top brand bar
    doc.rect(0, 0, pageWidth, 8).fill(COLORS.accent);

    // Header band
    doc.rect(0, 8, pageWidth, 108).fill(COLORS.soft);

    doc
      .fillColor(COLORS.accent)
      .font('Helvetica-Bold')
      .fontSize(22)
      .text('StayNest', marginX, 28, { width: contentWidth / 2 });

    doc
      .fillColor(COLORS.muted)
      .font('Helvetica')
      .fontSize(9)
      .text('Hospitality Management', marginX, 54);

    doc
      .fillColor(COLORS.ink)
      .font('Helvetica-Bold')
      .fontSize(28)
      .text('INVOICE', marginX + contentWidth / 2, 28, {
        width: contentWidth / 2,
        align: 'right',
      });

    doc
      .fillColor(COLORS.muted)
      .font('Helvetica')
      .fontSize(10)
      .text(totals.invoiceNumber, marginX + contentWidth / 2, 62, {
        width: contentWidth / 2,
        align: 'right',
      });

    let y = 140;

    // Meta chips
    const meta = [
      { label: 'Issued', value: formatLongDate(issuedAt) },
      { label: 'Booking', value: booking.bookingCode },
      { label: 'Payment', value: paymentLabel(booking.payment?.status) },
    ];

    const chipGap = 12;
    const chipWidth = (contentWidth - chipGap * 2) / 3;

    meta.forEach((item, index) => {
      const x = marginX + index * (chipWidth + chipGap);
      doc.roundedRect(x, y, chipWidth, 46, 6).fill(COLORS.soft);
      doc
        .fillColor(COLORS.muted)
        .font('Helvetica')
        .fontSize(8)
        .text(item.label.toUpperCase(), x + 12, y + 10, { width: chipWidth - 24 });
      doc
        .fillColor(COLORS.ink)
        .font('Helvetica-Bold')
        .fontSize(10)
        .text(item.value, x + 12, y + 24, {
          width: chipWidth - 24,
          ellipsis: true,
        });
    });

    y += 70;

    // Bill from / Bill to
    const colWidth = (contentWidth - 24) / 2;
    const hotelAddress = [
      booking.hotel.address,
      [booking.hotel.city, booking.hotel.state].filter(Boolean).join(', '),
      [booking.hotel.country, booking.hotel.zipCode].filter(Boolean).join(' '),
    ]
      .filter(Boolean)
      .join('\n');

    const guestName = `${booking.user.firstName} ${booking.user.lastName}`.trim();
    const guestLines = [booking.user.email, booking.user.phone || null]
      .filter(Boolean)
      .join('\n');

    doc
      .fillColor(COLORS.accent)
      .font('Helvetica-Bold')
      .fontSize(8)
      .text('FROM', marginX, y);
    doc
      .fillColor(COLORS.ink)
      .font('Helvetica-Bold')
      .fontSize(12)
      .text(booking.hotel.name, marginX, y + 14, { width: colWidth });
    doc
      .fillColor(COLORS.muted)
      .font('Helvetica')
      .fontSize(9)
      .text(hotelAddress, marginX, y + 32, { width: colWidth, lineGap: 2 });

    doc
      .fillColor(COLORS.accent)
      .font('Helvetica-Bold')
      .fontSize(8)
      .text('BILL TO', marginX + colWidth + 24, y);
    doc
      .fillColor(COLORS.ink)
      .font('Helvetica-Bold')
      .fontSize(12)
      .text(guestName, marginX + colWidth + 24, y + 14, { width: colWidth });
    doc
      .fillColor(COLORS.muted)
      .font('Helvetica')
      .fontSize(9)
      .text(guestLines, marginX + colWidth + 24, y + 32, {
        width: colWidth,
        lineGap: 2,
      });

    y += 110;

    // Stay summary
    doc
      .fillColor(COLORS.ink)
      .font('Helvetica-Bold')
      .fontSize(11)
      .text('Stay summary', marginX, y);

    y += 18;
    doc.moveTo(marginX, y).lineTo(marginX + contentWidth, y).strokeColor(COLORS.line).lineWidth(1).stroke();
    y += 14;

    const stayRows: Array<[string, string]> = [
      ['Check-in', formatShortDate(booking.checkInDate)],
      ['Check-out', formatShortDate(booking.checkOutDate)],
      ['Nights', String(nights)],
      ['Guests', String(booking.guestCount)],
      ['Room', `${booking.room.name} · #${booking.room.roomNumber}`],
    ];

    stayRows.forEach(([label, value], index) => {
      const rowY = y + index * 18;
      doc
        .fillColor(COLORS.muted)
        .font('Helvetica')
        .fontSize(9)
        .text(label, marginX, rowY, { width: 120 });
      doc
        .fillColor(COLORS.ink)
        .font('Helvetica-Bold')
        .fontSize(9)
        .text(value, marginX + 130, rowY, { width: contentWidth - 130 });
    });

    y += stayRows.length * 18 + 24;

    if (booking.guests.length > 0) {
      const guestNames = booking.guests
        .map((g) => `${g.firstName} ${g.lastName}`.trim())
        .join(', ');
      doc
        .fillColor(COLORS.muted)
        .font('Helvetica')
        .fontSize(9)
        .text('Registered guests', marginX, y, { width: 120 });
      doc
        .fillColor(COLORS.ink)
        .font('Helvetica')
        .fontSize(9)
        .text(guestNames, marginX + 130, y, { width: contentWidth - 130 });
      y += 28;
    }

    // Line items table
    doc
      .fillColor(COLORS.ink)
      .font('Helvetica-Bold')
      .fontSize(11)
      .text('Charges', marginX, y);
    y += 16;

    const tableTop = y;
    const cols = {
      desc: marginX,
      qty: marginX + contentWidth - 220,
      rate: marginX + contentWidth - 150,
      amount: marginX + contentWidth - 70,
    };

    doc.roundedRect(marginX, tableTop, contentWidth, 28, 4).fill(COLORS.ink);
    doc
      .fillColor(COLORS.white)
      .font('Helvetica-Bold')
      .fontSize(8)
      .text('DESCRIPTION', cols.desc + 12, tableTop + 10)
      .text('QTY', cols.qty, tableTop + 10, { width: 40, align: 'right' })
      .text('RATE', cols.rate, tableTop + 10, { width: 55, align: 'right' })
      .text('AMOUNT', cols.amount, tableTop + 10, { width: 58, align: 'right' });

    y = tableTop + 28;

    const lineItems = [
      {
        description: `Room accommodation — ${booking.room.name} (#${booking.room.roomNumber})`,
        qty: nights,
        rate: nightlyRate,
        amount: totals.subtotal,
      },
    ];

    lineItems.forEach((item, index) => {
      const rowH = 36;
      if (index % 2 === 0) {
        doc.rect(marginX, y, contentWidth, rowH).fill(COLORS.soft);
      }

      doc
        .fillColor(COLORS.ink)
        .font('Helvetica')
        .fontSize(9)
        .text(item.description, cols.desc + 12, y + 12, {
          width: cols.qty - cols.desc - 20,
        });
      doc
        .fillColor(COLORS.ink)
        .font('Helvetica')
        .fontSize(9)
        .text(String(item.qty), cols.qty, y + 12, { width: 40, align: 'right' })
        .text(money(item.rate, currency), cols.rate, y + 12, {
          width: 55,
          align: 'right',
        })
        .text(money(item.amount, currency), cols.amount, y + 12, {
          width: 58,
          align: 'right',
        });

      y += rowH;
    });

    doc
      .moveTo(marginX, y)
      .lineTo(marginX + contentWidth, y)
      .strokeColor(COLORS.line)
      .lineWidth(1)
      .stroke();

    y += 18;

    // Totals
    const totalsWidth = 220;
    const totalsX = marginX + contentWidth - totalsWidth;

    const drawTotalRow = (
      label: string,
      value: string,
      opts?: { bold?: boolean; accent?: boolean },
    ) => {
      doc
        .fillColor(opts?.accent ? COLORS.total : COLORS.muted)
        .font(opts?.bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(opts?.bold ? 11 : 9)
        .text(label, totalsX, y, { width: 110 });
      doc
        .fillColor(opts?.accent ? COLORS.total : COLORS.ink)
        .font(opts?.bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(opts?.bold ? 11 : 9)
        .text(value, totalsX + 110, y, { width: 110, align: 'right' });
      y += opts?.bold ? 22 : 18;
    };

    drawTotalRow('Subtotal', money(totals.subtotal, currency));
    drawTotalRow(taxLabel, money(totals.taxAmount, currency));

    y += 4;
    doc.roundedRect(totalsX - 12, y - 6, totalsWidth + 12, 36, 6).fill(COLORS.accentSoft);
    doc
      .fillColor(COLORS.total)
      .font('Helvetica-Bold')
      .fontSize(12)
      .text('Total due', totalsX, y + 6, { width: 110 });
    doc
      .fillColor(COLORS.total)
      .font('Helvetica-Bold')
      .fontSize(14)
      .text(money(totals.totalAmount, currency), totalsX + 110, y + 5, {
        width: 110,
        align: 'right',
      });

    y += 52;

    // Payment notes
    if (booking.payment) {
      const paidAmount = toNumber(booking.payment.amount);
      const paymentBits = [
        `Status: ${paymentLabel(booking.payment.status)}`,
        booking.payment.paymentMethod
          ? `Method: ${booking.payment.paymentMethod}`
          : null,
        booking.payment.paidAt
          ? `Paid on: ${formatShortDate(booking.payment.paidAt)}`
          : null,
        paidAmount != null ? `Recorded amount: ${money(paidAmount, currency)}` : null,
      ]
        .filter(Boolean)
        .join('  ·  ');

      doc
        .fillColor(COLORS.ink)
        .font('Helvetica-Bold')
        .fontSize(10)
        .text('Payment details', marginX, y);
      y += 14;
      doc
        .fillColor(COLORS.muted)
        .font('Helvetica')
        .fontSize(9)
        .text(paymentBits, marginX, y, { width: contentWidth });
      y += 28;
    }

    if (booking.specialNotes?.trim()) {
      doc
        .fillColor(COLORS.ink)
        .font('Helvetica-Bold')
        .fontSize(10)
        .text('Notes', marginX, y);
      y += 14;
      doc
        .fillColor(COLORS.muted)
        .font('Helvetica')
        .fontSize(9)
        .text(booking.specialNotes.trim(), marginX, y, { width: contentWidth });
      y += 28;
    }

    // Footer
    const footerTop = pageHeight - 72;
    doc
      .moveTo(marginX, footerTop)
      .lineTo(marginX + contentWidth, footerTop)
      .strokeColor(COLORS.line)
      .lineWidth(1)
      .stroke();

    doc
      .fillColor(COLORS.muted)
      .font('Helvetica')
      .fontSize(8)
      .text(
        'Thank you for staying with us. This invoice was generated electronically by StayNest and is valid without a signature.',
        marginX,
        footerTop + 12,
        { width: contentWidth, align: 'center' },
      )
      .text(
        `Document ${totals.invoiceNumber}  ·  Total includes ${taxLabel}`,
        marginX,
        footerTop + 28,
        { width: contentWidth, align: 'center' },
      );

    doc.end();
  });
}
