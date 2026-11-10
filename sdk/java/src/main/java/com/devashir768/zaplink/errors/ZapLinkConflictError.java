package com.devashir768.zaplink.errors;

import java.util.List;
import java.util.Map;

/** 409 Conflict: a conflicting state, typically a session that is not ready for the operation, or a keyed send that is pending or may already have been sent (see {@code code()}). */
public class ZapLinkConflictError extends ZapLinkApiError {
    public ZapLinkConflictError(String message, int status, Object body, String errorKind) {
        super(message, status, body, errorKind);
    }

    public ZapLinkConflictError(
            String message, int status, Object body, String errorKind, Map<String, List<String>> headers) {
        super(message, status, body, errorKind, headers);
    }
}
