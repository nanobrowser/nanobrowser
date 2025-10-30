# VisibleAI - Accessible Web 

VisibleAI is designed to break down digital barriers and make the web more accessible for everyone. Our AI-powered Chrome extension provides intelligent automation that helps users navigate, interact with, and understand web content more effectively, regardless of their abilities or technical expertise.

## ♿ Accessibility-First Features

- **🗣️ Natural Language Web Navigation** - Control any website using simple, conversational commands
- **🔍 Intelligent Content Discovery** - AI agents automatically identify and highlight important page elements
- **📝 Smart Form Assistance** - Automated form filling with accessibility validation
- **🎯 Focus Management** - Improved keyboard navigation and focus indicators
- **📱 Universal Compatibility** - Works across all websites without requiring special accessibility implementations
- **🧠 Cognitive Load Reduction** - Simplifies complex web interactions into intuitive conversations

## 🌟 Why VisibleAI for Accessibility?

Traditional web accessibility tools require websites to be properly coded with accessibility features. VisibleAI takes a different approach:

- **Universal Access** - Works on any website, even those without proper accessibility implementation
- **Zero Learning Curve** - Natural language interface eliminates the need to learn complex keyboard shortcuts or screen reader commands
- **Adaptive Intelligence** - AI agents learn and adapt to different website layouts and interaction patterns
- **Real-time Assistance** - Provides immediate help and context for any web element or action
- **Cost-Free Solution** - Completely free to use with your own API keys - no subscriptions or hidden costs

## 🚀 How It Works

VisibleAI employs a multi-agent system specifically designed for accessible web automation:

1. **Navigator Agent** - Handles precise web interactions and element identification
2. **Planner Agent** - Breaks down complex tasks into simple, accessible steps
3. **Validator Agent** - Ensures actions complete successfully and provides feedback

Simply tell VisibleAI what you want to do in plain English, and the agents work together to make it happen.

## 🌐 Browser Support

**Officially Supported:**
- **Chrome** - Full support with all accessibility features
- **Edge** - Full support with all accessibility features

**Not Supported:**
- Firefox, Safari, and other Chromium variants (Opera, Arc, etc.)

> **Note**: While VisibleAI may function on other Chromium-based browsers, we recommend using Chrome or Edge for the best accessibility experience and guaranteed compatibility.

## 🚀 Quick Start

### Install from Chrome Web Store (Recommended)

1. **Install the Extension**:
   * Visit the Chrome Web Store page for VisibleAI
   * Click "Add to Chrome" button
   * Confirm the installation when prompted

2. **Configure Your AI Models**:
   * Click the VisibleAI icon in your toolbar to open the sidebar
   * Click the `Settings` icon (top right)
   * Add your LLM API keys
   * Choose which model to use for different agents (Navigator, Planner)

3. **Start Using Natural Language Commands**:
   * Open any website
   * Tell VisibleAI what you want to do in plain English
   * Watch as the AI agents handle the complex interactions for you

### Manual Installation (Latest Features)

To get the most recent accessibility improvements:

