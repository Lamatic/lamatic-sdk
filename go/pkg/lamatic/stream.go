package lamatic

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/Lamatic/lamatic-sdk-go/internal/client"
)

// streamSubscription is the executeWorkflowWithStream subscription. Its field
// returns a JSON! scalar, so it takes no selection set.
const streamSubscription = `subscription ExecuteWorkflowWithStream(
                $workflowId: String
                $payload: JSON!
                $source: String
                $command: String
              ) {
                executeWorkflowWithStream(
                  workflowId: $workflowId
                  payload: $payload
                  source: $source
                  command: $command
                )
              }`

// EventType identifies the kind of a TokenEvent.
type EventType string

const (
	// EventToken is one text delta from a streaming node (LLM or RAG).
	EventToken EventType = "token"
	// EventNode reports that a node finished; Output holds its full output.
	EventNode EventType = "node"
	// EventFinal reports that the flow finished. It is always the last event
	// of a successful stream.
	EventFinal EventType = "final"
	// EventError reports a failed execution. The stream ends if the failure
	// was fatal.
	EventError EventType = "error"
)

// StreamOptions tunes ExecuteFlowTokenStream. A nil *StreamOptions uses the
// server defaults.
type StreamOptions struct {
	// Source is the trigger source used to resolve the flow. Defaults to
	// "graphql" server-side.
	Source  string
	Command string
}

// RawStreamChunk is a single frame emitted by the executeWorkflowWithStream
// subscription, unwrapped from its GraphQL envelope.
//
// Frames arrive in this order for a flow containing a streaming node:
//  1. one per upstream node, with IsNodeExecutionFinished set
//  2. many with Status "streaming" — one LLM/RAG token each
//  3. one with IsNodeExecutionFinished set for the streaming node, carrying
//     _meta (token counts and cost) in Data
//  4. one with IsFlowExecutionFinished set — the flow's final output
type RawStreamChunk struct {
	Status string `json:"status,omitempty"`
	// Data is the node output, or {"generatedResponse": ...} on a token frame.
	Data map[string]interface{} `json:"data,omitempty"`
	// Result is used instead of Data by some server error paths.
	Result map[string]interface{} `json:"result,omitempty"`
	// NodeID is empty on the terminal flow frame.
	NodeID                  string `json:"nodeId,omitempty"`
	IsNodeExecutionFinished bool   `json:"isNodeExecutionFinished,omitempty"`
	IsFlowExecutionFinished bool   `json:"isFlowExecutionFinished,omitempty"`
}

// UnmarshalJSON decodes a frame, leaving Data or Result nil when the server
// sends something other than a JSON object there. Failing the whole frame
// instead would drop it, and dropping the terminal frame would end the stream
// with a spurious truncation error.
func (c *RawStreamChunk) UnmarshalJSON(b []byte) error {
	type plain RawStreamChunk
	var aux struct {
		plain
		Data   json.RawMessage `json:"data,omitempty"`
		Result json.RawMessage `json:"result,omitempty"`
	}
	if err := json.Unmarshal(b, &aux); err != nil {
		return err
	}
	*c = RawStreamChunk(aux.plain)
	c.Data = objectOrNil(aux.Data)
	c.Result = objectOrNil(aux.Result)
	return nil
}

func objectOrNil(raw json.RawMessage) map[string]interface{} {
	var m map[string]interface{}
	if json.Unmarshal(raw, &m) != nil {
		return nil
	}
	return m
}

// TokenEvent is one event of a token stream. Which fields are set depends on
// Type:
//
//	EventToken: Token, NodeID
//	EventNode:  NodeID, Output
//	EventFinal: Result, Text, TextByNode
//	EventError: Message, NodeID
//
// Raw is the untouched server frame, for fields the typed event does not
// surface — Data["_meta"] on a node event holds token counts and cost. It is
// nil for errors raised on the client side.
type TokenEvent struct {
	Type   EventType
	Raw    *RawStreamChunk
	NodeID string

	// Token is one text delta.
	Token string

	// Output is the full output of the node that finished.
	Output map[string]interface{}

	// Result is the flow's final output, as configured by its response node.
	Result map[string]interface{}
	// Text is every token concatenated in arrival order. Prefer it over
	// reading generatedResponse off a node's output: the platform currently
	// returns that field with its content duplicated, and a flow's Result
	// often carries only what its response node was configured to return.
	Text string
	// TextByNode is Text split per node, for flows with more than one
	// streaming node.
	TextByNode map[string]string

	// Message describes an error.
	Message string
}

