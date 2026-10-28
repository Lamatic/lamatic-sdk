package lamatic

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func newStreamTestClient(t *testing.T, handler http.HandlerFunc) *Client {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)

	apiKey := "test-key"
	client, err := NewClient(Config{Endpoint: server.URL, ProjectID: "test-project", APIKey: &apiKey})
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	return client
}

func writeSSE(w http.ResponseWriter, frames ...string) {
	w.Header().Set("Content-Type", "text/event-stream")
	for _, f := range frames {
		_, _ = w.Write([]byte(f))
		if fl, ok := w.(http.Flusher); ok {
			fl.Flush()
		}
	}
}

func collect(t *testing.T, ch <-chan TokenEvent) []TokenEvent {
	t.Helper()
	var events []TokenEvent
	timeout := time.After(5 * time.Second)
	for {
		select {
		case ev, ok := <-ch:
			if !ok {
				return events
			}
			events = append(events, ev)
		case <-timeout:
			t.Fatal("timed out waiting for the stream to close")
		}
	}
}

func TestExecuteFlowTokenStream(t *testing.T) {
	var sawAccept, sawSubscription atomic.Bool
	client := newStreamTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		sawAccept.Store(r.Header.Get("Accept") == "text/event-stream")
		body, _ := io.ReadAll(r.Body)
		sawSubscription.Store(strings.Contains(string(body), "subscription ExecuteWorkflowWithStream"))

		writeSSE(w,
			": keep-alive\n\n",
			"data: {\"data\":{\"executeWorkflowWithStream\":{\"status\":\"success\",\"nodeId\":\"trigger\",\"data\":{\"in\":1},\"isNodeExecutionFinished\":true}}}\n\n",
			"data: {\"data\":{\"executeWorkflowWithStream\":null}}\n\n",
			"data: {\"data\":{\"executeWorkflowWithStream\":{\"status\":\"streaming\",\"nodeId\":\"llm\",\"data\":{\"generatedResponse\":\"Hel\"}}}}\r\n\r\n",
			"data: {\"data\":{\"executeWorkflowWithStream\":{\"status\":\"streaming\",\"nodeId\":\"llm\",\"data\":{\"generatedResponse\":\"lo\"}}}}\n\n",
			"data: {\"data\":{\"executeWorkflowWithStream\":{\"status\":\"success\",\"nodeId\":\"llm\",\"data\":{\"_meta\":{\"total_tokens\":2}},\"isNodeExecutionFinished\":true}}}\n\n",
			"data: {\"data\":{\"executeWorkflowWithStream\":{\"status\":\"success\",\"data\":{\"answer\":\"Hello\"},\"isFlowExecutionFinished\":true}}}\n\n",
			// Nothing after the terminal frame may be delivered.
			"data: {\"data\":{\"executeWorkflowWithStream\":{\"status\":\"streaming\",\"nodeId\":\"llm\",\"data\":{\"generatedResponse\":\"late\"}}}}\n\n",
		)
	})

	ch, err := client.ExecuteFlowTokenStream(context.Background(), "flow", map[string]interface{}{"q": "hi"}, nil)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	events := collect(t, ch)

	if !sawAccept.Load() {
		t.Error("Expected Accept: text/event-stream")
	}
	if !sawSubscription.Load() {
		t.Error("Expected the executeWorkflowWithStream subscription to be sent")
	}

	wantTypes := []EventType{EventNode, EventToken, EventToken, EventNode, EventFinal}
	if len(events) != len(wantTypes) {
		t.Fatalf("Expected %d events, got %d: %+v", len(wantTypes), len(events), events)
	}
	for i, want := range wantTypes {
		if events[i].Type != want {
			t.Errorf("event %d: expected %s, got %s", i, want, events[i].Type)
		}
	}

	if events[1].Token != "Hel" || events[2].Token != "lo" || events[1].NodeID != "llm" {
		t.Errorf("Unexpected tokens: %+v %+v", events[1], events[2])
	}
	if events[3].Output["_meta"] == nil {
		t.Errorf("Expected node output to carry _meta, got %v", events[3].Output)
	}

	final := events[4]
	if final.Text != "Hello" {
		t.Errorf("Expected accumulated text Hello, got %q", final.Text)
	}
	if final.TextByNode["llm"] != "Hello" {
		t.Errorf("Expected textByNode[llm]=Hello, got %v", final.TextByNode)
	}
	if final.Result["answer"] != "Hello" {
		t.Errorf("Expected result answer=Hello, got %v", final.Result)
	}
	if final.Raw == nil || !final.Raw.IsFlowExecutionFinished {
		t.Errorf("Expected raw terminal frame, got %+v", final.Raw)
	}
}

func TestExecuteFlowTokenStreamErrorFrame(t *testing.T) {
	client := newStreamTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		writeSSE(w,
			"data: {\"data\":{\"executeWorkflowWithStream\":{\"status\":\"error\",\"nodeId\":\"llm\",\"data\":{\"errorMsg\":\"model unavailable\"},\"isFlowExecutionFinished\":true}}}\n\n",
		)
	})

	ch, err := client.ExecuteFlowTokenStream(context.Background(), "flow", nil, nil)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	events := collect(t, ch)

	if len(events) != 1 || events[0].Type != EventError {
		t.Fatalf("Expected a single error event, got %+v", events)
	}
	if events[0].Message != "model unavailable" || events[0].NodeID != "llm" {
		t.Errorf("Unexpected error event: %+v", events[0])
	}
}

