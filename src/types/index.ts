import { Plugin } from 'obsidian';

export interface VoiceNoteSettings {
    openAiKey: string;
    isRecording: boolean;
    audioQuality: 'high' | 'medium' | 'low';
}

export type RecordingStatus = 'idle' | 'listening' | 'transcribing' | 'formatting';

export const DEFAULT_SETTINGS: VoiceNoteSettings = {
    openAiKey: '',
    isRecording: false,
    audioQuality: 'medium'
};

export interface VoiceNotePlugin extends Plugin {
    settings: VoiceNoteSettings;
    saveSettings(): Promise<void>;
} 