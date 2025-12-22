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

type Config struct {
	Endpoint    string
	ProjectID   string
	APIKey      *string
	AccessToken *string
}

type Response struct {
	Status     Status                 `json:"status"`
	Result     map[string]interface{} `json:"result"`
	Message    string                 `json:"message,omitempty"`
	StatusCode int                    `json:"statusCode,omitempty"`
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

type executeAgentData struct {
	ExecuteAgent executeResponse `json:"executeAgent"`
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

func (c *Client) ExecuteAgent(ctx context.Context, agentId string, payload interface{}) (*Response, error) {
	query := `query ExecuteAgent(
                $agentId: String!  
                $payload: JSON!
              ) 
              {   
                executeAgent( 
                  agentId: $agentId   
                  payload: $payload
                ) 
                {  
                  status       
                  result   
                } 
              }`

	variables := map[string]interface{}{
		"agentId": agentId,
		"payload": payload,
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

	var data executeAgentData
	if err := json.Unmarshal(resp.Data, &data); err != nil {
		return nil, err
	}

	return &Response{
		Status:     data.ExecuteAgent.Status,
		Result:     data.ExecuteAgent.Result,
		StatusCode: statusCode,
	}, nil
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
