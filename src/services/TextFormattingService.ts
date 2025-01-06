import { CONSTANTS } from '../constants';
import { VoiceNoteSettings } from '../types';

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
                    model: CONSTANTS.GPT_MODEL,
                    messages: [
                        {
                            role: 'system',
                            content: '你是一个文本格式整理工具。严格遵循以下规则：\n1. 使用简体中文（不要使用繁体字）\n2. 英文单词和短语保持原样不变\n3. 为文本添加合适的标点符号（中文使用中文标点，英文使用英文标点）\n4. 优化段落格式\n5. 不要改变原文的任何词句含义\n6. 只返回格式化后的文本，不要添加任何其他对话或解释性文字\n7. 不要添加任何前缀或后缀，直接返回处理后的文本'
                        },
                        {
                            role: 'user',
                            content: text
                        }
                    ],
                    temperature: 0.3
                })
            });

            if (!response.ok) {
                throw new Error('Failed to process text with GPT');
            }

            const data = await response.json();
            return data.choices[0].message.content;
        } catch (error) {
            console.error('Error processing text with GPT:', error);
            return text;
        }
    }
} 