package test

import (
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

	if client.Name != "Lamatic SDK" {
		t.Errorf("Expected name 'Lamatic SDK', got '%s'", client.Name)
	}

	if client.GetName() != "Lamatic SDK" {
		t.Errorf("Expected GetName() to return 'Lamatic SDK', got '%s'", client.GetName())
	}
}
