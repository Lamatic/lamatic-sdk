package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"github.com/AasheeshLikePanner/lamatic-sdk-go/pkg/lamatic"
)

func main() {
	apiKey := "my-secret-key"
	client, err := lamatic.NewClient(lamatic.Config{
		Endpoint:  "https://api.lamatic.ai/graphql",
		ProjectID: "project-123",
		APIKey:    &apiKey,
		Logger:    log.New(os.Stderr, "lamatic: ", log.LstdFlags),
	})
	if err != nil {
		fmt.Printf("Failed to create client: %v\n", err)
		return
	}

	// Fire the flow off in the background and keep doing other work.
	future := client.ExecuteFlowAsync(context.Background(), "flow-abc", map[string]interface{}{
		"message": "Hello from Go!",
	})

	result := <-future
	if result.Err != nil {
		fmt.Printf("Error executing flow: %v\n", result.Err)
		return
	}

	// Decode the untyped result into a struct instead of digging through a map.
	var payload struct {
		Message string `json:"message"`
	}
	if err := result.Response.Decode(&payload); err != nil {
		fmt.Printf("Error decoding result: %v\n", err)
		return
	}

	fmt.Printf("Decoded message: %s\n", payload.Message)
}
