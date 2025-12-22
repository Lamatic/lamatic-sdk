package main

import (
	"fmt"

	"github.com/AasheeshLikePanner/lamatic-sdk-go/pkg/lamatic"
)

func main() {
	apiKey := "my-secret-key"
	config := lamatic.Config{
		Endpoint:  "https://api.lamatic.ai/graphql",
		ProjectID: "project-123",
		APIKey:    &apiKey,
	}

	client, err := lamatic.NewClient(config)
	if err != nil {
		fmt.Printf("Failed to create client: %v\n", err)
		return
	}

	resp, err := client.ExecuteFlow("flow-abc", map[string]interface{}{
		"message": "Hello from Go!",
	})

	if err != nil {
		fmt.Printf("Error executing flow: %v\n", err)
		return
	}

	fmt.Printf("Response: %+v\n", resp)
}
