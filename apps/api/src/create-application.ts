import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ApplicationModule, type ApplicationOptions } from './application.module.js';
import type { ApiConfiguration } from './common/configuration.js';
import { ErrorFilter } from './common/error.filter.js';
import { securityHeaders } from './common/security-headers.js';
import { Clock, SystemClock } from './common/server.js';
import { API_VERSION_PREFIX } from './common/shared.js';
import { applyTrustProxy } from './common/trust-proxy.js';

export async function createApplication(
  configuration: ApiConfiguration,
  options: ApplicationOptions & { clock?: Clock } = {},
): Promise<INestApplication> {
  const application = await NestFactory.create(
    ApplicationModule.register(configuration, options.clock ?? new SystemClock(), options),
    { logger: ['error', 'warn'] },
  );
  application.use(securityHeaders());
  application.setGlobalPrefix(API_VERSION_PREFIX.slice(1));
  application.useGlobalFilters(new ErrorFilter());
  // Sau máy chủ chuyển tiếp thì lấy địa chỉ người dùng từ X-Forwarded-For cho nhật ký và giới hạn yêu cầu
  applyTrustProxy(application, configuration.trustProxy);
  application.enableShutdownHooks();
  return application;
}
