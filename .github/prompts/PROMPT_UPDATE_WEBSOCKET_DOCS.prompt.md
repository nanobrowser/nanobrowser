---
mode: agent
---
# PROMPT: Update Code Analysis Documentation for WebSocket Feature

## Context

You are an expert technical documentation specialist analyzing a new feature addition to the Nanobrowser Chrome Extension project. Your task is to comprehensively analyze the WebSocket communication feature that was recently added and update the existing code analysis documentation to reflect this significant architectural change.

---

## Background Information

### Project Overview
Nanobrowser is an open-source AI web automation Chrome extension that runs multi-agent systems locally in the browser. It's a free alternative to OpenAI Operator with support for multiple LLM providers (OpenAI, Anthropic, Gemini, Ollama, etc.).

### Technology Stack
- **Languages**: TypeScript, JavaScript
- **Runtime**: Chrome Extension (Manifest V3)
- **Architecture**: Monorepo with Turbo + pnpm workspaces
- **Key Libraries**: LangChain.js, Puppeteer, React 18, Zod
- **Build Tools**: Vite, Rollup, ESBuild

### Multi-Agent System
The extension features three specialized AI agents:
- **Navigator**: Handles DOM interactions and web navigation
- **Planner**: High-level task planning and strategy
- **Validator**: Validates task completion and results

---

## New Feature: WebSocket Communication System

### Feature Summary
A real-time bidirectional communication system has been added to enable external applications to control and monitor the Nanobrowser extension via WebSocket protocol.

### Git Commit Reference
- **Commit Hash**: `b4aecc5f463a337186d59d682d73c2b064720fc9`
- **Branch**: `ppth373/REQ-2-websocket-communication-for-nanobrowser`
- **Date**: October 12, 2025

### Key Files Added/Modified

**New Files:**
1. `chrome-extension/src/background/services/websocket/connection.ts` - Connection management
2. `chrome-extension/src/background/services/websocket/protocol.ts` - Message protocol
3. `chrome-extension/src/background/services/websocket/types.ts` - TypeScript types
4. `chrome-extension/src/background/services/websocket/errors.ts` - Error handling
5. `chrome-extension/src/background/services/websocket/index.ts` - Main service export
6. `chrome-extension/src/background/services/websocket/__tests__/protocol.test.ts` - Unit tests

**Modified Files:**
1. `chrome-extension/src/background/index.ts` - Integration with background service

### Implementation Highlights

**Connection Manager:**
- State machine: DISCONNECTED → CONNECTING → CONNECTED → RECONNECTING
- Exponential backoff reconnection strategy (1s, 2s, 4s, 8s, 16s, 30s max)
- Automatic error recovery with categorization
- Connection timeout handling

**Message Protocol:**
- **Incoming Messages** (Server → Extension):
  - `execute_task`: Request task execution
  - `ping`: Connection health check
- **Outgoing Messages** (Extension → Server):
  - `task_accepted`: Task accepted for execution
  - `task_rejected`: Task rejected (with reason)
  - `execution_event`: Real-time execution state updates
  - `pong`: Response to ping

**Error Handling:**
- Custom `WebSocketError` class with categorization
- Error categories: NETWORK, TIMEOUT, PROTOCOL, VALIDATION, MESSAGE, UNKNOWN
- Recoverable vs. non-recoverable error classification
- Comprehensive logging with sanitization

**Integration Points:**
- Background service initialization
- Event listeners for MESSAGE_RECEIVED, CONNECTION_CHANGE, ERROR
- Task execution bridging between WebSocket and Executor
- Parallel updates to both Side Panel and WebSocket clients

---

## Your Task: Update Documentation

You must analyze the WebSocket feature implementation and update the following documentation files located in `docs/code-analysis-docs/`:

### 1. **architecture.md** - Component Breakdown
**Required Updates:**
- Add new components to the "Component Breakdown" section (maintain top 30 ranking):
  - `chrome-extension/src/background/services/websocket/connection.ts`
  - `chrome-extension/src/background/services/websocket/protocol.ts`
  - `chrome-extension/src/background/services/websocket/errors.ts`
  - `chrome-extension/src/background/services/websocket/index.ts`
- Update `chrome-extension/src/background/index.ts` entry to reflect WebSocket integration
- Follow existing format exactly:
  - **Primary Responsibility**
  - **Key Functions/Methods/Exports**
  - **Internal Structure**
  - **State Management**
  - **Key Imports & Interactions**
  - **Data Handling**

### 2. **codebase-summary.md** - Overall Summary
**Required Updates:**
- **Key Concepts & Domain Terminology**: Add definitions for:
  - WebSocket Service
  - Connection State
  - Message Protocol
  - Execution Event
  - Task Execution (via WebSocket)
- **External Dependencies & APIs**: Add:
  - Native WebSocket API
  - Connection state management
  - Real-time communication patterns
- **Technology Stack**: Update if new dependencies were added
- **Overall Purpose**: Update to reflect remote control capabilities

