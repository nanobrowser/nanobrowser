# MCP Host Go Makefile

# Variables
BINARY_NAME=mcp-host
BUILD_DIR=bin
INSTALL_DIR=$(HOME)/.nanobrowser/bin
MANIFEST_DIR=$(HOME)/.config/google-chrome/NativeMessagingHosts
MANIFEST_NAME=dev.nanobrowser.mcp.host.json
MANIFEST_SOURCE=manifest/$(MANIFEST_NAME)

# Go parameters
GOCMD=go
GOBUILD=$(GOCMD) build
GOCLEAN=$(GOCMD) clean
GOTEST=$(GOCMD) test
GOGET=$(GOCMD) get
GOMOD=$(GOCMD) mod
GOVET=$(GOCMD) vet
GOLINT=golangci-lint

# Build flags
LDFLAGS=-ldflags "-s -w"
BUILD_FLAGS=-trimpath

# Colors
GREEN=\033[0;32m
YELLOW=\033[1;33m
RED=\033[0;31m
NC=\033[0m  # No Color

# Default target
.PHONY: help
help:
	@echo "MCP Host Go Makefile"
	@echo "--------------------"
	@echo "Available targets:"
	@echo "  make build                    - Build the MCP host binary"
	@echo "  make install                  - Build and install the MCP host"
	@echo "  make uninstall                - Remove the MCP host"
	@echo "  make clean                    - Remove build artifacts"
	@echo "  make test                     - Run unit tests"
	@echo "  make test-integration         - Run integration tests"
	@echo "  make test-integration-verbose - Run integration tests with verbose output"
	@echo "  make test-integration-clean   - Run integration tests and clean artifacts"
	@echo "  make test-integration-coverage- Run integration tests with coverage"
	@echo "  make lint                     - Run linter"
	@echo "  make vet                      - Run Go vet"
	@echo "  make deps                     - Download dependencies"
	@echo "  make tidy                     - Tidy Go modules"
	@echo "  make all                      - Clean, build, and test"
	@echo "  make help                     - Show this help message"

# Create build directory
$(BUILD_DIR):
	mkdir -p $(BUILD_DIR)

# Build the binary
.PHONY: build
build: $(BUILD_DIR)
	@echo "${GREEN}Building MCP host binary...${NC}"
	$(GOBUILD) $(BUILD_FLAGS) $(LDFLAGS) -o $(BUILD_DIR)/$(BINARY_NAME) ./cmd/mcp-host
	@echo "${GREEN}Binary built at $(BUILD_DIR)/$(BINARY_NAME)${NC}"

# Install the MCP host
.PHONY: install
install: build
	@echo "${GREEN}Installing MCP host...${NC}"
	./install.sh
	@echo "${GREEN}Installation completed successfully!${NC}"

# Uninstall the MCP host
.PHONY: uninstall
uninstall:
	@echo "${YELLOW}Uninstalling MCP host...${NC}"
	./uninstall.sh
	@echo "${GREEN}Uninstallation completed successfully!${NC}"

# Clean build artifacts
.PHONY: clean
clean:
	@echo "${YELLOW}Cleaning build artifacts...${NC}"
	$(GOCLEAN)
	rm -rf $(BUILD_DIR)
	@echo "${GREEN}Cleaned build artifacts${NC}"

# Run tests
.PHONY: test
test:
	@echo "${GREEN}Running tests...${NC}"
	$(GOTEST) -v ./...

# Run integration tests
.PHONY: test-integration
test-integration: build
	@echo "${GREEN}Running integration tests...${NC}"
	cd tests/integration && $(GOTEST) -v -timeout=5m ./...

# Run integration tests with verbose output
.PHONY: test-integration-verbose
test-integration-verbose: build
	@echo "${GREEN}Running integration tests with verbose output...${NC}"
	cd tests/integration && $(GOTEST) -v -timeout=5m -args -test.v ./...

# Clean up test artifacts and run integration tests
.PHONY: test-integration-clean
test-integration-clean: test-integration
	@echo "${GREEN}Cleaning up test artifacts...${NC}"
	rm -rf /tmp/mcp-host-test*

# Run integration tests with coverage
.PHONY: test-integration-coverage
test-integration-coverage: build
	@echo "${GREEN}Running integration tests with coverage...${NC}"
	cd tests/integration && $(GOTEST) -v -timeout=5m -coverprofile=coverage.out ./...
	cd tests/integration && go tool cover -html=coverage.out -o coverage.html

# Run linter
.PHONY: lint
lint:
	@echo "${GREEN}Running linter...${NC}"
	$(GOLINT) run

# Run Go vet
.PHONY: vet
vet:
	@echo "${GREEN}Running Go vet...${NC}"
	$(GOVET) ./...

# Download dependencies
.PHONY: deps
deps:
	@echo "${GREEN}Downloading dependencies...${NC}"
	$(GOGET) -u ./...
	$(GOMOD) tidy

# Tidy Go modules
.PHONY: tidy
tidy:
	@echo "${GREEN}Tidying Go modules...${NC}"
	$(GOMOD) tidy

# Build for multiple platforms
.PHONY: build-all
build-all: $(BUILD_DIR)
	@echo "${GREEN}Building for multiple platforms...${NC}"
	GOOS=linux GOARCH=amd64 $(GOBUILD) $(BUILD_FLAGS) $(LDFLAGS) -o $(BUILD_DIR)/$(BINARY_NAME)-linux-amd64 ./cmd/mcp-host
	GOOS=darwin GOARCH=amd64 $(GOBUILD) $(BUILD_FLAGS) $(LDFLAGS) -o $(BUILD_DIR)/$(BINARY_NAME)-darwin-amd64 ./cmd/mcp-host
	GOOS=windows GOARCH=amd64 $(GOBUILD) $(BUILD_FLAGS) $(LDFLAGS) -o $(BUILD_DIR)/$(BINARY_NAME)-windows-amd64.exe ./cmd/mcp-host
	@echo "${GREEN}Binaries built in $(BUILD_DIR)/ directory${NC}"

# Build, test, and lint
.PHONY: all
all: clean build test
	@echo "${GREEN}All tasks completed successfully!${NC}"

# Run the binary
.PHONY: run
run: build
	@echo "${GREEN}Running MCP host...${NC}"
	./$(BUILD_DIR)/$(BINARY_NAME)
