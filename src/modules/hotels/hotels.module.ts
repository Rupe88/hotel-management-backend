import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { HotelsController } from './hotels.controller';
import { HotelsService } from './hotels.service';

@Module({
  imports: [StorageModule],
  controllers: [HotelsController],
  providers: [HotelsService],
  exports: [HotelsService],
})
export class HotelsModule {}
