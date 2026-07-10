import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { AdminBookingsController, BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';

@Module({
  imports: [StorageModule],
  controllers: [BookingsController, AdminBookingsController],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}
