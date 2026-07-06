import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RoomStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { paginate, PaginationDto } from '../../common/dto/pagination.dto';
import { StorageService } from '../storage/storage.service';
import {
  CreateRoomCategoryDto,
  CreateRoomDto,
  RoomImageDto,
  RoomQueryDto,
  UpdateRoomCategoryDto,
  UpdateRoomDto,
  UpdateRoomImageDto,
  UpdateRoomStatusDto,
} from './dto/room.dto';

const roomInclude = {
  hotel: { select: { id: true, name: true, slug: true, city: true } },
  category: true,
  images: { orderBy: [{ isPrimary: 'desc' as const }, { sortOrder: 'asc' as const }] },
};

type RoomWithImages = {
  images?: Array<{ url: string }>;
  hotel?: Record<string, unknown> & { images?: Array<{ url: string }> };
};

@Injectable()
export class RoomsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
  ) {}

  findCategories() {
    return this.prisma.roomCategory.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { rooms: true } } },
    });
  }

  createCategory(dto: CreateRoomCategoryDto) {
    return this.prisma.roomCategory.create({ data: dto });
  }

  async updateCategory(id: string, dto: UpdateRoomCategoryDto) {
    await this.ensureCategoryExists(id);

    try {
      return await this.prisma.roomCategory.update({
        where: { id },
        data: dto,
        include: { _count: { select: { rooms: true } } },
      });
    } catch {
      throw new ConflictException('Category name already exists');
    }
  }

  async removeCategory(id: string) {
    await this.ensureCategoryExists(id);

    const roomCount = await this.prisma.room.count({ where: { categoryId: id } });
    if (roomCount > 0) {
      throw new ConflictException('Cannot delete a category that has rooms assigned');
    }

    await this.prisma.roomCategory.delete({ where: { id } });
    return { message: 'Category deleted successfully' };
  }

  async findAll(query: RoomQueryDto, pagination: PaginationDto) {
    const { skip, take, page, limit } = paginate(pagination.page, pagination.limit);
    const where: Prisma.RoomWhereInput = {
      ...(query.hotelId ? { hotelId: query.hotelId } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.guests ? { capacity: { gte: query.guests } } : {}),
      ...(query.minPrice || query.maxPrice
        ? {
            pricePerNight: {
              ...(query.minPrice ? { gte: query.minPrice } : {}),
              ...(query.maxPrice ? { lte: query.maxPrice } : {}),
            },
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.room.findMany({ where, skip, take, include: roomInclude, orderBy: { pricePerNight: 'asc' } }),
      this.prisma.room.count({ where }),
    ]);

    const resolvedItems = await Promise.all(items.map((room) => this.resolveRoomMedia(room)));

    return { items: resolvedItems, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string) {
    const room = await this.prisma.room.findUnique({
      where: { id },
      include: {
        ...roomInclude,
        hotel: {
          include: {
            amenities: true,
            policies: true,
            images: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }] },
          },
        },
      },
    });

    if (!room) {
      throw new NotFoundException('Room not found');
    }

    return this.resolveRoomMedia(room);
  }

  async create(dto: CreateRoomDto) {
    try {
      const room = await this.prisma.room.create({
        data: {
          ...dto,
          pricePerNight: dto.pricePerNight,
        },
        include: roomInclude,
      });
      return this.resolveRoomMedia(room);
    } catch {
      throw new ConflictException('Room number already exists for this hotel');
    }
  }

  async update(id: string, dto: UpdateRoomDto) {
    await this.ensureExists(id);
    const room = await this.prisma.room.update({
      where: { id },
      data: dto,
      include: roomInclude,
    });
    return this.resolveRoomMedia(room);
  }

  async updateStatus(id: string, dto: UpdateRoomStatusDto) {
    await this.ensureExists(id);
    const room = await this.prisma.room.update({
      where: { id },
      data: { status: dto.status },
      include: roomInclude,
    });
    return this.resolveRoomMedia(room);
  }

  async remove(id: string) {
    await this.ensureExists(id);
    await this.prisma.room.delete({ where: { id } });
    return { message: 'Room deleted successfully' };
  }

  async addImage(roomId: string, dto: RoomImageDto) {
    await this.ensureExists(roomId);

    if (dto.isPrimary) {
      await this.clearPrimaryImages(roomId);
    }

    const image = await this.prisma.roomImage.create({ data: { roomId, ...dto } });
    return this.resolveImage(image);
  }

  async updateImage(roomId: string, imageId: string, dto: UpdateRoomImageDto) {
    await this.ensureExists(roomId);

    const image = await this.prisma.roomImage.findFirst({
      where: { id: imageId, roomId },
    });

    if (!image) {
      throw new NotFoundException('Image not found');
    }

    if (dto.isPrimary) {
      await this.clearPrimaryImages(roomId);
    }

    const updated = await this.prisma.roomImage.update({
      where: { id: imageId },
      data: dto,
    });

    return this.resolveImage(updated);
  }

  async removeImage(roomId: string, imageId: string) {
    const image = await this.prisma.roomImage.findFirst({
      where: { id: imageId, roomId },
    });

    if (!image) {
      throw new NotFoundException('Image not found');
    }

    await this.prisma.roomImage.delete({ where: { id: imageId } });
    return { message: 'Image deleted successfully' };
  }

  private async clearPrimaryImages(roomId: string) {
    await this.prisma.roomImage.updateMany({
      where: { roomId },
      data: { isPrimary: false },
    });
  }

  private async resolveImage<T extends { url: string }>(image: T) {
    return {
      ...image,
      url: await this.storageService.resolveAccessibleUrl(image.url),
    };
  }

  private async resolveRoomMedia<T extends RoomWithImages>(room: T): Promise<T> {
    const [images, hotel] = await Promise.all([
      room.images
        ? this.storageService.resolveAccessibleUrls(room.images)
        : Promise.resolve(room.images),
      room.hotel && 'images' in room.hotel && Array.isArray(room.hotel.images)
        ? {
            ...room.hotel,
            images: await this.storageService.resolveAccessibleUrls(room.hotel.images),
          }
        : Promise.resolve(room.hotel),
    ]);

    return {
      ...room,
      images,
      ...(hotel ? { hotel } : {}),
    };
  }

  private async ensureCategoryExists(id: string) {
    const category = await this.prisma.roomCategory.findUnique({ where: { id } });
    if (!category) {
      throw new NotFoundException('Category not found');
    }
    return category;
  }

  private async ensureExists(id: string) {
    const room = await this.prisma.room.findUnique({ where: { id } });
    if (!room) {
      throw new NotFoundException('Room not found');
    }
    return room;
  }
}
