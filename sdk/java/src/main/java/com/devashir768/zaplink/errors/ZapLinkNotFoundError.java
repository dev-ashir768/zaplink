package com.devashir768.zaplink.errors;

import java.util.List;
import java.util.Map;

/** 404 Not Found. */
public class ZapLinkNotFoundError extends ZapLinkApiError {
    public ZapLinkNotFoundError(String message, int status, Object body, String errorKind) {
        super(message, status, body, errorKind);
    }

    public ZapLinkNotFoundError(
            String message, int status, Object body, String errorKind, Map<String, List<String>> headers) {
        super(message, status, body, errorKind, headers);
    }
}
