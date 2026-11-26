package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"

	"github.com/Lamatic/lamatic-sdk-go/pkg/lamatic"
)

func main() {
	apiKey := "my-secret-key"
	client, err := lamatic.NewClient(lamatic.Config{
		Endpoint:  "https://api.lamatic.ai/graphql",
		ProjectID: "project-123",
		APIKey:    &apiKey,
	})
	if err != nil {
		fmt.Printf("Failed to create client: %v\n", err)
		return
	}

	// Ctrl+C cancels the context, which stops generation and closes the channel.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	events, err := client.ExecuteFlowTokenStream(ctx, "flow-abc", map[string]interface{}{
		"sampleInput": "Hello from Go!",
	}, nil)
	if err != nil {
		fmt.Printf("Error starting stream: %v\n", err)
		return
	}

	for event := range events {
		switch event.Type {
		case lamatic.EventToken:
			fmt.Print(event.Token) // one text delta
		case lamatic.EventNode:
			fmt.Printf("\n[%s] finished\n", event.NodeID)
		case lamatic.EventFinal:
			fmt.Printf("\nFull text: %s\n", event.Text)
			fmt.Printf("Flow result: %v\n", event.Result)
		case lamatic.EventError:
			fmt.Printf("\nStream failed: %s\n", event.Message)
		}
	}
}
