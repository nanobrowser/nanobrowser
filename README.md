# NanoBrowser

<div align="center">

[![GitHub](https://img.shields.io/badge/GitHub-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/nanobrowser)
[![Twitter](https://img.shields.io/badge/Twitter-000000?style=for-the-badge&logo=x&logoColor=white)](https://x.com/nanobrowser_ai)
[![Discord](https://img.shields.io/badge/Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/NN3ABHggMK)

</div>

Open source multi-agent browser automation tool with built-in Chrome extension. NanoBrowser makes it easy to perform complex browser tasks using natural language commands.

![Demo GIF](https://github.com/user-attachments/assets/94f6e4e6-290d-4b6a-b68e-8ebcf038ded5)

## Features

- 🤖 Multi-agent system for complex web automation tasks
- 🔌 Built-in Chrome extension with chat interface
- 🧠 Natural language commands for browser control
- 💬 Interactive chat sidebar for real-time interaction and status updates

## Quick Start

### Prerequisites

1. **Chrome Browser**:
- Chrome browser installed
- Chrome Extension Management page (`chrome://extensions/`) with "Developer mode" enabled

2. **Python Environment**:
- Python 3.10 or higher

### Installation

1. **Install the Chrome Extension**:
- Open Chrome and go to `chrome://extensions/`
- Enable "Developer mode" (top right)
- Click "Load unpacked" (top left)
- Select the `nanobrowser/extension/src` directory

2. **Install the NanoBrowser Agent Server**:
```bash
# Navigate to nanobrowser directory
cd nanobrowser

# Run installation script
./install.sh
```

> Note: The installation script has only been tested on MacOS. For other platforms, please refer to [uv's official documentation](https://github.com/astral-sh/uv) to install uv and dependencies manually.

3. **Configure API Keys**:

Create a `.env` file in the nanobrowser directory and add your API key. The default LLM provider is OpenAI:
```bash
OPENAI_API_KEY=your_openai_key_here
```

If you want to use Claude (Anthropic), you'll need to modify the provider in `config.yaml` and use:
```bash
ANTHROPIC_API_KEY=your_anthropic_key_here
```

4. **Run NanoBrowser**:
```bash
uv run nanobrowser
```

5. **Stop the extension**:
```bash
uv stop nanobrowser
```

6. **How to install the extension manually**:
```bash
 Open Chrome and go to chrome://extensions/
 Enable "Developer mode" (top right)
 Click "Load unpacked" (top left)
 Select the `nanobrowser/extension/src` directory
```

## Example Tasks

Here are some tasks you can accomplish with NanoBrowser using natural language:

1. **News Extraction**:
   > "Go to TechCrunch and extract top 10 headlines from the last 24 hours"

2. **GitHub Research**:
   > "Look for the trending Python repositories on GitHub with most stars"

3. **Shopping Research**:
   > "Find a portable Bluetooth speaker on Amazon with a water-resistant design, under $50. It should have a minimum battery life of 10 hours"

4. **Recipe Analysis**:
   > "Find a recipe with over 100 reviews for Fried Fish on Allrecipes, list the Full Nutrition Label and tell me the amount of Iron per Serving"

## Roadmap

Here are the key features we're working on:

1. **Standalone Extension**:
   > "Simplify installation by making the Chrome extension work without a backend server"

2. **Enhanced Tab Management**:
   > "Support multiple tabs with context awareness and state synchronization"

3. **Conversation Intelligence**:
   > "Enable natural follow-up questions and preserve context between tasks"

4. **Advanced DOM Analysis**:
   > "Improve interaction with complex web elements like canvas and dynamic content"

---

## Contributing

Contributions are welcome! Feel free to:
- Report bugs
- Suggest new features
- Submit pull requests

## Acknowledgments

Special thanks to these inspiring projects:
- [python-cdp](https://github.com/HMaker/python-cdp)
- [Agent-E](https://github.com/EmergenceAI/Agent-E)
- [fuji-web](https://github.com/normal-computing/fuji-web)

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

Made with ❤️ by the NanoBrowser Team
