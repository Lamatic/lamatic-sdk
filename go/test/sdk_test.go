package test

import (
	"context"
	"testing"

	"github.com/AasheeshLikePanner/lamatic-sdk-go/pkg/lamatic"
)

func TestLamaticBasic(t *testing.T) {
	apiKey := "test-key"
	client, err := lamatic.NewClient(lamatic.Config{
		Endpoint:  "https://api.lamatic.ai/graphql",
		ProjectID: "test-project",
		APIKey:    &apiKey,
	})

	if err != nil {
		t.Fatalf("Failed to initialize client: %v", err)
	}

	if client == nil {
		t.Fatal("Expected client to be non-nil")
	}
}

func TestContextCancellation(t *testing.T) {
	apiKey := "test-key"
	client, _ := lamatic.NewClient(lamatic.Config{
		Endpoint:  "https://api.lamatic.ai/graphql",
		ProjectID: "test-project",
		APIKey:    &apiKey,
	})

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately

	_, err := client.ExecuteFlow(ctx, "test-flow", nil)
	if err == nil {
		t.Error("Expected error for cancelled context, got nil")
	}
}
