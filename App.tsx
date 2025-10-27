import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { GoogleGenAI, LiveSession, LiveServerMessage, Modality, FunctionDeclaration, Type } from '@google/genai';
import type { Status, Transcript } from './types';
import { createBlob, decode, decodeAudioData } from './utils/audioUtils';
import ControlButton from './components/ControlButton';
import StatusIndicator from './components/StatusIndicator';
import TranscriptDisplay from './components/TranscriptDisplay';
import DrawingCanvas, { DrawingCanvasRef } from './components/DrawingCanvas';
import ThemeToggle from './components/ThemeToggle';
import RadioPlayer from './components/RadioPlayer';
import { playStartSound, playStopSound, playResponseSound, playSendSound } from './utils/soundEffects';

// Audio configuration constants
const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;
const AUDIO_BUFFER_SIZE = 4096;
const RADIO_STREAM_URL = 'https://listen-funkids.sharp-stream.com/funkids.mp3'; // Fun Kids Radio (direct stream)

// Function Declaration for the AI's drawing tool
const drawSomethingFunctionDeclaration: FunctionDeclaration = {
    name: 'drawSomething',
    parameters: {
      type: Type.OBJECT,
      description: 'Draws an image based on a textual description and places it on the user\'s canvas for them to see and edit.',
      properties: {
        description: {
          type: Type.STRING,
          description: 'A detailed description of the image to draw. For example: "a happy cat wearing a party hat"',
        },
      },
      required: ['description'],
    },
};

// Keywords to detect if a specific drawing style was requested
const styleKeywords = [
    'photorealistic', 'realistic', 'photo', 'watercolor', 'oil painting',
    'cartoon', 'impressionist', 'cubist', 'abstract', '3d render', 'pixel art',
    'sketch', 'charcoal', 'pastel', 'line art', 'drawing', 'illustration',
    'vector', 'anime', 'manga', 'gothic', 'renaissance', 'pop art', 'art nouveau'
];

const containsStyleKeyword = (text: string): boolean => {
    const lowerText = text.toLowerCase();
    return styleKeywords.some(keyword => lowerText.includes(keyword));
};


