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
      success_url: `${this.configService.get('appUrl')}/payments/success?bookingId=${bookingId}`,
      cancel_url: `${this.configService.get('appUrl')}/payments/cancel?bookingId=${bookingId}`,
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
        await this.prisma.payment.update({
          where: { bookingId },
          data: {
            status: PaymentStatus.COMPLETED,
            stripePaymentId: session.payment_intent as string,
            paidAt: new Date(),
            paymentMethod: 'card',
          },
        });

        await this.bookingsService.markConfirmedAfterPayment(bookingId);
      }
    }

    return { received: true };
  }
}
