import { VoiceNoteSettings } from '../types';
import { Notice } from 'obsidian';
import { WEBSOCKET_CONFIG } from '../config/websocket.config';

export interface WebSocketCallbacks {
    onSpeechStarted: () => void;
    onSpeechStopped: () => void;
    onTranscriptReceived: (text: string) => void;
    onError: (error: string) => void;
    onClose: () => void;
}

export class WebSocketService {
    private ws: WebSocket | null = null;
    private currentTranscript: string = '';
    private currentDeltaText: string = '';

    constructor(
        private settings: VoiceNoteSettings,
        private callbacks: WebSocketCallbacks
    ) {}

    async connect(): Promise<void> {
        try {
            const url = `${WEBSOCKET_CONFIG.URL}?model=${WEBSOCKET_CONFIG.MODEL}`;
            console.log('Connecting to WebSocket:', url);
            
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
        console.log('WebSocket connection opened');
        if (this.ws) {
            const config = {
                type: 'session.update',
                session: {
                    modalities: ['text'],
                    input_audio_format: 'pcm16',
                    instructions: WEBSOCKET_CONFIG.INSTRUCTIONS,
                    input_audio_transcription: {
                        model: WEBSOCKET_CONFIG.TRANSCRIPTION_MODEL
                    },
                    turn_detection: WEBSOCKET_CONFIG.VAD_CONFIG,
                    temperature: WEBSOCKET_CONFIG.TEMPERATURE,
                    tool_choice: 'none',
                    max_response_output_tokens: WEBSOCKET_CONFIG.MAX_TOKENS
                }
            };
            console.log('Sending session config:', config);
            this.ws.send(JSON.stringify(config));
        }
    }

    private handleMessage(event: MessageEvent): void {
        const data = JSON.parse(event.data);
        console.log('Received WebSocket message:', data);
        
        switch (data.type) {
            case 'session.created':
            case 'session.updated':
                console.log('Session status:', data.type);
                break;

            case 'input_audio_buffer.speech_started':
                console.log('Speech started detected');
                this.currentTranscript = '';
                this.currentDeltaText = '';
                this.callbacks.onSpeechStarted();
                break;

            case 'input_audio_buffer.speech_stopped':
                console.log('Speech stopped detected');
                this.callbacks.onSpeechStopped();
                break;

            case 'conversation.item.created':
                if (data.item.content?.[0]?.type === 'input_audio' && data.item.content[0].transcript) {
                    const transcript = data.item.content[0].transcript.trim();
                    console.log('Received partial transcript:', transcript);
                    if (transcript && transcript !== this.currentTranscript) {
                        this.currentTranscript = transcript;
                        this.callbacks.onTranscriptReceived(transcript + ' ');
                    }
                }
                break;

            case 'conversation.item.input_audio_transcription.completed':
                if (data.transcript) {
                    const transcript = data.transcript.trim();
                    console.log('Received complete transcript:', transcript);
                    if (transcript && transcript !== this.currentTranscript) {
                        this.currentTranscript = transcript;
                        this.callbacks.onTranscriptReceived(transcript + ' ');
                    }
                }
                break;

            case 'response.text.delta':
                if (data.delta?.text) {
                    const deltaText = data.delta.text;
                    console.log('Received text delta:', deltaText);
                    this.currentDeltaText += deltaText;
                    this.callbacks.onTranscriptReceived(deltaText);
                }
                break;

            case 'response.text.done':
                // 当一段delta文本完成时，添加空格
                if (this.currentDeltaText) {
                    console.log('Text delta completed:', this.currentDeltaText);
                    this.callbacks.onTranscriptReceived(' ');
                    this.currentDeltaText = '';
                }
                break;

            case 'error':
                console.error('WebSocket error:', data.error);
                if (!data.error.message.includes('buffer too small')) {
                    this.callbacks.onError(data.error.message);
                }
                break;

            default:
                // 其他事件类型我们只记录但不处理
                console.log('Unhandled message type:', data.type);
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
            const message = {
                type: 'input_audio_buffer.append',
                audio: audioData
            };
            console.log('Sending audio data, length:', audioData.length);
            this.ws.send(JSON.stringify(message));
        } else {
            console.warn('WebSocket not ready, state:', this.ws?.readyState);
        }
    }

    close(): void {
        console.log('Closing WebSocket connection');
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
} 