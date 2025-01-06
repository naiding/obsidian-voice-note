import { VoiceNoteSettings } from '../types';
import { FORMATTING_INSTRUCTIONS } from '../instructions/formatting';

export class TextFormattingService {
    constructor(private settings: VoiceNoteSettings) {}

    async formatText(text: string): Promise<string> {
        try {
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.settings.openAiKey}`
                },
                body: JSON.stringify({
                    model: 'gpt-3.5-turbo',
                    messages: [
                        {
                            role: 'system',
                            content: FORMATTING_INSTRUCTIONS
                        },
                        {
                            role: 'user',
                            content: text
                        }
                    ],
                    temperature: 0.3,
                    max_tokens: 2000
                })
            });

            const data = await response.json();
            if (data.error) {
                throw new Error(data.error.message);
            }

            return data.choices[0].message.content.trim();
        } catch (error) {
            console.error('Error formatting text:', error);
            return text; // 如果格式化失败，返回原始文本
        }
    }
} 