import { App, MarkdownView, Notice, Plugin, Platform } from 'obsidian';
import { VoiceNoteSettings, DEFAULT_SETTINGS } from './types';
import { RecordingService } from './services/RecordingService';
import { WebSocketService } from './services/WebSocketService';
import { TextFormattingService } from './services/TextFormattingService';
import { EditorService } from './services/EditorService';
import { TimeoutManager } from './services/TimeoutManager';
import { StatusBar } from './components/StatusBar';
import { VoiceNoteSettingTab } from './components/SettingsTab';

export default class VoiceNotePlugin extends Plugin {
    settings: VoiceNoteSettings;
    private statusBar: StatusBar;
    private recordingService: RecordingService;
    private webSocketService: WebSocketService;
    private textFormattingService: TextFormattingService;
    private editorService: EditorService;
    private timeoutManager: TimeoutManager;
    private recordingInterval: number | null = null;

    async onload() {
        await this.loadSettings();
        
        // Initialize services
        this.recordingService = new RecordingService(this.settings);
        this.textFormattingService = new TextFormattingService(this.settings);
        this.editorService = new EditorService(() => this.app.workspace.getActiveViewOfType(MarkdownView));
        this.timeoutManager = new TimeoutManager(
            async () => {
                this.statusBar.setStatus('formatting');
                await this.formatPendingText();
                if (this.settings.isRecording) {
                    this.statusBar.setStatus('listening');
                }
            },
            () => this.settings.isRecording
        );
        
        // Initialize UI components
        this.statusBar = new StatusBar(
            this.addStatusBarItem(),
            {
                onStartRecording: () => this.startRecording(),
                onStopRecording: () => this.stopRecording(),
                validateApiKey: () => {
                    if (!this.settings.openAiKey) {
                        new Notice('Please set your OpenAI API key in settings first!');
                        return false;
                    }
                    return true;
                },
                getActiveView: () => this.app.workspace.getActiveViewOfType(MarkdownView)
            }
        );

        // Ensure recording state is false on load
        this.settings.isRecording = false;
        await this.saveSettings();

        // Add command for both mobile and desktop
        this.addCommand({
            id: 'start-stop-recording',
            name: 'Start/Stop Voice Recording',
            icon: 'microphone',
            mobileOnly: false,
            callback: async () => {
                if (!this.settings.openAiKey) {
                    new Notice('Please set your OpenAI API key in settings first!');
                    return;
                }
                
                if (!this.settings.isRecording) {
                    await this.startRecording();
                } else {
                    await this.stopRecording();
                }
            }
        });

        // Handle file open events
        this.registerEvent(
            this.app.workspace.on('file-open', () => {
                this.statusBar.checkVisibility();
            })
        );

        // Add settings tab
        this.addSettingTab(new VoiceNoteSettingTab(this.app, this));
    }

    async startRecording() {
        try {
            // Reset state
            this.editorService.reset();
            
            // Initialize WebSocket service with callbacks
            this.webSocketService = new WebSocketService(this.settings, {
                onSpeechStarted: () => {
                    this.statusBar.setStatus('listening');
                    this.timeoutManager.clearTimeouts();
                },
                onSpeechStopped: () => {
                    this.statusBar.setStatus('transcribing');
                    this.timeoutManager.scheduleFormat();
                },
                onTranscriptReceived: (text: string) => {
                    this.editorService.appendText(text);
                    this.timeoutManager.scheduleBackupFormat();
                },
                onError: (error: string) => {
                    new Notice(error);
                },
                onClose: () => {
                    this.settings.isRecording = false;
                    this.statusBar.updateStatus(false);
                }
            });

            await this.webSocketService.connect();

            // Start recording
            await this.recordingService.startRecording((audioData: string) => {
                this.webSocketService?.sendAudioData(audioData);
            });

            // Update UI state
            this.settings.isRecording = true;
            this.statusBar.updateStatus(true);

            // Start the interval timer
            this.recordingInterval = window.setInterval(() => {
                this.statusBar.incrementDuration();
            }, 1000);

            new Notice('Recording started');

        } catch (error: any) {
            console.error('Recording error:', error);
            new Notice(Platform.isMobile
                ? 'Error accessing microphone. Please check microphone permissions in your mobile settings.'
                : 'Error accessing microphone: ' + error.message
            );
        }
    }

    async stopRecording() {
        if (this.settings.isRecording) {
            // Clear timeouts
            this.timeoutManager.clearTimeouts();

            // Force format any remaining text
            if (this.editorService.hasUnformattedText()) {
                this.statusBar.setStatus('formatting');
                await this.formatPendingText();
            }

            // Stop all services
            await this.recordingService.stopRecording();
            this.webSocketService?.close();
            
            if (this.recordingInterval) {
                clearInterval(this.recordingInterval);
                this.recordingInterval = null;
            }

            // Reset state
            this.settings.isRecording = false;
            this.statusBar.updateStatus(false);
            
            new Notice('Recording stopped');
        }
    }

    private async formatPendingText() {
        await this.editorService.formatText(text => this.textFormattingService.formatText(text));
    }

    async onunload() {
        // Clean up UI
        this.statusBar.destroy();

        // Stop recording if active
        if (this.settings.isRecording) {
            await this.stopRecording();
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
} 