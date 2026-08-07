package lamatic

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/AasheeshLikePanner/lamatic-sdk-go/internal/client"
)

type Status string

const (
	StatusSuccess Status = "success"
	StatusError   Status = "error"
)

// Logger is satisfied by *log.Logger and lets callers plug in their own
// logging backend to observe request failures.
type Logger interface {
	Printf(format string, args ...interface{})
}

type Config struct {
	Endpoint    string
	ProjectID   string
	APIKey      *string
	AccessToken *string
	// Logger, if set, receives diagnostic messages for failed requests.
	Logger Logger
}

type Response struct {
	Status     Status                 `json:"status"`
	Result     map[string]interface{} `json:"result"`
	Message    string                 `json:"message,omitempty"`
	StatusCode int                    `json:"statusCode,omitempty"`
}

// Decode unmarshals the response Result into v, which should be a pointer.
// It's a convenience for callers who want a typed struct instead of the raw
// map[string]interface{}.
func (r *Response) Decode(v interface{}) error {
	raw, err := json.Marshal(r.Result)
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, v)
}

// AsyncResult carries the outcome of an asynchronous SDK call.
type AsyncResult struct {
	Response *Response
	Err      error
}

type Client struct {
	httpClient *client.Client
}

func NewClient(config Config) (*Client, error) {
	httpClient, err := client.New(client.Config{
		Endpoint:    config.Endpoint,
		ProjectID:   config.ProjectID,
		APIKey:      config.APIKey,
		AccessToken: config.AccessToken,
		Logger:      config.Logger,
	})
	if err != nil {
		return nil, err
	}

	return &Client{
		httpClient: httpClient,
	}, nil
}

func (c *Client) UpdateAccessToken(token string) {
	c.httpClient.UpdateAccessToken(token)
}

type executeResponse struct {
	Status Status                 `json:"status"`
	Result map[string]interface{} `json:"result"`
}

type executeWorkflowData struct {
	ExecuteWorkflow executeResponse `json:"executeWorkflow"`
}

type checkStatusData struct {
	CheckStatus executeResponse `json:"checkStatus"`
}

func (c *Client) ExecuteFlow(ctx context.Context, flowId string, payload interface{}) (*Response, error) {
	query := `query ExecuteWorkflow(
                $workflowId: String!  
                $payload: JSON!
              ) 
              {   
                executeWorkflow( 
                  workflowId: $workflowId   
                  payload: $payload
                ) 
                {  
                  status       
                  result   
                } 
              }`

	variables := map[string]interface{}{
		"workflowId": flowId,
		"payload":    payload,
	}

	resp, statusCode, err := c.httpClient.DoRequest(ctx, query, variables)
	if err != nil {
		return nil, err
	}

	if len(resp.Errors) > 0 {
		return &Response{
			Status:     StatusError,
			Result:     nil,
			Message:    resp.Errors[0].Message,
			StatusCode: statusCode,
		}, nil
	}

	var data executeWorkflowData
	if err := json.Unmarshal(resp.Data, &data); err != nil {
		return nil, err
	}

	return &Response{
		Status:     data.ExecuteWorkflow.Status,
		Result:     data.ExecuteWorkflow.Result,
		StatusCode: statusCode,
	}, nil
}

// ExecuteFlowAsync runs ExecuteFlow in the background and reports the result on the
// returned channel, which is closed after a single value is sent.
func (c *Client) ExecuteFlowAsync(ctx context.Context, flowId string, payload interface{}) <-chan AsyncResult {
	out := make(chan AsyncResult, 1)
	go func() {
		defer close(out)
		resp, err := c.ExecuteFlow(ctx, flowId, payload)
		out <- AsyncResult{Response: resp, Err: err}
	}()
	return out
}

func (c *Client) CheckStatus(ctx context.Context, requestId string, pollInterval int, pollTimeout int) (*Response, error) {
	if pollInterval <= 0 {
		pollInterval = 15
	}
	if pollTimeout <= 0 {
		pollTimeout = 900
	}

	timeoutCtx, cancel := context.WithTimeout(ctx, time.Duration(pollTimeout)*time.Second)
	defer cancel()

	ticker := time.NewTicker(time.Duration(pollInterval) * time.Second)
	defer ticker.Stop()

	query := `query CheckStatus(
                  $requestId: String!
                ) {
                  checkStatus(
                    requestId: $requestId
                  )
                }`

	variables := map[string]interface{}{
		"requestId": requestId,
	}

	for {
		resp, statusCode, err := c.httpClient.DoRequest(timeoutCtx, query, variables)
		if err != nil {
			if timeoutCtx.Err() != nil {
				return &Response{
					Status:     StatusError,
					Result:     nil,
					Message:    fmt.Sprintf("Request checkStatus timed out or cancelled: %v", timeoutCtx.Err()),
					StatusCode: 408,
				}, nil
			}
			return nil, err
		}

		if len(resp.Errors) > 0 {
			return &Response{
				Status:     StatusError,
				Result:     nil,
				Message:    resp.Errors[0].Message,
				StatusCode: statusCode,
			}, nil
		}

		var data checkStatusData
		if err := json.Unmarshal(resp.Data, &data); err != nil {
			return nil, err
		}

		status := data.CheckStatus.Status
		if status == StatusSuccess || status == StatusError || status == "failed" {
			return &Response{
				Status:     status,
				Result:     data.CheckStatus.Result,
				StatusCode: statusCode,
			}, nil
		}

		select {
		case <-timeoutCtx.Done():
			return &Response{
				Status:     StatusError,
				Result:     nil,
				Message:    fmt.Sprintf("Request checkStatus timed out or cancelled: %v", timeoutCtx.Err()),
				StatusCode: 408,
			}, nil
		case <-ticker.C:
		}
	}
}

// CheckStatusAsync runs CheckStatus in the background and reports the result on the
// returned channel, which is closed after a single value is sent.
func (c *Client) CheckStatusAsync(ctx context.Context, requestId string, pollInterval int, pollTimeout int) <-chan AsyncResult {
	out := make(chan AsyncResult, 1)
	go func() {
		defer close(out)
		resp, err := c.CheckStatus(ctx, requestId, pollInterval, pollTimeout)
		out <- AsyncResult{Response: resp, Err: err}
	}()
	return out
}
