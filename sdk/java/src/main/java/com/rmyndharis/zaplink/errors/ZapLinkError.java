package com.rmyndharis.zaplink.errors;

/**
 * Base class for errors the SDK throws for an API response, a timeout or a transport failure. An invalid
 * argument (an empty or dot id, an invalid idempotency key or client option) throws
 * {@link IllegalArgumentException} instead.
 */
public class ZapLinkError extends RuntimeException {
    public ZapLinkError(String message) {
        super(message);
    }

    public ZapLinkError(String message, Throwable cause) {
        super(message, cause);
    }
}
