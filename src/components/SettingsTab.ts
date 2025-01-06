import { App, PluginSettingTab, Setting } from 'obsidian';
import { VoiceNoteSettings, VoiceNotePlugin } from '../types';

export class VoiceNoteSettingTab extends PluginSettingTab {
    constructor(
        app: App,
        private plugin: VoiceNotePlugin
    ) {
        super(app, plugin);
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl)
            .setName('OpenAI API Key')
            .setDesc('Enter your OpenAI API key for transcription')
            .addText(text => text
                .setPlaceholder('Enter your API key')
                .setValue(this.plugin.settings.openAiKey)
                .onChange(async (value) => {
                    this.plugin.settings.openAiKey = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Audio Quality')
            .setDesc('Select the audio quality (affects performance and data usage)')
            .addDropdown(dropdown => dropdown
                .addOption('low', 'Low (Better for slow connections)')
                .addOption('medium', 'Medium (Recommended)')
                .addOption('high', 'High (Best quality)')
                .setValue(this.plugin.settings.audioQuality)
                .onChange(async (value: 'high' | 'medium' | 'low') => {
                    this.plugin.settings.audioQuality = value;
                    await this.plugin.saveSettings();
                }));
    }
} 