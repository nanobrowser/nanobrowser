# System Patterns: Nanobrowser

## System Architecture

Nanobrowser follows a Chrome extension architecture with a multi-agent system design and MCP integration. The core architecture includes:

### 1. Extension Structure
- **Background Script**: Manages the core extension functionality and agent system
- **Content Scripts**: Interact with web pages for DOM manipulation and extraction
- **Side Panel**: Provides the user interface for interacting with the agent system
- **Options Page**: Allows configuration of LLM providers and agent models
- **Native Messaging Host**: Provides MCP services to external AI systems

### 2. Multi-Agent System
The extension employs a collaborative multi-agent architecture:

```mermaid
graph TD
    User[User] --> |Issues task| SidePanel[Side Panel]
    SidePanel --> |Delegates task| Planner[Planner Agent]
    Planner --> |Creates subtasks| Navigator[Navigator Agent]
    Navigator --> |Executes actions| Browser[Browser Context]
    Browser --> |Returns results| Navigator
    Navigator --> |Reports completion| Validator[Validator Agent]
    Validator --> |Verifies results| SidePanel
    SidePanel --> |Presents results| User
```

- **Planner Agent**: Responsible for task decomposition and strategy development
- **Navigator Agent**: Executes browser interactions and interprets web content
- **Validator Agent**: Verifies task completion and result accuracy

### 3. MCP Integration System
The MCP SEE (Surface Extension Environments) service architecture:

```mermaid
graph TD
    A[Chrome Extension] ---> B[Native Messaging Interface]
    B <---> C[Native Host Application]
    C ---> D[MCP Server Implementation]
    D ---> E1[Browser Resources]
    D ---> E2[Browser Operation Tools]
    
    F[External AI Systems] ---> C
    
    subgraph "Chrome Browser"
        A
        B
    end
    
    subgraph "Local Machine"
        C
        D
        E1
        E2
    end
```

- **Chrome Extension**: Captures browser state and executes operations
- **Native Messaging Host**: Provides communication channel and MCP server implementation
- **MCP Server**: Exposes browser capabilities through standardized protocol
- **External AI Systems**: Can access browser state and operations via MCP

### 4. Communication Flow
- **User → Extension**: Via the side panel interface
- **Between Agents**: Through structured message passing
- **Extension → Web Page**: Via content scripts and browser APIs
- **Agent → LLM**: Through configured provider APIs
- **Extension → Native Host**: Via Chrome Native Messaging protocol
- **External AI → Browser**: Via MCP resources and tools

## Key Technical Decisions

### 1. Multi-Package Monorepo Structure
Nanobrowser uses a monorepo approach with pnpm workspaces, separating functionality into distinct packages:

- **Chrome Extension**: The main extension implementation
- **UI Package**: Shared UI components
- **Storage Package**: Data persistence mechanisms
- **I18n Package**: Internationalization support
- **HMR Package**: Hot module replacement for development
- **Schema Utils**: Schema validation utilities
- **Dev Utils**: Development utilities

This structure enables better code organization, reuse, and targeted testing.

### 2. Browser Extension Framework
Leveraging Vite for modern bundling and Chrome Extension API for browser integration, providing:

- Fast HMR during development
- Efficient bundling for production
- Access to browser APIs for automation

### 3. Agent System Design
- **Prompt Engineering**: Specialized prompts for different agent roles
- **Context Management**: Maintaining and passing relevant context between agents
- **Task Decomposition**: Breaking complex tasks into manageable steps

### 4. LLM Provider Integration
- **Provider Abstraction**: Consistent interface across different LLM providers
- **Model Selection**: Flexible assignment of models to different agents
- **Efficient Prompting**: Minimizing token usage while maximizing effectiveness

## Design Patterns in Use

### 1. Observer Pattern
Used for event handling and updates between different parts of the extension:
- Background script observes tab changes and browser events
- UI components observe state changes for rendering updates

### 2. Factory Pattern
Implemented for creating agent instances with appropriate configuration:
- Agent factory creates agents with specific roles
- Provider factory creates appropriate LLM provider connectors

### 3. Strategy Pattern
Applied to allow interchangeable algorithms:
- Different navigation strategies based on website structure
- Alternative validation approaches based on task type

### 4. Command Pattern
Used for encapsulating browser automation actions:
- Click commands
- Scroll commands
- Form input commands
- Navigation commands

### 5. Adapter Pattern
Implemented for LLM provider integration:
- Unified interface for different LLM APIs
- Translation between provider-specific responses and internal formats

## Component Relationships

### 1. Extension Components

```mermaid
graph TD
    Background[Background Script] --> |Manages| Agents[Agent System]
    Background --> |Configures| ContentScripts[Content Scripts]
    ContentScripts --> |Manipulates| WebPage[Web Page DOM]
    SidePanel[Side Panel] --> |User Interface| Background
    OptionsPage[Options Page] --> |Configures| Storage[Storage]
    Background --> |Reads| Storage
    Background --> |Connects to| NativeMessaging[Native Messaging Host]
    NativeMessaging --> |Implements| McpServer[MCP Server]
```

