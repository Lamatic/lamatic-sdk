# SDK parity

Lamatic has three SDKs that must offer the same features with the same behaviour:

- TypeScript: [Lamatic/lamatic-sdk](https://github.com/Lamatic/lamatic-sdk) (npm `lamatic`)
- Python: [Lamatic/Lamatic-Python-SDK](https://github.com/Lamatic/Lamatic-Python-SDK) (PyPI `lamatic`)
- Go: [Lamatic/lamatic-sdk-go](https://github.com/Lamatic/lamatic-sdk-go) (`github.com/Lamatic/lamatic-sdk-go`)

This file is identical in all three repos. A feature is not done until all three
SDKs have it and this table is updated in all three.

## Features

| Feature | TypeScript | Python | Go |
|---|---|---|---|
| Run a flow | `executeFlow` | `execute_flow`, `async_execute_flow` | `ExecuteFlow`, `ExecuteFlowAsync` |
| Run a flow and wait for an async result | `executeFlowPoll` | `execute_flow_poll`, `async_execute_flow_poll` | `ExecuteFlowPoll`, `ExecuteFlowPollAsync` |
| Poll a request ID | `checkStatus` | `check_status`, `async_check_status` | `CheckStatus`, `CheckStatusAsync` |
| Token streaming | `executeFlowTokenStream` | `execute_flow_token_stream`, `async_execute_flow_token_stream` | `ExecuteFlowTokenStream` |
| API key and access token auth | yes | yes | yes |
| Update the access token | `updateAccessToken` | `update_access_token` | `UpdateAccessToken` |

Agents are not supported: the platform's `executeAgent` API is deprecated.

Language-specific extras, which need no counterpart: Go has `Response.Decode` and
a `Logger` hook. TypeScript's legacy `executeFlowStream` is deprecated and will be removed in
1.0.0.

Polling options follow each language's idiom: TypeScript `{ interval, timeout }`
in seconds, Python `poll_interval` / `poll_timeout` in seconds, Go
`*PollOptions{Interval, Timeout}` as `time.Duration`.

## Shared behaviour

**Polling (`checkStatus`, `executeFlowPoll`).** `checkStatus` returns the run's
log record, `{success, status, data: {input, output: {result, tokensInfo}}}`.
Each SDK maps it to its response type the same way:

| API status | SDK status | Result | Message | Status code |
|---|---|---|---|---|
| `in-progress` | keeps polling | | | |
| `success` | `success` | `data.output.result` | | HTTP status |
| `failed` | `failed` | `data.output.result` | `data.output.result.errorMsg` | HTTP status |
| `not-found` | keeps polling for 60 s, then `error` | | `Request <id> was not found` | 404 |
| poll timeout | `error` | | timed-out message, plus the last network error if any | 408 |

A network error or a non-JSON reply (such as a gateway error page) during polling
does not end it: the SDK keeps polling until the timeout. A GraphQL error, such as
a bad API key, ends polling at once with status `error`.

`failed` means the flow ran and a node failed. `error` means the request itself
failed. The SDKs' status types list exactly `success`, `error` and `failed`.

`executeFlowPoll` polls only when `executeFlow` answers with a result that holds
nothing but `requestId`, which is what a queued (async) flow returns. Any other
response is returned unchanged.

**Streaming.** See each SDK's README. All three emit the same `token`, `node`,
`final` and `error` events, and build `final.text` from the token deltas.

## Shared test fixtures

The polling tests in every SDK run against the same recorded API responses:

- TypeScript: `test/fixtures/check-status.json`
- Python: `tests/fixtures/check_status.json`
- Go: `pkg/lamatic/testdata/check_status.json`

Keep the three copies identical. When the API changes, record new responses
once and copy them to all three repos.
