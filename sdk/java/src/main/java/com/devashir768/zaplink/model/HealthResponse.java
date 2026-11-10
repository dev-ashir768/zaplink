package com.devashir768.zaplink.model;

/** General health payload. Optional fields are {@code null} when absent. */
public record HealthResponse(String status, String timestamp, String version) {}
