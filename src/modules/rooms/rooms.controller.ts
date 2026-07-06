import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { JwtAuthGuard, RolesGuard } from '../../common/guards/auth.guards';
import { RoomsService } from './rooms.service';
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

@ApiTags('Rooms')
@Controller()
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @Get('room-categories')
  @ApiOperation({ summary: 'List room categories' })
  findCategories() {
    return this.roomsService.findCategories();
  }

  @Post('room-categories')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create room category (admin)' })
  createCategory(@Body() dto: CreateRoomCategoryDto) {
    return this.roomsService.createCategory(dto);
  }

  @Patch('room-categories/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update room category (admin)' })
  updateCategory(@Param('id') id: string, @Body() dto: UpdateRoomCategoryDto) {
    return this.roomsService.updateCategory(id, dto);
  }

  @Delete('room-categories/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete room category (admin)' })
  removeCategory(@Param('id') id: string) {
    return this.roomsService.removeCategory(id);
  }

  @Get('rooms')
  @ApiOperation({ summary: 'Search and list rooms' })
  findAll(@Query() query: RoomQueryDto) {
    return this.roomsService.findAll(query, query);
  }

  @Get('rooms/:id')
  @ApiOperation({ summary: 'Get room details' })
  findOne(@Param('id') id: string) {
    return this.roomsService.findOne(id);
  }

  @Post('rooms')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create room (admin)' })
  create(@Body() dto: CreateRoomDto) {
    return this.roomsService.create(dto);
  }

  @Patch('rooms/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update room (admin)' })
  update(@Param('id') id: string, @Body() dto: UpdateRoomDto) {
    return this.roomsService.update(id, dto);
  }

  @Patch('rooms/:id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update room availability status (admin)' })
  updateStatus(@Param('id') id: string, @Body() dto: UpdateRoomStatusDto) {
    return this.roomsService.updateStatus(id, dto);
  }

  @Delete('rooms/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete room (admin)' })
  remove(@Param('id') id: string) {
    return this.roomsService.remove(id);
  }

  @Post('rooms/:id/images')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add room image (admin)' })
  addImage(@Param('id') id: string, @Body() dto: RoomImageDto) {
    return this.roomsService.addImage(id, dto);
  }

  @Patch('rooms/:id/images/:imageId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update room image (thumbnail, sort order)' })
  updateImage(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
    @Body() dto: UpdateRoomImageDto,
  ) {
    return this.roomsService.updateImage(id, imageId, dto);
  }

  @Delete('rooms/:id/images/:imageId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete room image (admin)' })
  removeImage(@Param('id') id: string, @Param('imageId') imageId: string) {
    return this.roomsService.removeImage(id, imageId);
  }
}
