# Lamatic Ai Go SDK

> [!IMPORTANT]
> This is an **unofficial** Go SDK for the [Lamatic AI](https://lamatic.ai/) platform.

The Lamatic Go SDK provides a simple way to interact with the Lamatic AI platform from your Go applications.

## Installation

```bash
go get github.com/AasheeshLikePanner/lamatic-sdk-go
```

## Getting Started

```go
package main

import (
	"context"
	"fmt"
	"github.com/AasheeshLikePanner/lamatic-sdk-go/pkg/lamatic"
)

func main() {
	apiKey := "your-api-key"
	client, err := lamatic.NewClient(lamatic.Config{
		Endpoint:  "your-endpoint",
		ProjectID: "your-project-id",
		APIKey:    &apiKey,
	})
	if err != nil {
		panic(err)
	}

	// All API calls require context.Context
	resp, err := client.ExecuteFlow(context.Background(), "your-flow-id", map[string]interface{}{
		"prompt": "Hello, AI!",
	})
	if err != nil {
		fmt.Printf("Error: %v\n", err)
		return
	}

	if resp.Status == lamatic.StatusSuccess {
		fmt.Printf("Result: %v\n", resp.Result)
	} else {
		fmt.Printf("Failed: %s\n", resp.Message)
	}
}
```

## Project Structure

```
go-sdk/
├── go.mod
├── README.md
├── LICENSE
├── internal/
│   └── client/
│       └── client.go          # Internal HTTP client
├── pkg/
│   └── lamatic/
│       ├── lamatic.go         # Public SDK API
│       └── lamatic_test.go    # Unit tests
└── examples/
    ├── api_key/
    │   └── main.go            # Example: API Key auth
    ├── access_token/
    │   └── main.go            # Example: Access Token auth
    ├── access_token_expiry/
    │   └── main.go            # Example: Handling token expiry
    ├── token_generation/
    │   └── main.go            # Example: Server-side JWT generation
    └── decode_and_async/
        └── main.go            # Example: Async execution, typed decoding, logging
```

## Features

- Execute Workflows (Flows), synchronously or via `ExecuteFlowAsync`
- Job Polling with `CheckStatus`, synchronously or via `CheckStatusAsync`
- Decode results into your own structs with `Response.Decode`
- Optional `Logger` hook on `Config` for observing request failures
- Support for API Key and Access Token (JWT) authentication
- Proper internal/pkg separation for Go best practices

> [!NOTE]
> `ExecuteAgent` has been removed. The underlying `executeAgent` API is deprecated
> platform-side; use `ExecuteFlow` instead.
