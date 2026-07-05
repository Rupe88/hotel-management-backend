import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL must be set');
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL ?? 'admin@hotel.com';
  const adminPassword = process.env.ADMIN_PASSWORD ?? 'Admin@123456';
  const hashedPassword = await bcrypt.hash(adminPassword, 12);

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      password: hashedPassword,
      firstName: 'System',
      lastName: 'Admin',
      role: Role.ADMIN,
      emailVerified: true,
    },
  });

  const categories = [
    { name: 'Standard', description: 'Comfortable standard rooms' },
    { name: 'Deluxe', description: 'Spacious deluxe rooms' },
    { name: 'Suite', description: 'Premium suites with extra amenities' },
  ];

  for (const category of categories) {
    await prisma.roomCategory.upsert({
      where: { name: category.name },
      update: {},
      create: category,
    });
  }

  const standard = await prisma.roomCategory.findUniqueOrThrow({
    where: { name: 'Standard' },
  });
  const deluxe = await prisma.roomCategory.findUniqueOrThrow({
    where: { name: 'Deluxe' },
  });

  const hotel = await prisma.hotel.upsert({
    where: { slug: 'himalayan-grand' },
    update: {},
    create: {
      name: 'Himalayan Grand Hotel',
      slug: 'himalayan-grand',
      description: 'Luxury hotel in the heart of Kathmandu with mountain views.',
      address: 'Durbar Marg',
      city: 'Kathmandu',
      country: 'Nepal',
      starRating: 5,
      amenities: {
        create: [
          { name: 'Free WiFi', icon: 'wifi' },
          { name: 'Swimming Pool', icon: 'pool' },
          { name: 'Restaurant', icon: 'restaurant' },
        ],
      },
      policies: {
        create: [
          {
            title: 'Check-in',
            description: 'Check-in from 2:00 PM',
            type: 'CHECK_IN',
          },
          {
            title: 'Cancellation',
            description: 'Free cancellation up to 48 hours before arrival',
            type: 'CANCELLATION',
          },
        ],
      },
      images: {
        create: [
          {
            url: 'https://bucket-tc6j6n.s3.ap-south-1.amazonaws.com/hotels/sample-hotel.jpg',
            isPrimary: true,
            caption: 'Hotel exterior',
          },
        ],
      },
    },
  });

  await prisma.room.upsert({
    where: { hotelId_roomNumber: { hotelId: hotel.id, roomNumber: '101' } },
    update: {},
    create: {
      hotelId: hotel.id,
      categoryId: standard.id,
      name: 'Standard Double',
      roomNumber: '101',
      description: 'Cozy double room with city view',
      capacity: 2,
      bedType: 'Queen',
      pricePerNight: 80,
    },
  });

  await prisma.room.upsert({
    where: { hotelId_roomNumber: { hotelId: hotel.id, roomNumber: '201' } },
    update: {},
    create: {
      hotelId: hotel.id,
      categoryId: deluxe.id,
      name: 'Deluxe Suite',
      roomNumber: '201',
      description: 'Spacious suite with balcony',
      capacity: 3,
      bedType: 'King',
      pricePerNight: 150,
    },
  });

  console.log('Seed completed');
  console.log(`Admin login: ${adminEmail} / ${adminPassword}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
