package com.devashir768.zaplink;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.devashir768.zaplink.errors.ZapLinkError;
import com.devashir768.zaplink.http.HttpMethod;
import com.devashir768.zaplink.model.SendTextRequest;
import com.devashir768.zaplink.model.SuccessResult;
import com.devashir768.zaplink.support.MockTransport;
import org.junit.jupiter.api.Test;

/**
 * A 2xx body the client cannot read as the expected type (an explicit null for a primitive component, a
 * fraction for an integer, or text that is not JSON at all) surfaces as an ZapLinkError that names the
 * request, does not claim a well-formed JSON body was not JSON, and keeps the parse failure, which names
 * the offending field, as its cause.
 */
class ResponseShapeMismatchErrorTest {
    final MockTransport tx = new MockTransport();
    final ZapLinkClient client = new ZapLinkClient(
        ClientConfig.builder().baseUrl("http://localhost:2785").apiKey("k").transport(tx).build());

    @Test
    void aJsonObjectThatDoesNotFitTheModelKeepsTheDecodeCause() {
        tx.respond(201, "{\"messageId\":\"m1\",\"timestamp\":null}");
        ZapLinkError e = assertThrows(ZapLinkError.class,
            () -> client.messages.sendText("s1", new SendTextRequest("628123@c.us", "hi")));
        assertFalse(e.getMessage().contains("Non-JSON"), e.getMessage());
        assertTrue(e.getMessage().contains("POST /api/sessions/s1/messages/send-text"), e.getMessage());
        assertNotNull(e.getCause(), "the decode failure naming the field is dropped");
    }

    @Test
    void aJsonArrayThatDoesNotFitTheModelKeepsTheDecodeCause() {
        tx.respond(200, "[{\"emoji\":\"x\",\"senders\":[{\"senderId\":\"a@c.us\",\"emoji\":\"x\",\"timestamp\":null}]}]");
        ZapLinkError e = assertThrows(ZapLinkError.class,
            () -> client.messages.reactions("s1", "628123@c.us", "m1"));
        assertFalse(e.getMessage().contains("Non-JSON"), e.getMessage());
        assertTrue(e.getMessage().contains("GET /api/sessions/s1/messages/628123@c.us/m1/reactions"), e.getMessage());
        assertNotNull(e.getCause(), "the decode failure naming the field is dropped");
    }

    @Test
    void aFractionForAnIntegerComponentKeepsTheDecodeCause() {
        tx.respond(200, "{\"autoRejectCalls\":false,\"maxReconnectAttempts\":null,\"reconnectBaseDelay\":2500.5}");
        ZapLinkError e = assertThrows(ZapLinkError.class, () -> client.sessions.getConfig("s1"));
        assertFalse(e.getMessage().contains("Non-JSON"), e.getMessage());
        assertNotNull(e.getCause(), "the decode failure naming the field is dropped");
    }

    @Test
    void aBodyThatIsNotJsonStaysAPlainSdkErrorAndKeepsItsCause() {
        tx.respond(200, "<html>proxy</html>");
        ZapLinkError e = assertThrows(ZapLinkError.class,
            () -> client.request(HttpMethod.GET, "/api/x", null, null, SuccessResult.class));
        assertEquals(ZapLinkError.class, e.getClass());
        assertTrue(e.getMessage().contains("GET /api/x"), e.getMessage());
        assertNotNull(e.getCause(), "the parse failure is dropped");
    }
}
