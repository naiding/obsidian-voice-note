import { MarkdownView } from 'obsidian';

export class MicrophoneActionManager {
    private currentView: MarkdownView | null = null;
    private currentAction: any = null;

    constructor(
        private getActiveView: () => MarkdownView | null,
        private isRecording: boolean,
        private onToggle: () => void,
        private validateApiKey: () => boolean
    ) {}

    update(): void {
        const view = this.getActiveView();
        
        // 如果视图没有改变，只更新样式
        if (view === this.currentView && this.currentAction) {
            this.updateActionIcon();
            return;
        }

        // 如果视图改变了，清理旧的并添加新的
        this.cleanup();
        if (view) {
            this.addNewAction(view);
        }
    }

    private removeExistingActions(view: MarkdownView): void {
        const actions = (view as any).actions;
        if (!actions) return;

        // 收集所有需要删除的动作
        Object.entries(actions).forEach(([id, action]: [string, any]) => {
            if (action.icon === 'microphone' || action.icon === 'square') {
                if (action === this.currentAction) {
                    this.currentAction = null;
                }
                action.remove();
                delete actions[id];
            }
        });
    }

    private addNewAction(view: MarkdownView): void {
        // 确保先清理当前视图的所有相关动作
        this.removeExistingActions(view);

        this.currentView = view;
        this.currentAction = view.addAction(
            this.isRecording ? 'square' : 'microphone',
            this.isRecording ? 'Stop Recording' : 'Voice Record',
            async () => {
                if (!this.validateApiKey()) return;
                this.onToggle();
            }
        );

        // 更新图标样式
        this.updateActionStyle();
    }

    private updateActionIcon(): void {
        if (this.currentAction) {
            // 更新图标
            (this.currentAction as any).setIcon(this.isRecording ? 'square' : 'microphone');
            // 更新提示文本
            (this.currentAction as any).setTooltip(this.isRecording ? 'Stop Recording' : 'Voice Record');
            // 更新样式
            this.updateActionStyle();
        }
    }

    private updateActionStyle(): void {
        if (this.currentAction) {
            const iconEl = (this.currentAction as any).iconEl as HTMLElement;
            if (iconEl) {
                iconEl.removeClass('voice-note-recording');
                if (this.isRecording) {
                    iconEl.addClass('voice-note-recording');
                }
            }
        }
    }

    cleanup(): void {
        if (this.currentView) {
            this.removeExistingActions(this.currentView);
        }
        this.currentView = null;
        this.currentAction = null;
    }

    setRecordingState(isRecording: boolean): void {
        this.isRecording = isRecording;
        this.updateActionIcon();
    }
} 