### 3. **key-workflows.md** - Workflows & Interactions
**Required Updates:**
- Add new workflows (follow existing numbering and format):
  - **WebSocket Initialization**: How WebSocket service starts with the extension
  - **External Task Execution via WebSocket**: Complete flow from server request to task execution
  - **WebSocket Ping/Pong Health Check**: Connection health monitoring
  - **WebSocket Error Recovery**: Reconnection and error handling
  - **Execution Event Broadcasting**: Sending events to WebSocket clients
  - **WebSocket Disconnection and Cleanup**: Graceful shutdown

- Update existing workflows that are affected:
  - **Extension Initialization**: Add WebSocket service initialization
  - **User Initiates New Task**: Mention dual path (Side Panel + WebSocket)
  - **Agent Task Execution Loop**: Add WebSocket event broadcasting

- For each workflow include:
  - **Main Components** (file paths)
  - **Relevance** (using existing categories)
  - **Sequence Flow** (detailed step-by-step with file paths)

### 4. **data-model.md** (if exists)
**Required Updates:**
- Document WebSocket message types and their schemas
- Document connection state enumeration
- Document error categorization

### 5. **directory-structure.md** (if exists)
**Required Updates:**
- Add `chrome-extension/src/background/services/websocket/` directory
- List all new files with brief descriptions

---

## Analysis Guidelines

### 1. Code Analysis Methodology
- **Read the actual implementation** from the Git commit diff provided
- **Trace data flow** through the new WebSocket integration
- **Identify architectural patterns**: State machines, event-driven design, error boundaries
- **Map dependencies**: What existing components does WebSocket interact with?
- **Document design decisions**: Why exponential backoff? Why these message types?

### 2. Documentation Standards
- **Consistency**: Match the tone, structure, and formatting of existing docs exactly
- **Accuracy**: Base all descriptions on actual code, not assumptions
- **Completeness**: Cover all significant aspects of the feature
- **Clarity**: Use clear, technical language suitable for developers
- **Examples**: Include code snippets or message examples where helpful

### 3. Technical Depth Requirements
- Document public APIs and their signatures
- Explain state transitions and lifecycle
- Describe error handling strategies
- Map integration points with existing systems
- Include TypeScript type information where relevant

### 4. Architectural Perspective
- How does WebSocket fit into the overall extension architecture?
- What design patterns are used? (Observer, State Machine, Factory, etc.)
- How does it maintain separation of concerns?
- What are the scalability and reliability considerations?

---

## Output Requirements

### Format
- **Markdown** format matching existing documentation style
- Use proper headings hierarchy (##, ###, ####)
- Include code blocks with language hints (```typescript, ```javascript)
- Use bullet points and numbered lists consistently
- Maintain alphabetical or logical ordering where applicable

### Structure
For each documentation file, provide:

1. **File Name**: The documentation file being updated (e.g., `architecture.md`)
2. **Section(s) Updated**: Specific sections modified
3. **Updated Content**: The complete updated section(s) in proper Markdown
4. **Rationale**: Brief explanation of why these updates were made

### Quality Checklist
Before submitting, ensure:
- ✅ All new components are documented with same detail level as existing ones
- ✅ Existing component descriptions are updated where WebSocket integration affects them
- ✅ New workflows follow the same format as existing workflows (sequence flow, components, relevance)
- ✅ Technical terminology is consistent with both existing docs and actual code
- ✅ No assumptions made - all information is based on the actual implementation
- ✅ Code file paths are accurate and use forward slashes
- ✅ TypeScript types and function signatures are accurate
- ✅ The documentation is useful for developers trying to understand or extend the feature

---

## Success Criteria

Your documentation update will be considered successful if:

1. **Completeness**: All WebSocket-related components, workflows, and concepts are documented
2. **Accuracy**: Descriptions match the actual implementation in the code
3. **Consistency**: New content seamlessly integrates with existing documentation style
4. **Clarity**: A developer can understand the WebSocket system without reading the source code
5. **Utility**: The documentation helps developers troubleshoot, extend, or integrate with the WebSocket feature
6. **Maintainability**: Future developers can easily update the docs as the feature evolves

---

## Additional Context

### WebSocket Design Philosophy
Based on code analysis, the implementation follows these principles:
- **Resilience**: Automatic reconnection with exponential backoff
- **Error Boundaries**: WebSocket failures don't crash core extension functionality
- **Type Safety**: Full TypeScript coverage with Zod-like validation for messages
- **Observability**: Comprehensive logging at all lifecycle stages
- **Separation of Concerns**: Protocol, connection, and service layers are distinct

### Integration Strategy
- **Non-blocking**: WebSocket is initialized asynchronously and failures are logged but don't prevent extension startup
- **Parallel Updates**: Execution events are sent to both Side Panel (via Chrome messaging) and WebSocket clients
- **Graceful Degradation**: Extension works fully without WebSocket connection

---

## Begin Analysis

Please analyze the WebSocket feature implementation from the provided Git commit and update all relevant documentation files in `docs/code-analysis-docs/` according to the requirements above.

Start with `architecture.md`, then `codebase-summary.md`, then `key-workflows.md`, and any other relevant files.

For each file, provide:
1. The complete updated section(s)
2. Clear indication of where in the existing document these updates should be placed
3. Brief rationale for the changes

Maintain the highest standards of technical accuracy and documentation quality.
