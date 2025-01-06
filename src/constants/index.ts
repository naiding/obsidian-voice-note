export const CONSTANTS = {
    SEND_INTERVAL_MS: 150,
    MIN_AUDIO_MS: 100,
    FORMAT_DELAY_MS: 1000,
    WEBSOCKET_URL: 'wss://api.openai.com/v1/realtime',
    WEBSOCKET_MODEL: 'gpt-4o-realtime-preview-2024-12-17',
    GPT_MODEL: 'gpt-4o-mini',
    PROCESSOR_BUFFER_SIZE: 4096
} as const; 