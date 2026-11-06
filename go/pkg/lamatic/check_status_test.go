package lamatic

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

// loadFixtures reads the real API responses shared with the TypeScript and
// Python SDK test suites.
func loadFixtures(t *testing.T) map[string]json.RawMessage {
	t.Helper()
	raw, err := os.ReadFile("testdata/check_status.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fixtures); err != nil {
		t.Fatal(err)
	}
	return fixtures
}

// replyServer answers one fixture per request, repeating the last one, and
// records each request body.
func replyServer(t *testing.T, names ...string) (*Client, *[]map[string]interface{}) {
	t.Helper()
	fixtures := loadFixtures(t)
	var mu sync.Mutex
	var requests []map[string]interface{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var req map[string]interface{}
		json.Unmarshal(body, &req)
		mu.Lock()
		n := len(requests)
		requests = append(requests, req)
		mu.Unlock()
		if n >= len(names) {
			n = len(names) - 1
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write(fixtures[names[n]])
	}))
	t.Cleanup(server.Close)

	apiKey := "test-key"
	client, err := NewClient(Config{Endpoint: server.URL, ProjectID: "test-project", APIKey: &apiKey})
	if err != nil {
		t.Fatal(err)
	}
	return client, &requests
}

// fast polls every 10ms and gives up after 5s.
var fast = &PollOptions{Interval: 10 * time.Millisecond, Timeout: 5 * time.Second}

func TestCheckStatusReturnsTheFlowsResult(t *testing.T) {
	client, requests := replyServer(t, "inProgress", "success")

	resp, err := client.CheckStatus(context.Background(), "req-1", fast)
	if err != nil {
		t.Fatal(err)
	}
	if resp.Status != StatusSuccess || resp.Result["answer"] != "hello async" {
		t.Fatalf("got %+v", resp)
	}
	if len(*requests) != 2 {
		t.Fatalf("expected 2 requests, got %d", len(*requests))
	}
}

func TestCheckStatusReportsAFailedRunsMessage(t *testing.T) {
	client, _ := replyServer(t, "failed")

	resp, err := client.CheckStatus(context.Background(), "req-1", fast)
	if err != nil {
		t.Fatal(err)
	}
	if resp.Status != StatusFailed || !strings.HasPrefix(resp.Message, "LLM node failed: 404") {
		t.Fatalf("got %+v", resp)
	}
}

func TestCheckStatusGivesUpOnAnUnknownRequest(t *testing.T) {
	grace := notFoundGrace
	notFoundGrace = 30 * time.Millisecond
	t.Cleanup(func() { notFoundGrace = grace })
	client, _ := replyServer(t, "notFound")

	resp, err := client.CheckStatus(context.Background(), "req-missing", fast)
	if err != nil {
		t.Fatal(err)
	}
	if resp.Status != StatusError || resp.StatusCode != 404 || !strings.Contains(resp.Message, "req-missing was not found") {
		t.Fatalf("got %+v", resp)
	}
}

func TestCheckStatusPollsThroughNotFoundDuringTheGracePeriod(t *testing.T) {
	client, requests := replyServer(t, "notFound", "inProgress", "success")

	resp, err := client.CheckStatus(context.Background(), "req-1", fast)
	if err != nil {
		t.Fatal(err)
	}
	if resp.Status != StatusSuccess || len(*requests) != 3 {
		t.Fatalf("got %+v after %d requests", resp, len(*requests))
	}
}

func TestExecuteFlowPollPollsAQueuedRun(t *testing.T) {
	client, requests := replyServer(t, "queued", "inProgress", "success")

	resp, err := client.ExecuteFlowPoll(context.Background(), "flow-1", map[string]interface{}{"sampleInput": "hi"}, fast)
	if err != nil {
		t.Fatal(err)
	}
	if resp.Status != StatusSuccess || resp.Result["answer"] != "hello async" {
		t.Fatalf("got %+v", resp)
	}
	vars := (*requests)[1]["variables"].(map[string]interface{})
	if vars["requestId"] != "b896236e-c1a6-4abd-mw4g2792-rubzr973" {
		t.Fatalf("polled the wrong request: %v", vars)
	}
}

func TestExecuteFlowPollReturnsARealtimeResponseWithoutPolling(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"data":{"executeWorkflow":{"status":"success","result":{"answer":"now","requestId":"req-2"}}}}`))
	}))
	defer server.Close()
	apiKey := "test-key"
	client, _ := NewClient(Config{Endpoint: server.URL, ProjectID: "test-project", APIKey: &apiKey})

	result := <-client.ExecuteFlowPollAsync(context.Background(), "flow-1", nil, fast)
	if result.Err != nil {
		t.Fatal(result.Err)
	}
	if result.Response.Result["answer"] != "now" {
		t.Fatalf("got %+v", result.Response)
	}
}

func TestCheckStatusKeepsPollingThroughABadReply(t *testing.T) {
	fixtures := loadFixtures(t)
	var calls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if calls == 1 {
			// A gateway error page rather than JSON.
			w.WriteHeader(http.StatusBadGateway)
			w.Write([]byte("<html>Bad gateway</html>"))
			return
		}
		w.Write(fixtures["success"])
	}))
	defer server.Close()
	apiKey := "test-key"
	client, _ := NewClient(Config{Endpoint: server.URL, ProjectID: "test-project", APIKey: &apiKey})

	resp, err := client.CheckStatus(context.Background(), "req-1", fast)
	if err != nil {
		t.Fatal(err)
	}
	if resp.Status != StatusSuccess || calls != 2 {
		t.Fatalf("got %+v after %d calls", resp, calls)
	}
}

func TestCheckStatusReportsTheLastErrorOnTimeout(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		w.Write([]byte("<html>Bad gateway</html>"))
	}))
	defer server.Close()
	apiKey := "test-key"
	client, _ := NewClient(Config{Endpoint: server.URL, ProjectID: "test-project", APIKey: &apiKey})

	resp, err := client.CheckStatus(context.Background(), "req-1", &PollOptions{Interval: 10 * time.Millisecond, Timeout: 50 * time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 408 || !strings.Contains(resp.Message, "Last error:") {
		t.Fatalf("got %+v", resp)
	}
}