1. **Download**:
   * Download the latest `visibleai.zip` file from the [release page](https://github.com/gabe/Workspace/Algoma/research/visible-ai/releases)

2. **Install**:
   * Unzip `visibleai.zip`
   * Open `chrome://extensions/` in Chrome
   * Enable `Developer mode` (top right)
   * Click `Load unpacked` (top left)
   * Select the unzipped `visibleai` folder

3. **Configure**:
   * Follow the configuration steps above

## 🛠️ Build from Source

For developers who want to contribute to accessibility improvements:

1. **Prerequisites**:
   * [Node.js](https://nodejs.org/) (v22.12.0 or higher)
   * [pnpm](https://pnpm.io/installation) (v9.15.1 or higher)

2. **Clone and Build**:
   ```bash
   git clone https://github.com/gabe/Workspace/Algoma/research/visible-ai.git
   cd visible-ai
   pnpm install
   pnpm build
   ```

3. **Load the Extension**:
   * The built extension will be in the `dist` directory
   * Follow the manual installation steps above

4. **Development Mode**:
   ```bash
   pnpm dev
   ```

## 🤖 Accessibility-Optimized Model Configuration

Choose AI models that provide the best accessibility experience:

### Recommended for Accessibility
- **Planner**: Claude Sonnet 4 or GPT-4
  - Superior reasoning for complex accessibility scenarios
  - Better understanding of user intent and context
  
- **Navigator**: Claude Haiku 3.5 or GPT-4o-mini
  - Fast response times for real-time assistance
  - Efficient element identification and interaction

### Cost-Effective Options
- **Local Models**: Use Ollama for complete privacy
  - Zero API costs
  - No data leaving your machine
  - Recommended: Qwen 2.5 Coder 14B, Mistral Small 24B

> **Accessibility Tip**: Local models provide the ultimate privacy for users with sensitive accessibility needs, ensuring all interactions remain completely private.

## 💡 Accessibility Use Cases

Here are some ways VisibleAI can improve web accessibility:

### Navigation Assistance
> "Find the main navigation menu and tell me what options are available"
> "Take me to the contact form and help me fill it out"
> "Show me all the buttons on this page and what they do"

### Content Understanding
> "Summarize the main content of this article for me"
> "Find and read all the error messages on this form"
> "Identify all the interactive elements on this page"

### Task Automation
> "Fill out this job application form with my information"
> "Find products under $50 and sort them by rating"
> "Navigate to my account settings and change my email preferences"

## 🎨 Accessibility Standards

VisibleAI is built with accessibility best practices in mind:

- **WCAG 2.1 AA Compliance** - Interface follows Web Content Accessibility Guidelines
- **Keyboard Navigation** - Full functionality available via keyboard
- **Screen Reader Support** - Compatible with popular screen reading software
- **High Contrast Support** - Readable in high contrast and dark modes
- **Focus Indicators** - Clear visual focus indicators for all interactive elements

## 🤝 Contributing to Accessibility

We welcome contributions that improve web accessibility:

### Ways to Help
- **Test with Assistive Technologies** - Report compatibility issues with screen readers, voice recognition, etc.
- **Accessibility Audits** - Help identify and fix accessibility barriers
- **User Experience Feedback** - Share how VisibleAI helps or could better help your specific accessibility needs
- **Code Contributions** - Submit pull requests for accessibility improvements

### Getting Started
1. Join our community discussions about accessibility improvements
2. Review our accessibility testing guidelines
3. Check out accessibility-related issues in our GitHub repository

## 🔒 Privacy & Security

VisibleAI prioritizes user privacy and security:

- **Local Processing** - All AI interactions happen in your browser
- **No Data Collection** - We don't collect, store, or analyze your browsing data
- **Your API Keys** - Connect directly to AI providers using your own credentials
- **Open Source** - Complete transparency in how your data is handled

## 🛣️ Roadmap

Upcoming accessibility improvements:

- **Voice Control Integration** - Direct voice commands for hands-free navigation
- **Enhanced Screen Reader Support** - Deeper integration with assistive technologies
- **Cognitive Accessibility Features** - Tools to help users with cognitive disabilities
- **Multi-language Support** - Accessibility features in multiple languages
- **Custom Accessibility Profiles** - Personalized settings for different accessibility needs

## 📄 License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

VisibleAI builds upon excellent open-source accessibility and automation projects:

- [Browser Use](https://github.com/browser-use/browser-use)
- [Puppeteer](https://github.com/EmergenceAI/Agent-E)
- [Chrome Extension Boilerplate](https://github.com/Jonghakseo/chrome-extension-boilerplate-react-vite)
- [LangChain](https://github.com/langchain-ai/langchainjs)

This project is a fork of the NanoBrowser extension, enhanced with a focus on web accessibility and inclusive design. We're grateful to the original NanoBrowser team for providing the foundation that made this accessibility-focused version possible.

Special thanks to the accessibility community for their ongoing guidance and feedback.