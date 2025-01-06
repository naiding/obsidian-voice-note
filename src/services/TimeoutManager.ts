import { CONSTANTS } from '../constants';

export class TimeoutManager {
    private formatTimeout: NodeJS.Timeout | null = null;
    private backupFormatTimeout: NodeJS.Timeout | null = null;
    private lastTranscriptTime: number = 0;

    constructor(
        private onFormat: () => Promise<void>,
        private isRecording: () => boolean
    ) {}

    scheduleFormat(): void {
        if (this.formatTimeout) {
            clearTimeout(this.formatTimeout);
        }
        this.formatTimeout = setTimeout(async () => {
            await this.onFormat();
        }, CONSTANTS.FORMAT_DELAY_MS);
    }

    scheduleBackupFormat(): void {
        this.lastTranscriptTime = Date.now();
        if (this.backupFormatTimeout) {
            clearTimeout(this.backupFormatTimeout);
        }
        this.backupFormatTimeout = setTimeout(async () => {
            const timeSinceLastTranscript = Date.now() - this.lastTranscriptTime;
            if (timeSinceLastTranscript >= CONSTANTS.FORMAT_DELAY_MS && this.isRecording()) {
                await this.onFormat();
            }
        }, CONSTANTS.FORMAT_DELAY_MS * 1.5);
    }

    clearTimeouts(): void {
        if (this.formatTimeout) {
            clearTimeout(this.formatTimeout);
            this.formatTimeout = null;
        }
        if (this.backupFormatTimeout) {
            clearTimeout(this.backupFormatTimeout);
            this.backupFormatTimeout = null;
        }
    }
} 