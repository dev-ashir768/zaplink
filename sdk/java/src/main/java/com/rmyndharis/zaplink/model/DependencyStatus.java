package com.rmyndharis.zaplink.model;

/** One dependency's readiness snapshot, e.g. {@code {"status":"up"}}. */
public record DependencyStatus(String status) {}
