import { VoiceNoteSettings } from '../types';
import { FORMATTING_CONFIG } from '../config/formatting.config';

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
                    model: FORMATTING_CONFIG.MODEL,
                    messages: [
                        {
                            role: 'system',
                            content: FORMATTING_CONFIG.INSTRUCTIONS
                        },
                        {
                            role: 'user',
                            content: text
                        }
                    ],
                    temperature: FORMATTING_CONFIG.TEMPERATURE,
                    max_tokens: FORMATTING_CONFIG.MAX_TOKENS
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