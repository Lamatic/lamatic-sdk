package lamatic

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/Lamatic/lamatic-sdk-go/internal/client"
)

type Status string

const (
	StatusSuccess Status = "success"
	// StatusError means the request itself failed.
	StatusError Status = "error"
	// StatusFailed means the flow ran and a node failed.
	StatusFailed Status = "failed"
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
	CheckStatus checkStatusRecord `json:"checkStatus"`
}

// checkStatusRecord is what the checkStatus query returns: a JSON scalar
// holding the run's log record. The flow's result sits at data.output.result,
// and a failed run's message at data.output.result.errorMsg.
type checkStatusRecord struct {
	Status Status `json:"status"`
	Data   *struct {
		Output *struct {
			Result map[string]interface{} `json:"result"`
		} `json:"output"`
	} `json:"data"`
	Result  map[string]interface{} `json:"result"`
	Error   string                 `json:"error"`
	Message string                 `json:"message"`
}

// result returns the flow's result, falling back to a top-level result field.
func (r *checkStatusRecord) result() map[string]interface{} {
	if r.Data != nil && r.Data.Output != nil {
		return r.Data.Output.Result
	}
	return r.Result
}

// message returns the error message of a failed run.
func (r *checkStatusRecord) message() string {
	if msg, ok := r.result()["errorMsg"].(string); ok && msg != "" {
		return msg
	}
	if r.Error != "" {
		return r.Error
	}
	if r.Message != "" {
		return r.Message
	}
	return "Workflow execution failed"
}

// notFoundGrace is how long CheckStatus keeps polling a request reported as
// "not-found". A run's record reaches the status store a moment after the run
// is queued, so a fresh request ID can briefly read as unknown.
var notFoundGrace = 60 * time.Second

// PollOptions controls how CheckStatus and ExecuteFlowPoll wait for a run. A nil
// *PollOptions, or a zero field, uses the default.
type PollOptions struct {
	// Interval is the time between status checks. Defaults to 15 seconds.
	Interval time.Duration
	// Timeout is how long to poll before giving up. Defaults to 15 minutes.
	Timeout time.Duration
}

func (o *PollOptions) interval() time.Duration {
	if o == nil || o.Interval <= 0 {
		return 15 * time.Second
	}
	return o.Interval
}

func (o *PollOptions) timeout() time.Duration {
	if o == nil || o.Timeout <= 0 {
		return 15 * time.Minute
	}
	return o.Timeout
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

// CheckStatus polls a request until its run finishes, opts.Timeout passes, or
// ctx is done.
func (c *Client) CheckStatus(ctx context.Context, requestId string, opts *PollOptions) (*Response, error) {
	start := time.Now()
	timeoutCtx, cancel := context.WithTimeout(ctx, opts.timeout())
	defer cancel()

	ticker := time.NewTicker(opts.interval())
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

	var lastErr error
	timedOut := func() *Response {
		message := fmt.Sprintf("Request checkStatus timed out or cancelled: %v", timeoutCtx.Err())
		if lastErr != nil {
			message += fmt.Sprintf(". Last error: %v", lastErr)
		}
		return &Response{Status: StatusError, Result: nil, Message: message, StatusCode: 408}
	}

	for {
		resp, statusCode, err := c.httpClient.DoRequest(timeoutCtx, query, variables)
		if err == nil && len(resp.Errors) > 0 {
			return &Response{
				Status:     StatusError,
				Result:     nil,
				Message:    resp.Errors[0].Message,
				StatusCode: statusCode,
			}, nil
		}

		var data checkStatusData
		if err == nil {
			err = json.Unmarshal(resp.Data, &data)
		}

		if err != nil {
			if timeoutCtx.Err() != nil {
				return timedOut(), nil
			}
			// A dropped connection or a non-JSON reply (such as a gateway error
			// page) is usually transient, so keep polling until the timeout.
			lastErr = err
		} else {
			check := &data.CheckStatus
			switch check.Status {
			case StatusSuccess:
				return &Response{
					Status:     StatusSuccess,
					Result:     check.result(),
					StatusCode: statusCode,
				}, nil
			case StatusError, StatusFailed:
				return &Response{
					Status:     check.Status,
					Result:     check.result(),
					Message:    check.message(),
					StatusCode: statusCode,
				}, nil
			case "not-found":
				if time.Since(start) >= notFoundGrace {
					return &Response{
						Status:     StatusError,
						Result:     nil,
						Message:    fmt.Sprintf("Request %s was not found", requestId),
						StatusCode: 404,
					}, nil
				}
			}
		}

		select {
		case <-timeoutCtx.Done():
			return timedOut(), nil
		case <-ticker.C:
		}
	}
}

// CheckStatusAsync runs CheckStatus in the background and reports the result on the
// returned channel, which is closed after a single value is sent.
func (c *Client) CheckStatusAsync(ctx context.Context, requestId string, opts *PollOptions) <-chan AsyncResult {
	out := make(chan AsyncResult, 1)
	go func() {
		defer close(out)
		resp, err := c.CheckStatus(ctx, requestId, opts)
		out <- AsyncResult{Response: resp, Err: err}
	}()
	return out
}

// ExecuteFlowPoll executes a flow and, if it runs asynchronously, polls with
// CheckStatus until it finishes. A realtime flow's response is returned as is.
func (c *Client) ExecuteFlowPoll(ctx context.Context, flowId string, payload interface{}, opts *PollOptions) (*Response, error) {
	resp, err := c.ExecuteFlow(ctx, flowId, payload)
	if err != nil {
		return nil, err
	}
	if requestId, ok := queuedRequestId(resp); ok {
		return c.CheckStatus(ctx, requestId, opts)
	}
	return resp, nil
}

// ExecuteFlowPollAsync runs ExecuteFlowPoll in the background and reports the result
// on the returned channel, which is closed after a single value is sent.
func (c *Client) ExecuteFlowPollAsync(ctx context.Context, flowId string, payload interface{}, opts *PollOptions) <-chan AsyncResult {
	out := make(chan AsyncResult, 1)
	go func() {
		defer close(out)
		resp, err := c.ExecuteFlowPoll(ctx, flowId, payload, opts)
		out <- AsyncResult{Response: resp, Err: err}
	}()
	return out
}

// queuedRequestId returns the request ID of a run that was queued rather than
// executed. An async flow answers at once with result {requestId} and nothing
// else; a realtime flow's result also carries requestId, but next to its own
// fields.
func queuedRequestId(resp *Response) (string, bool) {
	if resp.Status != StatusSuccess || len(resp.Result) != 1 {
		return "", false
	}
	requestId, ok := resp.Result["requestId"].(string)
	return requestId, ok && requestId != ""
}
