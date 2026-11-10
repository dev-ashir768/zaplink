package com.rmyndharis.zaplink.resources;

import com.rmyndharis.zaplink.ZapLinkClient;
import com.rmyndharis.zaplink.http.HttpMethod;
import com.rmyndharis.zaplink.model.HealthReadyResponse;
import com.rmyndharis.zaplink.model.HealthResponse;

/** Health resource — connectivity and readiness probes. */
public final class HealthResource {
    private final ZapLinkClient client;

    public HealthResource(ZapLinkClient client) {
        this.client = client;
    }

    /** General health (also returns the running version). */
    public HealthResponse check() {
        return client.request(HttpMethod.GET, "/api/health", null, null, HealthResponse.class);
    }

    /** Kubernetes liveness probe. */
    public HealthResponse live() {
        return client.request(HttpMethod.GET, "/api/health/live", null, null, HealthResponse.class);
    }

    /** Kubernetes readiness probe — checks both DB connections. */
    public HealthReadyResponse ready() {
        return client.request(HttpMethod.GET, "/api/health/ready", null, null, HealthReadyResponse.class);
    }
}
