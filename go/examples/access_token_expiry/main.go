package main

import (
	"context"
	"fmt"
	"net/http"

	"github.com/AasheeshLikePanner/lamatic-sdk-go/pkg/lamatic"
)

func mockGetNewToken() string {
	return "new-fresh-access-token"
}

func main() {
	accessToken := "expired-token"

	config := lamatic.Config{
		Endpoint:    "https://api.lamatic.ai/graphql",
		ProjectID:   "project-123",
		AccessToken: &accessToken,
	}

	client, err := lamatic.NewClient(config)
	if err != nil {
		panic(err)
	}

	flowID := "flow-abc"
	payload := map[string]interface{}{"message": "test"}

	resp, err := client.ExecuteFlow(context.Background(), flowID, payload)
	if err != nil {
		fmt.Printf("Request failed: %v\n", err)
		return
	}

	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		fmt.Println("Token expired, fetching new token...")

		newToken := mockGetNewToken()
		client.UpdateAccessToken(newToken)

		resp, err = client.ExecuteFlow(context.Background(), flowID, payload)
		if err != nil {
			fmt.Printf("Retry failed: %v\n", err)
			return
		}
		fmt.Println("Retry successful with new token!")
	}

	fmt.Printf("Final Response: %+v\n", resp)
}
