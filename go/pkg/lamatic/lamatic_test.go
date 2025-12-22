package lamatic

import (
	"context"
	"encoding/json"
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

func TestExecuteAgent(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := map[string]interface{}{
			"data": map[string]interface{}{
				"executeAgent": map[string]interface{}{
					"status": "success",
					"result": map[string]interface{}{"agent": "done"},
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

	resp, err := client.ExecuteAgent(context.Background(), "test-agent", map[string]interface{}{"input": "test"})
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	if resp.Status != StatusSuccess {
		t.Errorf("Expected status success, got %v", resp.Status)
	}

	if resp.Result["agent"] != "done" {
		t.Errorf("Expected result agent=done, got %v", resp.Result["agent"])
	}
}
