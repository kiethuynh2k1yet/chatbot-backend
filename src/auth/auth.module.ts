import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, type JwtSignOptions } from '@nestjs/jwt';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';

function getJwtSecret(config: ConfigService): string {
  const secret = config.getOrThrow<string>('JWT_SECRET');
  if (secret.length < 32) {
    throw new Error('JWT_SECRET must contain at least 32 characters.');
  }
  return secret;
}

function getJwtExpiresIn(config: ConfigService): JwtSignOptions['expiresIn'] {
  const value = config.get<string>('JWT_EXPIRES_IN') ?? '8h';
  if (!/^\d+(s|m|h|d|w|y)$/.test(value)) {
    throw new Error(
      'JWT_EXPIRES_IN must be a duration such as 15m, 8h, or 7d.',
    );
  }
  return value as JwtSignOptions['expiresIn'];
}

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: getJwtSecret(config),
        signOptions: { expiresIn: getJwtExpiresIn(config) },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
  exports: [AuthService],
})
export class AuthModule {}
