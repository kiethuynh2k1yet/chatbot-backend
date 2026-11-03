import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import bcrypt from 'bcryptjs';
import { UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseService } from '../database/database.service.js';
import { AuthService } from './auth.service.js';
import type { LoginRow } from './auth.types.js';

describe('AuthService', () => {
  const password = 'correct-horse-battery';
  let row: LoginRow;
  let query: ReturnType<typeof vi.fn>;
  let database: DatabaseService;
  let service: AuthService;

  beforeEach(async () => {
    row = {
      user_id: 7,
      employee_id: 21,
      employee_code: 'NV001',
      username: 'nguyenvana',
      password_hash: await bcrypt.hash(password, 4),
      failed_login_count: 0,
      locked_until: null,
      token_version: 2,
      full_name: 'Nguyễn Văn A',
      email: 'employee@example.com',
      phone: null,
      department: 'Engineering',
      position: 'Developer',
    };

    query = vi.fn();
    const request = {
      input: vi.fn().mockReturnThis(),
      query,
    };
    database = {
      getTable: vi.fn((name: string) => `[dbo].[${name}]`),
      request: vi.fn(async () => request),
    } as unknown as DatabaseService;

    service = new AuthService(
      database,
      new JwtService({ secret: 'test-secret-with-more-than-32-characters' }),
      new ConfigService({ JWT_EXPIRES_IN: '8h' }),
    );
  });

  it('returns a signed token and employee profile for valid credentials', async () => {
    query
      .mockResolvedValueOnce({ recordset: [row] })
      .mockResolvedValueOnce({ rowsAffected: [1] })
      .mockResolvedValueOnce({ recordset: [row] });

    const result = await service.login({
      username: row.username,
      password,
    });

    expect(result.tokenType).toBe('Bearer');
    expect(result.user).toMatchObject({
      userId: row.user_id,
      employeeId: row.employee_id,
      employeeCode: row.employee_code,
      fullName: row.full_name,
    });
    expect(result).not.toHaveProperty('password_hash');

    const payload = await new JwtService({
      secret: 'test-secret-with-more-than-32-characters',
    }).verifyAsync(result.accessToken);
    expect(payload).toMatchObject({
      sub: String(row.user_id),
      employeeId: row.employee_id,
      employeeCode: row.employee_code,
      tokenVersion: row.token_version,
    });
    await expect(
      service.getCurrentUser(`Bearer ${result.accessToken}`),
    ).resolves.toEqual(result.user);
  });

  it('increments the failed-attempt counter for an incorrect password', async () => {
    query
      .mockResolvedValueOnce({ recordset: [row] })
      .mockResolvedValueOnce({ rowsAffected: [1] });

    await expect(
      service.login({ username: row.username, password: 'wrong-password' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][0]).toContain('u.username = @username');
    expect(query.mock.calls[1][0]).toContain('failed_login_count');
  });

  it('rejects locked accounts without checking their real password hash', async () => {
    row.locked_until = new Date(Date.now() + 60_000);
    query.mockResolvedValueOnce({ recordset: [row] });

    await expect(
      service.login({ username: row.username, password }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('uses the same credential error for an unknown username', async () => {
    query.mockResolvedValueOnce({ recordset: [] });

    await expect(
      service.login({ username: 'unknown-user', password }),
    ).rejects.toThrow('Username hoặc mật khẩu không chính xác.');
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('rejects an absent bearer token without querying SQL Server', async () => {
    await expect(service.getCurrentUser(undefined)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(database.request).not.toHaveBeenCalled();
  });
});
