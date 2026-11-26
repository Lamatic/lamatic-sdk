module github.com/Lamatic/lamatic-sdk-go

go 1.25.4

require github.com/golang-jwt/jwt/v5 v5.3.0

// v0.1.0 was tagged by mistake on the pre-streaming code, whose go.mod still
// declared the old module path, so it cannot be used. v0.1.1 is the release.
retract v0.1.0
