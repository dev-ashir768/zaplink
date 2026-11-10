package com.devashir768.zaplink.model;

/** Resolution of a contact id (e.g. a {@code @lid}) to a phone number. {@code phone} is {@code null} when unresolved. */
public record ContactPhoneResponse(String contactId, String phone) {}
