package client

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
)

// OpenStream issues a GraphQL request that asks for a text/event-stream
// response. The caller owns resp.Body and must close it. Non-2xx statuses are
// not turned into errors here: the server reports auth failures, rate limits
// and validation errors as plain JSON bodies, which the caller inspects.
func (c *Client) OpenStream(ctx context.Context, query string, variables map[string]interface{}) (*http.Response, error) {
	jsonBody, err := json.Marshal(GraphQLRequest{Query: query, Variables: variables})
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", c.endpoint, bytes.NewBuffer(jsonBody))
	if err != nil {
		return nil, err
	}

	req.Header = c.GetHeaders()
	req.Header.Set("Accept", "text/event-stream")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		c.logf("lamatic: stream request failed: %v", err)
		return nil, err
	}
	return resp, nil
}

// IsEventStream reports whether resp is a Server-Sent Events response.
func IsEventStream(resp *http.Response) bool {
	return strings.Contains(resp.Header.Get("Content-Type"), "text/event-stream")
}

// ReadEvents parses a Server-Sent Events stream and calls handle with the
// joined data field of each event. Comment lines (keep-alives) and fields
// other than data are ignored. Reading stops when handle returns false, at
// EOF, or on a read error.
func ReadEvents(r io.Reader, handle func(data string) bool) error {
	br := bufio.NewReader(r)
	var dataLines []string

	// dispatch reports whether reading should continue.
	dispatch := func() bool {
		if len(dataLines) == 0 {
			return true
		}
		data := strings.Join(dataLines, "\n")
		dataLines = dataLines[:0]
		return handle(data)
	}

	for {
		// ReadString rather than bufio.Scanner: a node's output can exceed
		// Scanner's token limit.
		line, err := br.ReadString('\n')
		if err == nil || line != "" {
			line = strings.TrimRight(line, "\r\n")
			switch {
			case line == "":
				if !dispatch() {
					return nil
				}
			case strings.HasPrefix(line, ":"):
				// Comment, used for keep-alives.
			case strings.HasPrefix(line, "data:"):
				dataLines = append(dataLines, strings.TrimPrefix(strings.TrimPrefix(line, "data:"), " "))
			}
		}
		if err != nil {
			if err == io.EOF {
				dispatch()
				return nil
			}
			return err
		}
	}
}
