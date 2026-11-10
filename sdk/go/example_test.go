package zaplink_test

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	zaplink "github.com/dev-ashir768/zaplink/sdk/go"
)

func ExampleNew() {
	client, err := zaplink.New("http://localhost:2785", "owa_k1_…")
	if err != nil {
		log.Fatal(err)
	}

	ctx := context.Background()
	// Sessions are addressed by the UUID that Create returns, not by name. Create a
	// session once; afterwards, find its ID with Sessions.List and a Name filter.
	session, err := client.Sessions.Create(ctx, zaplink.CreateSessionRequest{Name: "my-session"})
	if err != nil {
		log.Fatal(err)
	}
	if _, err := client.Sessions.Start(ctx, session.ID); err != nil {
		log.Fatal(err)
	}

	// Link the account before sending: scan Sessions.QRCode (or use Sessions.RequestPairingCode for a number with no linked session),
	// then wait for status "ready". An unlinked session answers the send with 409.
	res, err := client.Messages.SendText(ctx, session.ID, zaplink.SendTextRequest{
		ChatID: "628123456789@c.us",
		Text:   "Hello from the ZapLink Go SDK!",
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(res.MessageID)
}

func ExampleClient_typedErrors() {
	client, _ := zaplink.New("http://localhost:2785", "owa_k1_…")
	sessionID := "…" // the UUID that Sessions.Create returned, not the session name

	_, err := client.Messages.SendText(context.Background(), sessionID, zaplink.SendTextRequest{
		ChatID: "628123456789@c.us",
		Text:   "hi",
	})
	switch {
	case errors.Is(err, zaplink.ErrConflict):
		// Engine not ready (409) — retry after the session reaches "ready".
		// A keyed send can also answer 409 for a pending or uncertain outcome; APIError.Code
		// tells them apart, and an uncertain one must be checked in the chat before it is sent again.
	case errors.Is(err, zaplink.ErrNotFound):
		// Unknown session (404).
	case err != nil:
		var apiErr *zaplink.APIError
		if errors.As(err, &apiErr) {
			log.Printf("API %d: %s", apiErr.StatusCode, apiErr.Message)
		}
	}
}

func ExampleWithRetry() {
	// Opt into automatic retries with exponential backoff, and inject a custom
	// per-request timeout — dependencies flow through functional options.
	client, _ := zaplink.New("http://localhost:2785", "owa_k1_…",
		zaplink.WithRetry(zaplink.DefaultRetryPolicy()),
		zaplink.WithTimeout(15*time.Second),
	)
	_ = client
}

func ExampleClient_webhookEvents() {
	client, _ := zaplink.New("http://localhost:2785", "owa_k1_…")
	sessionID := "…" // the UUID that Sessions.Create returned, not the session name

	// Subscribe to the group and call events with the Event* constants — they
	// are the exact wire values, so a typo is a compile error, not a silent
	// no-delivery.
	_, err := client.Webhooks.Create(context.Background(), sessionID, zaplink.CreateWebhookRequest{
		URL: "https://example.com/hook",
		Events: []string{
			zaplink.EventGroupJoin,
			zaplink.EventGroupLeave,
			zaplink.EventGroupUpdate,
			zaplink.EventCallReceived,
		},
	})
	if err != nil {
		log.Fatal(err)
	}
}
