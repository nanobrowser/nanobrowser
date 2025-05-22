# Product Context: Algonius Browser

## Why Algonius Browser Exists

Algonius Browser is a fork of Nanobrowser created to address several key needs in the AI web automation space:

1. **Accessibility Gap**: Premium web automation tools like OpenAI Operator are expensive ($200/month), putting them out of reach for many users. Algonius Browser provides these capabilities at no cost, with users only paying for their own API usage.

2. **Privacy Concerns**: Many existing solutions send user data to cloud services, creating privacy risks. Algonius Browser runs entirely in the local browser, keeping sensitive information and credentials on the user's device.

3. **Limited LLM Flexibility**: Most tools lock users into specific LLM providers. Algonius Browser allows users to choose from multiple providers (OpenAI, Anthropic, Gemini, Ollama) and to assign different models to different agents based on their needs.

4. **Closed-Source Limitations**: Many web automation tools are closed-source, creating a "black box" that users can't inspect, modify, or extend. Algonius Browser is fully open-source, enabling transparency and community contribution.

5. **Need for Specialized Agents**: Web automation benefits from specialized agents working in coordination. Algonius Browser's multi-agent architecture allows for more effective task delegation and execution.

6. **MCP Integration Focus**: Algonius Browser has a focused mission on exposing browser capabilities to external AI systems through the Model Context Protocol (MCP), providing a standardized interface for browser automation.

## Problems Algonius Browser Solves

### For Users
- **Automates Repetitive Web Tasks**: Reduces time spent on manual browsing, data collection, and information extraction.
- **Provides AI Assistance Within Browser**: Offers contextual AI help without leaving the current browsing session.
- **Balances Cost and Performance**: Allows users to choose appropriate models for their budget and needs.
- **Preserves Privacy**: Keeps sensitive data local rather than sending it to external servers.
- **Creates Accessible AI Tools**: Makes advanced AI capabilities available without subscription costs.

### For Developers
- **Offers Open Platform for Extension**: Provides a foundation for building more specialized web automation tools.
- **Demonstrates Multi-Agent Architecture**: Shows practical implementation of agent collaboration systems.
- **Promotes Transparency**: Open-source nature allows for code inspection and security validation.
- **Enables Community Collaboration**: Creates opportunity for shared development and improvement.
- **Provides Standardized Browser Access**: Exposes browser capabilities through MCP for integration with external AI systems.

## How Algonius Browser Should Work

Algonius Browser functions through a collaborative multi-agent system:

1. **User Interaction Flow**:
   - User installs Chrome extension
   - User configures LLM providers and assigns models to agents
   - User opens the side panel and issues a task in natural language
   - Agents collaborate to complete the task while providing status updates
   - Results are presented in the side panel with option for follow-up questions

2. **External AI Integration Flow**:
   - External AI system connects to Algonius Browser via MCP protocol
   - Browser state is exposed as MCP resources (DOM, tabs, etc.)
   - Browser operations are exposed as MCP tools
   - External AI can browse and automate tasks while maintaining local privacy
   - All communication happens via secure Chrome Native Messaging

3. **Agent System Architecture**:
   - **Planner Agent**: Breaks down complex tasks into manageable steps
   - **Navigator Agent**: Executes browser actions and interprets web content
   - **Validator Agent**: Verifies task completion and results accuracy
   - **MCP Server**: Provides standardized access to browser capabilities

4. **Key Operational Principles**:
   - All processing occurs locally in the browser
   - API keys are stored locally and never shared
   - LLM interactions are minimal and purposeful to reduce costs
   - Clear feedback on current status and progress
   - Transparency in agent actions and decision-making
   - Secure communication with external systems via MCP

## User Experience Goals

Algonius Browser aims to deliver a user experience that is:

1. **Intuitive**: Easy to install, configure, and use without technical expertise
2. **Transparent**: Clear visibility into what actions are being taken by agents
3. **Responsive**: Quick feedback and status updates throughout task execution
4. **Flexible**: Adaptable to different user preferences and LLM selections
5. **Trustworthy**: Privacy-preserving and secure handling of sensitive information
6. **Empowering**: Enabling users to accomplish complex web tasks through simple prompts

## Target Use Cases

Algonius Browser is designed to excel at:

1. **Research Automation**:
   - Gathering news and information from multiple sources
   - Collecting and summarizing data from websites
   - Finding and comparing products or services

2. **Workflow Automation**:
   - Executing repetitive sequences of web actions
   - Filling forms and navigating multi-step processes
   - Monitoring websites for specific information

3. **Information Extraction**:
   - Pulling structured data from unstructured web pages
   - Summarizing lengthy articles or documentation
   - Converting web content into organized formats

4. **Learning and Exploration**:
   - Helping users understand complex websites
   - Answering questions about web content in context
   - Guiding users through unfamiliar web interfaces

5. **AI System Integration**:
   - Providing browser capabilities to external AI assistants
   - Enabling specialized AI tools with web browsing abilities
   - Supporting research on autonomous web agents
   - Allowing agent coordination across different systems

This document describes the fundamental why, what, and how of Algonius Browser, providing context for all product decisions and developments.
