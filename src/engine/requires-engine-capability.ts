import {
  applyDecorators,
  CallHandler,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { ApiExtension, ApiResponse } from '@nestjs/swagger';
import { ENGINE_NOT_SUPPORTED_501 } from '../common/openapi/engine-status-responses';
import type { Observable } from 'rxjs';
import { ENGINE_LABELS, isCapabilitySupported, resolveEngineId, supportedEngines } from './engine-capabilities';

export const ENGINE_CAPABILITY_KEY = 'zaplink:engine-capability';

/**
 * Marks a route as depending on one engine capability (an `IWhatsAppEngine` method name from the
 * capability matrix). The route then:
 *  - answers `501 ENGINE_NOT_SUPPORTED` before reaching the engine when the active engine lacks it;
 *  - carries `x-engines: [...]` in the OpenAPI document, so the Developer Center can filter by engine.
 */
export function RequiresEngineCapability(capability: string) {
  const engines = supportedEngines(capability);
  if (engines.length === 0) {
    throw new Error(`RequiresEngineCapability('${capability}'): no engine supports it — remove the route instead.`);
  }
  return applyDecorators(
    SetMetadata(ENGINE_CAPABILITY_KEY, capability),
    ApiExtension('x-engines', engines),
    ApiExtension('x-engine-capability', capability),
    ApiResponse({ status: HttpStatus.NOT_IMPLEMENTED, description: ENGINE_NOT_SUPPORTED_501 }),
  );
}

/** Body of the 501 answered for a route the active engine cannot serve. */
export function engineNotSupportedBody(capability: string, engine: string) {
  const supportedBy = supportedEngines(capability);
  return {
    statusCode: HttpStatus.NOT_IMPLEMENTED,
    error: 'Not Implemented',
    code: 'ENGINE_NOT_SUPPORTED',
    message:
      `Operation not supported by the active engine (${engine}): ${capability}. ` +
      (supportedBy.length
        ? `Supported by ${supportedBy.map(e => ENGINE_LABELS[e]).join(', ')}; switch engines in the dashboard (Infrastructure > Engine).`
        : 'No engine supports it.'),
    engine,
    capability,
    supportedBy,
  };
}

/** Global interceptor (runs after the auth guards) enforcing `@RequiresEngineCapability`. */
@Injectable()
export class EngineCapabilityInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const capability = this.reflector.getAllAndOverride<string | undefined>(ENGINE_CAPABILITY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (capability) {
      const engine = resolveEngineId(this.config.get<string>('engine.type'));
      if (!isCapabilitySupported(capability, engine)) {
        throw new HttpException(engineNotSupportedBody(capability, engine), HttpStatus.NOT_IMPLEMENTED);
      }
    }
    return next.handle();
  }
}