### 2. MCP Components

```mermaid
graph TD
    NativeHost[Native Messaging Host] --> |Contains| McpServer[MCP Server]
    McpServer --> |Exposes| Resources[Browser Resources]
    McpServer --> |Exposes| Tools[Browser Operation Tools]
    
    Resources --> CurrentState[Current Browser State]
    Resources --> DomStructure[DOM Structure]
    Resources --> TabsList[Tabs List]
    
    Tools --> Navigation[Navigation Tools]
    Tools --> ElementInteraction[Element Interaction Tools]
    Tools --> TabManagement[Tab Management Tools]
    
    NativeHost <--> |Communicates with| Extension[Chrome Extension]
    NativeHost <--> |Serves| ExternalAI[External AI Systems]
```

### 3. Package Dependencies

```mermaid
graph TD
    ChromeExtension[Chrome Extension] --> UI[UI Package]
    ChromeExtension --> Storage[Storage Package]
    ChromeExtension --> I18n[I18n Package]
    UI --> TailwindConfig[Tailwind Config]
    Storage --> SchemaUtils[Schema Utils]
    ChromeExtension --> DevUtils[Dev Utils]
    NativeHost[MCP Native Host] --> McpSdk[MCP SDK]
```

### 3. Agent Interaction Model

```mermaid
graph TD
    subgraph "Task Initialization"
        TaskInput[User Task Input] --> TaskIdGen[Generate Task ID]
        TaskIdGen --> ExecutorInit[Initialize Executor]
        ExecutorInit --> AgentInit[Initialize Agents]
        AgentInit --> ContextInit[Create Shared Context]
        ContextInit --> MessageInit[Initialize Message History]
    end
    
    subgraph "Execution Loop"
        ExecutionStart[Begin Execution Loop] --> CheckStop{Should Stop?}
        CheckStop -->|No| PlanCheck{Planning Needed?}
        PlanCheck -->|Yes| PlanGeneration[Planner Analyzes & Creates Plan]
        PlanCheck -->|No| SkipPlan[Skip Planning]
        
        PlanGeneration --> PlanDone{Task Done?}
        SkipPlan --> Navigate[Navigator Executes Actions]
        
        PlanDone -->|No| Navigate
        Navigate --> NavDone{Navigation Done?}
        NavDone -->|No| CheckStop
        NavDone -->|Yes| Validate[Validator Verifies Result]
        
        Validate --> IsValid{Is Valid?}
        IsValid -->|Yes| TaskComplete[Task Complete]
        IsValid -->|No| ValidatorFail[Mark Validation Failed]
        ValidatorFail --> CheckStop
        
        CheckStop -->|Yes| CheckReason{Reason for Stop}
    end
    
    subgraph "Event System"
        Navigate -.->|Emits Events| EventSystem[Event Manager]
        PlanGeneration -.->|Emits Events| EventSystem
        Validate -.->|Emits Events| EventSystem
        EventSystem -.->|Updates UI| SidePanel[Side Panel]
    end
    
    subgraph "Completion States"
        CheckReason -->|Max Steps| MaxSteps[Max Steps Reached]
        CheckReason -->|User Cancel| Cancelled[Task Cancelled]
        CheckReason -->|Max Failures| TooManyFailures[Too Many Failures]
        CheckReason -->|Valid Result| Success[Task Successful]
        
        MaxSteps --> FinalEvent[Final Event Emission]
        Cancelled --> FinalEvent
        TooManyFailures --> FinalEvent
        Success --> FinalEvent
        TaskComplete --> Success
    end
    
    FinalEvent --> Cleanup[Resource Cleanup]
    Cleanup --> End[End Task Execution]
```

## Critical Implementation Paths

### 0. MCP Integration Path

1. **Native Messaging Setup**:
   - Native Host manifest registered with Chrome
   - Chrome extension connects to Native Host
   - Message protocol established for bidirectional communication

2. **Browser State Capture**:
   - Current browser state is monitored and captured
   - DOM structure is serialized
   - Tab information is tracked
   - State is transmitted to Native Host

3. **MCP Server Implementation**:
   - Server instance created with MCP SDK
   - Browser resources defined and registered
   - Browser tools defined with schemas
   - Resource and tool handlers implemented

4. **Resource Exposure**:
   - Browser state exposed as MCP resources
   - DOM structure provided as structured resource
   - Tab information exposed through standardized endpoints

5. **Tool Implementation**:
   - Browser operations mapped to MCP tools
   - Tool requests validated against schemas
   - Tool actions executed in browser context
   - Results returned in standardized format

6. **Error Handling**:
   - Message protocol errors handled
   - MCP request errors processed
   - Browser action errors managed
   - Results communicated back with appropriate status

### 1. Task Execution Flow
1. **Task Reception**:
   - User inputs task in side panel
   - Task ID is generated and stored
   - Executor is initialized with appropriate LLM models

