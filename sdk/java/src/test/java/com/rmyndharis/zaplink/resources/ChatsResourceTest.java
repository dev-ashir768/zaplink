package com.rmyndharis.zaplink.resources;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.rmyndharis.zaplink.ClientConfig;
import com.rmyndharis.zaplink.ZapLinkClient;
import com.rmyndharis.zaplink.http.HttpMethod;
import com.rmyndharis.zaplink.model.ChatState;
import com.rmyndharis.zaplink.model.ChatSummary;
import com.rmyndharis.zaplink.model.MessageType;
import com.rmyndharis.zaplink.model.ArchiveChatRequest;
import com.rmyndharis.zaplink.model.DeleteChatRequest;
import com.rmyndharis.zaplink.model.MuteChatRequest;
import com.rmyndharis.zaplink.model.PinChatRequest;
import com.rmyndharis.zaplink.model.ListChatsQuery;
import com.rmyndharis.zaplink.model.MarkChatReadRequest;
import com.rmyndharis.zaplink.model.MarkChatRequest;
import com.rmyndharis.zaplink.model.SendChatStateRequest;
import com.rmyndharis.zaplink.support.MockTransport;
import org.junit.jupiter.api.Test;

class ChatsResourceTest {
    final MockTransport tx = new MockTransport();
    final ZapLinkClient client = new ZapLinkClient(
        ClientConfig.builder().baseUrl("http://h").apiKey("k").transport(tx).build());

    @Test
    void listHitsChatsPath() {
        tx.respond(200, "[]");
        client.chats.list("s");
        assertEquals("http://h/api/sessions/s/chats", tx.lastRequest().url());
        assertEquals(HttpMethod.GET, tx.lastRequest().method());
    }

    @Test
    void listDecodesOptionalLastMessageType() {
        tx.respond(200, "[{\"id\":\"photo@c.us\",\"lastMessageType\":\"image\"},{\"id\":\"empty@c.us\"}]");
        var chats = client.chats.list("s");
        assertEquals(MessageType.IMAGE, chats.get(0).lastMessageType());
        assertNull(chats.get(1).lastMessageType());
        var legacy = new ChatSummary("id", "name", false, 0, "hi", 1L, null, false, false, false, null);
        assertNull(legacy.lastMessageType());
    }

    @Test
    void listEncodesSessionId() {
        tx.respond(200, "[]");
        client.chats.list("a/b");
        assertEquals("http://h/api/sessions/a%2Fb/chats", tx.lastRequest().url());
    }

    @Test
    void listSerializesQuery() {
        tx.respond(200, "[]");
        client.chats.list("s", ListChatsQuery.builder().limit(10).offset(20).build());
        assertEquals("http://h/api/sessions/s/chats?limit=10&offset=20", tx.lastRequest().url());
        assertEquals(HttpMethod.GET, tx.lastRequest().method());
    }

    @Test
    void markReadSendsBody() {
        tx.respond(200, "{\"success\":true}");
        client.chats.markRead("s", MarkChatReadRequest.builder().chatId("628123@c.us").build());
        assertEquals("http://h/api/sessions/s/chats/read", tx.lastRequest().url());
        assertEquals(HttpMethod.POST, tx.lastRequest().method());
        assertTrue(tx.lastRequest().body().contains("628123@c.us"));
    }

    @Test
    void markUnreadSendsBody() {
        tx.respond(200, "{\"success\":true}");
        client.chats.markUnread("s", MarkChatRequest.builder().chatId("628999@c.us").build());
        assertEquals("http://h/api/sessions/s/chats/unread", tx.lastRequest().url());
        assertEquals(HttpMethod.POST, tx.lastRequest().method());
        assertTrue(tx.lastRequest().body().contains("628999@c.us"));
    }

    @Test
    void clearMessagesDeletesTheSubResource() {
        tx.respond(200, "{\"success\":true}");
        client.chats.clearMessages("s", "628321@c.us");
        assertEquals("http://h/api/sessions/s/chats/628321@c.us/messages", tx.lastRequest().url());
        assertEquals(HttpMethod.DELETE, tx.lastRequest().method());
    }

    @Test
    void archiveSendsBody() {
        tx.respond(200, "{\"success\":true}");
        client.chats.archive("s", ArchiveChatRequest.builder().chatId("628321@c.us").archive(true).build());
        assertEquals("http://h/api/sessions/s/chats/archive", tx.lastRequest().url());
        assertEquals(HttpMethod.POST, tx.lastRequest().method());
        assertTrue(tx.lastRequest().body().contains("628321@c.us"));
    }

    @Test
    void pinSendsBody() {
        tx.respond(200, "{\"success\":true}");
        client.chats.pin("s", PinChatRequest.builder().chatId("628321@c.us").pin(true).build());
        assertEquals("http://h/api/sessions/s/chats/pin", tx.lastRequest().url());
        assertEquals(HttpMethod.POST, tx.lastRequest().method());
        assertTrue(tx.lastRequest().body().contains("\"pin\":true"));
    }

    /**
     * The timestamp is epoch MILLISECONDS and must reach the wire unscaled. A value rescaled to
     * seconds is an instant in 1970, so the mute expires immediately while the call still answers
     * 200 — the wrong unit is invisible in the response.
     */
    @Test
    void muteSendsEpochMillisecondsUnchanged() {
        tx.respond(200, "{\"success\":true}");
        client.chats.mute("s", MuteChatRequest.builder().chatId("628321@c.us").muteUntil(1893456000000L).build());
        assertEquals("http://h/api/sessions/s/chats/mute", tx.lastRequest().url());
        assertEquals(HttpMethod.POST, tx.lastRequest().method());
        assertTrue(tx.lastRequest().body().contains("\"muteUntil\":1893456000000"));
    }

    /**
     * Unmuting is a null muteUntil, and the route requires the key. Gson drops null members by
     * default, so without the client routing this body through its null-emitting serializer the key
     * would vanish and the request would be rejected — the one thing null should express could not
     * be. An omitted value is ambiguous in a way null is not: unmute now and mute indefinitely are
     * opposite readings of the same absence.
     */
    @Test
    void muteSendsExplicitNullToUnmute() {
        tx.respond(200, "{\"success\":true}");
        client.chats.mute("s", MuteChatRequest.builder().chatId("628321@c.us").build());
        assertTrue(
            tx.lastRequest().body().contains("\"muteUntil\":null"),
            "null muteUntil must survive as an explicit null, got " + tx.lastRequest().body());
    }

    @Test
    void deleteSendsBody() {
        tx.respond(200, "{\"success\":true}");
        client.chats.delete("s", DeleteChatRequest.builder().chatId("628321@c.us").build());
        assertEquals("http://h/api/sessions/s/chats/delete", tx.lastRequest().url());
        assertEquals(HttpMethod.POST, tx.lastRequest().method());
        assertTrue(tx.lastRequest().body().contains("628321@c.us"));
    }

    @Test
    void sendStateSerializesEnumAndBody() {
        tx.respond(200, "{\"success\":true}");
        client.chats.sendState(
            "s", SendChatStateRequest.builder().chatId("628555@c.us").state(ChatState.TYPING).build());
        assertEquals("http://h/api/sessions/s/chats/typing", tx.lastRequest().url());
        assertEquals(HttpMethod.POST, tx.lastRequest().method());
        assertTrue(tx.lastRequest().body().contains("628555@c.us"));
        assertTrue(tx.lastRequest().body().contains("typing"));
    }
}
