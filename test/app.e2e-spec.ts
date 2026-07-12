import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import * as bcrypt from 'bcrypt';
import { E2eContext } from './helpers/e2e-context';
import { PrismaService } from '../src/database/prisma.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { GoogleOAuthService } from '../src/modules/auth/google-oauth.service';
import { Role } from '../src/common/enums/role.enum';

describe('Hotel Management System (e2e)', () => {
  let ctx: E2eContext;
  let app: INestApplication<App>;
  let adminToken: string;
  let userToken: string;
  let hotelId: string;
  let hotelSlug: string;
  let roomId: string;
  let categoryId: string;
  let bookingId: string;

  beforeAll(async () => {
    ctx = await E2eContext.getInstance();
    app = ctx.app;
  }, 120000);

  beforeEach(async () => {
    await ctx.resetDatabase();
    await seedBaseData(app);
    adminToken = await loginAsAdmin(app);
    userToken = await loginAsUser(app);
  });

  async function seedBaseData(application: INestApplication<App>) {
    const prisma = application.get(PrismaService);
    const hashedPassword = await bcrypt.hash('Admin@123456', 12);

    await prisma.user.create({
      data: {
        email: 'admin@hotel.com',
        password: hashedPassword,
        firstName: 'System',
        lastName: 'Admin',
        role: Role.ADMIN,
        emailVerified: true,
      },
    });

    await prisma.user.create({
      data: {
        email: 'user@example.com',
        firstName: 'Test',
        lastName: 'User',
        role: Role.USER,
        emailVerified: true,
      },
    });

    const category = await prisma.roomCategory.create({
      data: { name: 'Standard', description: 'Standard room' },
    });
    categoryId = category.id;
  }

  async function loginAsAdmin(application: INestApplication<App>) {
    const res = await request(application.getHttpServer())
      .post('/api/v1/auth/admin/login')
      .send({ email: 'admin@hotel.com', password: 'Admin@123456' })
      .expect(201);
    return res.body.tokens.accessToken as string;
  }

  async function loginAsUser(application: INestApplication<App>) {
    const prisma = application.get(PrismaService);
    const authService = application.get(AuthService);
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: 'user@example.com' },
    });
    const result = await authService.loginWithGoogle(user);
    return result.tokens.accessToken;
  }

  describe('Day 1 – Auth & health', () => {
    it('GET /health', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
      expect(res.body.status).toBe('ok');
    });

    it('signs in user via Google OAuth profile', async () => {
      const googleOAuth = app.get(GoogleOAuthService);
      const authService = app.get(AuthService);

      const user = await googleOAuth.findOrCreateFromGoogleProfile({
        googleId: 'google-new-user',
        email: 'new@example.com',
        firstName: 'New',
        lastName: 'User',
      });

      const result = await authService.loginWithGoogle(user);
      expect(result.tokens.accessToken).toBeDefined();
      expect(result.user.email).toBe('new@example.com');
    });

    it('reports Google OAuth status', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/google/status')
        .expect(200);

      expect(res.body.enabled).toBe(false);
      expect(res.body.loginUrl).toContain('/api/v1/auth/google');
    });

    it('blocks Google login when OAuth is not configured', async () => {
      await request(app.getHttpServer()).get('/api/v1/auth/google').expect(503);
    });

    it('links Google profile to existing user account', async () => {
      const googleOAuth = app.get(GoogleOAuthService);
      const user = await googleOAuth.findOrCreateFromGoogleProfile({
        googleId: 'google-user-123',
        email: 'user@example.com',
        firstName: 'Google',
        lastName: 'Tester',
        avatar: 'https://example.com/avatar.jpg',
      });

      expect(user.email).toBe('user@example.com');
      expect(user.googleId).toBe('google-user-123');
      expect(user.avatar).toBe('https://example.com/avatar.jpg');
    });
  });

  describe('Day 3 – Hotels', () => {
    it('creates hotel with gallery, amenities, policies', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/hotels')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Himalayan Grand',
          description: 'Luxury hotel',
          address: 'Durbar Marg',
          city: 'Kathmandu',
          country: 'Nepal',
          starRating: 5,
        })
        .expect(201);

      hotelId = created.body.id;
      hotelSlug = created.body.slug;

      await request(app.getHttpServer())
        .post(`/api/v1/hotels/${hotelId}/images`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ url: 'https://example.com/hotel.jpg', isPrimary: true })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/hotels/${hotelId}/amenities`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'WiFi', icon: 'wifi' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/hotels/${hotelId}/policies`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Check-in', description: 'From 2PM', type: 'CHECK_IN' })
        .expect(201);

      const detail = await request(app.getHttpServer())
        .get(`/api/v1/hotels/${hotelSlug}`)
        .expect(200);

      expect(detail.body.name).toBe('Himalayan Grand');
      expect(detail.body.amenities).toHaveLength(1);
    });

    it('lists hotels with search', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/hotels')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'City Hotel',
          address: 'Main St',
          city: 'Pokhara',
          country: 'Nepal',
        });

      const res = await request(app.getHttpServer())
        .get('/api/v1/hotels?city=Pokhara')
        .expect(200);

      expect(res.body.items.length).toBeGreaterThan(0);
    });
  });

  describe('Day 4 – Rooms', () => {
    beforeEach(async () => {
      const hotel = await request(app.getHttpServer())
        .post('/api/v1/hotels')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Room Test Hotel',
          address: 'Street 1',
          city: 'Kathmandu',
          country: 'Nepal',
        });
      hotelId = hotel.body.id;
    });

    it('creates and lists rooms', async () => {
      const room = await request(app.getHttpServer())
        .post('/api/v1/rooms')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          hotelId,
          categoryId,
          name: 'Deluxe Room',
          roomNumber: '101',
          pricePerNight: 120,
          capacity: 2,
        })
        .expect(201);

      roomId = room.body.id;

      const list = await request(app.getHttpServer())
        .get(`/api/v1/rooms?hotelId=${hotelId}`)
        .expect(200);

      expect(list.body.items).toHaveLength(1);

      const detail = await request(app.getHttpServer())
        .get(`/api/v1/rooms/${roomId}`)
        .expect(200);

      expect(detail.body.roomNumber).toBe('101');
    });
  });

  describe('Day 5–8 – Full booking workflow', () => {
    beforeEach(async () => {
      const hotel = await request(app.getHttpServer())
        .post('/api/v1/hotels')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Booking Hotel',
          address: 'Street 2',
          city: 'Kathmandu',
          country: 'Nepal',
        });
      hotelId = hotel.body.id;

      const room = await request(app.getHttpServer())
        .post('/api/v1/rooms')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          hotelId,
          categoryId,
          name: 'Standard',
          roomNumber: '102',
          pricePerNight: 100,
          capacity: 2,
        });
      roomId = room.body.id;
    });

    it('completes search → book → pay → approve → check-in → check-out → invoice', async () => {
      const search = await request(app.getHttpServer())
        .get('/api/v1/bookings/search?city=Kathmandu&checkInDate=2026-09-01&checkOutDate=2026-09-03&guests=2')
        .expect(200);

      expect(search.body.items.length).toBeGreaterThan(0);

      const booking = await request(app.getHttpServer())
        .post('/api/v1/bookings')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          roomId,
          checkInDate: '2026-09-01',
          checkOutDate: '2026-09-03',
          guestCount: 2,
          guests: [{ firstName: 'John', lastName: 'Doe', email: 'john@example.com' }],
        })
        .expect(201);

      bookingId = booking.body.id;

      await request(app.getHttpServer())
        .post('/api/v1/payments/checkout')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ bookingId })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/bookings/${bookingId}/documents`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ url: 'https://example.com/passport.pdf', type: 'PASSPORT' })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/api/v1/admin/bookings/${bookingId}/verify`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/api/v1/admin/bookings/${bookingId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/api/v1/admin/bookings/${bookingId}/check-in`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/api/v1/admin/bookings/${bookingId}/check-out`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const invoice = await request(app.getHttpServer())
        .post(`/api/v1/invoices/${bookingId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);

      expect(invoice.body.invoiceNumber).toBeDefined();

      await request(app.getHttpServer())
        .get(`/api/v1/invoices/${bookingId}/pdf`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/api/v1/admin/bookings/${bookingId}/complete`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    });
  });

  describe('Day 9 – Reports', () => {
    it('returns dashboard KPIs and reports', async () => {
      const dashboard = await request(app.getHttpServer())
        .get('/api/v1/reports/dashboard')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(dashboard.body).toHaveProperty('totalBookings');
      expect(dashboard.body).toHaveProperty('totalRevenue');

      await request(app.getHttpServer())
        .get('/api/v1/reports/revenue')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .get('/api/v1/reports/bookings')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .get('/api/v1/reports/occupancy')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .get('/api/v1/reports/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    });
  });
});
