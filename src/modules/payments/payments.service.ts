import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentStatus } from '@prisma/client';
import Stripe from 'stripe';
import { PrismaService } from '../../database/prisma.service';
import { BookingsService } from '../bookings/bookings.service';
import { decimalToNumber } from '../../common/utils/helpers';

@Injectable()
export class PaymentsService implements OnModuleInit {
  private readonly logger = new Logger(PaymentsService.name);
  private stripe: Stripe | null = null;
  private webhookSecret: string | undefined;
  private testMode = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly bookingsService: BookingsService,
  ) {}

  onModuleInit() {
    if (this.configService.get<string>('nodeEnv') === 'test') {
      this.testMode = true;
      this.logger.log('Stripe disabled in test environment');
      return;
    }

    const secretKey = this.configService.get<string>('stripe.secretKey');
    this.webhookSecret = this.configService.get<string>('stripe.webhookSecret');

    if (!secretKey) {
      this.logger.warn('STRIPE_SECRET_KEY not set – payments disabled');
      return;
    }

    this.stripe = new Stripe(secretKey);
    this.logger.log('Stripe payment gateway initialized');
  }

  async createCheckoutSession(bookingId: string, userId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { hotel: true, room: true, payment: true },
    });

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    if (booking.userId !== userId) {
      throw new BadRequestException('Access denied');
    }

    if (booking.payment?.status === PaymentStatus.COMPLETED) {
      throw new BadRequestException('Booking already paid');
    }

    const amount = decimalToNumber(booking.totalAmount);
    const currency = this.configService.get<string>('stripe.currency') ?? 'usd';

    if (this.testMode || !this.stripe) {
      const payment = await this.prisma.payment.upsert({
        where: { bookingId },
        update: { status: PaymentStatus.COMPLETED, paidAt: new Date(), paymentMethod: 'test' },
        create: {
          bookingId,
          amount: booking.totalAmount,
          currency: currency.toUpperCase(),
          status: PaymentStatus.COMPLETED,
          stripePaymentId: `test_${bookingId}`,
          paymentMethod: 'test',
          paidAt: new Date(),
        },
      });

      await this.bookingsService.markConfirmedAfterPayment(bookingId);

      return {
        mode: 'test',
        paymentId: payment.id,
        status: PaymentStatus.COMPLETED,
        message: 'Payment simulated successfully',
      };
    }

    const appUrl = this.configService.get<string>('appUrl');
    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency,
            unit_amount: Math.round(amount * 100),
            product_data: {
              name: `${booking.hotel.name} – ${booking.room.name}`,
              description: `Booking ${booking.bookingCode}`,
            },
          },
        },
      ],
      metadata: { bookingId, userId },
      success_url: `${appUrl}/payments/success?bookingId=${bookingId}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/payments/cancel?bookingId=${bookingId}`,
    });

    await this.prisma.payment.upsert({
      where: { bookingId },
      update: {
        amount: booking.totalAmount,
        status: PaymentStatus.PENDING,
        stripePaymentId: session.id,
      },
      create: {
        bookingId,
        amount: booking.totalAmount,
        currency: currency.toUpperCase(),
        status: PaymentStatus.PENDING,
        stripePaymentId: session.id,
      },
    });

    return { checkoutUrl: session.url, sessionId: session.id };
  }

  async getPaymentStatus(bookingId: string, userId: string, isAdmin: boolean) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { payment: true },
    });

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    if (!isAdmin && booking.userId !== userId) {
      throw new BadRequestException('Access denied');
    }

    return booking.payment ?? { status: PaymentStatus.PENDING, bookingId };
  }

  async verifyPayment(bookingId: string, userId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { payment: true },
    });

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    if (booking.userId !== userId) {
      throw new BadRequestException('Access denied');
    }

    if (!booking.payment) {
      return {
        bookingId,
        status: PaymentStatus.PENDING,
        verified: false,
        message: 'No payment found for this booking',
      };
    }

    if (booking.payment.status === PaymentStatus.COMPLETED) {
      return {
        bookingId,
        status: PaymentStatus.COMPLETED,
        amount: booking.payment.amount,
        currency: booking.payment.currency,
        paidAt: booking.payment.paidAt,
        verified: true,
        message: 'Payment already confirmed',
      };
    }

    const sessionId = booking.payment.stripePaymentId;
    if (!sessionId || sessionId.startsWith('test_')) {
      return {
        bookingId,
        status: booking.payment.status,
        amount: booking.payment.amount,
        currency: booking.payment.currency,
        verified: false,
        message: 'Payment is still pending',
      };
    }

    return this.syncCheckoutSession(sessionId, userId, bookingId);
  }

  async verifySession(sessionId: string, userId: string) {
    return this.syncCheckoutSession(sessionId, userId);
  }

  private async syncCheckoutSession(
    sessionId: string,
    userId: string,
    expectedBookingId?: string,
  ) {
    if (this.testMode || !this.stripe) {
      throw new BadRequestException('Stripe is not configured');
    }

    const session = await this.stripe.checkout.sessions.retrieve(sessionId);
    const bookingId = session.metadata?.bookingId;

    if (!bookingId) {
      throw new BadRequestException('Checkout session is missing booking metadata');
    }

    if (expectedBookingId && expectedBookingId !== bookingId) {
      throw new BadRequestException('Session does not match this booking');
    }

    if (session.metadata?.userId && session.metadata.userId !== userId) {
      throw new BadRequestException('Access denied');
    }

    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { payment: true },
    });

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    if (booking.userId !== userId) {
      throw new BadRequestException('Access denied');
    }

    const paid =
      session.payment_status === 'paid' || session.status === 'complete';

    if (paid) {
      const payment = await this.completePaymentFromSession(bookingId, session);
      return {
        bookingId,
        status: payment.status,
        amount: payment.amount,
        currency: payment.currency,
        paidAt: payment.paidAt,
        verified: true,
        message: 'Payment confirmed',
      };
    }

    return {
      bookingId,
      status: booking.payment?.status ?? PaymentStatus.PENDING,
      amount: booking.payment?.amount,
      currency: booking.payment?.currency,
      verified: false,
      message: 'Payment is still pending',
    };
  }

  private async completePaymentFromSession(
    bookingId: string,
    session: Stripe.Checkout.Session,
  ) {
    const existing = await this.prisma.payment.findUnique({
      where: { bookingId },
    });

    if (existing?.status === PaymentStatus.COMPLETED) {
      return existing;
    }

    const payment = await this.prisma.payment.update({
      where: { bookingId },
      data: {
        status: PaymentStatus.COMPLETED,
        stripePaymentId:
          typeof session.payment_intent === 'string'
            ? session.payment_intent
            : session.id,
        paidAt: new Date(),
        paymentMethod: 'card',
      },
    });

    await this.bookingsService.markConfirmedAfterPayment(bookingId);
    return payment;
  }

  async handleWebhook(rawBody: Buffer, signature: string) {
    if (!this.stripe || !this.webhookSecret) {
      throw new BadRequestException('Stripe webhook not configured');
    }

    const event = this.stripe.webhooks.constructEvent(
      rawBody,
      signature,
      this.webhookSecret,
    );

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const bookingId = session.metadata?.bookingId;

      if (bookingId) {
        await this.completePaymentFromSession(bookingId, session);
      }
    }

    return { received: true };
  }
}
