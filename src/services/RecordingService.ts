import { Platform } from 'obsidian';
import { CONSTANTS } from '../constants';
import { VoiceNoteSettings } from '../types';

export class RecordingService {
    private mediaRecorder: MediaRecorder | null = null;
    private audioContext: AudioContext | null = null;
    private audioProcessor: ScriptProcessorNode | null = null;
    private audioBuffer: Int16Array[] = [];
    private lastSendTime: number = 0;
    private isMobileDevice: boolean;
    private ws: WebSocket | null = null;

    constructor(private settings: VoiceNoteSettings) {
        this.isMobileDevice = Platform.isMobile;
    }

    private async getMobileAudioConstraints() {
        const quality = this.settings.audioQuality;
        const constraints: MediaTrackConstraints = {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
        };

        let sampleRate: number;
        switch (quality) {
            case 'high':
                sampleRate = 48000;
                break;
            case 'low':
                sampleRate = 16000;
                break;
            default:
                sampleRate = 24000;
        }

        constraints.sampleRate = { ideal: sampleRate };
        return constraints;
    }

    async startRecording(onAudioData: (data: string) => void): Promise<void> {
        const audioConstraints = this.isMobileDevice 
            ? await this.getMobileAudioConstraints()
            : {
                channelCount: 1,
                sampleRate: 16000,
                echoCancellation: true,
                noiseSuppression: true
            };

        const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: audioConstraints
        });

        this.audioContext = new AudioContext({
            sampleRate: this.isMobileDevice 
                ? (typeof audioConstraints.sampleRate === 'number' 
                    ? audioConstraints.sampleRate 
                    : (audioConstraints.sampleRate as ConstrainULongRange)?.ideal || 16000)
                : 16000,
            latencyHint: this.isMobileDevice ? 'playback' : 'interactive'
        });

        const source = this.audioContext.createMediaStreamSource(stream);
        this.audioProcessor = this.audioContext.createScriptProcessor(CONSTANTS.PROCESSOR_BUFFER_SIZE, 1, 1);
        
        this.audioProcessor.onaudioprocess = (e) => {
            const inputData = e.inputBuffer.getChannelData(0);
            const pcmData = new Int16Array(inputData.length);
            for (let i = 0; i < inputData.length; i++) {
                const s = Math.max(-1, Math.min(1, inputData[i]));
                pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }
            
            this.audioBuffer.push(pcmData);

            const now = Date.now();
            if (now - this.lastSendTime >= CONSTANTS.SEND_INTERVAL_MS) {
                this.sendAudioBuffer(onAudioData);
                this.lastSendTime = now;
            }
        };

        source.connect(this.audioProcessor);
        this.audioProcessor.connect(this.audioContext.destination);
    }

    private sendAudioBuffer(onAudioData: (data: string) => void): void {
        if (this.audioBuffer.length === 0) return;

        try {
            const totalLength = this.audioBuffer.reduce((sum, buf) => sum + buf.length, 0);
            const combinedBuffer = new Int16Array(totalLength);
            let offset = 0;
            for (const buffer of this.audioBuffer) {
                combinedBuffer.set(buffer, offset);
                offset += buffer.length;
            }

            const audioData = btoa(String.fromCharCode.apply(null, new Uint8Array(combinedBuffer.buffer)));
            onAudioData(audioData);
            this.audioBuffer = [];
        } catch (error) {
            console.error('Error sending audio buffer:', error);
        }
    }

    async stopRecording(): Promise<void> {
        if (this.audioProcessor) {
            this.audioProcessor.disconnect();
            this.audioProcessor = null;
        }
        
        if (this.audioContext) {
            await this.audioContext.close();
            this.audioContext = null;
        }

        this.audioBuffer = [];
    }
} 