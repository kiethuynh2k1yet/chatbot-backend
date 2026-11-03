import {
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import sql from 'mssql';
import { DatabaseService } from '../database/database.service.js';
import type {
  AccessTokenPayload,
  EmployeeIdentity,
  LoginRow,
} from './auth.types.js';
import type { LoginDto } from './dto/login.dto.js';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MINUTES = 15;
const BCRYPT_MAX_PASSWORD_BYTES = 72;
const DUMMY_PASSWORD_HASH =
  '$2b$10$7EqJtq98hPqEX7fNZaFWoO5zQ4zV6KQn8rJxv/2rZ5lL9j/0jNn8K';

type TokenResponse = {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: string;
  user: EmployeeIdentity;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly expiresIn: string;

  constructor(
    private readonly database: DatabaseService,
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    this.expiresIn = config.get<string>('JWT_EXPIRES_IN') ?? '8h';
  }

  async login(credentials: LoginDto): Promise<TokenResponse> {
    const rows = await this.findLoginRows(credentials.username);
    if (rows.length > 1) {
      this.logger.error('Multiple active accounts share the same login email.');
      throw new InternalServerErrorException(
        'Dữ liệu tài khoản không hợp lệ. Vui lòng liên hệ quản trị viên.',
      );
    }

    const row = rows[0];
    if (!row) {
      await bcrypt.compare(credentials.password, DUMMY_PASSWORD_HASH);
      throw this.invalidCredentials();
    }

    if (row.locked_until && row.locked_until.getTime() > Date.now()) {
      await bcrypt.compare(credentials.password, DUMMY_PASSWORD_HASH);
      throw this.invalidCredentials();
    }

    if (!this.isBcryptHash(row.password_hash)) {
      this.logger.error('An employee account has a password hash that is not bcrypt.');
      throw new InternalServerErrorException(
        'Cấu hình mật khẩu tài khoản không hợp lệ. Vui lòng liên hệ quản trị viên.',
      );
    }

    const passwordSupported =
      Buffer.byteLength(credentials.password, 'utf8') <=
      BCRYPT_MAX_PASSWORD_BYTES;
    const passwordMatches = await bcrypt.compare(
      passwordSupported ? credentials.password : '',
      row.password_hash,
    );
    if (!passwordSupported || !passwordMatches) {
      await this.recordFailedLogin(row.user_id);
      throw this.invalidCredentials();
    }

    const updated = await this.resetFailedLogins(row.user_id);
    if (!updated) throw this.invalidCredentials();

    const user = this.toIdentity(row);
    const payload: AccessTokenPayload = {
      employeeId: user.employeeId,
      employeeCode: user.employeeCode,
      tokenVersion: row.token_version,
    };
    const accessToken = await this.jwt.signAsync(payload, {
      subject: String(row.user_id),
    });

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: this.expiresIn,
      user,
    };
  }

  async getCurrentUser(
    authorizationHeader: string | undefined,
  ): Promise<EmployeeIdentity> {
    const token = authorizationHeader?.match(/^Bearer\s+(\S+)$/i)?.[1];
    if (!token) throw this.invalidToken();

    let subject: string;
    let payload: AccessTokenPayload;
    try {
      const decoded = await this.jwt.verifyAsync<
        AccessTokenPayload & { sub?: string }
      >(token);
      if (
        typeof decoded.sub !== 'string' ||
        !Number.isSafeInteger(Number(decoded.sub)) ||
        !Number.isSafeInteger(decoded.employeeId) ||
        !Number.isSafeInteger(decoded.tokenVersion) ||
        typeof decoded.employeeCode !== 'string'
      ) {
        throw this.invalidToken();
      }
      subject = decoded.sub;
      payload = decoded;
    } catch {
      throw this.invalidToken();
    }

    const rows = await this.findUserById(Number(subject));
    const row = rows[0];
    if (
      !row ||
      rows.length !== 1 ||
      row.token_version !== payload.tokenVersion ||
      row.employee_id !== payload.employeeId ||
      row.employee_code !== payload.employeeCode
    ) {
      throw this.invalidToken();
    }

    return this.toIdentity(row);
  }

  private async findLoginRows(username: string): Promise<LoginRow[]> {
    const users = this.database.getTable('A30_User');
    const employees = this.database.getTable('A30_Employee');
    const request = await this.database.request();
    request.input('username', sql.VarChar(100), username);

    const result = await request.query<LoginRow>(`
      SELECT TOP (2)
        u.id AS user_id,
        e.id AS employee_id,
        e.employee_code,
        u.username,
        u.password_hash,
        u.failed_login_count,
        u.locked_until,
        u.token_version,
        e.full_name,
        COALESCE(NULLIF(u.login_email, ''), e.email) AS email,
        e.phone,
        e.department,
        e.position
      FROM ${users} AS u
      INNER JOIN ${employees} AS e
        ON e.employee_code = u.user_code
      WHERE u.username = @username
        AND u.is_delete = 0
        AND e.is_active = 1;
    `);
    return result.recordset;
  }

  private async findUserById(userId: number): Promise<LoginRow[]> {
    const users = this.database.getTable('A30_User');
    const employees = this.database.getTable('A30_Employee');
    const request = await this.database.request();
    request.input('userId', sql.Int, userId);

    const result = await request.query<LoginRow>(`
      SELECT TOP (2)
        u.id AS user_id,
        e.id AS employee_id,
        e.employee_code,
        u.username,
        u.password_hash,
        u.failed_login_count,
        u.locked_until,
        u.token_version,
        e.full_name,
        COALESCE(NULLIF(u.login_email, ''), e.email) AS email,
        e.phone,
        e.department,
        e.position
      FROM ${users} AS u
      INNER JOIN ${employees} AS e
        ON e.employee_code = u.user_code
      WHERE u.id = @userId
        AND u.is_delete = 0
        AND e.is_active = 1;
    `);
    return result.recordset;
  }

  private async recordFailedLogin(userId: number): Promise<void> {
    const users = this.database.getTable('A30_User');
    const request = await this.database.request();
    request.input('userId', sql.Int, userId);
    request.input('maxAttempts', sql.Int, MAX_FAILED_ATTEMPTS);
    request.input('lockMinutes', sql.Int, LOCK_DURATION_MINUTES);

    await request.query(`
      UPDATE account
      SET failed_login_count = attempt.next_count,
          locked_until = CASE
            WHEN attempt.next_count >= @maxAttempts
              THEN DATEADD(MINUTE, @lockMinutes, SYSDATETIME())
            ELSE NULL
          END,
          updated_at = SYSDATETIME()
      FROM ${users} AS account
      CROSS APPLY (
        VALUES (
          CASE
            WHEN account.locked_until IS NOT NULL
              AND account.locked_until <= SYSDATETIME()
              THEN 1
            ELSE account.failed_login_count + 1
          END
        )
      ) AS attempt(next_count)
      WHERE account.id = @userId
        AND account.is_delete = 0
        AND (
          account.locked_until IS NULL
          OR account.locked_until <= SYSDATETIME()
        );
    `);
  }

  private async resetFailedLogins(userId: number): Promise<boolean> {
    const users = this.database.getTable('A30_User');
    const request = await this.database.request();
    request.input('userId', sql.Int, userId);

    const result = await request.query(`
      UPDATE ${users}
      SET failed_login_count = 0,
          locked_until = NULL,
          last_login_at = SYSDATETIME(),
          updated_at = SYSDATETIME()
      WHERE id = @userId
        AND is_delete = 0
        AND (locked_until IS NULL OR locked_until <= SYSDATETIME());
    `);
    return result.rowsAffected[0] === 1;
  }

  private toIdentity(row: LoginRow): EmployeeIdentity {
    return {
      userId: row.user_id,
      employeeId: row.employee_id,
      employeeCode: row.employee_code,
      username: row.username,
      fullName: row.full_name,
      email: row.email,
      phone: row.phone,
      department: row.department,
      position: row.position,
    };
  }

  private isBcryptHash(hash: string): boolean {
    return /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(hash);
  }

  private invalidCredentials(): UnauthorizedException {
    return new UnauthorizedException('Username hoặc mật khẩu không chính xác.');
  }

  private invalidToken(): UnauthorizedException {
    return new UnauthorizedException('Phiên đăng nhập không hợp lệ hoặc đã hết hạn.');
  }
}
