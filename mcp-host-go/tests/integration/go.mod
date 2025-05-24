module integration

go 1.23

toolchain go1.23.7

require (
	env v0.0.0
	github.com/stretchr/testify v1.9.0
)

require (
	github.com/davecgh/go-spew v1.1.1 // indirect
	github.com/google/uuid v1.6.0 // indirect
	github.com/mark3labs/mcp-go v0.29.0 // indirect
	github.com/pmezard/go-difflib v1.0.0 // indirect
	github.com/spf13/cast v1.7.1 // indirect
	github.com/yosida95/uritemplate/v3 v3.0.2 // indirect
	gopkg.in/yaml.v3 v3.0.1 // indirect
)

replace env => ./env
