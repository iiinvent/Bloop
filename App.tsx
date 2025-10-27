import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { GoogleGenAI, LiveSession, LiveServerMessage, Modality, FunctionDeclaration, Type } from '@google/genai';
import type { Status, Transcript } from './types';
import { createBlob, decode, decodeAudioData } from './utils/audioUtils';
import ControlButton from './components/ControlButton';
import StatusIndicator from './components/StatusIndicator';
import TranscriptDisplay from './components/TranscriptDisplay';
import DrawingCanvas from './components/DrawingCanvas';
import ThemeToggle from './components/ThemeToggle';
import { playStartSound, playStopSound, playResponseSound, playSendSound } from './utils/soundEffects';

// Audio configuration constants
const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;
const AUDIO_BUFFER_SIZE = 4096;

// Function Declaration for the AI's drawing tool
const drawSomethingFunctionDeclaration: FunctionDeclaration = {
    name: 'drawSomething',
    parameters: {
      type: Type.OBJECT,
      description: 'Draws an image based on a textual description.',
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
    const [clearCanvasKey, setClearCanvasKey] = useState(0);

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
    
    // Refs to avoid stale closures in the onmessage callback
    const currentInputRef = useRef('');
    const currentOutputRef = useRef('');


    // Initialize UI audio context on first user interaction
    const initUiAudio = () => {
        if (!uiAudioContextRef.current) {
            uiAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
    }
    
    // Cleanup function to stop all processes
    const cleanup = useCallback(() => {
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
    }, []);

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
        setStatus('connecting');
        setTranscripts([]);
        setCurrentInput('');
        setCurrentOutput('');
        currentInputRef.current = '';
        currentOutputRef.current = '';

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
                        // Start streaming microphone audio
                        mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
                        mediaStreamSourceRef.current = inputAudioContextRef.current!.createMediaStreamSource(mediaStreamRef.current);
                        scriptProcessorRef.current = inputAudioContextRef.current!.createScriptProcessor(AUDIO_BUFFER_SIZE, 1, 1);
                        
                        scriptProcessorRef.current.onaudioprocess = (audioProcessingEvent) => {
                            const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                            const pcmBlob = createBlob(inputData);
                            if (sessionPromiseRef.current) {
                                sessionPromiseRef.current.then((session) => {
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
                    systemInstruction: "You are a fun, friendly, and creative assistant. You can talk about drawings too. To illustrate something, you have a tool called 'drawSomething' you can use. By default, your drawings will be simple line art. If the user asks for a specific style (like 'photorealistic', 'watercolor', or 'cartoon'), include that in your description for the drawing tool.",
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
                    const drawingId = `drawing-${Date.now()}`;
                    
                    let imagePrompt = originalDescription;
                    if (!containsStyleKeyword(originalDescription)) {
                        imagePrompt = `line art drawing of ${originalDescription}`;
                    }

                    // Add a placeholder message
                    setTranscripts(prev => [...prev, {
                        id: drawingId,
                        speaker: 'ai',
                        text: `Drawing: "${originalDescription}"`,
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
                            // Replace placeholder with the actual image
                            setTranscripts(prev => prev.map(t => t.id === drawingId ? { ...t, text: '', image: imageUrl, isLoading: false } : t));
                        } else {
                            throw new Error("No image data received.");
                        }

                    } catch (error) {
                        console.error("Image generation failed:", error);
                        // Update placeholder with an error message
                        setTranscripts(prev => prev.map(t => t.id === drawingId ? { ...t, text: "Sorry, I couldn't create the drawing.", isLoading: false } : t));
                    }
                    
                    // Respond to the tool call
                    sessionPromiseRef.current?.then((session) => {
                        session.sendToolResponse({
                            functionResponses: {
                                id: fc.id,
                                name: fc.name,
                                response: { result: "ok, the drawing is displayed." },
                            }
                        });
                    });
                }
            }
        }

        // Handle audio output
        const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
        if (audioData && outputAudioContextRef.current) {
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
            const finalInput = currentInputRef.current;
            const finalOutput = currentOutputRef.current;

            if (finalInput || finalOutput) {
                 setTranscripts(prev => {
                    const newEntries: Transcript[] = [];
                    // Check if last entry was a user drawing without text, and merge new text into it
                    const lastEntry = prev.length > 0 ? prev[prev.length - 1] : null;
                    if (finalInput && lastEntry?.speaker === 'user' && lastEntry.image && !lastEntry.text) {
                        const updatedTranscripts = [...prev.slice(0, -1), { ...lastEntry, text: finalInput }];
                        if (finalOutput) {
                            newEntries.push({ id: `ai-${Date.now()}`, speaker: 'ai', text: finalOutput });
                        }
                        return [...updatedTranscripts, ...newEntries];
                    }
                    
                    // Otherwise, add new entries as normal
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

    const handleSendDrawing = useCallback(async (dataUrl: string) => {
        if (!sessionPromiseRef.current || status !== 'active') {
            console.warn('Cannot send drawing, session is not active.');
            return;
        }
        initUiAudio();
        playSendSound(uiAudioContextRef.current);

        const base64Data = dataUrl.split(',')[1];
        try {
            const session = await sessionPromiseRef.current;
            session.sendRealtimeInput({
                media: { data: base64Data, mimeType: 'image/jpeg' }
            });

            setTranscripts(prev => [...prev, { id: `user-drawing-${Date.now()}`, speaker: 'user', text: '', image: dataUrl }]);

            // Trigger canvas clear in the child component
            setClearCanvasKey(k => k + 1);

        } catch (error)
{
            console.error('Failed to send drawing:', error);
        }
    }, [status]);
    
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

    
    // Effect for graceful shutdown
    useEffect(() => {
        return () => {
            if (sessionPromiseRef.current) {
                sessionPromiseRef.current.then(session => session.close()).catch(console.error);
            }
            cleanup();
        };
    }, [cleanup]);

    return (
        <div className="bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100 min-h-screen flex flex-col items-center justify-center p-4 font-sans">
            <div className="w-full max-w-4xl mx-auto flex flex-col h-[90vh] bg-white dark:bg-gray-800 shadow-2xl rounded-2xl overflow-hidden">
                <header className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
                    <h1 className="text-lg md:text-xl font-bold">Bloop</h1>
                    <div className="flex items-center space-x-4">
                        <StatusIndicator status={status} />
                        <ThemeToggle />
                    </div>
                </header>

                <main className="flex-1 flex flex-col md:flex-row overflow-hidden p-2 md:p-4 gap-4">
                    <div className="w-full aspect-square md:flex-1 md:h-full md:aspect-auto">
                        <DrawingCanvas onSend={handleSendDrawing} disabled={status !== 'active'} clearKey={clearCanvasKey} />
                    </div>
                    <div className="flex-1 flex overflow-hidden md:flex-1 md:h-full">
                        <TranscriptDisplay transcripts={displayedTranscripts} />
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