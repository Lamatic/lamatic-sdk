package lamatic

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestExecuteFlow(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := map[string]interface{}{
			"data": map[string]interface{}{
				"executeWorkflow": map[string]interface{}{
					"status": "success",
					"result": map[string]interface{}{"foo": "bar"},
				},
			},
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	apiKey := "test-key"
	client, _ := NewClient(Config{
		Endpoint:  server.URL,
		ProjectID: "test-project",
		APIKey:    &apiKey,
	})

	resp, err := client.ExecuteFlow(context.Background(), "test-flow", map[string]interface{}{"input": "test"})
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	if resp.Status != StatusSuccess {
		t.Errorf("Expected status success, got %v", resp.Status)
	}

	if resp.Result["foo"] != "bar" {
		t.Errorf("Expected result foo=bar, got %v", resp.Result["foo"])
	}
}

func TestExecuteFlowAsync(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := map[string]interface{}{
			"data": map[string]interface{}{
				"executeWorkflow": map[string]interface{}{
					"status": "success",
					"result": map[string]interface{}{"foo": "bar"},
				},
			},
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	apiKey := "test-key"
	client, _ := NewClient(Config{
		Endpoint:  server.URL,
		ProjectID: "test-project",
		APIKey:    &apiKey,
	})

	result := <-client.ExecuteFlowAsync(context.Background(), "test-flow", map[string]interface{}{"input": "test"})
	if result.Err != nil {
		t.Fatalf("Expected no error, got %v", result.Err)
	}

	if result.Response.Status != StatusSuccess {
		t.Errorf("Expected status success, got %v", result.Response.Status)
	}

	if result.Response.Result["foo"] != "bar" {
		t.Errorf("Expected result foo=bar, got %v", result.Response.Result["foo"])
	}
}

func TestResponseDecode(t *testing.T) {
	resp := &Response{
		Status: StatusSuccess,
		Result: map[string]interface{}{"foo": "bar", "count": 3},
	}

	var target struct {
		Foo   string `json:"foo"`
		Count int    `json:"count"`
	}

	if err := resp.Decode(&target); err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	if target.Foo != "bar" || target.Count != 3 {
		t.Errorf("Expected {bar 3}, got %+v", target)
	}
}

type testLogger struct {
	messages []string
}

func (l *testLogger) Printf(format string, args ...interface{}) {
	l.messages = append(l.messages, fmt.Sprintf(format, args...))
}

func TestLoggerReceivesRequestFailures(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	apiKey := "test-key"
	logger := &testLogger{}
	client, _ := NewClient(Config{
		Endpoint:  server.URL,
		ProjectID: "test-project",
		APIKey:    &apiKey,
		Logger:    logger,
	})

	_, err := client.ExecuteFlow(context.Background(), "test-flow", map[string]interface{}{"input": "test"})
	if err == nil {
		t.Fatal("Expected an error for a 500 response")
	}

	if len(logger.messages) == 0 {
		t.Error("Expected logger to receive a diagnostic message")
	}
}
