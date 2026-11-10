package com.devashir768.zaplink.model;

/** Result of validating the configured API key. */
public record AuthValidateResponse(boolean valid, String role, String engineType, Boolean scoped) {}
