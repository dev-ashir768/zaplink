import { BadRequestException, ValidationError } from '@nestjs/common';
import { FieldError } from './api-response';

/** Flatten class-validator failures, nested children included, into `{ field, message }` with dotted paths. */
export function flattenValidationErrors(errors: ValidationError[], parent = ''): FieldError[] {
  const out: FieldError[] = [];
  for (const error of errors) {
    const field = parent ? `${parent}.${error.property}` : error.property;
    for (const message of Object.values(error.constraints ?? {})) out.push({ field, message });
    if (error.children?.length) out.push(...flattenValidationErrors(error.children, field));
  }
  return out;
}

export const VALIDATION_FAILED_MESSAGE = 'Validation failed';

/**
 * The ValidationPipe exceptionFactory: a 400 whose body carries the flattened field errors. With
 * `detailed` false (production without VALIDATION_ERROR_DETAIL) the field list is withheld, as Nest's
 * own `disableErrorMessages` did.
 */
export function validationExceptionFactory(detailed: boolean) {
  return (errors: ValidationError[]): BadRequestException =>
    new BadRequestException({
      message: VALIDATION_FAILED_MESSAGE,
      errors: detailed ? flattenValidationErrors(errors) : [],
    });
}