// ExecuteFlowTokenStream runs a flow and streams its LLM/RAG output one token
// at a time, over the executeWorkflowWithStream subscription.
//
// An error is returned only if the request could not be sent. Everything that
// goes wrong afterwards — rejected credentials, a failing node, a dropped
// connection — arrives as an EventError event.
//
// The returned channel is closed when the stream ends. A successful stream
// ends with an EventFinal event. Cancelling ctx stops generation and closes
// the channel quietly, without a final or error event. Always either read the
// channel to the end or cancel ctx; abandoning it otherwise leaks the
// connection.
//
// Only LLM and RAG nodes emit EventToken events. Every other node reports once,
// as a single EventNode event when it completes.
func (c *Client) ExecuteFlowTokenStream(ctx context.Context, flowId string, payload interface{}, opts *StreamOptions) (<-chan TokenEvent, error) {
	variables := map[string]interface{}{
		"workflowId": flowId,
		"payload":    payload,
	}
	if opts != nil {
		if opts.Source != "" {
			variables["source"] = opts.Source
		}
		if opts.Command != "" {
			variables["command"] = opts.Command
		}
	}

	resp, err := c.httpClient.OpenStream(ctx, streamSubscription, variables)
	if err != nil {
		return nil, err
	}

	out := make(chan TokenEvent)
	go func() {
		defer close(out)
		defer resp.Body.Close()

		// send reports whether the event was delivered; false means the caller
		// cancelled and nobody is reading anymore.
		send := func(ev TokenEvent) bool {
			select {
			case out <- ev:
				return true
			case <-ctx.Done():
				return false
			}
		}

		tr := &tokenTranslator{textByNode: map[string]string{}}
		err := readChunks(resp, func(chunk *RawStreamChunk) bool {
			ev := tr.next(chunk)
			if ev != nil && !send(*ev) {
				return false
			}
			return !tr.done
		})

		// A caller-initiated cancel ends the stream quietly rather than as a failure.
		if ctx.Err() != nil {
			return
		}
		if err != nil {
			send(TokenEvent{Type: EventError, Message: err.Error()})
			return
		}
		// A non-fatal error does not end the flow, so a dropped connection after
		// one is still a truncated stream.
		if !tr.done {
			send(TokenEvent{Type: EventError, Message: "Stream ended before the flow finished"})
		}
	}()

	return out, nil
}

// tokenTranslator turns raw frames into typed events, accumulating the text.
type tokenTranslator struct {
	text       string
	textByNode map[string]string
	// done is set once the stream is over: the flow finished, or failed fatally.
	done bool
}

// next returns the event for chunk, or nil if the frame carries nothing to report.
func (t *tokenTranslator) next(chunk *RawStreamChunk) *TokenEvent {
	nodeID := chunk.NodeID

	if chunk.Status == "error" {
		body := chunk.Data
		if body == nil {
			body = chunk.Result
		}
		msg, _ := body["errorMsg"].(string)
		if msg == "" {
			msg = "Workflow execution failed"
		}
		t.done = chunk.IsFlowExecutionFinished
		return &TokenEvent{Type: EventError, Message: msg, NodeID: nodeID, Raw: chunk}
	}

	// A token frame: status "streaming" with a single delta in Data.
	if chunk.Status == "streaming" && !chunk.IsNodeExecutionFinished {
		token, _ := chunk.Data["generatedResponse"].(string)
		if token == "" {
			return nil
		}
		t.text += token
		if nodeID != "" {
			t.textByNode[nodeID] += token
		}
		return &TokenEvent{Type: EventToken, Token: token, NodeID: nodeID, Raw: chunk}
	}

	// Checked before IsNodeExecutionFinished: the terminal frame can set both.
	if chunk.IsFlowExecutionFinished {
		t.done = true
		result := chunk.Data
		if result == nil {
			result = chunk.Result
		}
		return &TokenEvent{
			Type:       EventFinal,
			Result:     result,
			Text:       t.text,
			TextByNode: t.textByNode,
			Raw:        chunk,
		}
	}

	if chunk.IsNodeExecutionFinished {
		return &TokenEvent{Type: EventNode, NodeID: nodeID, Output: chunk.Data, Raw: chunk}
	}

	return nil
}

