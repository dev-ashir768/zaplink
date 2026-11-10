package com.devashir768.zaplink.resources;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.devashir768.zaplink.ClientConfig;
import com.devashir768.zaplink.ZapLinkClient;
import com.devashir768.zaplink.errors.ZapLinkNotFoundError;
import com.devashir768.zaplink.http.HttpMethod;
import com.devashir768.zaplink.support.MockTransport;
import com.devashir768.zaplink.model.CallLinkType;
import com.devashir768.zaplink.model.CreateCallLinkRequest;
import org.junit.jupiter.api.Test;

class CallsResourceTest {
    final MockTransport tx = new MockTransport();
    final ZapLinkClient client = new ZapLinkClient(
        ClientConfig.builder().baseUrl("http://h").apiKey("k").transport(tx).build());

    @Test
    void rejectCallHitsRejectPath() {
        tx.respond(200, "{\"success\":true}");
        client.calls.rejectCall("s", "call-123");
        assertEquals("http://h/api/sessions/s/calls/call-123/reject", tx.lastRequest().url());
        assertEquals(HttpMethod.POST, tx.lastRequest().method());
    }

    @Test
    void rejectCallEncodesIds() {
        tx.respond(200, "{\"success\":true}");
        client.calls.rejectCall("a/b", "call/1");
        assertEquals("http://h/api/sessions/a%2Fb/calls/call%2F1/reject", tx.lastRequest().url());
    }

    @Test
    void rejectCallParsesSuccess() {
        tx.respond(200, "{\"success\":true}");
        assertTrue(client.calls.rejectCall("s", "call-123").success());
    }

    @Test
    void rejectCallNotRingingThrowsNotFound() {
        tx.respond(404, "{\"statusCode\":404,\"message\":\"Call not found or no longer ringing\",\"error\":\"Not Found\"}");
        assertThrows(ZapLinkNotFoundError.class, () -> client.calls.rejectCall("s", "call-123"));
    }
    @Test
    void createLinkPostsToCallsLink() {
        tx.respond(200, "{\"link\":\"https://call.whatsapp.com/video/AbC\"}");
        var res = client.calls.createLink(
            "s", CreateCallLinkRequest.builder().type(CallLinkType.VIDEO).startTime(1800000000000.0).build());
        assertEquals("http://h/api/sessions/s/calls/link", tx.lastRequest().url());
        assertEquals(HttpMethod.POST, tx.lastRequest().method());
        assertTrue(tx.lastRequest().body().contains("\"type\":\"video\""));
        assertTrue(res.link().contains("call.whatsapp.com"));
    }

}
