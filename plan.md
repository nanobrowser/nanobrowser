# Development Guide: Goal-Driven Social-Media AI Agent

This document outlines the phased development plan for evolving the project into a goal-driven social-media “human-worker” AI agent.

## Core Mantras

- Reuse existing features wherever they fit
- Modify only to align with your goals
- Add new pieces when there’s no better alternative
- Gather data passively and invoke LLM “modals” only for heavy-lift planning
- Respect LLM usage & context-length limits

## Phase 1: Reuse-First Policy

Leverage Nanobrowser’s existing capabilities as a foundation.

### 1.1 LLM Pipeline (Planner → Navigator → Validator)
- Keep Nanobrowser’s built-in multi-agent workflow.
- Tweak prompt templates or agent roles to specifically reflect “grow followers” tasks and objectives.

### 1.2 Content-script Automation
- Retain all existing click/scroll/type primitives and human-like delays.
- Extend content-script capabilities only if new UI actions are essential (e.g., “hover to reveal menu”).

### 1.3 Element-Finding via LLM
- Keep the LLM-powered, on-page selector discovery mechanism.
- Implement a one-time caching layer for selectors (details in Phase 3) to minimize redundant LLM calls. Avoid rebuilding selector-training UI from scratch.

### 1.4 Local Data Storage
- Continue using the existing SQLite integration (via the background script).
- Utilize SQLite for storing new caches (e.g., selector cache), logs, and performance metrics.

## Phase 2: Modify-Where-Needed

Adapt existing components when Nanobrowser’s stock behavior doesn’t perfectly align with social media engagement goals.

### 2.1 Action-Sequence Templates
- Add or fine-tune “follow-growth” action sequences (e.g., scan hashtag → follow top contributor → like 3 posts).
- Integrate these new/modified templates into the Planner’s repertoire of available actions.

### 2.2 Goal-Monitoring Hooks
- Introduce new database tables or extend existing ones with columns for tracking key metrics (e.g., “daily_follows_count,” “current_followers,” “weekly_growth_rate”).
- Implement event emitters that trigger a Planner re-evaluation when specific thresholds are met (e.g., 50 follows/day achieved, follower count stagnates for 48 hours).

### 2.3 Error-Recovery Mechanisms
- If an element lookup or action fails repeatedly (e.g., 3 times consecutively):
    - Flag the element/selector for retraining.
    - Implement fallback actions (e.g., “skip to next user/profile,” “try alternative interaction”).

## Phase 3: Hybrid Selector-Training Cache

Optimize selector discovery by caching results and minimizing LLM reliance.

### 3.1 First Encounter with a Page/Component
- The background script checks SQLite: “Do I have validated selectors for this page fingerprint (e.g., URL structure, key static elements)?”
- If no selectors exist:
    - Invoke the Navigator-LLM once with the full page DOM.
    - Task the LLM to extract all required selectors for typical actions on that page type in a single pass.
    - Validate the extracted selectors via the content script (e.g., attempt to locate elements).
    - Persist the validated selectors to SQLite, associated with the page fingerprint.

### 3.2 Subsequent Runs on Similar Pages
- Load selectors directly from the SQLite cache based on the page fingerprint. This should result in zero LLM calls for selector discovery in most cases.
- If a cached selector fails validation (e.g., UI has changed):
    - Trigger a “retrain” process (similar to 3.1) for that specific selector or page.

## Phase 4: Passive Data Gathering & LLM Modal Strategy

Employ a strategy of quiet data collection and judicious LLM invocation.

### 4.1 Passive Metrics Capture
- The content script should silently log relevant data points during browsing and interaction:
    - Follower counts, new followers gained/lost, likes given/received, comments made.
    - Timestamps for actions, page URLs visited, outcomes of automated actions (success/failure).
- Store this data locally in SQLite for later aggregation and analysis.

