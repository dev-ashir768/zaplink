import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  INestApplication,
  Post,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerException } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { IsString, Matches, ValidateNested } from 'class-validator';
import type { Response } from 'express';
import { Readable } from 'node:stream';
import request from 'supertest';
import type { App } from 'supertest/types';
import { applyGlobalValidation } from '../../config/app-validation';
import { requestContextMiddleware } from '../middleware/request-context.middleware';
import { AllExceptionsFilter, resolveException } from './all-exceptions.filter';
import { RawResponse, ResponseMessage } from './api-response';
import { ResponseEnvelopeInterceptor } from './response-envelope.interceptor';
import { flattenValidationErrors } from './validation-errors';

class ChildDto {
  @IsString()
  phone!: string;
}

class CreateThingDto {
  @Matches(/^[a-z]+$/, { message: 'name may only contain lowercase letters' })
  name!: string;

  @ValidateNested()
  @Type(() => ChildDto)
  child!: ChildDto;
}

@Controller('things')
class ThingsController {
  @Get()
  list() {
    return { items: [{ id: 1 }], total: 1, limit: 50, offset: 0 };
  }

  @Post()
  @ResponseMessage('Thing created')
  create(@Body() dto: CreateThingDto) {
    return { name: dto.name };
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(): void {}

  @Delete('soft')
  removeSoft() {
    return { deleted: true };
  }

  @Get('stream')
  stream() {
    return new StreamableFile(Readable.from([Buffer.from('raw-bytes')]));
  }

  @Get('res')
  manual(@Res() res: Response) {
    res.status(200).json({ untouched: true });
  }

  @Get('text')
  @RawResponse()
  text() {
    return { raw: true };
  }

  @Get('boom')
  boom() {
    throw new Error('secret connection string postgres://user:pw@db');
  }

  @Get('throttled')
  throttled() {
    throw new ThrottlerException();
  }

  @Get('conflict')
  conflict() {
    throw new ConflictException({
      statusCode: 409,
      error: 'Conflict',
      message: "Session with name 'x' already exists",
      sessionId: 'abc',
    });
  }

  @Get('engine')
  engine() {
    throw new HttpException(
      { statusCode: 501, error: 'Not Implemented', code: 'ENGINE_NOT_SUPPORTED', message: 'nope', engine: 'baileys' },
      501,
    );
  }

  @Get('unauthorized')
  unauthorized(@Res({ passthrough: true }) res: Response) {
    res.setHeader('WWW-Authenticate', 'ApiKey');
    throw new HttpException('Invalid API key', 401);
  }
}

describe('response envelope (interceptor + exception filter)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ThingsController],
      providers: [
        { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(requestContextMiddleware);
    applyGlobalValidation(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('wraps a success with the default message and leaves a list payload as it is', async () => {
    const res = await request(app.getHttpServer()).get('/api/things').expect(200);
    expect(res.body).toEqual({
      success: true,
      message: 'OK',
      data: { items: [{ id: 1 }], total: 1, limit: 50, offset: 0 },
    });
  });

  it('uses the @ResponseMessage text and keeps 201', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/things')
      .send({ name: 'abc', child: { phone: '1' } })
      .expect(201);
    expect(res.body).toEqual({ success: true, message: 'Thing created', data: { name: 'abc' } });
  });

  it('defaults DELETE to "Deleted"', async () => {
    const res = await request(app.getHttpServer()).delete('/api/things/soft').expect(200);
    expect(res.body).toEqual({ success: true, message: 'Deleted', data: { deleted: true } });
  });

  it('leaves a 204 empty', async () => {
    const res = await request(app.getHttpServer()).delete('/api/things').expect(204);
    expect(res.text).toBe('');
  });

  it('leaves a stream, a @Res response and a @RawResponse handler untouched', async () => {
    const stream = await request(app.getHttpServer()).get('/api/things/stream').expect(200);
    expect(Buffer.from(stream.body as Buffer).toString()).toBe('raw-bytes');
    const manual = await request(app.getHttpServer()).get('/api/things/res').expect(200);
    expect(manual.body).toEqual({ untouched: true });
    const raw = await request(app.getHttpServer()).get('/api/things/text').expect(200);
    expect(raw.body).toEqual({ raw: true });
  });

  it('renders validation failures as { field, message } with dotted paths', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/things')
      .send({ name: 'bad name!', child: {} })
      .expect(400);
    expect(res.body).toMatchObject({ success: false, message: 'Validation failed', data: null });
    expect((res.body as { errors: unknown }).errors).toEqual(
      expect.arrayContaining([
        { field: 'name', message: 'name may only contain lowercase letters' },
        { field: 'child.phone', message: 'phone must be a string' },
      ]),
    );
    expect(typeof (res.body as { requestId: unknown }).requestId).toBe('string');
    expect(res.body).not.toHaveProperty('statusCode');
  });

  it('hides the internals of an unexpected error behind a generic 500', async () => {
    const res = await request(app.getHttpServer()).get('/api/things/boom').expect(500);
    expect(res.body).toEqual({
      success: false,
      message: 'Internal server error',
      errors: [],
      data: null,
      requestId: res.headers['x-request-id'],
    });
    expect(JSON.stringify(res.body)).not.toContain('postgres://');
  });

  it('renders the throttler 429 in the envelope', async () => {
    const res = await request(app.getHttpServer()).get('/api/things/throttled').expect(429);
    expect(res.body).toMatchObject({ success: false, errors: [], data: null });
    expect(typeof (res.body as { message: unknown }).message).toBe('string');
  });

  it('answers an unknown route with a 404 envelope', async () => {
    const res = await request(app.getHttpServer()).get('/api/nope').expect(404);
    expect(res.body).toMatchObject({ success: false, message: 'Cannot GET /api/nope', errors: [], data: null });
  });

  it('answers malformed JSON with a 400 envelope', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/things')
      .set('Content-Type', 'application/json')
      .send('{"name":')
      .expect(400);
    expect(res.body).toMatchObject({ success: false, errors: [], data: null });
  });

  it('keeps machine-readable extras and drops the reason phrase', async () => {
    const conflict = await request(app.getHttpServer()).get('/api/things/conflict').expect(409);
    expect(conflict.body).toMatchObject({
      success: false,
      message: "Session with name 'x' already exists",
      errors: [],
      data: null,
      sessionId: 'abc',
    });
    expect(conflict.body).not.toHaveProperty('error');
    const engine = await request(app.getHttpServer()).get('/api/things/engine').expect(501);
    expect(engine.body).toMatchObject({ code: 'ENGINE_NOT_SUPPORTED', engine: 'baileys', message: 'nope' });
  });

  it('keeps headers set before the error', async () => {
    const res = await request(app.getHttpServer()).get('/api/things/unauthorized').expect(401);
    expect(res.headers['www-authenticate']).toBe('ApiKey');
    expect(res.body).toMatchObject({ success: false, message: 'Invalid API key' });
  });
});

