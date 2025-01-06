import { App, Editor, MarkdownView, Notice, Plugin, Platform } from 'obsidian';
import { VoiceNoteSettings, DEFAULT_SETTINGS, RecordingStatus } from './types';
import { RecordingService } from './services/RecordingService';
import { WebSocketService, WebSocketCallbacks } from './services/WebSocketService';
import { TextFormattingService } from './services/TextFormattingService';
import { StatusBar } from './components/StatusBar';
import { VoiceNoteSettingTab } from './components/SettingsTab';
import { CONSTANTS } from './constants';

export default class VoiceNotePlugin extends Plugin {
    settings: VoiceNoteSettings;
    private statusBar: StatusBar;
    private recordingService: RecordingService;
    private webSocketService: WebSocketService;
    private textFormattingService: TextFormattingService;
    private recordingInterval: number | null = null;
    private currentView: MarkdownView | null = null;
    private currentMicrophoneAction: any = null;
    private transcribedText: string = '';
    private lastFormatPosition: number = 0;
    private formatTimeout: NodeJS.Timeout | null = null;
    private backupFormatTimeout: NodeJS.Timeout | null = null;
    private lastTranscriptTime: number = 0;

    async onload() {
        await this.loadSettings();
        
        // Initialize services
        this.recordingService = new RecordingService(this.settings);
        this.textFormattingService = new TextFormattingService(this.settings);
        
        // Initialize status bar
        this.statusBar = new StatusBar(this.addStatusBarItem());

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
                this.updateMicrophoneAction();
            })
        );

        // Add settings tab
        this.addSettingTab(new VoiceNoteSettingTab(this.app, this));
    }

    private updateMicrophoneAction() {
        // Remove action from previous view if it exists
        if (this.currentView) {
            const actions = (this.currentView as any).actions;
            if (actions) {
                Object.entries(actions).forEach(([id, action]: [string, any]) => {
                    if (action.icon === 'microphone' || action.icon === 'square') {
                        action.remove();
                        delete actions[id];
                    }
                });
            }
        }

        // Add action to new view
        const leaf = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (leaf) {
            const newActions = (leaf as any).actions;
            if (newActions) {
                Object.entries(newActions).forEach(([id, action]: [string, any]) => {
                    if (action.icon === 'microphone' || action.icon === 'square') {
                        action.remove();
                        delete newActions[id];
                    }
                });
            }

            this.currentView = leaf;
            this.currentMicrophoneAction = leaf.addAction(
                this.settings.isRecording ? 'square' : 'microphone',
                this.settings.isRecording ? 'Stop Recording' : 'Voice Record',
                async () => {
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
            );

            if (this.settings.isRecording && this.currentMicrophoneAction) {
                const iconEl = (this.currentMicrophoneAction as any).iconEl as HTMLElement;
                if (iconEl) {
                    iconEl.addClass('voice-note-recording');
                }
            }
        }
    }

    async startRecording() {
        try {
            // Reset format tracking variables
            this.lastFormatPosition = 0;
            this.transcribedText = '';
            
            // Initialize WebSocket service with callbacks
            this.webSocketService = new WebSocketService(this.settings, {
                onSpeechStarted: () => {
                    this.statusBar.setStatus('listening');
                    if (this.formatTimeout) {
                        clearTimeout(this.formatTimeout);
                        this.formatTimeout = null;
                    }
                },
                onSpeechStopped: () => {
                    this.statusBar.setStatus('transcribing');
                    if (this.formatTimeout) {
                        clearTimeout(this.formatTimeout);
                    }
                    this.formatTimeout = setTimeout(async () => {
                        this.statusBar.setStatus('formatting');
                        await this.formatPendingText();
                        if (this.settings.isRecording) {
                            this.statusBar.setStatus('listening');
                        }
                    }, CONSTANTS.FORMAT_DELAY_MS);
                },
                onTranscriptReceived: (text: string) => {
                    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
                    if (view) {
                        const editor = view.editor;
                        const cursor = editor.getCursor();
                        this.transcribedText += text;
                        editor.replaceRange(text, cursor);
                        const newPos = editor.offsetToPos(editor.posToOffset(cursor) + text.length);
                        editor.setCursor(newPos);
                        
                        this.lastTranscriptTime = Date.now();
                        if (this.backupFormatTimeout) {
                            clearTimeout(this.backupFormatTimeout);
                        }
                        this.backupFormatTimeout = setTimeout(async () => {
                            const timeSinceLastTranscript = Date.now() - this.lastTranscriptTime;
                            if (timeSinceLastTranscript >= CONSTANTS.FORMAT_DELAY_MS) {
                                this.statusBar.setStatus('formatting');
                                await this.formatPendingText();
                                if (this.settings.isRecording) {
                                    this.statusBar.setStatus('listening');
                                }
                            }
                        }, CONSTANTS.FORMAT_DELAY_MS * 1.5);
                    }
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

            this.updateMicrophoneAction();
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
            // Clear any pending timeouts
            if (this.formatTimeout) {
                clearTimeout(this.formatTimeout);
                this.formatTimeout = null;
            }
            if (this.backupFormatTimeout) {
                clearTimeout(this.backupFormatTimeout);
                this.backupFormatTimeout = null;
            }

            // Force format any remaining text
            if (this.transcribedText.trim()) {
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
            this.updateMicrophoneAction();
            
            new Notice('Recording stopped');
        }
    }

    private async formatPendingText() {
        if (!this.transcribedText.trim()) {
            this.statusBar.setStatus('listening');
            return;
        }

        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) return;

        const editor = view.editor;
        const cursor = editor.getCursor();
        const currentPosition = editor.posToOffset(cursor);

        const textToFormat = this.transcribedText.substring(this.lastFormatPosition);
        if (!textToFormat.trim()) return;

        try {
            const processedText = await this.textFormattingService.formatText(textToFormat);
            
            const startPos = editor.offsetToPos(currentPosition - textToFormat.length);
            const endPos = cursor;
            
            editor.replaceRange(processedText, startPos, endPos);
            
            this.lastFormatPosition = this.transcribedText.length;
            
            if (this.settings.isRecording) {
                this.statusBar.setStatus('listening');
            }
        } catch (error) {
            console.error('Error formatting text:', error);
            if (this.settings.isRecording) {
                this.statusBar.setStatus('listening');
            }
        }
    }

    async onunload() {
        // Clean up action from current view
        if (this.currentView) {
            const actions = (this.currentView as any).actions;
            if (actions) {
                Object.entries(actions).forEach(([id, action]: [string, any]) => {
                    if (action.icon === 'microphone' || action.icon === 'square') {
                        action.remove();
                        delete actions[id];
                    }
                });
            }
        }

        // Clean up status bar
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