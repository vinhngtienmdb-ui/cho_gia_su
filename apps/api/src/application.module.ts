import { Module, type DynamicModule } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AdminAccountsController, AdminAccountsService, AdminAuthController } from './admin/admin-accounts.js';
import { API_CONFIGURATION, type ApiConfiguration } from './common/configuration.js';
import { FileStorage, NoFileStorage, S3FileStorage } from './common/file-storage.js';
import { Clock } from './common/server.js';
import { createVideoProvider, VIDEO_PROVIDER } from './common/video-provider.js';
import { MarketAccountsController, MarketAccountsService } from './market/market-accounts.js';
import { MarketAdminController, MarketAdminService } from './market/market-admin.js';
import { MarketBookingsController, MarketBookingsService } from './market/market-bookings.js';
import { MarketContext } from './market/market-context.js';
import { MarketChildrenController, MarketFamilyService } from './market/market-family.js';
import { MarketIdentityController, MarketIdentityService } from './market/market-identity.js';
import { MarketListingController, MarketListingService } from './market/market-listing.js';
import { MarketMessenger } from './market/market-messenger.js';
import { MarketPasswordController, MarketPasswordService } from './market/market-password.js';
import { MarketplacePaymentProvider, MockMarketplacePaymentProvider } from './market/market-payment-provider.js';
import { MarketPaymentsAdminController, MarketPaymentsAdminService } from './market/market-payments-admin.js';
import { MarketPublicController, MarketPublicService } from './market/market-public.js';
import { MarketRateLimiter } from './market/market-rate-limit.js';
import { MarketReviewController, MarketReviewService } from './market/market-review.js';
import { MarketReviewsController, MarketReviewsService } from './market/market-reviews.js';
import { MarketRoomsController, MarketRoomsService } from './market/market-rooms.js';
import { MarketSafetyAdminController, MarketSafetyController, MarketSafetyService } from './market/market-safety.js';
import { MarketTutorController, MarketTutorsService } from './market/market-tutors.js';
import { VideoWebhookController } from './video-webhook.controller.js';

export interface ApplicationOptions {
  fileStorage?: FileStorage;
  paymentProvider?: MarketplacePaymentProvider;
}

// Mô-đun gốc của máy chủ API Chợ gia sư. Danh sách bộ điều khiển và dịch vụ lấy từ các tệp đăng ký phần dt-27f đến dt-27j, yctd-364 của
// School Management khi tách (YCTD-393), bỏ liên kết với trường, thêm tài khoản quản trị riêng và điểm nhận sự kiện video
@Module({})
export class ApplicationModule {
  static register(configuration: ApiConfiguration, clock: Clock, options: ApplicationOptions = {}): DynamicModule {
    return {
      module: ApplicationModule,
      controllers: [
        AdminAuthController,
        AdminAccountsController,
        MarketAccountsController,
        MarketChildrenController,
        MarketTutorController,
        MarketAdminController,
        MarketIdentityController,
        MarketListingController,
        MarketReviewController,
        MarketPublicController,
        MarketBookingsController,
        MarketPaymentsAdminController,
        MarketSafetyController,
        MarketSafetyAdminController,
        MarketRoomsController,
        MarketReviewsController,
        MarketPasswordController,
        VideoWebhookController,
      ],
      providers: [
        { provide: API_CONFIGURATION, useValue: configuration },
        { provide: Clock, useValue: clock },
        {
          provide: FileStorage,
          useValue:
            options.fileStorage ??
            (configuration.objectStorage ? new S3FileStorage(configuration.objectStorage) : new NoFileStorage()),
        },
        { provide: VIDEO_PROVIDER, useValue: createVideoProvider(configuration.video, configuration.objectStorage) },
        {
          provide: MarketplacePaymentProvider,
          useValue: options.paymentProvider ?? new MockMarketplacePaymentProvider(),
        },
        MarketContext,
        MarketMessenger,
        AdminAccountsService,
        MarketAccountsService,
        MarketFamilyService,
        MarketTutorsService,
        MarketAdminService,
        MarketIdentityService,
        MarketListingService,
        MarketReviewService,
        MarketPublicService,
        MarketBookingsService,
        MarketPaymentsAdminService,
        MarketSafetyService,
        MarketRoomsService,
        MarketReviewsService,
        MarketPasswordService,
        // Giới hạn số yêu cầu tới market/* theo địa chỉ mạng (YCTD-379)
        MarketRateLimiter,
        { provide: APP_INTERCEPTOR, useExisting: MarketRateLimiter },
      ],
    };
  }
}