const App: React.FC = () => {
    const [status, setStatus] = useState<Status>('idle');
    const [transcripts, setTranscripts] = useState<Transcript[]>([]);
    const [currentInput, setCurrentInput] = useState('');
    const [currentOutput, setCurrentOutput] = useState('');
    const [isCanvasExpanded, setIsCanvasExpanded] = useState(true);
    const [isRadioPlaying, setIsRadioPlaying] = useState(false);
    const [aiDrawingToLoad, setAiDrawingToLoad] = useState<string | null>(null);

    // Refs for various audio and session objects
    const sessionPromiseRef = useRef<Promise<LiveSession> | null>(null);
    const inputAudioContextRef = useRef<AudioContext | null>(null);
    const outputAudioContextRef = useRef<AudioContext | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
    const mediaStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const nextAudioStartTimeRef = useRef(0);
    const audioPlaybackSources = useRef<Set<AudioBufferSourceNode>>(new Set());
    const uiAudioContextRef = useRef<AudioContext | null>(null);
    const aiRef = useRef<GoogleGenAI | null>(null);
    const wakeLockSentinelRef = useRef<WakeLockSentinel | null>(null);
    const radioAudioRef = useRef<HTMLAudioElement | null>(null);
    const radioVolumeRestoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const radioWasPlayingOnStartRef = useRef<boolean>(false);
    const drawingCanvasRef = useRef<DrawingCanvasRef>(null);
    const hasSentCanvasForThisTurnRef = useRef<boolean>(false);
    
    // Refs to avoid stale closures in the onmessage callback
    const currentInputRef = useRef('');
    const currentOutputRef = useRef('');


    // --- Wake Lock Management ---
    const requestWakeLock = useCallback(async () => {
      if ('wakeLock' in navigator && document.visibilityState === 'visible') {
        try {
          wakeLockSentinelRef.current = await navigator.wakeLock.request('screen');
          wakeLockSentinelRef.current.addEventListener('release', () => {
            console.log('Wake Lock was released by the system.');
          });
          console.log('Screen Wake Lock is active.');
        } catch (err: any) {
          if (err.name === 'NotAllowedError') {
            console.warn('Screen Wake Lock permission denied. This is expected in some environments (e.g., iframes) and the app will function without it.');
          } else {
            console.error(`Failed to acquire Wake Lock: ${err.name}, ${err.message}`);
          }
        }
      }
    }, []);
  
    const releaseWakeLock = useCallback(async () => {
      if (wakeLockSentinelRef.current) {
        await wakeLockSentinelRef.current.release();
        wakeLockSentinelRef.current = null;
        console.log('Screen Wake Lock released.');
      }
    }, []);


    // Initialize UI audio context on first user interaction
    const initUiAudio = () => {
        if (!uiAudioContextRef.current) {
            uiAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
    }

    const toggleRadio = useCallback(() => {
        const radio = radioAudioRef.current;
        if (radio) {
            if (radio.paused) {
                radio.play().catch(e => console.error("Radio play failed:", e));
            } else {
                radio.pause();
            }
        }
    }, []);
    
    // Cleanup function to stop all processes
    const cleanup = useCallback(() => {
        releaseWakeLock();
        // Stop microphone stream
        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach(track => track.stop());
            mediaStreamRef.current = null;
        }
        // Disconnect audio nodes
        if (scriptProcessorRef.current) {
            scriptProcessorRef.current.disconnect();
            scriptProcessorRef.current = null;
        }
        if (mediaStreamSourceRef.current) {
            mediaStreamSourceRef.current.disconnect();
            mediaStreamSourceRef.current = null;
        }
        // Close audio contexts
        if (inputAudioContextRef.current && inputAudioContextRef.current.state !== 'closed') {
            inputAudioContextRef.current.close();
            inputAudioContextRef.current = null;
        }
        if (outputAudioContextRef.current && outputAudioContextRef.current.state !== 'closed') {
            outputAudioContextRef.current.close();
            outputAudioContextRef.current = null;
        }
        // Stop any ongoing audio playback
        audioPlaybackSources.current.forEach(source => source.stop());
        audioPlaybackSources.current.clear();
        nextAudioStartTimeRef.current = 0;
        
        // Resume radio if it was playing before the session started
        if (radioWasPlayingOnStartRef.current) {
            radioAudioRef.current?.play().catch(e => console.error("Radio play failed on resume:", e));
            radioWasPlayingOnStartRef.current = false;
        }
    }, [releaseWakeLock]);

    const handleStop = useCallback(async () => {
        initUiAudio();
        playStopSound(uiAudioContextRef.current);
        if (sessionPromiseRef.current) {
            try {
                const session = await sessionPromiseRef.current;
                session.close();
            } catch (error) {
                console.error('Error closing session:', error);
            } finally {
                sessionPromiseRef.current = null;
            }
        }
        cleanup();
        setStatus('idle');
    }, [cleanup]);

    const handleStart = async () => {
        if (status === 'active' || status === 'connecting') {
            return;
        }
        initUiAudio();
        playStartSound(uiAudioContextRef.current);
        
        // Pause radio if it's playing
        if (isRadioPlaying) {
            radioWasPlayingOnStartRef.current = true;
            radioAudioRef.current?.pause();
        }

        setStatus('connecting');
        setTranscripts([]);
        setCurrentInput('');
        setCurrentOutput('');
        currentInputRef.current = '';
        currentOutputRef.current = '';
        setIsCanvasExpanded(true); // Ensure canvas is open on start
        hasSentCanvasForThisTurnRef.current = false; // Reset canvas sending flag

        try {
            aiRef.current = new GoogleGenAI({ apiKey: process.env.API_KEY! });
            
            inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: INPUT_SAMPLE_RATE });
            outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: OUTPUT_SAMPLE_RATE });

            sessionPromiseRef.current = aiRef.current.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-09-2025',
                callbacks: {
                    onopen: async () => {
                        console.log('Session opened.');
                        setStatus('active');
                        requestWakeLock(); // Acquire wake lock
                        // Start streaming microphone audio with echo cancellation
                        mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true } });
                        mediaStreamSourceRef.current = inputAudioContextRef.current!.createMediaStreamSource(mediaStreamRef.current);
                        scriptProcessorRef.current = inputAudioContextRef.current!.createScriptProcessor(AUDIO_BUFFER_SIZE, 1, 1);
                        
                        scriptProcessorRef.current.onaudioprocess = (audioProcessingEvent) => {
                            const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                            const pcmBlob = createBlob(inputData);
                            if (sessionPromiseRef.current) {
                                sessionPromiseRef.current.then((session) => {
                                    // On the first audio chunk of a turn, send the canvas image first
                                    if (!hasSentCanvasForThisTurnRef.current) {
                                        hasSentCanvasForThisTurnRef.current = true; // Set immediately to prevent race conditions
                                        const imageDataUrl = drawingCanvasRef.current?.getImageDataUrl();
                                        if (imageDataUrl) {
                                            const base64Data = imageDataUrl.split(',')[1];
                                            session.sendRealtimeInput({
                                                media: { data: base64Data, mimeType: 'image/jpeg' }
                                            });
                                        }
                                    }
                                    // Send the audio chunk
                                    session.sendRealtimeInput({ media: pcmBlob });
                                });
                            }
                        };
                        
                        mediaStreamSourceRef.current.connect(scriptProcessorRef.current);
                        scriptProcessorRef.current.connect(inputAudioContextRef.current!.destination);
                    },
                    onmessage: (message: LiveServerMessage) => {
                        handleServerMessage(message);
                    },
                    onerror: (e: ErrorEvent) => {
                        console.error('Session error:', e);
                        setStatus('error');
                        cleanup();
                    },
                    onclose: (e: CloseEvent) => {
                        console.log('Session closed.');
                        if (status !== 'error') {
                            setStatus('idle');
                        }
                        cleanup();
                    },
                },
                config: {
                    responseModalities: [Modality.AUDIO],
                    inputAudioTranscription: {},
                    outputAudioTranscription: {},
                    systemInstruction: "You are Bloop, a fun, friendly, and creative AI assistant. At the beginning of the user's turn, you will receive an image showing the current state of their drawing canvas. Use this image as context for the conversation. You can comment on it, answer questions about it, or use your 'drawSomething' tool to add to it if the user asks. By default, your own drawings are simple line art unless the user requests a specific style (like 'photorealistic' or 'cartoon').",
                    tools: [{ functionDeclarations: [drawSomethingFunctionDeclaration] }],
                },
            });

            await sessionPromiseRef.current;

        } catch (error) {
            console.error('Failed to start session:', error);
            setStatus('error');
            cleanup();
        }
    };
    
    const handleServerMessage = async (message: LiveServerMessage) => {
        // Handle tool calls for drawing
        if (message.toolCall) {
            for (const fc of message.toolCall.functionCalls) {
                if (fc.name === 'drawSomething') {
                    const originalDescription = fc.args.description ?? 'something creative';
                    const drawingMessageId = `ai-draw-msg-${Date.now()}`;
                    
                    let imagePrompt = originalDescription;
                    if (!containsStyleKeyword(originalDescription)) {
                        imagePrompt = `line art drawing of ${originalDescription}`;
                    }

                    // Add a placeholder message to transcript
                    setTranscripts(prev => [...prev, {
                        id: drawingMessageId,
                        speaker: 'ai',
                        text: `Okay, I'll draw: "${originalDescription}"`,
                        isLoading: true,
                    }]);

                    try {
                        // Generate the image
                        const response = await aiRef.current!.models.generateContent({
                            model: 'gemini-2.5-flash-image',
                            contents: { parts: [{ text: imagePrompt }] },
                            config: { responseModalities: [Modality.IMAGE] },
                        });

                        const part = response.candidates?.[0]?.content?.parts?.[0];
                        if (part?.inlineData) {
                            const base64Image = part.inlineData.data;
                            const imageUrl = `data:${part.inlineData.mimeType};base64,${base64Image}`;
                            // Set the image data to be loaded by the canvas
                            setAiDrawingToLoad(imageUrl);
                            // Update placeholder message to indicate success
                            setTranscripts(prev => prev.map(t => t.id === drawingMessageId ? { ...t, isLoading: false } : t));
                        } else {
                            throw new Error("No image data received.");
                        }

                    } catch (error) {
                        console.error("Image generation failed:", error);
                        // Update placeholder with an error message
                        setTranscripts(prev => prev.map(t => t.id === drawingMessageId ? { ...t, text: "Sorry, I couldn't create the drawing.", isLoading: false } : t));
                    }
                    
                    // Respond to the tool call
                    sessionPromiseRef.current?.then((session) => {
                        session.sendToolResponse({
                            functionResponses: {
                                id: fc.id,
                                name: fc.name,
                                response: { result: "ok, I have put the drawing on the canvas for the user." },
                            }
                        });
                    });
                }
            }
        }

        // Handle audio output
        const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
        if (audioData && outputAudioContextRef.current) {
            // Duck radio volume when AI starts speaking (first chunk of a turn)
            if (audioPlaybackSources.current.size === 0 && radioAudioRef.current && !radioAudioRef.current.paused) {
                if (radioVolumeRestoreTimerRef.current) clearTimeout(radioVolumeRestoreTimerRef.current);
                radioAudioRef.current.volume = 0.2;
            }

            if (audioPlaybackSources.current.size === 0) { // Play sound only for the first chunk of a response
                playResponseSound(uiAudioContextRef.current);
            }
            const audioContext = outputAudioContextRef.current;
            nextAudioStartTimeRef.current = Math.max(nextAudioStartTimeRef.current, audioContext.currentTime);

            const decodedAudio = decode(audioData);
            const audioBuffer = await decodeAudioData(decodedAudio, audioContext, OUTPUT_SAMPLE_RATE, 1);
            
            const source = audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(audioContext.destination);
            source.addEventListener('ended', () => {
                audioPlaybackSources.current.delete(source);
            });
            source.start(nextAudioStartTimeRef.current);
            nextAudioStartTimeRef.current += audioBuffer.duration;
            audioPlaybackSources.current.add(source);
        }

        // Handle interruptions
        if (message.serverContent?.interrupted) {
            audioPlaybackSources.current.forEach(source => source.stop());
            audioPlaybackSources.current.clear();
            nextAudioStartTimeRef.current = 0;
            // Restore radio volume on interruption
            if (radioAudioRef.current && !radioAudioRef.current.paused) {
                if (radioVolumeRestoreTimerRef.current) clearTimeout(radioVolumeRestoreTimerRef.current);
                radioAudioRef.current.volume = 1.0;
            }
        }

        // Handle transcriptions using refs to avoid stale state
        if (message.serverContent?.inputTranscription) {
            currentInputRef.current += message.serverContent.inputTranscription.text;
            setCurrentInput(currentInputRef.current);
        }
        if (message.serverContent?.outputTranscription) {
            currentOutputRef.current += message.serverContent.outputTranscription.text;
            setCurrentOutput(currentOutputRef.current);
        }

        if (message.serverContent?.turnComplete) {
            // Reset the flag so the canvas is sent on the next user utterance
            hasSentCanvasForThisTurnRef.current = false;

            // Restore radio volume after the AI has finished its turn
            if (radioAudioRef.current && !radioAudioRef.current.paused) {
                if (radioVolumeRestoreTimerRef.current) clearTimeout(radioVolumeRestoreTimerRef.current);
                radioVolumeRestoreTimerRef.current = setTimeout(() => {
                    if (radioAudioRef.current) {
                      radioAudioRef.current.volume = 1.0;
                    }
                }, 500);
            }

            const finalInput = currentInputRef.current;
            const finalOutput = currentOutputRef.current;

            if (finalInput || finalOutput) {
                 setTranscripts(prev => {
                    const newEntries: Transcript[] = [];
                    if (finalInput) newEntries.push({ id: `user-${Date.now()}`, speaker: 'user', text: finalInput });
                    if (finalOutput) newEntries.push({ id: `ai-${Date.now()}`, speaker: 'ai', text: finalOutput });
                    return [...prev, ...newEntries];
                });
            }
            currentInputRef.current = '';
            currentOutputRef.current = '';
            setCurrentInput('');
            setCurrentOutput('');
        }
    };
    
    // Combine final transcripts with in-progress ones for live display
    const displayedTranscripts = useMemo(() => {
        const liveTranscripts: Transcript[] = [];
        if (currentInput) {
            liveTranscripts.push({ id: 'live-user', speaker: 'user' as const, text: currentInput });
        }
        if (currentOutput) {
            liveTranscripts.push({ id: 'live-ai', speaker: 'ai' as const, text: currentOutput });
        }
        return [...transcripts, ...liveTranscripts].filter(t => t.text || t.image);
    }, [transcripts, currentInput, currentOutput]);

    const handleAiDrawingComplete = useCallback(() => {
        setAiDrawingToLoad(null);
    }, []);
    
    // Effect for graceful shutdown
    useEffect(() => {
        return () => {
            if (sessionPromiseRef.current) {
                sessionPromiseRef.current.then(session => session.close()).catch(console.error);
            }
            cleanup();
        };
    }, [cleanup]);

    // Effect to handle wake lock on visibility changes
    useEffect(() => {
        const handleVisibilityChange = () => {
          if (status === 'active' && document.visibilityState === 'visible') {
            requestWakeLock();
          }
        };
    
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => {
          document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
      }, [status, requestWakeLock]);

    // Effect to initialize the radio player
    useEffect(() => {
        radioAudioRef.current = new Audio(RADIO_STREAM_URL);
        radioAudioRef.current.crossOrigin = "anonymous";
        const radio = radioAudioRef.current;
        
        const handlePlay = () => setIsRadioPlaying(true);
        const handlePause = () => setIsRadioPlaying(false);
        
        radio.addEventListener('play', handlePlay);
        radio.addEventListener('pause', handlePause);

        return () => {
            radio.removeEventListener('play', handlePlay);
            radio.removeEventListener('pause', handlePause);
            radio.pause();
        }
    }, []);


    return (
        <div className="bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100 min-h-screen flex flex-col items-center justify-center p-4 font-sans">
            <div className="w-full max-w-4xl mx-auto flex flex-col h-[90vh] bg-white dark:bg-gray-800 shadow-2xl rounded-2xl overflow-hidden">
                <header className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
                    <h1 className="text-lg md:text-xl font-bold">Bloop</h1>
                    <div className="flex items-center space-x-2 md:space-x-4">
                        <RadioPlayer isPlaying={isRadioPlaying} onToggle={toggleRadio} />
                        <StatusIndicator status={status} />
                        <ThemeToggle />
                    </div>
                </header>

                <main className="flex-1 flex flex-col-reverse md:flex-row overflow-hidden p-2 md:p-4 gap-4">
                    <div className="flex-1 flex flex-col overflow-hidden md:flex-1 md:h-full">
                        <TranscriptDisplay transcripts={displayedTranscripts} />
                    </div>
                    <div className={`
                        w-full flex-shrink-0 relative overflow-hidden transition-all duration-500 ease-in-out
                        md:flex-1 md:h-full md:aspect-auto
                        ${isCanvasExpanded ? 'aspect-square' : 'h-20'}
                    `}>
                        {/* Drawing Canvas Wrapper */}
                        <div className={`
                            w-full h-full transition-opacity duration-300
                            md:opacity-100 md:pointer-events-auto
                            ${isCanvasExpanded ? 'opacity-100' : 'opacity-0 pointer-events-none'}
                        `}>
                            <DrawingCanvas
                                ref={drawingCanvasRef}
                                disabled={status !== 'active'}
                                aiDrawingToLoad={aiDrawingToLoad}
                                onAiDrawingComplete={handleAiDrawingComplete}
                            />
                        </div>
                        
                        {/* Expand Button Wrapper */}
                        <div className={`
                            absolute inset-0 transition-opacity duration-300 md:hidden
                            ${!isCanvasExpanded ? 'opacity-100' : 'opacity-0 pointer-events-none'}
                        `}>
                            <button
                                onClick={() => setIsCanvasExpanded(true)}
                                disabled={status !== 'active'}
                                className="w-full h-full flex items-center justify-center gap-2 text-lg font-semibold bg-gray-200 dark:bg-gray-700 rounded-lg shadow disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <svg xmlns="http://www.w.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                                <span>Draw</span>
                            </button>
                        </div>
                    </div>
                </main>

                <footer className="p-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-center">
                    <ControlButton status={status} onStart={handleStart} onStop={handleStop} />
                </footer>
            </div>
        </div>
    );
};

export default App;