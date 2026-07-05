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
import { HotelsService } from './hotels.service';
import {
  CreateHotelDto,
  HotelAmenityDto,
  HotelImageDto,
  HotelPolicyDto,
  HotelQueryDto,
  UpdateHotelDto,
} from './dto/hotel.dto';

@ApiTags('Hotels')
@Controller('hotels')
export class HotelsController {
  constructor(private readonly hotelsService: HotelsService) {}

  @Get()
  @ApiOperation({ summary: 'Search and list hotels' })
  findAll(@Query() query: HotelQueryDto) {
    return this.hotelsService.findAll(query, query);
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Get hotel details by slug' })
  findBySlug(@Param('slug') slug: string) {
    return this.hotelsService.findBySlug(slug);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create hotel (admin)' })
  create(@Body() dto: CreateHotelDto) {
    return this.hotelsService.create(dto);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update hotel (admin)' })
  update(@Param('id') id: string, @Body() dto: UpdateHotelDto) {
    return this.hotelsService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete hotel (admin)' })
  remove(@Param('id') id: string) {
    return this.hotelsService.remove(id);
  }

  @Post(':id/images')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add hotel gallery image (admin)' })
  addImage(@Param('id') id: string, @Body() dto: HotelImageDto) {
    return this.hotelsService.addImage(id, dto);
  }

  @Delete(':id/images/:imageId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete hotel image (admin)' })
  removeImage(@Param('id') id: string, @Param('imageId') imageId: string) {
    return this.hotelsService.removeImage(id, imageId);
  }

  @Post(':id/amenities')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add hotel amenity (admin)' })
  addAmenity(@Param('id') id: string, @Body() dto: HotelAmenityDto) {
    return this.hotelsService.addAmenity(id, dto);
  }

  @Delete(':id/amenities/:amenityId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete hotel amenity (admin)' })
  removeAmenity(@Param('id') id: string, @Param('amenityId') amenityId: string) {
    return this.hotelsService.removeAmenity(id, amenityId);
  }

  @Post(':id/policies')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add hotel policy (admin)' })
  addPolicy(@Param('id') id: string, @Body() dto: HotelPolicyDto) {
    return this.hotelsService.addPolicy(id, dto);
  }

  @Delete(':id/policies/:policyId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete hotel policy (admin)' })
  removePolicy(@Param('id') id: string, @Param('policyId') policyId: string) {
    return this.hotelsService.removePolicy(id, policyId);
  }
}
