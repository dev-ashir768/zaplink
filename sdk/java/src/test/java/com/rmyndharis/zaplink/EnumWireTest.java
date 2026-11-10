package com.rmyndharis.zaplink;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.rmyndharis.zaplink.http.HttpMethod;
import com.rmyndharis.zaplink.model.AccountRestriction;
import com.rmyndharis.zaplink.model.AccountRestrictionKind;
import com.rmyndharis.zaplink.model.BatchLifecycleStatus;
import com.rmyndharis.zaplink.model.BatchMessageResult;
import com.rmyndharis.zaplink.model.BatchMessageStatus;
import com.rmyndharis.zaplink.model.ChatHistoryMessage;
import com.rmyndharis.zaplink.model.ChatKind;
import com.rmyndharis.zaplink.model.GroupInfo;
import com.rmyndharis.zaplink.model.MemberAddMode;
import com.rmyndharis.zaplink.model.MessageType;
import com.rmyndharis.zaplink.model.ParticipantPresence;
import com.rmyndharis.zaplink.model.PresenceState;
import com.rmyndharis.zaplink.model.SessionResponse;
import com.rmyndharis.zaplink.model.SessionStatus;
import com.rmyndharis.zaplink.support.MockTransport;
import org.junit.jupiter.api.Test;

/**
 * Wire-format round trips for the enum-backed record components: the API speaks lowercase and
 * snake_case ("qr_ready", "reachout_timelock"), while Java constants are UpperCamel — every enum
 * must carry a {@code @SerializedName} that maps the exact wire token in BOTH directions.
 */
class EnumWireTest {

    private final Gson gson = new GsonBuilder().create();

    @Test
    void sessionStatusRoundTripsEveryWireToken() {
        record Pair(String wire, SessionStatus constant) {}
        Pair[] pairs = {
            new Pair("created", SessionStatus.CREATED),
            new Pair("initializing", SessionStatus.INITIALIZING),
            new Pair("qr_ready", SessionStatus.QR_READY),
            new Pair("authenticating", SessionStatus.AUTHENTICATING),
            new Pair("ready", SessionStatus.READY),
            new Pair("disconnected", SessionStatus.DISCONNECTED),
            new Pair("action_required", SessionStatus.ACTION_REQUIRED),
            new Pair("failed", SessionStatus.FAILED),
        };
        for (Pair pair : pairs) {
            SessionResponse r = gson.fromJson(
                "{\"id\":\"s\",\"name\":\"n\",\"status\":\"" + pair.wire() + "\",\"engineLoaded\":true,"
                    + "\"createdAt\":\"t\",\"updatedAt\":\"t\"}",
                SessionResponse.class);
            assertEquals(pair.constant(), r.status(), pair.wire());
            assertEquals(pair.wire(), gson.toJsonTree(r.status()).getAsString(), pair.wire());
        }
    }

    @Test
    void messageAndChatKindRoundTrip() {
        ChatHistoryMessage m = gson.fromJson(
            "{\"id\":\"m\",\"from\":\"a\",\"to\":\"b\",\"chatId\":\"c\",\"body\":\"x\","
                + "\"type\":\"sticker\",\"timestamp\":1,\"fromMe\":true,\"isGroup\":true,\"kind\":\"broadcast\"}",
            ChatHistoryMessage.class);
        assertEquals(MessageType.STICKER, m.type());
        assertEquals(ChatKind.BROADCAST, m.kind());
        assertEquals("sticker", gson.toJsonTree(m.type()).getAsString());
    }

