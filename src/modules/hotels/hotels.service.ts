import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { HotelStatus, PolicyType, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { paginate, PaginationDto } from '../../common/dto/pagination.dto';
import { slugify, uniqueSlug } from '../../common/utils/helpers';
import { StorageService } from '../storage/storage.service';
import {
  CreateHotelDto,
  HotelAmenityDto,
  HotelImageDto,
  HotelPolicyDto,
  HotelQueryDto,
  UpdateHotelDto,
  UpdateHotelImageDto,
} from './dto/hotel.dto';

const hotelInclude = {
  images: { orderBy: [{ isPrimary: 'desc' as const }, { sortOrder: 'asc' as const }] },
  amenities: true,
  policies: true,
  _count: { select: { rooms: true } },
};

type HotelWithImages = {
  images?: Array<{ url: string }>;
  rooms?: Array<{ images?: Array<{ url: string }> }>;
};

@Injectable()
export class HotelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
  ) {}

  async findAll(query: HotelQueryDto, pagination: PaginationDto) {
    const { skip, take, page, limit } = paginate(pagination.page, pagination.limit);
    const where: Prisma.HotelWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.city ? { city: { contains: query.city, mode: 'insensitive' } } : {}),
      ...(query.country ? { country: { contains: query.country, mode: 'insensitive' } } : {}),
      ...(query.starRating ? { starRating: query.starRating } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { city: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.hotel.findMany({ where, skip, take, include: hotelInclude, orderBy: { name: 'asc' } }),
      this.prisma.hotel.count({ where }),
    ]);

    const resolvedItems = await Promise.all(items.map((hotel) => this.resolveHotelMedia(hotel)));

    return { items: resolvedItems, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findBySlug(slug: string) {
    const hotel = await this.prisma.hotel.findUnique({
      where: { slug },
      include: {
        ...hotelInclude,
        rooms: {
          where: { status: 'AVAILABLE' },
          include: {
            category: true,
            images: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }] },
          },
        },
      },
    });

    if (!hotel) {
      throw new NotFoundException('Hotel not found');
    }

    return this.resolveHotelMedia(hotel);
  }

  async create(dto: CreateHotelDto) {
    const slug = await uniqueSlug(dto.name, async (candidate) => {
      const existing = await this.prisma.hotel.findUnique({ where: { slug: candidate } });
      return !!existing;
    });

    const hotel = await this.prisma.hotel.create({
      data: { ...dto, slug: slug || slugify(dto.name) },
      include: hotelInclude,
    });

    return this.resolveHotelMedia(hotel);
  }

  async update(id: string, dto: UpdateHotelDto) {
    await this.ensureExists(id);

    let slug: string | undefined;
    if (dto.name) {
      slug = await uniqueSlug(dto.name, async (candidate) => {
        const existing = await this.prisma.hotel.findFirst({
          where: { slug: candidate, NOT: { id } },
        });
        return !!existing;
      });
    }

    const hotel = await this.prisma.hotel.update({
      where: { id },
      data: { ...dto, ...(slug ? { slug } : {}) },
      include: hotelInclude,
    });

    return this.resolveHotelMedia(hotel);
  }

  async remove(id: string) {
    await this.ensureExists(id);

    // Bookings restrict hotel/room deletes (ON DELETE RESTRICT). Remove them
    // first so cascading hotel → rooms → images/amenities/policies can proceed.
    // Booking children (guests, documents, photos, payment, invoice) cascade.
    await this.prisma.$transaction(async (tx) => {
      await tx.booking.deleteMany({ where: { hotelId: id } });
      await tx.hotel.delete({ where: { id } });
    });

    return { message: 'Hotel deleted successfully' };
  }

  async addImage(hotelId: string, dto: HotelImageDto) {
    await this.ensureExists(hotelId);

    if (dto.isPrimary) {
      await this.clearPrimaryImages(hotelId);
    }

    const image = await this.prisma.hotelImage.create({
      data: { hotelId, ...dto },
    });

    return this.resolveImage(image);
  }

  async updateImage(hotelId: string, imageId: string, dto: UpdateHotelImageDto) {
    await this.ensureExists(hotelId);

    const image = await this.prisma.hotelImage.findFirst({
      where: { id: imageId, hotelId },
    });

    if (!image) {
      throw new NotFoundException('Image not found');
    }

    if (dto.isPrimary) {
      await this.clearPrimaryImages(hotelId);
    }

    const updated = await this.prisma.hotelImage.update({
      where: { id: imageId },
      data: dto,
    });

    return this.resolveImage(updated);
  }

  async removeImage(hotelId: string, imageId: string) {
    const image = await this.prisma.hotelImage.findFirst({
      where: { id: imageId, hotelId },
    });

    if (!image) {
      throw new NotFoundException('Image not found');
    }

    await this.prisma.hotelImage.delete({ where: { id: imageId } });
    return { message: 'Image deleted successfully' };
  }

  async addAmenity(hotelId: string, dto: HotelAmenityDto) {
    await this.ensureExists(hotelId);
    return this.prisma.hotelAmenity.create({ data: { hotelId, ...dto } });
  }

  async removeAmenity(hotelId: string, amenityId: string) {
    const amenity = await this.prisma.hotelAmenity.findFirst({
      where: { id: amenityId, hotelId },
    });

    if (!amenity) {
      throw new NotFoundException('Amenity not found');
    }

    await this.prisma.hotelAmenity.delete({ where: { id: amenityId } });
    return { message: 'Amenity deleted successfully' };
  }

  async addPolicy(hotelId: string, dto: HotelPolicyDto) {
    await this.ensureExists(hotelId);
    return this.prisma.hotelPolicy.create({
      data: {
        hotelId,
        title: dto.title,
        description: dto.description,
        type: dto.type ?? PolicyType.OTHER,
      },
    });
  }

  async removePolicy(hotelId: string, policyId: string) {
    const policy = await this.prisma.hotelPolicy.findFirst({
      where: { id: policyId, hotelId },
    });

    if (!policy) {
      throw new NotFoundException('Policy not found');
    }

    await this.prisma.hotelPolicy.delete({ where: { id: policyId } });
    return { message: 'Policy deleted successfully' };
  }

  private async clearPrimaryImages(hotelId: string) {
    await this.prisma.hotelImage.updateMany({
      where: { hotelId },
      data: { isPrimary: false },
    });
  }

  private async resolveImage<T extends { url: string }>(image: T) {
    return {
      ...image,
      url: await this.storageService.resolveAccessibleUrl(image.url),
    };
  }

  private async resolveHotelMedia<T extends HotelWithImages>(hotel: T): Promise<T> {
    const [images, rooms] = await Promise.all([
      hotel.images
        ? this.storageService.resolveAccessibleUrls(hotel.images)
        : Promise.resolve(hotel.images),
      hotel.rooms
        ? Promise.all(
            hotel.rooms.map(async (room) => ({
              ...room,
              images: room.images
                ? await this.storageService.resolveAccessibleUrls(room.images)
                : room.images,
            })),
          )
        : Promise.resolve(hotel.rooms),
    ]);

    return {
      ...hotel,
      images,
      rooms,
    };
  }

  private async ensureExists(id: string) {
    const hotel = await this.prisma.hotel.findUnique({ where: { id } });
    if (!hotel) {
      throw new NotFoundException('Hotel not found');
    }
    return hotel;
  }
}
