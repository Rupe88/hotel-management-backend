import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { AdminBookingsController, BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';

@Module({
  imports: [StorageModule, InvoicesModule],
  controllers: [BookingsController, AdminBookingsController],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}
