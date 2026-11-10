package com.devashir768.zaplink.model;

/** Result of checking whether a phone number is registered on WhatsApp. */
public record CheckNumberResponse(String number, boolean exists, String whatsappId) {}
