package client

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
)

type Config struct {
	Endpoint    string
	ProjectID   string
	APIKey      *string
	AccessToken *string
}

type Client struct {
	endpoint    string
	projectId   string
	apiKey      *string
	accessToken *string
	httpClient  *http.Client
}

type GraphQLRequest struct {
	Query     string                 `json:"query"`
	Variables map[string]interface{} `json:"variables"`
}

type GraphQLError struct {
	Message string `json:"message"`
}

type GraphQLResponse struct {
	Data   json.RawMessage `json:"data"`
	Errors []GraphQLError  `json:"errors"`
}

func New(config Config) (*Client, error) {
	if config.Endpoint == "" {
		return nil, errors.New("endpoint URL is required")
	}
	if config.ProjectID == "" {
		return nil, errors.New("project ID is required")
	}
	if config.APIKey == nil && config.AccessToken == nil {
		return nil, errors.New("API key or Access Token is required")
	}

	return &Client{
		endpoint:    config.Endpoint,
		projectId:   config.ProjectID,
		apiKey:      config.APIKey,
		accessToken: config.AccessToken,
		httpClient:  &http.Client{},
	}, nil
}

func (c *Client) UpdateAccessToken(token string) {
	c.accessToken = &token
}

func (c *Client) GetHeaders() http.Header {
	headers := http.Header{}
	headers.Set("Content-Type", "application/json")
	headers.Set("x-project-id", c.projectId)

	if c.accessToken != nil {
		headers.Set("X-Lamatic-Signature", *c.accessToken)
	} else if c.apiKey != nil {
		headers.Set("Authorization", fmt.Sprintf("Bearer %s", *c.apiKey))
	}

	return headers
}

// DoRequest executes a GraphQL request and returns the response and status code.
func (c *Client) DoRequest(ctx context.Context, query string, variables map[string]interface{}) (*GraphQLResponse, int, error) {
	reqBody := GraphQLRequest{
		Query:     query,
		Variables: variables,
	}

	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		return nil, 0, err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", c.endpoint, bytes.NewBuffer(jsonBody))
	if err != nil {
		return nil, 0, err
	}

	req.Header = c.GetHeaders()

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		var gQLResp GraphQLResponse
		if err := json.NewDecoder(resp.Body).Decode(&gQLResp); err == nil && len(gQLResp.Errors) > 0 {
			return &gQLResp, resp.StatusCode, nil
		}
		return nil, resp.StatusCode, fmt.Errorf("API request failed with status code %d", resp.StatusCode)
	}

	var gQLResp GraphQLResponse
	if err := json.NewDecoder(resp.Body).Decode(&gQLResp); err != nil {
		return nil, resp.StatusCode, fmt.Errorf("failed to decode response: %v", err)
	}

	return &gQLResp, resp.StatusCode, nil
}
