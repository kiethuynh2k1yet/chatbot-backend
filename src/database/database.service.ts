import {
  Injectable,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sql, { type ConnectionPool, type Request } from 'mssql';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private poolPromise?: Promise<ConnectionPool>;

  constructor(private readonly config: ConfigService) {}

  async request(): Promise<Request> {
    const pool = await this.getPool();
    return pool.request();
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.poolPromise) return;
    try {
      const pool = await this.poolPromise;
      await pool.close();
    } catch {
      this.logger.warn('SQL Server connection pool could not be closed cleanly.');
    }
  }

  getTable(name: 'A30_User' | 'A30_Employee'): string {
    const schema = this.config.get<string>('DB_SCHEMA')?.trim() || 'dbo';
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
      throw new Error('DB_SCHEMA must be a valid SQL Server schema identifier.');
    }
    return `[${schema}].[${name}]`;
  }

  private getPool(): Promise<ConnectionPool> {
    if (!this.poolPromise) {
      const server = this.config.getOrThrow<string>('DB_HOST');
      const user = this.config.getOrThrow<string>('DB_USERNAME');
      const password = this.config.getOrThrow<string>('DB_PASSWORD');
      const database = this.config.getOrThrow<string>('DB_DATABASE');
      const portValue = this.config.get<string>('DB_PORT') ?? '1433';
      const port = Number(portValue);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('DB_PORT must be a valid TCP port.');
      }

      const pool = new sql.ConnectionPool({
        server,
        port,
        user,
        password,
        database,
        connectionTimeout: 15_000,
        requestTimeout: 15_000,
        pool: { max: 10, min: 0, idleTimeoutMillis: 30_000 },
        options: {
          encrypt: this.readBoolean('DB_ENCRYPT', true),
          trustServerCertificate: this.readBoolean(
            'DB_TRUST_SERVER_CERTIFICATE',
            false,
          ),
        },
      });

      const poolPromise = pool.connect().catch((error: unknown) => {
        this.poolPromise = undefined;
        this.logger.error(
          'Unable to connect to SQL Server. Check the DB_* settings and network access.',
        );
        throw new ServiceUnavailableException(
          'Không thể kết nối cơ sở dữ liệu. Vui lòng thử lại sau.',
          { cause: error },
        );
      });
      this.poolPromise = poolPromise;
      return poolPromise;
    }

    return this.poolPromise;
  }

  private readBoolean(name: string, defaultValue: boolean): boolean {
    const value = this.config.get<string>(name);
    if (value === undefined || value.trim() === '') return defaultValue;
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
    throw new Error(`${name} must be "true" or "false".`);
  }
}
