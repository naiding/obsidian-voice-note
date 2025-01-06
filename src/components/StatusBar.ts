import { MarkdownView } from 'obsidian';
import { RecordingStatus } from '../types';

export interface StatusBarCallbacks {
    onStartRecording: () => Promise<void>;
    onStopRecording: () => Promise<void>;
    validateApiKey: () => boolean;
    getActiveView: () => MarkdownView | null;
}

export class StatusBar {
    private statusContainer: HTMLElement;
    private statusText: HTMLElement;
    private actionButton: HTMLElement;
    private recordingDuration: number = 0;
    private recordingStatus: RecordingStatus = 'idle';
    private isRecording: boolean = false;

    constructor(
        private statusBarItem: HTMLElement,
        private callbacks: StatusBarCallbacks
    ) {
        this.initializeStatusBar();
    }

    private initializeStatusBar(): void {
        this.statusBarItem.empty();
        
        // 创建浮动指示器容器
        this.statusContainer = document.body.createEl('div');
        this.statusContainer.addClasses(['voice-note-floating-indicator']);
        document.body.appendChild(this.statusContainer);
        
        // 创建录音按钮
        this.actionButton = this.statusContainer.createEl('div');
        this.actionButton.addClasses(['voice-note-action-button', 'clickable-icon']);
        this.updateActionButton();
        
        // 创建状态文本
        this.statusText = this.statusContainer.createEl('span');
        this.statusText.addClasses(['voice-note-status-text']);
        
        // 立即更新状态文本
        this.updateStatusText();
        
        // 更新可见性
        this.updateVisibility();
    }

    private updateActionButton(): void {
        // 更新按钮图标和样式
        this.actionButton.empty();
        const icon = this.actionButton.createEl('div');
        icon.addClass(this.isRecording ? 'voice-note-stop-icon' : 'voice-note-mic-icon');
        
        // 更新点击处理
        this.actionButton.onclick = async (e) => {
            e.stopPropagation();
            if (!this.isRecording) {
                if (!this.callbacks.validateApiKey()) return;
                await this.callbacks.onStartRecording();
            } else {
                await this.callbacks.onStopRecording();
            }
        };

        // 更新提示文本
        this.actionButton.setAttribute('aria-label', 
            this.isRecording ? 'Stop Recording' : 'Start Voice Recording'
        );
    }

    private updateVisibility(): void {
        const view = this.callbacks.getActiveView();
        
        if (this.isRecording || view) {
            this.statusContainer.style.display = 'flex';
            this.statusContainer.style.opacity = '1';
            // 确保状态文本显示
            this.updateStatusText();
        } else {
            this.statusContainer.style.display = 'none';
            this.statusContainer.style.opacity = '0';
        }
    }

    setStatus(status: RecordingStatus): void {
        this.recordingStatus = status;
        this.updateStatusText();
    }

    updateStatus(isRecording: boolean): void {
        this.isRecording = isRecording;
        
        // 更新容器样式
        this.statusContainer.removeClass('is-recording');
        if (isRecording) {
            this.statusContainer.addClass('is-recording');
            this.recordingStatus = 'listening';
        } else {
            this.recordingStatus = 'idle';
            this.recordingDuration = 0;
        }

        // 更新按钮和可见性
        this.updateActionButton();
        this.updateVisibility();
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
            case 'idle':
            default:
                statusMessage = this.isRecording ? 'Initializing...' : 'Click microphone to start recording';
                break;
        }

        this.statusText.innerText = statusMessage;
    }

    checkVisibility(): void {
        this.updateVisibility();
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