func TestExecuteFlowTokenStreamJSONError(t *testing.T) {
	client := newStreamTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"errors":[{"message":"invalid api key"}]}`))
	})

	ch, err := client.ExecuteFlowTokenStream(context.Background(), "flow", nil, nil)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	events := collect(t, ch)

	if len(events) != 1 || events[0].Type != EventError || events[0].Message != "invalid api key" {
		t.Fatalf("Expected a single 'invalid api key' error event, got %+v", events)
	}
}

func TestExecuteFlowTokenStreamJSONFallback(t *testing.T) {
	client := newStreamTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"executeWorkflow":{"status":"success","result":{"foo":"bar"}}}}`))
	})

	ch, err := client.ExecuteFlowTokenStream(context.Background(), "flow", nil, nil)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	events := collect(t, ch)

	if len(events) != 1 || events[0].Type != EventFinal || events[0].Result["foo"] != "bar" {
		t.Fatalf("Expected a single final event with foo=bar, got %+v", events)
	}
}

func TestExecuteFlowTokenStreamTruncated(t *testing.T) {
	client := newStreamTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		writeSSE(w,
			"data: {\"data\":{\"executeWorkflowWithStream\":{\"status\":\"streaming\",\"nodeId\":\"llm\",\"data\":{\"generatedResponse\":\"Hi\"}}}}\n\n",
		)
	})

	ch, err := client.ExecuteFlowTokenStream(context.Background(), "flow", nil, nil)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	events := collect(t, ch)

	if len(events) != 2 || events[0].Type != EventToken || events[1].Type != EventError {
		t.Fatalf("Expected a token then an error event, got %+v", events)
	}
}

func TestExecuteFlowTokenStreamTruncatedAfterNonFatalError(t *testing.T) {
	client := newStreamTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		writeSSE(w,
			"data: {\"data\":{\"executeWorkflowWithStream\":{\"status\":\"error\",\"nodeId\":\"code\",\"data\":{\"errorMsg\":\"soft fail\"}}}}\n\n",
			"data: {\"data\":{\"executeWorkflowWithStream\":{\"status\":\"streaming\",\"nodeId\":\"llm\",\"data\":{\"generatedResponse\":\"Hi\"}}}}\n\n",
		)
	})

	ch, err := client.ExecuteFlowTokenStream(context.Background(), "flow", nil, nil)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	events := collect(t, ch)

	// The soft error did not end the flow, so the dropped connection must
	// still be reported.
	if len(events) != 3 || events[2].Type != EventError || events[2].Message != "Stream ended before the flow finished" {
		t.Fatalf("Expected error, token, then a truncation error, got %+v", events)
	}
}

func TestExecuteFlowTokenStreamNonObjectData(t *testing.T) {
	client := newStreamTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		writeSSE(w,
			"data: {\"data\":{\"executeWorkflowWithStream\":{\"status\":\"error\",\"nodeId\":\"code\",\"data\":\"boom\"}}}\n\n",
			"data: {\"data\":{\"executeWorkflowWithStream\":{\"status\":\"streaming\",\"nodeId\":\"llm\",\"data\":{\"generatedResponse\":\"Hi\"}}}}\n\n",
			"data: {\"data\":{\"executeWorkflowWithStream\":{\"status\":\"success\",\"data\":[1,2],\"isFlowExecutionFinished\":true}}}\n\n",
		)
	})

	ch, err := client.ExecuteFlowTokenStream(context.Background(), "flow", nil, nil)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	events := collect(t, ch)

	// A frame whose data is not an object is still delivered, just without Data.
	want := []EventType{EventError, EventToken, EventFinal}
	if len(events) != len(want) {
		t.Fatalf("Expected %v, got %+v", want, events)
	}
	for i, w := range want {
		if events[i].Type != w {
			t.Fatalf("event %d: expected %s, got %+v", i, w, events[i])
		}
	}
	if events[0].Message != "Workflow execution failed" || events[2].Text != "Hi" {
		t.Errorf("Unexpected events: %+v", events)
	}
}

func TestExecuteFlowTokenStreamCancel(t *testing.T) {
	release := make(chan struct{})
	client := newStreamTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		writeSSE(w,
			"data: {\"data\":{\"executeWorkflowWithStream\":{\"status\":\"streaming\",\"nodeId\":\"llm\",\"data\":{\"generatedResponse\":\"Hi\"}}}}\n\n",
		)
		// Hold the connection open until the client goes away.
		select {
		case <-r.Context().Done():
		case <-release:
		}
	})
	defer close(release)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	ch, err := client.ExecuteFlowTokenStream(ctx, "flow", nil, nil)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	first := <-ch
	if first.Type != EventToken || first.Token != "Hi" {
		t.Fatalf("Expected the first token, got %+v", first)
	}

	cancel()
	if rest := collect(t, ch); len(rest) != 0 {
		t.Errorf("Expected a quiet close after cancel, got %+v", rest)
	}
}

func TestExecuteFlowTokenStreamRequestFailure(t *testing.T) {
	apiKey := "test-key"
	client, _ := NewClient(Config{Endpoint: "http://127.0.0.1:1", ProjectID: "p", APIKey: &apiKey})

	if _, err := client.ExecuteFlowTokenStream(context.Background(), "flow", nil, nil); err == nil {
		t.Error("Expected an error when the request cannot be sent")
	}
}
