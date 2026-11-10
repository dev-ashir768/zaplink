<?php

declare(strict_types=1);

namespace ZapLink\Exceptions;

/** 409 Conflict: a conflicting state, typically a session that is not ready for the operation, or a keyed send that is pending or may already have been sent (see getErrorCode()). */
class ZapLinkConflictException extends ZapLinkApiException
{
}
