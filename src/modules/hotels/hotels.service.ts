import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { HotelStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { paginate, PaginationDto } from '../../common/dto/pagination.dto';
import { slugify, uniqueSlug } from '../../common/utils/helpers';
import {
  CreateHotelDto,
  HotelAmenityDto,
  HotelImageDto,
  HotelPolicyDto,
  HotelQueryDto,
  UpdateHotelDto,
} from './dto/hotel.dto';

const hotelInclude = {
  images: { orderBy: { sortOrder: 'asc' as const } },
  amenities: true,
  policies: true,
  _count: { select: { rooms: true } },
};

@Injectable()
export class HotelsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: HotelQueryDto, pagination: PaginationDto) {
    const { skip, take, page, limit } = paginate(pagination.page, pagination.limit);
    const where: Prisma.HotelWhereInput = {
      status: query.status ?? HotelStatus.ACTIVE,
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

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findBySlug(slug: string) {
    const hotel = await this.prisma.hotel.findUnique({
      where: { slug },
      include: {
        ...hotelInclude,
        rooms: {
          where: { status: 'AVAILABLE' },
          include: { category: true, images: true },
        },
      },
    });

    if (!hotel) {
      throw new NotFoundException('Hotel not found');
    }

    return hotel;
  }

  async create(dto: CreateHotelDto) {
    const slug = await uniqueSlug(dto.name, async (candidate) => {
      const existing = await this.prisma.hotel.findUnique({ where: { slug: candidate } });
      return !!existing;
    });

    return this.prisma.hotel.create({
      data: { ...dto, slug: slug || slugify(dto.name) },
      include: hotelInclude,
    });
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

    return this.prisma.hotel.update({
      where: { id },
      data: { ...dto, ...(slug ? { slug } : {}) },
      include: hotelInclude,
    });
  }

  async remove(id: string) {
    await this.ensureExists(id);
    await this.prisma.hotel.delete({ where: { id } });
    return { message: 'Hotel deleted successfully' };
  }

  async addImage(hotelId: string, dto: HotelImageDto) {
    await this.ensureExists(hotelId);

    if (dto.isPrimary) {
      await this.prisma.hotelImage.updateMany({
        where: { hotelId },
        data: { isPrimary: false },
      });
    }

    return this.prisma.hotelImage.create({
      data: { hotelId, ...dto },
    });
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
        type: (dto.type as never) ?? 'OTHER',
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

  private async ensureExists(id: string) {
    const hotel = await this.prisma.hotel.findUnique({ where: { id } });
    if (!hotel) {
      throw new NotFoundException('Hotel not found');
    }
    return hotel;
  }
}
