package com.rmyndharis.zaplink.errors;

import java.util.List;
import java.util.Map;

/** 401 Unauthorized — missing or invalid API key. */
public class ZapLinkAuthError extends ZapLinkApiError {
    public ZapLinkAuthError(String message, int status, Object body, String errorKind) {
        super(message, status, body, errorKind);
    }

    public ZapLinkAuthError(
            String message, int status, Object body, String errorKind, Map<String, List<String>> headers) {
        super(message, status, body, errorKind, headers);
    }
}
