package main

import (
	"context"
	"fmt"

	"github.com/AasheeshLikePanner/lamatic-sdk-go/pkg/lamatic"
)

func main() {
	accessToken := "your-jwt-access-token"

	config := lamatic.Config{
		Endpoint:    "https://api.lamatic.ai/graphql",
		ProjectID:   "project-123",
		AccessToken: &accessToken,
	}

	client, err := lamatic.NewClient(config)
	if err != nil {
		fmt.Printf("Failed to create client: %v\n", err)
		return
	}

	resp, err := client.ExecuteFlow(context.Background(), "flow-abc", map[string]interface{}{
		"message": "Hello using Access Token!",
	})

	if err != nil {
		fmt.Printf("Error: %v\n", err)
		return
	}

	fmt.Printf("Response: %+v\n", resp)
}