    @Test
    void batchPresenceRestrictionAndMemberAddModeRoundTrip() {
        BatchMessageResult b = gson.fromJson(
            "{\"chatId\":\"628@c.us\",\"status\":\"cancelled\"}", BatchMessageResult.class);
        assertEquals(BatchMessageStatus.CANCELLED, b.status());

        com.rmyndharis.zaplink.model.BatchStatusResponse s = gson.fromJson(
            "{\"batchId\":\"b1\",\"status\":\"processing\",\"progress\":{\"total\":1,\"sent\":0,"
                + "\"failed\":0,\"pending\":1,\"cancelled\":0},\"results\":[]}",
            com.rmyndharis.zaplink.model.BatchStatusResponse.class);
        assertEquals(BatchLifecycleStatus.PROCESSING, s.status());

        com.rmyndharis.zaplink.model.ParticipantPresence p = gson.fromJson(
            "{\"id\":\"628@c.us\",\"state\":\"recording\"}",
            com.rmyndharis.zaplink.model.ParticipantPresence.class);
        assertEquals(PresenceState.RECORDING, p.state());

        com.rmyndharis.zaplink.model.AccountRestriction a = gson.fromJson(
            "{\"kind\":\"proxy_block\",\"code\":\"X\"}",
            com.rmyndharis.zaplink.model.AccountRestriction.class);
        assertEquals(AccountRestrictionKind.PROXY_BLOCK, a.kind());

        com.rmyndharis.zaplink.model.GroupInfo g = gson.fromJson(
            "{\"id\":\"g\",\"name\":\"n\",\"memberAddMode\":\"admins\"}",
            com.rmyndharis.zaplink.model.GroupInfo.class);
        assertEquals(MemberAddMode.ADMINS, g.memberAddMode());
    }


    @Test
    void clientDecodesAnUnrecognisedTokenToUnknownNotNull() {
        MockTransport tx = new MockTransport();
        ZapLinkClient client = new ZapLinkClient(
            ClientConfig.builder().baseUrl("https://h").apiKey("owa_k1_x").transport(tx).build());

        tx.respond(200, "{\"id\":\"s\",\"name\":\"n\",\"status\":\"brand_new_state\",\"engineLoaded\":true,"
            + "\"createdAt\":\"t\",\"updatedAt\":\"t\"}");
        assertEquals(SessionStatus.UNKNOWN, client.sessions.get("s").status());

        tx.respond(200, "{\"chatId\":\"c\",\"status\":\"later\"}");
        assertEquals(BatchMessageStatus.UNKNOWN,
            client.request(HttpMethod.GET, "/x", null, null, BatchMessageResult.class).status());
        tx.respond(200, "{\"state\":\"later\"}");
        assertEquals(PresenceState.UNKNOWN,
            client.request(HttpMethod.GET, "/x", null, null, ParticipantPresence.class).state());
        tx.respond(200, "{\"kind\":\"later\"}");
        assertEquals(AccountRestrictionKind.UNKNOWN,
            client.request(HttpMethod.GET, "/x", null, null, AccountRestriction.class).kind());
        tx.respond(200, "{\"memberAddMode\":\"later\"}");
        assertEquals(MemberAddMode.UNKNOWN,
            client.request(HttpMethod.GET, "/x", null, null, GroupInfo.class).memberAddMode());
        tx.respond(200, "{\"type\":\"future_type\",\"kind\":\"unknown\"}");
        ChatHistoryMessage m = client.request(HttpMethod.GET, "/x", null, null, ChatHistoryMessage.class);
        assertEquals(MessageType.UNKNOWN, m.type());
        assertEquals(ChatKind.UNKNOWN, m.kind());

        // A null or absent value is still null, and a known token still decodes to its constant.
        tx.respond(200, "{\"chatId\":\"c\",\"status\":null}");
        assertNull(client.request(HttpMethod.GET, "/x", null, null, BatchMessageResult.class).status());
        tx.respond(200, "{\"chatId\":\"c\",\"status\":\"sent\"}");
        assertEquals(BatchMessageStatus.SENT,
            client.request(HttpMethod.GET, "/x", null, null, BatchMessageResult.class).status());
        tx.respond(200, "{\"id\":\"s\"}");
        assertNull(client.sessions.get("s").status());
    }

}
