import { execSync, spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Client } from 'pg';

process.env.GOOGLE_CLIENT_ID = '';
process.env.GOOGLE_CLIENT_SECRET = '';

import { AppModule } from '../../src/app.module';

const MIGRATION_SQL = readFileSync(
  join(__dirname, '../../prisma/migrations/20250705000000_init/migration.sql'),
  'utf8',
);

const DATA_DIR = join(__dirname, '../../tmp-pgdata-e2e');
const PG_BIN = join(
  __dirname,
  '../../node_modules/@embedded-postgres',
  `${process.platform}-${process.arch}`,
  'native/bin',
);
const PG_PORT = 5434;
const DATABASE_URL = `postgresql://postgres@127.0.0.1:${PG_PORT}/postgres`;

function killPort(port: number): void {
  try {
    execSync(`lsof -ti :${port} | xargs kill -9`, { stdio: 'ignore' });
  } catch {
    // Port was already free.
  }
}

function runPgBin(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(join(PG_BIN, command), args, {
      env: { ...process.env, LC_MESSAGES: 'en_US.UTF-8' },
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });
  });
}

async function waitForPostgres(): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const client = new Client({ connectionString: DATABASE_URL });
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  throw new Error('Embedded PostgreSQL did not become ready in time');
}

async function startPostgres(): Promise<ChildProcessWithoutNullStreams> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('PostgreSQL startup timed out'));
    }, 30000);

    const postgresProcess = spawn(
      join(PG_BIN, 'postgres'),
      ['-D', DATA_DIR, '-p', PG_PORT.toString()],
      { env: { ...process.env, LC_MESSAGES: 'en_US.UTF-8' } },
    );

    postgresProcess.stderr.on('data', (chunk: Buffer) => {
      const message = chunk.toString();
      if (message.includes('database system is ready to accept connections')) {
        clearTimeout(timeout);
        resolve(postgresProcess);
      }
      if (message.includes('FATAL:')) {
        clearTimeout(timeout);
        reject(new Error(message));
      }
    });

    postgresProcess.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

export class E2eContext {
  private static initPromise: Promise<E2eContext> | null = null;
  private static instance: E2eContext | null = null;

  postgresProcess!: ChildProcessWithoutNullStreams;
  app!: INestApplication;

  static getInstance(): Promise<E2eContext> {
    if (!E2eContext.initPromise) {
      E2eContext.initPromise = E2eContext.create()
        .then((ctx) => {
          E2eContext.instance = ctx;
          return ctx;
        })
        .catch((error) => {
          E2eContext.initPromise = null;
          throw error;
        });
    }
    return E2eContext.initPromise;
  }

  static async teardown(): Promise<void> {
    if (E2eContext.instance) {
      await E2eContext.instance.close();
    }
  }

  private static async create(): Promise<E2eContext> {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-jwt-secret-minimum-32-characters-long';
    process.env.JWT_REFRESH_SECRET =
      'test-refresh-secret-minimum-32-characters-long';
    process.env.JWT_EXPIRES_IN = '1h';
    process.env.JWT_REFRESH_EXPIRES_IN = '7d';
    process.env.DATABASE_URL = DATABASE_URL;
    process.env.DIRECT_URL = DATABASE_URL;
    process.env.GOOGLE_CLIENT_ID = '';
    process.env.GOOGLE_CLIENT_SECRET = '';

    killPort(PG_PORT);
    rmSync(DATA_DIR, { recursive: true, force: true });

    await runPgBin('initdb', [
      '-D',
      DATA_DIR,
      '--locale=C.UTF-8',
      '-U',
      'postgres',
      '-A',
      'trust',
    ]);

    const ctx = new E2eContext();
    ctx.postgresProcess = await startPostgres();
    await waitForPostgres();

    const migrationClient = new Client({ connectionString: DATABASE_URL });
    await migrationClient.connect();
    await migrationClient.query(MIGRATION_SQL);
    await migrationClient.end();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    ctx.app = moduleFixture.createNestApplication();
    ctx.app.setGlobalPrefix('api/v1');
    ctx.app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await ctx.app.init();

    return ctx;
  }

  async resetDatabase(): Promise<void> {
    const client = new Client({ connectionString: DATABASE_URL });
    await client.connect();
    await client.query(`
      TRUNCATE TABLE
        "guest_photos",
        "guest_documents",
        "booking_guests",
        "invoices",
        "payments",
        "bookings",
        "room_images",
        "rooms",
        "room_categories",
        "hotel_policies",
        "hotel_amenities",
        "hotel_images",
        "hotels",
        "refresh_tokens",
        "users"
      RESTART IDENTITY CASCADE;
    `);
    await client.end();
  }

  async close(): Promise<void> {
    await this.app?.close();

    if (this.postgresProcess) {
      this.postgresProcess.kill('SIGINT');
      await new Promise<void>((resolve) => {
        this.postgresProcess.on('close', () => resolve());
      });
    }

    E2eContext.initPromise = null;
    E2eContext.instance = null;
  }
}
