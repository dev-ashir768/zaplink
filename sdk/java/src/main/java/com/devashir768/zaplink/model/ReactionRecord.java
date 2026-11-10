package com.devashir768.zaplink.model;

import java.util.List;

/** One emoji and everyone who reacted with it. */
public record ReactionRecord(String emoji, List<ReactionSender> senders) {}
