package com.devashir768.zaplink.resources;

import static com.devashir768.zaplink.http.Http.encodeSegment;

import com.devashir768.zaplink.ZapLinkClient;
import com.devashir768.zaplink.http.HttpMethod;
import com.devashir768.zaplink.model.CheckNumberResponse;
import com.devashir768.zaplink.model.ContactLidResponse;
import com.devashir768.zaplink.model.ContactPhoneResponse;
import com.devashir768.zaplink.model.ContactRecord;
import com.devashir768.zaplink.model.ListContactsQuery;
import com.devashir768.zaplink.model.ProfilePictureResponse;
import com.devashir768.zaplink.model.ProfilePicturesResponse;
import com.devashir768.zaplink.model.SuccessResult;
import com.devashir768.zaplink.model.UpsertContactRequest;
import java.util.List;
import java.util.Map;

/** Contacts resource — contact lookup and management. */
public final class ContactsResource {
    private final ZapLinkClient client;

    public ContactsResource(ZapLinkClient client) {
        this.client = client;
    }

    /** List contacts known to the session. */
    public List<ContactRecord> list(String sessionId, ListContactsQuery query) {
        return client.requestList(
            HttpMethod.GET,
            "/api/sessions/" + encodeSegment(sessionId) + "/contacts",
            query,
            null,
            ContactRecord.class);
    }

    /** Get details for a single contact by id (JID). */
    public ContactRecord get(String sessionId, String contactId) {
        return client.request(
            HttpMethod.GET,
            "/api/sessions/" + encodeSegment(sessionId) + "/contacts/" + encodeSegment(contactId),
            null,
            null,
            ContactRecord.class);
    }

    /** Check whether a phone number is registered on WhatsApp. Requires an OPERATOR-level key. */
    public CheckNumberResponse check(String sessionId, String number) {
        return client.request(
            HttpMethod.GET,
            "/api/sessions/" + encodeSegment(sessionId) + "/contacts/check/" + encodeSegment(number),
            null,
            null,
            CheckNumberResponse.class);
    }

    /** Get the contact's profile picture URL (or null). */
    public ProfilePictureResponse profilePicture(String sessionId, String contactId) {
        return client.request(
            HttpMethod.GET,
            "/api/sessions/" + encodeSegment(sessionId) + "/contacts/" + encodeSegment(contactId) + "/profile-picture",
            null,
            null,
            ProfilePictureResponse.class);
    }

    /**
     * Batch-resolve profile picture URLs for up to 50 contacts in one request.
     * Returns a map of contact id → URL (null when a lookup fails). An id skipped after a lookup timed out is absent from the map; ask for it again.
     */
    public ProfilePicturesResponse profilePictures(String sessionId, List<String> ids) {
        return client.request(
            HttpMethod.GET,
            "/api/sessions/" + encodeSegment(sessionId) + "/contacts/profile-pictures",
            Map.of("ids", String.join(",", ids)),
            null,
            ProfilePicturesResponse.class);
    }

    /** Resolve a contact id (e.g. a {@code @lid}) to a phone number. */
    public ContactPhoneResponse phone(String sessionId, String contactId) {
        return client.request(
            HttpMethod.GET,
            "/api/sessions/" + encodeSegment(sessionId) + "/contacts/" + encodeSegment(contactId) + "/phone",
            null,
            null,
            ContactPhoneResponse.class);
    }

    /**
     * Look up the {@code @lid} WhatsApp holds for a phone number, without sending a message. {@code lid} is
     * {@code null} when WhatsApp holds none, which an unregistered number also answers. The lookup can query
     * WhatsApp (Baileys on every call, whatsapp-web.js when the page holds no LID), so bulk lookups put the
     * linked account at risk. Requires an OPERATOR-level key.
     */
    public ContactLidResponse lid(String sessionId, String number) {
        return client.request(
            HttpMethod.GET,
            "/api/sessions/" + encodeSegment(sessionId) + "/contacts/" + encodeSegment(number) + "/lid",
            null,
            null,
            ContactLidResponse.class);
    }

    /** Block a contact. Requires an OPERATOR-level key. */
    public SuccessResult block(String sessionId, String contactId) {
        return client.request(
            HttpMethod.POST,
            "/api/sessions/" + encodeSegment(sessionId) + "/contacts/" + encodeSegment(contactId) + "/block",
            null,
            null,
            SuccessResult.class);
    }

    /** Save a contact to the addressbook, or edit an existing entry. Requires an OPERATOR key. */
    public SuccessResult upsert(String sessionId, String contactId, UpsertContactRequest body) {
        return client.request(
            HttpMethod.PUT,
            "/api/sessions/" + encodeSegment(sessionId) + "/contacts/" + encodeSegment(contactId),
            null,
            body,
            SuccessResult.class);
    }

    /** Remove a contact from the addressbook. Requires an OPERATOR key. */
    public SuccessResult delete(String sessionId, String contactId) {
        return client.request(
            HttpMethod.DELETE,
            "/api/sessions/" + encodeSegment(sessionId) + "/contacts/" + encodeSegment(contactId),
            null,
            null,
            SuccessResult.class);
    }

    /** Unblock a contact. Requires an OPERATOR-level key. */
    public SuccessResult unblock(String sessionId, String contactId) {
        return client.request(
            HttpMethod.DELETE,
            "/api/sessions/" + encodeSegment(sessionId) + "/contacts/" + encodeSegment(contactId) + "/block",
            null,
            null,
            SuccessResult.class);
    }

    /**
     * List the JIDs this account has blocked. Session-wide, so it takes no contact id — unlike
     * {@link #block} and {@link #unblock}, which act on one contact — and it returns bare ids
     * rather than contact records.
     */
    public List<String> listBlocked(String sessionId) {
        return client.requestList(
            HttpMethod.GET,
            "/api/sessions/" + encodeSegment(sessionId) + "/contacts/blocked",
            null,
            null,
            String.class);
    }
}
