import {
  BadRequestException,
  Controller,
  Delete,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { JwtAuthGuard, RolesGuard } from '../../common/guards/auth.guards';
import {
  ALLOWED_MIME_TYPES,
  MAX_UPLOAD_SIZE_BYTES,
  StorageFolder,
} from './storage.constants';
import { StorageService } from './storage.service';

@ApiTags('Storage')
@Controller('storage')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_UPLOAD_SIZE_BYTES },
      fileFilter: (_req, file, callback) => {
        if (
          ALLOWED_MIME_TYPES.includes(
            file.mimetype as (typeof ALLOWED_MIME_TYPES)[number],
          )
        ) {
          callback(null, true);
          return;
        }

        callback(new Error(`Unsupported file type: ${file.mimetype}`), false);
      },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a file to Lightsail S3 storage' })
  @ApiQuery({
    name: 'folder',
    enum: StorageFolder,
    required: true,
    description: 'Target folder inside the bucket',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
      required: ['file'],
    },
  })
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Query('folder') folder: StorageFolder,
  ) {
    if (!Object.values(StorageFolder).includes(folder)) {
      throw new BadRequestException(`Invalid folder: ${folder}`);
    }

    return this.storageService.uploadFile(file, folder);
  }

  @Delete()
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Delete a file from storage (admin only)' })
  @ApiQuery({ name: 'key', required: true, description: 'Object key in the bucket' })
  async delete(@Query('key') key: string) {
    if (!key?.trim()) {
      throw new BadRequestException('key query parameter is required');
    }

    await this.storageService.deleteFile(key);
    return { message: 'File deleted successfully', key };
  }
}
