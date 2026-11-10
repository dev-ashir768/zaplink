package com.devashir768.zaplink;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.devashir768.zaplink.errors.ZapLinkError;
import com.devashir768.zaplink.http.HttpMethod;
import com.devashir768.zaplink.http.HttpTransport;
import com.devashir768.zaplink.model.SuccessResult;
import com.devashir768.zaplink.support.MockTransport;
import java.net.ConnectException;
import java.time.Duration;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

class ConfigTest {
    private static ClientConfig.Builder base() {
        return ClientConfig.builder().baseUrl("http://h").apiKey("owa_k1_x");
    }

    @Test
    void rejectsZeroAndNegativeTimeout() {
        assertThrows(IllegalArgumentException.class, () -> base().timeout(Duration.ZERO).build());
        assertThrows(IllegalArgumentException.class, () -> base().timeout(Duration.ofSeconds(-1)).build());
    }

    @Test
    void rejectsMalformedBaseUrl() {
        assertThrows(IllegalArgumentException.class,
            () -> ClientConfig.builder().baseUrl("http://my host:2785").apiKey("owa_k1_x").build());
    }

    @Test
    void rejectsApiKeyWithInteriorControlChar() {
        assertThrows(IllegalArgumentException.class,
            () -> ClientConfig.builder().baseUrl("http://h").apiKey("owa\nk1").build());
    }

    @Test
    void trimsWhitespaceFromBaseUrlAndApiKey() {
        // A trailing newline (e.g. key read from a file/env) must be tolerated, not fatal.
        MockTransport tx = new MockTransport().respond(200, "{\"valid\":true}");
        ZapLinkClient c = new ZapLinkClient(
            ClientConfig.builder().baseUrl("http://h ").apiKey(" owa_k1_x\n").transport(tx).build());
        c.auth();
        assertEquals("owa_k1_x", tx.lastRequest().headers().get("X-API-Key"));
        assertTrue(tx.lastRequest().url().startsWith("http://h/"));
    }

    @Test
    void aDefaultHeaderValueWithAStrayNewlineIsRefusedWithoutBeingQuoted() {
        Map<String, String> h = new HashMap<>();
        h.put("CF-Access-Client-Secret", "s3cret-token\n");
        IllegalArgumentException e =
            assertThrows(IllegalArgumentException.class, () -> base().defaultHeaders(h).build());
        assertTrue(e.getMessage().contains("CF-Access-Client-Secret"));
        assertFalse(e.getMessage().contains("s3cret-token"));
        Map<String, String> badName = Map.of("X Bad Name", "v");
        assertThrows(IllegalArgumentException.class, () -> base().defaultHeaders(badName).build());
        // A tab and plain printable ASCII are fine.
        base().defaultHeaders(Map.of("X-Trace", "a\tb c")).build();
    }

    @Test
    void defaultHeadersAreCopiedAtBuildTime() {
        Map<String, String> h = new HashMap<>(Map.of("X-Tenant", "a"));
        MockTransport tx = new MockTransport().respond(200, "{\"valid\":true}");
        ZapLinkClient c = new ZapLinkClient(base().defaultHeaders(h).transport(tx).build());
        h.put("X-Tenant", "b");
        c.auth();
        assertEquals("a", tx.lastRequest().headers().get("X-Tenant"));
    }

    @Test
    void rejectsNullDefaultHeaderValue() {
        Map<String, String> h = new HashMap<>();
        h.put("X-Trace", null);
        assertThrows(IllegalArgumentException.class, () -> base().defaultHeaders(h).build());
    }

    @Test
    void transportIllegalArgumentIsWrappedAsZapLinkError() {
        HttpTransport bad = req -> {
            throw new IllegalArgumentException("restricted header name: \"Host\"");
        };
        ZapLinkClient c = new ZapLinkClient(base().transport(bad).build());
        ZapLinkError e = assertThrows(ZapLinkError.class,
            () -> c.request(HttpMethod.GET, "/x", null, null, SuccessResult.class));
        assertTrue(e.getMessage().contains("Invalid request"));
    }

    @Test
    void aRefusedHeaderValueIsNotRepeatedButARefusedHeaderNameIsNamed() {
        HttpTransport badValue = req -> {
            throw new IllegalArgumentException("invalid header value: \"s3cret-token\"");
        };
        ZapLinkError value = assertThrows(ZapLinkError.class,
            () -> new ZapLinkClient(base().transport(badValue).build())
                .request(HttpMethod.GET, "/x", null, null, SuccessResult.class));
        assertFalse(value.getMessage().contains("s3cret-token"));
        assertTrue(value.getMessage().contains("header value"));

        HttpTransport restricted = req -> {
            throw new IllegalArgumentException("restricted header name: \"Host\"");
        };
        ZapLinkError name = assertThrows(ZapLinkError.class,
            () -> new ZapLinkClient(base().transport(restricted).build())
                .request(HttpMethod.GET, "/x", null, null, SuccessResult.class));
        assertTrue(name.getMessage().contains("restricted header name: \"Host\""));
    }

    @Test
    void anApiKeyWithAnInnerSpaceIsAcceptedAsTheGatewayAndOtherClientsTakeIt() {
        MockTransport tx = new MockTransport().respond(200, "{\"valid\":true}");
        new ZapLinkClient(ClientConfig.builder().baseUrl("http://h").apiKey("correct horse battery staple\n").transport(tx).build()).auth();
        assertEquals("correct horse battery staple", tx.lastRequest().headers().get("X-API-Key"));
    }

    @Test
    void rejectsApiKeyWithNonAsciiCharacterWithoutEchoingIt() {
        // A zero-width space is a common copy artifact; the JDK would quote the whole key when it
        // refused the header, so the key is refused here and never repeated.
        String key = "owa_k1_0123456789abcdef\u200b";
        IllegalArgumentException e = assertThrows(IllegalArgumentException.class,
            () -> ClientConfig.builder().baseUrl("http://h").apiKey(key).build());
        assertFalse(e.getMessage().contains("owa_k1_0123456789abcdef"));
    }

    @Test
    void transportFailureWithoutDetailTextNamesTheExceptionAndKeepsTheCause() {
        ConnectException refused = new ConnectException();
        HttpTransport down = req -> {
            throw refused;
        };
        ZapLinkClient c = new ZapLinkClient(base().transport(down).build());
        ZapLinkError e = assertThrows(ZapLinkError.class,
            () -> c.request(HttpMethod.GET, "/x", null, null, SuccessResult.class));
        assertTrue(e.getMessage().endsWith(": ConnectException"), e.getMessage());
        assertSame(refused, e.getCause());
    }
}
