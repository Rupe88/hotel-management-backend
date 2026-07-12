import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { HotelStatus, PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL must be set');
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const SAMPLE_IMAGE =
  'https://bucket-tc6j6n.s3.ap-south-1.amazonaws.com/hotels/sample-hotel.jpg';

const HOTELS = [
  {
    name: 'Himalayan Grand Hotel',
    slug: 'himalayan-grand',
    description: 'Luxury hotel in the heart of Kathmandu with mountain views.',
    address: 'Durbar Marg',
    city: 'Kathmandu',
    country: 'Nepal',
    starRating: 5,
  },
  {
    name: 'Lakeside Retreat',
    slug: 'lakeside-retreat',
    description: 'Peaceful lakeside stay with garden cafes and boat access.',
    address: 'Lakeside Road',
    city: 'Pokhara',
    country: 'Nepal',
    starRating: 4,
  },
  {
    name: 'Everest View Lodge',
    slug: 'everest-view-lodge',
    description: 'Mountain lodge offering panoramic Himalayan views.',
    address: 'Namche Bazaar',
    city: 'Solukhumbu',
    country: 'Nepal',
    starRating: 3,
  },
  {
    name: 'Patan Heritage Inn',
    slug: 'patan-heritage-inn',
    description: 'Boutique stay near Patan Durbar Square with traditional décor.',
    address: 'Mangal Bazaar',
    city: 'Lalitpur',
    country: 'Nepal',
    starRating: 4,
  },
  {
    name: 'Bhaktapur Courtyard Hotel',
    slug: 'bhaktapur-courtyard',
    description: 'Quiet courtyard hotel in the UNESCO heritage city.',
    address: 'Pottery Square',
    city: 'Bhaktapur',
    country: 'Nepal',
    starRating: 3,
  },
  {
    name: 'Chitwan Jungle Lodge',
    slug: 'chitwan-jungle-lodge',
    description: 'Safari-style lodge near Chitwan National Park.',
    address: 'Sauraha',
    city: 'Chitwan',
    country: 'Nepal',
    starRating: 4,
  },
  {
    name: 'Annapurna Base Camp Hotel',
    slug: 'annapurna-base-camp-hotel',
    description: 'Comfortable trekking hotel with warm hospitality.',
    address: 'Naya Bazaar',
    city: 'Pokhara',
    country: 'Nepal',
    starRating: 3,
  },
  {
    name: 'Thamel Boutique Stay',
    slug: 'thamel-boutique-stay',
    description: 'Modern boutique rooms in Kathmandu’s tourist hub.',
    address: 'Thamel Marg',
    city: 'Kathmandu',
    country: 'Nepal',
    starRating: 4,
  },
  {
    name: 'Nagarkot Sunrise Resort',
    slug: 'nagarkot-sunrise-resort',
    description: 'Hilltop resort famous for sunrise over the Himalayas.',
    address: 'Mahankal',
    city: 'Nagarkot',
    country: 'Nepal',
    starRating: 5,
  },
  {
    name: 'Lumbini Peace Hotel',
    slug: 'lumbini-peace-hotel',
    description: 'Calm hotel near the birthplace of Buddha.',
    address: 'Monastery Road',
    city: 'Lumbini',
    country: 'Nepal',
    starRating: 3,
  },
  {
    name: 'Bandipur Mountain Inn',
    slug: 'bandipur-mountain-inn',
    description: 'Hill-town inn with traditional Newari architecture.',
    address: 'Main Bazaar',
    city: 'Bandipur',
    country: 'Nepal',
    starRating: 3,
  },
  {
    name: 'Dhulikhel Mountain Resort',
    slug: 'dhulikhel-mountain-resort',
    description: 'Resort escape with spa facilities and valley views.',
    address: 'Kavre Highway',
    city: 'Dhulikhel',
    country: 'Nepal',
    starRating: 5,
  },
  {
    name: 'Ilam Tea Garden Hotel',
    slug: 'ilam-tea-garden-hotel',
    description: 'Stay among tea gardens in eastern Nepal.',
    address: 'Fikkal Road',
    city: 'Ilam',
    country: 'Nepal',
    starRating: 3,
  },
  {
    name: 'Janakpur Cultural Hotel',
    slug: 'janakpur-cultural-hotel',
    description: 'Hotel near historic temples and cultural sites.',
    address: 'Station Road',
    city: 'Janakpur',
    country: 'Nepal',
    starRating: 2,
  },
  {
    name: 'Biratnagar Business Hotel',
    slug: 'biratnagar-business-hotel',
    description: 'Business-friendly hotel with meeting rooms and WiFi.',
    address: 'Main Road',
    city: 'Biratnagar',
    country: 'Nepal',
    starRating: 4,
  },
  {
    name: 'Butwal Gateway Inn',
    slug: 'butwal-gateway-inn',
    description: 'Convenient stopover hotel for travelers heading west.',
    address: 'Traffic Chowk',
    city: 'Butwal',
    country: 'Nepal',
    starRating: 3,
  },
  {
    name: 'Nepalgunj Desert Rose Hotel',
    slug: 'nepalgunj-desert-rose',
    description: 'Comfortable city hotel near the western border.',
    address: 'Surkhet Road',
    city: 'Nepalgunj',
    country: 'Nepal',
    starRating: 3,
  },
  {
    name: 'Dharan Hill View Hotel',
    slug: 'dharan-hill-view',
    description: 'Hill-city hotel with modern rooms and rooftop dining.',
    address: 'Putali Line',
    city: 'Dharan',
    country: 'Nepal',
    starRating: 4,
  },
  {
    name: 'Hetauda Riverside Hotel',
    slug: 'hetauda-riverside-hotel',
    description: 'Family hotel along the riverside route to Kathmandu.',
    address: 'Nawalpur Road',
    city: 'Hetauda',
    country: 'Nepal',
    starRating: 2,
  },
  {
    name: 'Gorkha Palace Hotel',
    slug: 'gorkha-palace-hotel',
    description: 'Heritage-inspired hotel near Gorkha Durbar.',
    address: 'Palace Road',
    city: 'Gorkha',
    country: 'Nepal',
    starRating: 4,
  },
] as const;

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

  let createdHotels = 0;

  for (const [index, hotelData] of HOTELS.entries()) {
    const hotel = await prisma.hotel.upsert({
      where: { slug: hotelData.slug },
      update: {
        name: hotelData.name,
        description: hotelData.description,
        address: hotelData.address,
        city: hotelData.city,
        country: hotelData.country,
        starRating: hotelData.starRating,
        status: HotelStatus.ACTIVE,
      },
      create: {
        name: hotelData.name,
        slug: hotelData.slug,
        description: hotelData.description,
        address: hotelData.address,
        city: hotelData.city,
        country: hotelData.country,
        starRating: hotelData.starRating,
        status: HotelStatus.ACTIVE,
        amenities: {
          create: [
            { name: 'Free WiFi', icon: 'wifi' },
            { name: 'Parking', icon: 'parking' },
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
              title: 'Check-out',
              description: 'Check-out by 11:00 AM',
              type: 'CHECK_OUT',
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
              url: SAMPLE_IMAGE,
              isPrimary: true,
              caption: 'Hotel exterior',
              sortOrder: 0,
            },
          ],
        },
      },
    });

    const basePrice = 60 + hotelData.starRating * 20 + (index % 5) * 5;

    await prisma.room.upsert({
      where: { hotelId_roomNumber: { hotelId: hotel.id, roomNumber: '101' } },
      update: {
        status: 'AVAILABLE',
        pricePerNight: basePrice,
      },
      create: {
        hotelId: hotel.id,
        categoryId: standard.id,
        name: 'Standard Double',
        roomNumber: '101',
        description: 'Comfortable double room with city or garden view',
        capacity: 2,
        bedType: 'Queen',
        pricePerNight: basePrice,
        status: 'AVAILABLE',
      },
    });

    await prisma.room.upsert({
      where: { hotelId_roomNumber: { hotelId: hotel.id, roomNumber: '201' } },
      update: {
        status: 'AVAILABLE',
        pricePerNight: basePrice + 40,
      },
      create: {
        hotelId: hotel.id,
        categoryId: deluxe.id,
        name: 'Deluxe Suite',
        roomNumber: '201',
        description: 'Spacious suite with extra amenities',
        capacity: 3,
        bedType: 'King',
        pricePerNight: basePrice + 40,
        status: 'AVAILABLE',
      },
    });

    createdHotels += 1;
  }

  console.log('Seed completed');
  console.log(`Admin login: ${adminEmail} / ${adminPassword}`);
  console.log(`Hotels seeded (ACTIVE): ${createdHotels}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
