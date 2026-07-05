import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RoomStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { paginate, PaginationDto } from '../../common/dto/pagination.dto';
import {
  CreateRoomCategoryDto,
  CreateRoomDto,
  RoomImageDto,
  RoomQueryDto,
  UpdateRoomDto,
  UpdateRoomStatusDto,
} from './dto/room.dto';

const roomInclude = {
  hotel: { select: { id: true, name: true, slug: true, city: true } },
  category: true,
  images: { orderBy: { sortOrder: 'asc' as const } },
};

@Injectable()
export class RoomsService {
  constructor(private readonly prisma: PrismaService) {}

  findCategories() {
    return this.prisma.roomCategory.findMany({ orderBy: { name: 'asc' } });
  }

  createCategory(dto: CreateRoomCategoryDto) {
    return this.prisma.roomCategory.create({ data: dto });
  }

  async findAll(query: RoomQueryDto, pagination: PaginationDto) {
    const { skip, take, page, limit } = paginate(pagination.page, pagination.limit);
    const where: Prisma.RoomWhereInput = {
      ...(query.hotelId ? { hotelId: query.hotelId } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.status ? { status: query.status } : { status: RoomStatus.AVAILABLE }),
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

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
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
            images: true,
          },
        },
      },
    });

    if (!room) {
      throw new NotFoundException('Room not found');
    }

    return room;
  }

  async create(dto: CreateRoomDto) {
    try {
      return await this.prisma.room.create({
        data: {
          ...dto,
          pricePerNight: dto.pricePerNight,
        },
        include: roomInclude,
      });
    } catch {
      throw new ConflictException('Room number already exists for this hotel');
    }
  }

  async update(id: string, dto: UpdateRoomDto) {
    await this.ensureExists(id);
    return this.prisma.room.update({
      where: { id },
      data: dto,
      include: roomInclude,
    });
  }

  async updateStatus(id: string, dto: UpdateRoomStatusDto) {
    await this.ensureExists(id);
    return this.prisma.room.update({
      where: { id },
      data: { status: dto.status },
      include: roomInclude,
    });
  }

  async remove(id: string) {
    await this.ensureExists(id);
    await this.prisma.room.delete({ where: { id } });
    return { message: 'Room deleted successfully' };
  }

  async addImage(roomId: string, dto: RoomImageDto) {
    await this.ensureExists(roomId);

    if (dto.isPrimary) {
      await this.prisma.roomImage.updateMany({
        where: { roomId },
        data: { isPrimary: false },
      });
    }

    return this.prisma.roomImage.create({ data: { roomId, ...dto } });
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

  private async ensureExists(id: string) {
    const room = await this.prisma.room.findUnique({ where: { id } });
    if (!room) {
      throw new NotFoundException('Room not found');
    }
    return room;
  }
}
