# Lamatic SDKs

Official SDKs for running [Lamatic](https://lamatic.ai) flows from your own code.

| Language | Install | Docs |
|---|---|---|
| TypeScript / JavaScript | `npm install lamatic` | [typescript/README.md](typescript/README.md) |
| Python | `pip install lamatic` | [python/README.md](python/README.md) |
| Go | `go get github.com/Lamatic/lamatic-sdk/go` | [go/README.md](go/README.md) |

All three offer the same features with the same behaviour. [PARITY.md](PARITY.md)
lists what each one calls things and how they behave.

## Layout

```
typescript/   npm package `lamatic`
python/       PyPI package `lamatic`
go/           Go module github.com/Lamatic/lamatic-sdk/go
fixtures/     recorded API responses shared by the tests
```

## Releases

Each SDK is versioned and released on its own. Push a tag from `main`:

| SDK | Tag | Published to |
|---|---|---|
| TypeScript | `ts/v1.2.3` | npm |
| Python | `py/v1.2.3` | PyPI |
| Go | `go/v1.2.3` | the Go module proxy (the tag is the release) |

Every release tag must match the version in the SDK's own `package.json` or
`pyproject.toml`; the release workflow checks.

## Contributing

A change to the API surface needs all three SDKs updated in the same pull
request, plus [PARITY.md](PARITY.md). Each folder explains how to run its tests.

## License

MIT. See [LICENSE](LICENSE). Each SDK folder carries a copy so it is included in
its published package.
