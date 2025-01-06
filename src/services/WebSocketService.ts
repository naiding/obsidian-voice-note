import { CONSTANTS } from '../constants';
import { VoiceNoteSettings } from '../types';
import { Notice } from 'obsidian';

export interface WebSocketCallbacks {
    onSpeechStarted: () => void;
    onSpeechStopped: () => void;
    onTranscriptReceived: (text: string) => void;
    onError: (error: string) => void;
    onClose: () => void;
}

export class WebSocketService {
    private ws: WebSocket | null = null;

    constructor(
        private settings: VoiceNoteSettings,
        private callbacks: WebSocketCallbacks
    ) {}

    async connect(): Promise<void> {
        try {
            const url = `${CONSTANTS.WEBSOCKET_URL}?model=${CONSTANTS.WEBSOCKET_MODEL}`;
            
            const protocols = [
                'realtime',
                'openai-insecure-api-key.' + this.settings.openAiKey,
                'openai-beta.realtime-v1'
            ];
            
            this.ws = new WebSocket(url, protocols);
            
            this.ws.onopen = this.handleOpen.bind(this);
            this.ws.onmessage = this.handleMessage.bind(this);
            this.ws.onerror = this.handleError.bind(this);
            this.ws.onclose = this.handleClose.bind(this);
        } catch (error) {
            console.error('Error setting up WebSocket:', error);
            this.callbacks.onError('Failed to setup WebSocket connection: ' + (error as Error).message);
        }
    }

    private handleOpen(): void {
        if (this.ws) {
            this.ws.send(JSON.stringify({
                type: 'session.update',
                session: {
                    modalities: ['text'],
                    input_audio_format: 'pcm16',
                    instructions: "You are a bilingual transcriber for Mandarin Chinese and English. Follow these strict rules:\n\n1. Language Rules:\n   - For Chinese text, always use Simplified Chinese (简体中文), never Traditional Chinese\n   - Never translate English words or terms into Chinese\n   - Keep all English terms exactly as spoken (e.g., 'market', 'session', 'OK', brand names, technical terms)\n   - Preserve English interjections ('OK', 'yes', 'ha ha') in original form\n\n2. Text Formatting:\n   - Remove all extra spaces at start and end\n   - Never add newlines or line breaks\n   - Keep exactly one space between English words and Chinese characters\n   - Remove any duplicate spaces\n   - No spaces before punctuation\n\n3. Punctuation:\n   - Use Chinese punctuation (。，？！) for Chinese sentences\n   - Use English punctuation (.?!) for pure English sentences\n   - Add proper punctuation for every sentence",
                    input_audio_transcription: {
                        model: 'whisper-1'
                    },
                    turn_detection: {
                        type: 'server_vad',
                        threshold: 0.3,
                        prefix_padding_ms: 300,
                        silence_duration_ms: 500,
                        create_response: true
                    },
                    temperature: 0.6,
                    tool_choice: 'none',
                    max_response_output_tokens: 4096
                }
            }));
        }
    }

    private handleMessage(event: MessageEvent): void {
        const data = JSON.parse(event.data);
        
        switch (data.type) {
            case 'input_audio_buffer.speech_started':
                this.callbacks.onSpeechStarted();
                break;

            case 'input_audio_buffer.speech_stopped':
                this.callbacks.onSpeechStopped();
                break;

            case 'conversation.item.created':
                if (data.item.content?.[0]?.type === 'input_audio' && data.item.content[0].transcript) {
                    this.callbacks.onTranscriptReceived(data.item.content[0].transcript.trim() + ' ');
                }
                break;

            case 'error':
                console.error('WebSocket error:', data.error);
                if (!data.error.message.includes('buffer too small')) {
                    this.callbacks.onError(data.error.message);
                }
                break;
        }
    }

    private handleError(error: Event): void {
        console.error('WebSocket error:', error);
        this.callbacks.onError('WebSocket error occurred');
    }

    private handleClose(): void {
        console.log('WebSocket connection closed');
        this.callbacks.onClose();
    }

    sendAudioData(audioData: string): void {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'input_audio_buffer.append',
                audio: audioData
            }));
        }
    }

    close(): void {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
} 