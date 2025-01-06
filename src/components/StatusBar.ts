import { RecordingStatus } from '../types';

export class StatusBar {
    private statusContainer: HTMLElement;
    private statusText: HTMLElement;
    private recordingDuration: number = 0;
    private recordingStatus: RecordingStatus = 'idle';

    constructor(private statusBarItem: HTMLElement) {
        this.initializeStatusBar();
    }

    private initializeStatusBar(): void {
        this.statusBarItem.empty();
        
        this.statusContainer = document.body.createEl('div');
        this.statusContainer.addClasses(['voice-note-floating-indicator']);
        
        const dot = this.statusContainer.createEl('div');
        dot.addClasses(['voice-note-status-dot']);
        
        this.statusText = this.statusContainer.createEl('span');
        this.statusText.addClasses(['voice-note-status-text']);
        
        this.updateStatus();
    }

    updateStatus(isRecording: boolean = false): void {
        this.statusContainer.removeClass('is-recording');
        
        if (isRecording) {
            this.statusContainer.addClass('is-recording');
            this.statusContainer.style.display = 'flex';
        } else {
            this.recordingStatus = 'idle';
            this.recordingDuration = 0;
            this.statusContainer.style.display = 'flex';
        }

        this.updateStatusText();
    }

    setStatus(status: RecordingStatus): void {
        this.recordingStatus = status;
        this.updateStatusText();
    }

    incrementDuration(): void {
        this.recordingDuration++;
        this.updateStatusText();
    }

    private updateStatusText(): void {
        if (!this.statusText) return;

        let statusMessage = '';
        const durationText = this.recordingDuration ? ` (${Math.floor(this.recordingDuration)}s)` : '';

        switch (this.recordingStatus) {
            case 'listening':
                statusMessage = `Listening${durationText}...`;
                break;
            case 'transcribing':
                statusMessage = `Transcribing${durationText}...`;
                break;
            case 'formatting':
                statusMessage = `Formatting${durationText}...`;
                break;
            default:
                statusMessage = '';
        }

        this.statusText.innerText = statusMessage;
    }

    destroy(): void {
        if (this.statusContainer) {
            this.statusContainer.remove();
        }
        if (this.statusBarItem) {
            this.statusBarItem.empty();
        }
    }
} 