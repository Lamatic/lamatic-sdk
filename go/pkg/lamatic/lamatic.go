package lamatic

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/lamatic/lamatic-sdk-go/internal/client"
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

func (c *Client) ExecuteFlow(flowId string, payload interface{}) (*Response, error) {
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

	resp, statusCode, err := c.httpClient.DoRequest(query, variables)
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

func (c *Client) ExecuteAgent(agentId string, payload interface{}) (*Response, error) {
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

	resp, statusCode, err := c.httpClient.DoRequest(query, variables)
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

func (c *Client) CheckStatus(requestId string, pollInterval int, pollTimeout int) (*Response, error) {
	if pollInterval <= 0 {
		pollInterval = 15
	}
	if pollTimeout <= 0 {
		pollTimeout = 900
	}

	startTime := time.Now()
	timeout := time.Duration(pollTimeout) * time.Second
	interval := time.Duration(pollInterval) * time.Second

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

	for time.Since(startTime) < timeout {
		resp, statusCode, err := c.httpClient.DoRequest(query, variables)
		if err != nil {
			return &Response{
				Status:     StatusError,
				Result:     nil,
				Message:    err.Error(),
				StatusCode: 500,
			}, nil
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

		if data.CheckStatus.Status == StatusSuccess || data.CheckStatus.Status == StatusError || data.CheckStatus.Status == "failed" {
			return &Response{
				Status:     data.CheckStatus.Status,
				Result:     data.CheckStatus.Result,
				StatusCode: statusCode,
			}, nil
		}

		if time.Since(startTime)+interval < timeout {
			time.Sleep(interval)
		}
	}

	return &Response{
		Status:     StatusError,
		Result:     nil,
		Message:    fmt.Sprintf("Request checkStatus timed out after %d seconds", pollTimeout),
		StatusCode: 408,
	}, nil
}
