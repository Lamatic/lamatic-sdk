# Lamatic Ai Go SDK

> [!IMPORTANT]
> This is an **unofficial** Go SDK for the [Lamatic AI](https://lamatic.ai/) platform.

The Lamatic Go SDK provides a simple way to interact with the Lamatic AI platform from your Go applications.

## Installation

```bash
go get github.com/Lamatic/lamatic-sdk-go
```

## Getting Started

```go
package main

import (
	"context"
	"fmt"
	"github.com/Lamatic/lamatic-sdk-go/pkg/lamatic"
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

## Token Streaming

`ExecuteFlowTokenStream` runs a flow and streams its LLM/RAG output one token at a time, so you can render text as it is generated instead of waiting for the whole flow to finish. It returns a channel of `TokenEvent`s.

```go
events, err := client.ExecuteFlowTokenStream(ctx, "your-flow-id", map[string]interface{}{
	"sampleInput": "Hello",
}, nil)
if err != nil {
	return err // the request could not be sent
}

for event := range events {
	switch event.Type {
	case lamatic.EventToken:
		fmt.Print(event.Token) // one text delta
	case lamatic.EventNode:
		fmt.Printf("\n[%s] finished: %v\n", event.NodeID, event.Output)
	case lamatic.EventFinal:
		fmt.Println("\nFull text:", event.Text)
		fmt.Println("Flow result:", event.Result)
	case lamatic.EventError:
		fmt.Println("\nStream failed:", event.Message)
	}
}
```

### Events

| `Type` | Fields | Emitted when |
|---|---|---|
| `EventToken` | `Token`, `NodeID`, `Raw` | An LLM or RAG node produces a text delta |
| `EventNode` | `NodeID`, `Output`, `Raw` | Any node finishes; `Output` is its full output |
| `EventFinal` | `Result`, `Text`, `TextByNode`, `Raw` | The flow finishes — always the last event of a successful stream |
| `EventError` | `Message`, `NodeID`, `Raw` | Execution failed, the connection dropped, or the server rejected the request |

Every server-originated event carries `Raw`, the untouched server frame, for fields the typed event does not expose — such as `_meta` on a node event, which holds token counts and cost:

```go
if event.Type == lamatic.EventNode {
	if meta, ok := event.Raw.Data["_meta"].(map[string]interface{}); ok {
		fmt.Printf("%v: %v tokens\n", meta["model_name"], meta["total_tokens"])
	}
}
```

### Reading the generated text

Use `Text` on the final event — every token concatenated in arrival order. Don't read `generatedResponse` off a node's `Output` instead:

- A flow's final `Result` contains only what its response node was configured to return, which often does not include the generated text at all.
- The platform currently returns a streaming node's `generatedResponse` with its content duplicated. `Text` is built from the deltas, so it is correct.

For a flow with more than one streaming node, `TextByNode` keys the text by node ID.

### Which nodes stream

Only **LLM** and **RAG** nodes emit `EventToken` events. Every other node reports once, as a single `EventNode` event when it completes.

### Errors and cancelling

`ExecuteFlowTokenStream` returns an error only if the request could not be sent. Everything after that — rejected credentials, a failing node, a dropped connection — arrives as an `EventError` event on the channel.

Cancel the `context.Context` to stop generation, for example from a "stop" button. The channel is then closed quietly, with no final or error event. Either read the channel until it closes or cancel the context; abandoning it otherwise leaks the connection.

```go
ctx, cancel := context.WithCancel(context.Background())
defer cancel()

events, _ := client.ExecuteFlowTokenStream(ctx, "your-flow-id", payload, nil)
for event := range events {
	if event.Type == lamatic.EventToken {
		fmt.Print(event.Token)
	}
	if shouldStop() {
		cancel() // keep ranging: the channel closes once the stream has wound down
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
│       ├── lamatic_test.go    # Unit tests
│       ├── stream.go          # Token streaming
│       └── stream_test.go     # Token streaming tests
└── examples/
    ├── api_key/
    │   └── main.go            # Example: API Key auth
    ├── access_token/
    │   └── main.go            # Example: Access Token auth
    ├── access_token_expiry/
    │   └── main.go            # Example: Handling token expiry
    ├── token_generation/
    │   └── main.go            # Example: Server-side JWT generation
    ├── decode_and_async/
    │   └── main.go            # Example: Async execution, typed decoding, logging
    └── token_stream/
        └── main.go            # Example: Token-level streaming
```

## Features

- Execute Workflows (Flows), synchronously or via `ExecuteFlowAsync`
- Token-level streaming of LLM/RAG output with `ExecuteFlowTokenStream`
- Job Polling with `CheckStatus`, synchronously or via `CheckStatusAsync`
- Decode results into your own structs with `Response.Decode`
- Optional `Logger` hook on `Config` for observing request failures
- Support for API Key and Access Token (JWT) authentication
- Proper internal/pkg separation for Go best practices

> [!NOTE]
> `ExecuteAgent` has been removed. The underlying `executeAgent` API is deprecated
> platform-side; use `ExecuteFlow` instead.