describe('resolveException', () => {
  it('maps body-parser errors by type', () => {
    expect(resolveException({ status: 413, type: 'entity.too.large', expose: true, message: 'x' })).toMatchObject({
      status: 413,
      message: 'Request body is too large',
    });
  });

  it('maps a TypeORM unique violation to 409 and EntityNotFound to 404', () => {
    expect(resolveException({ name: 'QueryFailedError', driverError: { code: '23505' } }).status).toBe(409);
    expect(resolveException({ name: 'EntityNotFoundError' }).status).toBe(404);
    expect(resolveException({ name: 'QueryFailedError', message: 'syntax' }).status).toBe(500);
  });

  it("turns Nest's list of messages into field errors", () => {
    const r = resolveException(new HttpException({ message: ['name must be a string', 'age must be a number'] }, 400));
    expect(r.message).toBe('Validation failed');
    expect(r.errors).toEqual([
      { field: 'name', message: 'name must be a string' },
      { field: 'age', message: 'age must be a number' },
    ]);
  });
});

describe('flattenValidationErrors', () => {
  it('flattens nested children and array items with dotted paths', () => {
    expect(
      flattenValidationErrors([
        {
          property: 'items',
          children: [{ property: '0', children: [{ property: 'phone', constraints: { isString: 'bad' } }] }],
        },
      ]),
    ).toEqual([{ field: 'items.0.phone', message: 'bad' }]);
  });
});
