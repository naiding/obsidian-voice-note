# Voice Note for Obsidian

Voice Note is a plugin for Obsidian that enables real-time voice transcription directly into your notes. Simply speak, and watch your words appear in your editor instantly.

## Features

- 🎙️ Real-time voice-to-text transcription
- ⚡ Instant text insertion at cursor position
- 🔊 High-quality audio processing with noise suppression
- 🎯 Accurate transcription using OpenAI's Real-time API
- 📱 Simple interface with status indicator
- ⌨️ Easy toggle recording via command palette or toolbar

## Installation

### Mobile Installation
1. Open Obsidian on your mobile device
2. Tap Settings (gear icon)
3. Tap "Community plugins"
4. Tap "Turn on community plugins" if not already enabled
5. Tap "Browse" and search for "Voice Note"
6. Tap "Install"
7. Tap "Enable"

### Desktop Installation
1. Open Obsidian Settings
2. Go to Community Plugins and disable Safe Mode
3. Click Browse and search for "Voice Note"
4. Install the plugin
5. Enable the plugin in your Community Plugins list

### Manual Installation (Advanced)
If you need to install manually (not recommended for most users):
1. Download these three files from the [latest release](https://github.com/naidingzhou/obsidian-voice-note/releases/latest):
   - `main.js`
   - `manifest.json`
   - `styles.css`
2. Create a folder named `voice-note` in your vault's `.obsidian/plugins/` directory
3. Copy the three files into that folder
4. Reload Obsidian
5. Enable the plugin in Settings > Community plugins

## Setup

1. Get an OpenAI API key from [OpenAI's website](https://platform.openai.com)
2. Open Obsidian Settings
3. Go to Voice Note settings
4. Enter your OpenAI API key

## Usage

You can start/stop voice recording in any of these ways:

1. Click/tap the microphone icon in the editor toolbar (available in every note)
2. Use the command palette (Cmd/Ctrl + P on desktop, ⋮ menu on mobile) and search for "Voice Record"

When recording:
1. Speak clearly into your microphone
2. Watch as your speech is transcribed in real-time
3. Click/tap the same button again to stop recording
4. The status bar will show recording duration

The microphone button is consistently placed in the editor toolbar for both desktop and mobile, making it easy to access while writing your notes.

## Requirements

- An active OpenAI API key
- A working microphone
- Obsidian v0.15.0 or higher

## Development

If you want to contribute to the plugin or modify it for your own use:

1. Clone this repository to your local machine
2. Make sure you have [Node.js](https://nodejs.org/) installed (version 16 or higher)
3. Install dependencies:
   ```bash
   npm install
   ```
4. Build the plugin:
   ```bash
   npm run build
   ```
5. For development with hot reload:
   ```bash
   npm run dev
   ```

### Development Tips
- The plugin uses TypeScript and the Obsidian API
- Build artifacts are not committed to the repository
- Use `npm run dev` for development to get hot reload
- Test on both desktop and mobile before submitting PRs

## Support

If you encounter any issues or have suggestions, please visit the [GitHub repository](https://github.com/naidingzhou/obsidian-voice-note) to:
- Report bugs
- Request features
- Contribute to the code

## Author

Created by Naiding Zhou

## License

This project is licensed under the MIT License.