### 4.2 Batched “Modal” Invocations
- Define two primary types of LLM “modals” (distinct LLM calls with specific purposes):
    - **“Micro-modals”**: Small context, computationally cheaper.
        - Example: Drafting a thank-you comment for a new follower, rephrasing a piece of content.
    - **“Macro-modals”**: Full context, computationally more expensive.
        - Example: “Given my last 24h performance data (followers gained, engagement rate), and current high-level goal (reach X followers), propose tomorrow’s 6-step follow/like strategy focusing on a new niche.”

### 4.3 Trigger Rules for Modals
- **Macro-modals**: Invoke only at defined intervals (e.g., once per day) or when significant events occur (e.g., growth stalls for X period, daily follow limit reached).
- **Micro-modals**: Invoke whenever an interaction requires creative text generation. Cache responses to avoid re-generating similar text.

### 4.4 Context Management for Modals
- Feed only the minimal necessary data into each modal type to respect context-length limits and reduce cost:
    - **Macro-modal context**: Aggregated metrics, current task state, high-level goals, recent error patterns.
    - **Micro-modal context**: Single-action context (e.g., specific post content to comment on, 2-3 prior examples of successful comments).

## Phase 5: Logs, Reports & Human-Worker Rapport

Maintain transparency and provide user control through clear reporting and a relatable agent persona.

### 5.1 Action Log Table
- Every significant action (click, follow, like, comment, message) should be logged to an SQLite table with:
    - Timestamp
    - Selector used (if applicable)
    - Action type
    - Result (success, failure, specific error)
    - Optional LLM rationale (e.g., why a particular user was chosen for interaction).

### 5.2 Error & Retrain Queue
- Collate failed element lookups, action errors, or instances where fallback actions were triggered.
- Make this queue visible in a UI section for quick review and potential manual intervention or prioritization of retraining tasks.

### 5.3 Dashboard & Notifications
- Develop an in-extension popup UI that displays:
    - Today’s follows vs. daily goal.
    - Summary of the last LLM macro-plan.
    - “Agent says” status updates in a human-like, relatable tone (e.g., “Just finished my tasks for #tech enthusiasts, now I’ll focus on #web3 users for a bit.”, “Taking a short break to avoid looking suspicious!”).

### 5.4 User Overrides
- Provide simple one-click controls in the popup UI:
    - “Pause Agent”
    - “Skip This Current Step/User”
    - “Replan Now” (forces a macro-modal invocation)

## Phase 6: Staying Within LLM Limits

Implement strategies to manage LLM usage costs and avoid hitting rate limits.

- **Cache Aggressively**: Cache LLM-generated selectors (Phase 3) and responses from micro-modals (Phase 4.3).
- **Batch Perception/Actions**: When possible, scrape data from multiple profiles on a page (e.g., a list of 20 search results) and then send relevant IDs or minimal data in a single macro call for planning next steps, rather than one call per profile.
- **Trim Context**: Before sending data to an LLM, strip irrelevant HTML tags, attributes, and verbose content. Include only essential metrics, timestamps, and current state.
- **Rotate Modal Types**: Use micro-modals for frequent, small decisions. Reserve macro-modals for less frequent, strategic planning to avoid over-utilizing the more powerful (and expensive) planner model.

## Summary

This project aims to create a sophisticated social-media AI agent by:
- Leaning heavily on Nanobrowser’s existing LLM agents, UI automation primitives, and SQLite storage.
- Enhancing selector robustness and efficiency with a one-time LLM trainer combined with persistent caching.
- Gathering operational data passively and silently in the background.
- Invoking expensive “macro” planning modals sparingly, triggered by data or time.
- Logging all actions and errors for transparency and debugging.
- Surfacing key metrics and agent status through a clear dashboard.
- Allowing user overrides and cultivating a “diligent human worker” persona for the agent.

This hybrid approach is designed to deliver human-stealthy, cost-effective, and goal-aligned social-media automation without reinventing foundational components.
