import { MarkdownView } from 'obsidian';

export class EditorService {
    private transcribedText: string = '';
    private lastFormatPosition: number = 0;

    constructor(private getActiveView: () => MarkdownView | null) {}

    appendText(text: string): void {
        console.log('Attempting to append text:', text);
        const view = this.getActiveView();
        if (!view) {
            console.warn('No active view found');
            return;
        }

        const editor = view.editor;
        const cursor = editor.getCursor();
        console.log('Current cursor position:', cursor);
        
        this.transcribedText += text;
        try {
            editor.replaceRange(text, cursor);
            const newPos = editor.offsetToPos(editor.posToOffset(cursor) + text.length);
            editor.setCursor(newPos);
            console.log('Text appended successfully, new cursor position:', newPos);
        } catch (error) {
            console.error('Error appending text:', error);
        }
    }

    async formatText(formatFn: (text: string) => Promise<string>): Promise<void> {
        console.log('Starting text formatting');
        if (!this.transcribedText.trim()) {
            console.log('No text to format');
            return;
        }

        const view = this.getActiveView();
        if (!view) {
            console.warn('No active view found for formatting');
            return;
        }

        const editor = view.editor;
        const cursor = editor.getCursor();
        const currentPosition = editor.posToOffset(cursor);

        const textToFormat = this.transcribedText.substring(this.lastFormatPosition);
        if (!textToFormat.trim()) {
            console.log('No new text to format');
            return;
        }

        try {
            console.log('Formatting text:', textToFormat);
            const processedText = await formatFn(textToFormat);
            console.log('Formatted result:', processedText);
            
            const startPos = editor.offsetToPos(currentPosition - textToFormat.length);
            const endPos = cursor;
            editor.replaceRange(processedText, startPos, endPos);
            this.lastFormatPosition = this.transcribedText.length;
            console.log('Text formatting completed');
        } catch (error) {
            console.error('Error formatting text:', error);
        }
    }

    reset(): void {
        console.log('Resetting editor state');
        this.transcribedText = '';
        this.lastFormatPosition = 0;
    }

    hasUnformattedText(): boolean {
        const hasText = this.transcribedText.trim().length > 0;
        console.log('Checking for unformatted text:', hasText);
        return hasText;
    }
} 