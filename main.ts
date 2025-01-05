import { App, Editor, MarkdownView, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';

interface MyPluginSettings {
	openAiKey: string;
	isRecording: boolean;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	openAiKey: '',
	isRecording: false
}

export default class VoiceNotePlugin extends Plugin {
	settings: MyPluginSettings;
	private mediaRecorder: MediaRecorder | null = null;
	private statusBarItem: HTMLElement;
	private recordingInterval: number | null = null;
	private ws: WebSocket | null = null;
	private audioContext: AudioContext | null = null;
	private audioProcessor: ScriptProcessorNode | null = null;
	private audioBuffer: Int16Array[] = [];
	private lastSendTime: number = 0;
	private readonly SEND_INTERVAL_MS = 500; // Send every 500ms
	private readonly MIN_AUDIO_MS = 100; // Minimum audio duration required
	private audioStartTime: number = 0;
	private audioDuration: number = 0;
	private accumulatedSamples: number = 0;

	async onload() {
		await this.loadSettings();

		// Add a ribbon icon for toggling recording
		const ribbonIconEl = this.addRibbonIcon('microphone', 'Toggle Audio Recording', async (evt: MouseEvent) => {
			if (!this.settings.openAiKey) {
				new Notice('Please set your OpenAI API key in settings first!');
				return;
			}
			
			if (!this.settings.isRecording) {
				await this.startRecording();
			} else {
				await this.stopRecording();
			}
		});

		// Add status bar item to show recording status
		this.statusBarItem = this.addStatusBarItem();
		this.updateStatusBar();

		// Add settings tab
		this.addSettingTab(new VoiceNoteSettingTab(this.app, this));
	}

	private async setupWebSocket() {
		try {
			const url = `wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17`;
			
			const protocols = [
				'realtime',
				'openai-insecure-api-key.' + this.settings.openAiKey,
				'openai-beta.realtime-v1'
			];
			
			this.ws = new WebSocket(url, protocols);
			
			this.ws.onopen = () => {
				console.log('WebSocket connection established');
				this.accumulatedSamples = 0;
				if (this.ws) {
					// Configure the session
					this.ws.send(JSON.stringify({
						type: 'session.update',
						session: {
							modalities: ['text'],
							input_audio_format: 'pcm16',
							instructions: 'You are a transcriber. Only transcribe the speech to text without adding any other content. Do not generate any responses.',
							input_audio_transcription: {
								model: 'whisper-1'
							},
							turn_detection: {
								type: 'server_vad',
								threshold: 0.5,
								prefix_padding_ms: 300,
								silence_duration_ms: 500,
								create_response: true
							},
							temperature: 0.6,
							tool_choice: 'none',
							max_response_output_tokens: 1
						}
					}));
				}
			};

			// Handle incoming messages
			this.ws.onmessage = async (event: MessageEvent) => {
				const data = JSON.parse(event.data);
				console.log('Received message:', data);
				
				switch (data.type) {
					case 'session.created':
						console.log('Session created:', data.session);
						break;

					case 'session.updated':
						console.log('Session configuration updated:', data.session);
						break;

					case 'input_audio_buffer.speech_started':
						console.log('Speech detected at', data.audio_start_ms, 'ms');
						break;

					case 'input_audio_buffer.speech_stopped':
						console.log('Speech stopped at', data.audio_end_ms, 'ms');
						break;

					case 'input_audio_buffer.committed':
						console.log('Audio buffer committed:', data.item_id);
						break;

					case 'conversation.item.created':
						console.log('Conversation item created:', data.item);
						if (data.item.content && data.item.content.length > 0) {
							const content = data.item.content[0];
							if (content.type === 'input_audio' && content.transcript) {
								const transcriptView = this.app.workspace.getActiveViewOfType(MarkdownView);
								if (transcriptView) {
									const editor = transcriptView.editor;
									const cursor = editor.getCursor();
									const text = content.transcript + ' ';
									editor.replaceRange(text, cursor);
									// Move cursor to end of inserted text
									const newPos = editor.offsetToPos(editor.posToOffset(cursor) + text.length);
									editor.setCursor(newPos);
								}
							}
						}
						break;

					case 'conversation.item.input_audio_transcription.completed':
						console.log('Transcription completed:', data.transcript);
						const transcriptView = this.app.workspace.getActiveViewOfType(MarkdownView);
						if (transcriptView && data.transcript) {
							const editor = transcriptView.editor;
							const cursor = editor.getCursor();
							const text = data.transcript + ' ';
							editor.replaceRange(text, cursor);
							// Move cursor to end of inserted text
							const newPos = editor.offsetToPos(editor.posToOffset(cursor) + text.length);
							editor.setCursor(newPos);
						}
						break;

					case 'response.created':
						console.log('Response created:', data.response);
						break;

					case 'response.output_item.added':
						console.log('Response output item added:', data.item);
						break;

					case 'response.content_part.added':
						console.log('Response content part added');
						break;

					case 'response.audio_transcript.delta':
						console.log('Audio transcript delta:', data.delta);
						break;

					case 'response.audio.delta':
						// Ignore audio deltas as we don't need to handle them
						break;

					case 'response.audio.done':
						console.log('Audio response completed');
						break;

					case 'response.audio_transcript.done':
						console.log('Audio transcript completed:', data.transcript);
						break;

					case 'response.content_part.done':
						console.log('Content part completed');
						break;

					case 'response.output_item.done':
						console.log('Output item completed:', data.item);
						break;

					case 'response.done':
						console.log('Response completed:', data.response);
						break;

					case 'rate_limits.updated':
						console.log('Rate limits updated:', data.rate_limits);
						break;

					case 'error':
						console.error('WebSocket error:', data.error);
						if (data.error.message.includes('buffer too small')) {
							console.warn('Buffer too small, continuing to accumulate audio');
						} else {
							new Notice('Error: ' + data.error.message);
						}
						break;

					default:
						console.log('Unhandled message type:', data.type);
				}
			};

			this.ws.onerror = (error: Event) => {
				console.error('WebSocket error:', error);
				new Notice('WebSocket error occurred');
			};

			this.ws.onclose = () => {
				console.log('WebSocket connection closed');
				this.settings.isRecording = false;
				this.updateStatusBar();
			};

		} catch (error) {
			console.error('Error setting up WebSocket:', error);
			new Notice('Failed to setup WebSocket connection: ' + (error as Error).message);
		}
	}

	async startRecording() {
		try {
			await this.setupWebSocket();
			this.audioBuffer = [];
			this.lastSendTime = Date.now();
			this.accumulatedSamples = 0;

			const stream = await navigator.mediaDevices.getUserMedia({ 
				audio: {
					channelCount: 1,
					sampleRate: 16000,
					echoCancellation: true,
					noiseSuppression: true
				}
			});

			// Create audio context and processor
			this.audioContext = new AudioContext({
				sampleRate: 16000,
				latencyHint: 'interactive'
			});

			const source = this.audioContext.createMediaStreamSource(stream);
			
			// Create processor for raw PCM data
			this.audioProcessor = this.audioContext.createScriptProcessor(2048, 1, 1);
			
			this.audioProcessor.onaudioprocess = (e) => {
				if (this.ws && this.ws.readyState === WebSocket.OPEN) {
					const inputData = e.inputBuffer.getChannelData(0);
					// Convert float32 to int16
					const pcmData = new Int16Array(inputData.length);
					for (let i = 0; i < inputData.length; i++) {
						const s = Math.max(-1, Math.min(1, inputData[i]));
						pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
					}
					
					// Add to buffer
					this.audioBuffer.push(pcmData);

					// Send accumulated data every SEND_INTERVAL_MS
					const now = Date.now();
					if (now - this.lastSendTime >= this.SEND_INTERVAL_MS) {
						this.sendAudioBuffer();
						this.lastSendTime = now;
					}
				}
			};

			// Connect the nodes
			source.connect(this.audioProcessor);
			this.audioProcessor.connect(this.audioContext.destination);

			this.settings.isRecording = true;
			this.updateStatusBar();
			new Notice('Recording started');

			let duration = 0;
			this.recordingInterval = window.setInterval(() => {
				duration++;
				this.updateStatusBar(duration);
			}, 1000);

		} catch (error: any) {
			new Notice('Error accessing microphone: ' + error.message);
			console.error('Recording error:', error);
		}
	}

	private sendAudioBuffer() {
		if (!this.ws || this.audioBuffer.length === 0) return;

		try {
			// Concatenate all buffers
			const totalLength = this.audioBuffer.reduce((sum, buf) => sum + buf.length, 0);
			const combinedBuffer = new Int16Array(totalLength);
			let offset = 0;
			for (const buffer of this.audioBuffer) {
				combinedBuffer.set(buffer, offset);
				offset += buffer.length;
			}

			// Send audio data
			this.ws.send(JSON.stringify({
				type: 'input_audio_buffer.append',
				audio: btoa(String.fromCharCode.apply(null, new Uint8Array(combinedBuffer.buffer)))
			}));

			// Clear the buffer after sending
			this.audioBuffer = [];
		} catch (error) {
			console.error('Error sending audio buffer:', error);
		}
	}

	async stopRecording() {
		if (this.settings.isRecording) {
			// Send any remaining audio data
			if (this.audioBuffer.length > 0) {
				this.sendAudioBuffer();
			}

			// Stop audio processing
			if (this.audioProcessor) {
				this.audioProcessor.disconnect();
				this.audioProcessor = null;
			}
			
			if (this.audioContext) {
				await this.audioContext.close();
				this.audioContext = null;
			}

			// Close WebSocket
			if (this.ws) {
				this.ws.close();
				this.ws = null;
			}
			
			if (this.recordingInterval) {
				clearInterval(this.recordingInterval);
				this.recordingInterval = null;
			}

			this.settings.isRecording = false;
			this.updateStatusBar();
			new Notice('Recording stopped');
		}
	}

	private updateStatusBar(duration?: number) {
		const text = this.settings.isRecording 
				? `🎙️ Recording${duration ? ` (${Math.floor(duration)}s)` : ''}...` 
				: '';
		this.statusBarItem.setText(text);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class VoiceNoteSettingTab extends PluginSettingTab {
	plugin: VoiceNotePlugin;

	constructor(app: App, plugin: VoiceNotePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('OpenAI API Key')
			.setDesc('Enter your OpenAI API key for transcription')
			.addText(text => text
				.setPlaceholder('Enter your API key')
				.setValue(this.plugin.settings.openAiKey)
				.onChange(async (value) => {
					this.plugin.settings.openAiKey = value;
					await this.plugin.saveSettings();
				}));
	}
}