// readChunks calls yield with each frame of the response, unwrapped from its
// GraphQL envelope, until yield returns false, the flow finishes, or the
// stream ends.
func readChunks(resp *http.Response, yield func(*RawStreamChunk) bool) error {
	// Auth failures, rate limits and query-validation errors come back as plain JSON.
	if !client.IsEventStream(resp) {
		body, err := io.ReadAll(resp.Body)
		if err != nil {
			return err
		}
		yield(chunkFromJSONResponse(body, resp.StatusCode))
		return nil
	}

	return client.ReadEvents(resp.Body, func(data string) bool {
		chunk, ok := parseFrame(data)
		if !ok {
			return true
		}
		if !yield(chunk) {
			return false
		}
		return !chunk.IsFlowExecutionFinished
	})
}

// parseFrame decodes the data of one SSE event. ok is false when the frame
// carries nothing to report.
func parseFrame(data string) (chunk *RawStreamChunk, ok bool) {
	if data == "[DONE]" {
		return &RawStreamChunk{IsFlowExecutionFinished: true}, true
	}

	var envelope struct {
		Data struct {
			Chunk json.RawMessage `json:"executeWorkflowWithStream"`
		} `json:"data"`
		Errors []client.GraphQLError `json:"errors"`
	}
	if err := json.Unmarshal([]byte(data), &envelope); err != nil {
		return nil, false
	}

	if len(envelope.Errors) > 0 {
		return errorChunk(envelope.Errors[0].Message), true
	}

	// The server also emits frames with a null payload; nothing to report.
	if len(envelope.Data.Chunk) == 0 || string(envelope.Data.Chunk) == "null" {
		return nil, false
	}

	var parsed RawStreamChunk
	if err := json.Unmarshal(envelope.Data.Chunk, &parsed); err != nil {
		return nil, false
	}
	return &parsed, true
}

// chunkFromJSONResponse builds a terminal chunk from a non-streaming response body.
func chunkFromJSONResponse(body []byte, statusCode int) *RawStreamChunk {
	var parsed struct {
		Data   map[string]json.RawMessage `json:"data"`
		Errors []client.GraphQLError      `json:"errors"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return errorChunk(fmt.Sprintf("Unexpected non-streaming response (HTTP %d)", statusCode))
	}
	if len(parsed.Errors) > 0 {
		return errorChunk(parsed.Errors[0].Message)
	}

	raw, ok := parsed.Data["executeWorkflowWithStream"]
	if !ok {
		raw = parsed.Data["executeWorkflow"]
	}

	var result struct {
		Status string                 `json:"status"`
		Result map[string]interface{} `json:"result"`
	}
	_ = json.Unmarshal(raw, &result)

	data := result.Result
	if data == nil {
		// Not the {status, result} shape; hand back whatever object we got.
		_ = json.Unmarshal(raw, &data)
	}
	status := result.Status
	if status == "" {
		status = string(StatusSuccess)
	}

	return &RawStreamChunk{Status: status, Data: data, IsFlowExecutionFinished: true}
}

func errorChunk(message string) *RawStreamChunk {
	return &RawStreamChunk{
		Status:                  string(StatusError),
		Data:                    map[string]interface{}{"errorMsg": message},
		IsFlowExecutionFinished: true,
	}
}
