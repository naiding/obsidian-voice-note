import { App, Editor, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, Platform } from 'obsidian';

interface MyPluginSettings {
	openAiKey: string;
	isRecording: boolean;
	audioQuality: 'high' | 'medium' | 'low';
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	openAiKey: '',
	isRecording: false,
	audioQuality: 'medium'
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
	private readonly SEND_INTERVAL_MS = 500;
	private readonly MIN_AUDIO_MS = 100;
	private audioStartTime: number = 0;
	private audioDuration: number = 0;
	private accumulatedSamples: number = 0;
	private isMobileDevice: boolean = false;
	private currentView: MarkdownView | null = null;
	private statusContainer: HTMLElement | null = null;
	private statusText: HTMLElement | null = null;
	private transcribedText: string = '';
	private lastTranscriptionEnd: number = 0;
	private readonly FORMAT_DELAY_MS = 2000; // 2 seconds silence before formatting
	private formatTimeout: NodeJS.Timeout | null = null;
	private lastFormatPosition: number = 0;
	private recordingStatus: 'idle' | 'listening' | 'transcribing' | 'formatting' = 'idle';
	private recordingDuration: number = 0;

	async onload() {
		await this.loadSettings();
		
		// Detect platform
		this.isMobileDevice = Platform.isMobile;

		// Initialize status bar first
		this.statusBarItem = this.addStatusBarItem();
		this.initializeStatusBar();

		// Ensure recording state is false on load
		this.settings.isRecording = false;
		
		await this.saveSettings();

		// Add command for both mobile and desktop
		this.addCommand({
			id: 'start-stop-recording',
			name: 'Start/Stop Voice Recording',
			icon: 'microphone',
			mobileOnly: false,
			callback: async () => {
				if (!this.settings.openAiKey) {
					new Notice('Please set your OpenAI API key in settings first!');
					return;
				}
				
				if (!this.settings.isRecording) {
					await this.startRecording();
				} else {
					await this.stopRecording();
				}
			}
		});

		// Handle file open events
		this.registerEvent(
			this.app.workspace.on('file-open', () => {
				// Remove action from previous view if it exists
				if (this.currentView) {
					const actions = (this.currentView as any).actions;
					if (actions) {
						const microphoneActions = Object.entries(actions)
							.filter(([_, action]: [string, any]) => action.icon === 'microphone');
						microphoneActions.forEach(([id, _]) => {
							delete actions[id];
						});
					}
				}

				// Add action to new view
				const leaf = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (leaf) {
					this.currentView = leaf;
					leaf.addAction('microphone', 'Voice Record', async (evt: MouseEvent) => {
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
				}
			})
		);

		// Add settings tab
		this.addSettingTab(new VoiceNoteSettingTab(this.app, this));
	}

	private initializeStatusBar() {
		// First clear any existing content
		this.statusBarItem.empty();
		
		// Create floating indicator for both mobile and desktop
		if (!this.statusContainer) {
			this.statusContainer = document.body.createEl('div');
		}
		this.statusContainer.addClasses(['voice-note-floating-indicator']);
		
		// Create dot indicator
		const dot = this.statusContainer.createEl('div');
		dot.addClasses(['voice-note-status-dot']);
		
		// Create text element
		this.statusText = this.statusContainer.createEl('span');
		this.statusText.addClasses(['voice-note-status-text']);
		
		// Ensure proper initial state
		this.updateStatusBar(0);
	}

	async onunload() {
		// Clean up action from current view
		if (this.currentView) {
			const actions = (this.currentView as any).actions;
			if (actions) {
				const microphoneActions = Object.entries(actions)
					.filter(([_, action]: [string, any]) => action.icon === 'microphone');
				microphoneActions.forEach(([id, _]) => {
					delete actions[id];
				});
			}
		}

		// Clean up status indicators
		if (this.statusContainer) {
			this.statusContainer.remove();
			this.statusContainer = null;
		}
		if (this.statusBarItem) {
			this.statusBarItem.empty();
		}
		this.statusText = null;
	}

	private async getMobileAudioConstraints() {
		const quality = this.settings.audioQuality;
		const constraints: MediaTrackConstraints = {
			channelCount: 1,
			echoCancellation: true,
			noiseSuppression: true,
			autoGainControl: true,
		};

		// Set sample rate as a number for the audio context
		let sampleRate: number;
		switch (quality) {
			case 'high':
				sampleRate = 48000;
				break;
			case 'low':
				sampleRate = 16000;
				break;
			default: // medium
				sampleRate = 24000;
		}

		// Add sampleRate to constraints with proper type
		constraints.sampleRate = { ideal: sampleRate };

		return constraints;
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
							instructions: "You are a bilingual transcriber for Mandarin Chinese and English. Follow these strict rules:\n\n1. Language Rules:\n   - For Chinese text, always use Simplified Chinese (简体中文), never Traditional Chinese\n   - Never translate English words or terms into Chinese\n   - Keep all English terms exactly as spoken (e.g., 'market', 'session', 'OK', brand names, technical terms)\n   - Preserve English interjections ('OK', 'yes', 'ha ha') in original form\n\n2. Text Formatting:\n   - Remove all extra spaces at start and end\n   - Never add newlines or line breaks\n   - Keep exactly one space between English words and Chinese characters\n   - Remove any duplicate spaces\n   - No spaces before punctuation\n\n3. Punctuation:\n   - Use Chinese punctuation (。，？！) for Chinese sentences\n   - Use English punctuation (.?!) for pure English sentences\n   - Add proper punctuation for every sentence",
							input_audio_transcription: {
								model: 'whisper-1'
							},
							turn_detection: {
								type: 'server_vad',
								threshold: 0.3,
								prefix_padding_ms: 300,
								silence_duration_ms: 500,
								create_response: true
							},
							temperature: 0.6,
							tool_choice: 'none',
							max_response_output_tokens: 4096
						}
					}));
				}
			};

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
						this.recordingStatus = 'listening';
						this.updateStatusText();
						// Clear any pending format timeout when speech starts
						if (this.formatTimeout) {
							clearTimeout(this.formatTimeout);
							this.formatTimeout = null;
						}
						break;

					case 'input_audio_buffer.speech_stopped':
						this.recordingStatus = 'transcribing';
						this.updateStatusText();
						this.lastTranscriptionEnd = Date.now();
						// Set timeout to format text after silence
						if (this.formatTimeout) {
							clearTimeout(this.formatTimeout);
						}
						this.formatTimeout = setTimeout(async () => {
							this.recordingStatus = 'formatting';
							this.updateStatusText();
							await this.formatPendingText();
							if (this.settings.isRecording) {
								this.recordingStatus = 'listening';
								this.updateStatusText();
							}
						}, this.FORMAT_DELAY_MS);
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
									// Clean up the transcript text: trim spaces and normalize newlines
									const text = content.transcript.trim() + ' ';
									this.transcribedText += text;
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
							// Clean up the transcript text: trim spaces and normalize newlines
							const text = data.transcript.trim() + ' ';
							this.transcribedText += text;
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
			// Reset format tracking variables
			this.lastFormatPosition = 0;
			this.transcribedText = '';
			this.recordingDuration = 0;
			this.recordingStatus = 'listening';
			if (this.formatTimeout) {
				clearTimeout(this.formatTimeout);
				this.formatTimeout = null;
			}
			
			console.log('Starting recording...');
			await this.setupWebSocket();
			this.audioBuffer = [];
			this.lastSendTime = Date.now();
			this.accumulatedSamples = 0;

			const audioConstraints = this.isMobileDevice 
				? await this.getMobileAudioConstraints()
				: {
					channelCount: 1,
					sampleRate: 16000,
					echoCancellation: true,
					noiseSuppression: true
				};

			console.log('Getting user media...');
			const stream = await navigator.mediaDevices.getUserMedia({ 
				audio: audioConstraints
			});

			// Create audio context with appropriate settings for the platform
			this.audioContext = new AudioContext({
				sampleRate: this.isMobileDevice 
					? (typeof audioConstraints.sampleRate === 'number' 
						? audioConstraints.sampleRate 
						: (audioConstraints.sampleRate as ConstrainULongRange)?.ideal || 16000)
					: 16000,
				latencyHint: this.isMobileDevice ? 'playback' : 'interactive'
			});

			const source = this.audioContext.createMediaStreamSource(stream);
			
			// Create processor for raw PCM data
			this.audioProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);
			
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

			console.log('Setting up recording state...');
			// Set up recording state first
			this.settings.isRecording = true;
			this.updateStatusBar(0);

			// Start the interval timer
			this.recordingInterval = window.setInterval(() => {
				this.recordingDuration++;
				this.updateStatusText();
			}, 1000);

			// Update UI last
			this.updateRecordingState(true);
			new Notice('Recording started');

		} catch (error: any) {
			console.error('Recording error:', error);
			new Notice(this.isMobileDevice 
				? 'Error accessing microphone. Please check microphone permissions in your mobile settings.' 
				: 'Error accessing microphone: ' + error.message
			);
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
			this.recordingStatus = 'idle';
			this.recordingDuration = 0;
			this.updateStatusText();

			// Clear any pending format timeout
			if (this.formatTimeout) {
				clearTimeout(this.formatTimeout);
				this.formatTimeout = null;
			}

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

			// Process any remaining transcribed text
			if (this.transcribedText.trim()) {
				const textToFormat = this.transcribedText.substring(this.lastFormatPosition);
				if (textToFormat.trim()) {
					const processedText = await this.processTranscribedText(textToFormat);
					const view = this.app.workspace.getActiveViewOfType(MarkdownView);
					if (view) {
						const editor = view.editor;
						const cursor = editor.getCursor();
						const startPos = editor.offsetToPos(editor.posToOffset(cursor) - textToFormat.length);
						editor.replaceRange(processedText, startPos, cursor);
					}
				}
				this.transcribedText = '';
				this.lastFormatPosition = 0;
			}

			this.updateRecordingState(false);
			new Notice('Recording stopped');
		}
	}

	private updateStatusBar(duration?: number) {
		// Ensure status bar elements exist
		if (!this.statusContainer || !this.statusText) {
			this.initializeStatusBar();
			return;
		}

		const isRecording = this.settings.isRecording;

		// Remove any existing classes first
		this.statusContainer.removeClass('is-recording');
		
		if (isRecording) {
			this.statusContainer.addClass('is-recording');
			this.recordingDuration = duration || 0;
			this.updateStatusText();
			
			// Ensure the container is visible
			this.statusContainer.style.display = 'flex';
		} else {
			this.recordingStatus = 'idle';
			this.recordingDuration = 0;
			this.updateStatusText();
			// Don't hide completely, just remove recording indicator
			this.statusContainer.style.display = 'flex';
		}
	}

	private updateRecordingState(isRecording: boolean) {
		console.log('Updating recording state:', isRecording);
		
		// Update recording state
		this.settings.isRecording = isRecording;

		// Update action button appearance
		if (this.currentView) {
			const actions = (this.currentView as any).actions;
			if (actions) {
				const microphoneActions = Object.entries(actions)
					.filter(([_, action]: [string, any]) => action.icon === 'microphone');
				microphoneActions.forEach(([_, action]) => {
					const iconEl = (action as any).iconEl as HTMLElement;
					if (iconEl) {
						if (isRecording) {
							iconEl.addClass('voice-note-recording');
						} else {
							iconEl.removeClass('voice-note-recording');
						}
					}
				});
			}
		}

		// Update status bar
		this.updateStatusBar(0);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private async processTranscribedText(text: string): Promise<string> {
		try {
			const response = await fetch('https://api.openai.com/v1/chat/completions', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${this.settings.openAiKey}`
				},
				body: JSON.stringify({
					model: 'gpt-4o-mini',
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
			new Notice('Error processing text with GPT');
			return text;
		}
	}

	private async formatPendingText() {
		if (!this.transcribedText.trim()) {
			this.recordingStatus = 'listening';
			this.updateStatusText();
			return;
		}

		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return;

		const editor = view.editor;
		const cursor = editor.getCursor();
		const currentPosition = editor.posToOffset(cursor);

		// Only format text that hasn't been formatted yet
		const textToFormat = this.transcribedText.substring(this.lastFormatPosition);
		if (!textToFormat.trim()) return;

		try {
			const processedText = await this.processTranscribedText(textToFormat);
			
			// Calculate positions for replacement
			const startPos = editor.offsetToPos(currentPosition - textToFormat.length);
			const endPos = cursor;
			
			// Replace the unformatted text with formatted version
			editor.replaceRange(processedText, startPos, endPos);
			
			// Update the last format position
			this.lastFormatPosition = this.transcribedText.length;
			
			if (this.settings.isRecording) {
				this.recordingStatus = 'listening';
				this.updateStatusText();
			}
		} catch (error) {
			console.error('Error formatting text:', error);
			if (this.settings.isRecording) {
				this.recordingStatus = 'listening';
				this.updateStatusText();
			}
		}
	}

	private updateStatusText() {
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

		new Setting(containerEl)
			.setName('Audio Quality')
			.setDesc('Select the audio quality (affects performance and data usage)')
			.addDropdown(dropdown => dropdown
				.addOption('low', 'Low (Better for slow connections)')
				.addOption('medium', 'Medium (Recommended)')
				.addOption('high', 'High (Best quality)')
				.setValue(this.plugin.settings.audioQuality)
				.onChange(async (value: 'high' | 'medium' | 'low') => {
					this.plugin.settings.audioQuality = value;
					await this.plugin.saveSettings();
				}));
	}
}