2. **Executor Setup**:
   - MessageManager is initialized for agent communication
   - EventManager is created for event handling
   - AgentContext is established as shared environment
   - Agent prompts are configured for each role
   - Navigator action registry is populated with browser operations

3. **Execution Loop**:
   - System checks if execution should stop (paused, cancelled, etc.)
   - On each Nth step (based on planningInterval) or after validation failure:
     - Planner agent analyzes context and generates plan
     - Plan may indicate task completion or next steps
   - If task is not complete:
     - Navigator executes appropriate browser actions
     - Browser state is updated and recorded
   - If Navigator indicates task completion:
     - Validator agent verifies the result
     - If invalid, planning restarts with validation insight
     - If valid, task is marked complete

4. **Completion Handling**:
   - Success event emitted if task is validated as complete
   - Failure event emitted if maximum steps or failures are reached
   - Cancel event emitted if user manually stops execution
   - All browser resources are cleaned up
   - Results presented to user with follow-up capability

### 2. LLM Integration Path
1. **Model Configuration**:
   - Provider and model configuration retrieved from storage
   - Different models can be assigned to different agents:
     - Navigator model for interactive browser operations
     - Planner model for strategic planning
     - Validator model for result verification
     - Extractor model for content extraction

2. **Agent Request Preparation**:
   - Current context gathered including:
     - Task description
     - Current browser state (DOM, visual elements)
     - Action history
     - Previous agent outputs
   - Context combined with agent-specific prompt template

3. **LLM Request Processing**:
   - Request formatted according to provider API requirements
   - API call made with appropriate authentication
   - Response received and parsed
   - Error handling for authentication failures, rate limits, etc.

4. **Result Interpretation**:
   - Structured output parsed according to expected schema
   - For Navigator: Action commands extracted and validated
   - For Planner: Task decomposition and next steps identified
   - For Validator: Completion validation results processed

### 3. Browser Automation Path
1. **Action Selection**:
   - Navigator agent determines required action (from 17 available operations)
   - Action input is validated against expected schema
   - Action intent is recorded for transparency

2. **Action Execution**:
   - Appropriate browserContext method is called
   - For element interaction:
     - Elements are identified by numeric index
     - Element properties are extracted from DOM state
     - Appropriate Puppeteer calls are made to interact with elements
   - For navigation:
     - URLs are processed and validated
     - Navigation is performed with timeout handling
   - For content extraction:
     - Page state is captured
     - Content is processed according to extraction goals

3. **Result Processing**:
   - Action result is captured in standardized format
   - Success/failure is determined and recorded
   - Extracted content is preserved for context
   - Event is emitted for user visibility

4. **State Management**:
   - Updated page state is captured after action
   - New element indices are calculated for changed DOM
   - Tab state is tracked for multi-tab operations
   - Visual state is captured for vision-based operations

5. **Error Handling**:
   - Action-specific errors are caught and processed
   - Retry mechanisms engaged for transient failures
   - Consecutive failure count tracked against threshold
   - Graceful degradation for unavailable elements

### 4. Navigator Action System

The Navigator agent can execute 17 distinct browser operations:

```mermaid
graph TD
    subgraph "Navigation Actions"
        go_to_url["go_to_url: Navigate to URL"]
        search_google["search_google: Google search"]
        go_back["go_back: Return to previous page"]
        wait["wait: Pause execution"]
    end
    
    subgraph "Element Interaction"
        click_element["click_element: Click by index"]
        input_text["input_text: Enter text in field"]
        get_dropdown_options["get_dropdown_options: List options"]
        select_dropdown_option["select_dropdown_option: Select from dropdown"]
    end
    
    subgraph "Tab Management"
        open_tab["open_tab: Open URL in new tab"]
        switch_tab["switch_tab: Change active tab"]
        close_tab["close_tab: Close tab by ID"]
    end
    
    subgraph "Page Navigation"
        scroll_down["scroll_down: Scroll page down"]
        scroll_up["scroll_up: Scroll page up"] 
        scroll_to_text["scroll_to_text: Find and scroll to text"]
    end
    
    subgraph "Special Actions"
        cache_content["cache_content: Store findings"]
        send_keys["send_keys: Send keyboard input"]
        done["done: Mark task complete"]
    end
    
    Navigator["Navigator Agent"] --> Navigation["Select Action Based on Context"]
    Navigation --> go_to_url & search_google & go_back & wait
    Navigation --> click_element & input_text & get_dropdown_options & select_dropdown_option
    Navigation --> open_tab & switch_tab & close_tab
    Navigation --> scroll_down & scroll_up & scroll_to_text
    Navigation --> cache_content & send_keys & done
```

This system architecture and these patterns provide the foundation for Nanobrowser's implementation, guiding development decisions and ensuring consistent design across the project. The detailed understanding of execution flow, agent communication, and browser automation capabilities enables effective development and troubleshooting.
