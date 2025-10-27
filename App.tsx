import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, LiveSession, LiveServerMessage, Modality, FunctionDeclaration, Type } from '@google/genai';
import type { Status } from './types';
import { createBlob, decode, decodeAudioData } from './utils/audioUtils';
import ControlButton from './components/ControlButton';
import StatusIndicator from './components/StatusIndicator';
import DrawingCanvas, { DrawingCanvasRef } from './components/DrawingCanvas';
import ThemeToggle from './components/ThemeToggle';
import RadioPlayer from './components/RadioPlayer';
import { playStartSound, playStopSound, playResponseSound } from './utils/soundEffects';
import Ticker from './components/Ticker';

// Audio configuration constants
const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;
const AUDIO_BUFFER_SIZE = 4096;
const RADIO_STREAM_URL = 'https://listen-funkids.sharp-stream.com/funkids.mp3';
const DRAWING_LOOP_URL = 'https://dw.zobj.net/download/v1/bsgpdBAOCGUfA3o0W11gFHK22SKeDM9FG5IPMu6RtnDwZwctUEGF37KOz8_McgA77Cv-_ynmT6GqQPtXgOfaKtfvyMqqSJ6oFJZ2-nWhJnF3ysh2z_DmWvcYpwp8/?a=&c=72&f=booloop.mp3&special=1761585023-Zof%2BCgnaeyIUJ8yuG%2FNtlQw%2BWeDGDVM8q7zk8H8%2Fods%3D';


// --- AI Tool Declarations ---

const drawSomethingFunctionDeclaration: FunctionDeclaration = {
    name: 'drawSomething',
    parameters: {
      type: Type.OBJECT,
      description: 'Intelligently edits the current Etch A Sketch drawing by adding something based on a textual description. This preserves the original drawing and adds the new element in a sensible way.',
      properties: {
        description: {
          type: Type.STRING,
          description: 'A detailed description of what to add to the drawing. For example: "a sun in the sky" or "a party hat on the cat"',
        },
      },
      required: ['description'],
    },
};

const clearCanvasFunctionDeclaration: FunctionDeclaration = {
    name: 'clearCanvas',
    parameters: {
      type: Type.OBJECT,
      description: 'Clears the Etch A Sketch screen, as if by shaking it.',
    },
};

const App: React.FC = () => {
    const [status, setStatus] = useState<Status>('idle');
    const [aiMessage, setAiMessage] = useState('Press the left knob to begin!');
    const [isRadioPlaying, setIsRadioPlaying] = useState(false);
    const [aiDrawingToLoad, setAiDrawingToLoad] = useState<string | null>(null);
    const [isShaking, setIsShaking] = useState(false);
    const [isAiDrawing, setIsAiDrawing] = useState(false);

    // Refs
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
    const turnCanvasSnapshotRef = useRef<string | null>(null);
    const currentOutputRef = useRef('');
    const drawingAudioRef = useRef<HTMLAudioElement | null>(null);
    const isAiDrawingRef = useRef(false);

    // --- Core App Logic (Wake Lock, Audio Init, etc.) ---

    useEffect(() => {
        isAiDrawingRef.current = isAiDrawing;
    }, [isAiDrawing]);

    const requestWakeLock = useCallback(async () => {
      if ('wakeLock' in navigator && document.visibilityState === 'visible') {
        try {
          wakeLockSentinelRef.current = await navigator.wakeLock.request('screen');
        } catch (err: any) {
            console.warn(`Wake Lock failed: ${err.name}. App will continue.`);
        }
      }
    }, []);
  
    const releaseWakeLock = useCallback(async () => {
      if (wakeLockSentinelRef.current) {
        await wakeLockSentinelRef.current.release();
        wakeLockSentinelRef.current = null;
      }
    }, []);

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
    
    const cleanup = useCallback(() => {
        releaseWakeLock();
        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach(track => track.stop());
            mediaStreamRef.current = null;
        }
        if (scriptProcessorRef.current) scriptProcessorRef.current.disconnect();
        if (mediaStreamSourceRef.current) mediaStreamSourceRef.current.disconnect();
        if (inputAudioContextRef.current?.state !== 'closed') inputAudioContextRef.current?.close();
        if (outputAudioContextRef.current?.state !== 'closed') outputAudioContextRef.current?.close();
        
        audioPlaybackSources.current.forEach(source => source.stop());
        audioPlaybackSources.current.clear();
        nextAudioStartTimeRef.current = 0;
        
        drawingAudioRef.current?.pause();

        if (radioWasPlayingOnStartRef.current) {
            radioAudioRef.current?.play().catch(e => console.error("Radio resume failed:", e));
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
        setAiMessage('Session ended. Press the left knob to play again!');
    }, [cleanup]);

    const handleStart = async () => {
        if (status === 'active' || status === 'connecting') return;
        
        initUiAudio();
        playStartSound(uiAudioContextRef.current);
        
        if (isRadioPlaying) {
            radioWasPlayingOnStartRef.current = true;
            radioAudioRef.current?.pause();
        }

        setStatus('connecting');
        setAiMessage('Connecting...');
        currentOutputRef.current = '';
        hasSentCanvasForThisTurnRef.current = false;

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
                        const activityIdeas = [
                            "Let's draw a silly monster!",
                            "What should we create today?",
                            "I'm ready to draw! How about a rocket ship?",
                            "It's drawing time! Let's make a beautiful garden.",
                            "Hello! Want to draw some funny animals with me?",
                        ];
                        const randomIndex = Math.floor(Math.random() * activityIdeas.length);
                        setAiMessage(activityIdeas[randomIndex]);
                        requestWakeLock();
                        mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true } });
                        mediaStreamSourceRef.current = inputAudioContextRef.current!.createMediaStreamSource(mediaStreamRef.current);
                        scriptProcessorRef.current = inputAudioContextRef.current!.createScriptProcessor(AUDIO_BUFFER_SIZE, 1, 1);
                        
                        scriptProcessorRef.current.onaudioprocess = (audioProcessingEvent) => {
                            const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                            const pcmBlob = createBlob(inputData);
                            sessionPromiseRef.current?.then((session) => {
                                if (!hasSentCanvasForThisTurnRef.current) {
                                    hasSentCanvasForThisTurnRef.current = true;
                                    const imageDataUrl = drawingCanvasRef.current?.getImageDataUrl();
                                    if (imageDataUrl) {
                                        turnCanvasSnapshotRef.current = imageDataUrl;
                                        const base64Data = imageDataUrl.split(',')[1];
                                        session.sendRealtimeInput({ media: { data: base64Data, mimeType: 'image/jpeg' } });
                                    }
                                }
                                session.sendRealtimeInput({ media: pcmBlob });
                            });
                        };
                        
                        mediaStreamSourceRef.current.connect(scriptProcessorRef.current);
                        scriptProcessorRef.current.connect(inputAudioContextRef.current!.destination);
                    },
                    onmessage: (message: LiveServerMessage) => handleServerMessage(message),
                    onerror: (e: ErrorEvent) => {
                        console.error('Session error:', e);
                        setStatus('error');
                        setAiMessage('An error occurred. Please try again.');
                        cleanup();
                    },
                    onclose: (e: CloseEvent) => {
                        console.log('Session closed.');
                        if (status !== 'error') setStatus('idle');
                        cleanup();
                    },
                },
                config: {
                    responseModalities: [Modality.AUDIO],
                    inputAudioTranscription: {},
                    outputAudioTranscription: {},
                    systemInstruction: "Your name is Bloop Bloop. You are a fun AI assistant from the 'Fun Kids' Edition, living inside a classic Etch A Sketch toy. The user interacts with you by voice and by drawing. At the start of their turn, you'll see the current drawing. Your first task is to look at the drawing and comment on what you see, especially if it's changed. For example, say 'Ooh, a house! What should we add next?' or 'Wow, you added a chimney!'. Always be playful and engaging, and suggest fun things to draw or add. You can add to the user's drawing by calling 'drawSomething' which will intelligently edit the image, and you can clear the screen by calling 'clearCanvas'. The drawing style is always a single dark line on a gray background. Keep your text responses short and fun, suitable for the toy's screen.",
                    tools: [{ functionDeclarations: [drawSomethingFunctionDeclaration, clearCanvasFunctionDeclaration] }],
                },
            });

            await sessionPromiseRef.current;

        } catch (error) {
            console.error('Failed to start session:', error);
            setStatus('error');
            setAiMessage('Failed to start. Check console for details.');
            cleanup();
        }
    };
    
    const handleServerMessage = async (message: LiveServerMessage) => {
        if (message.toolCall) {
            for (const fc of message.toolCall.functionCalls) {
                let toolResponseResult = "done";
                if (fc.name === 'drawSomething') {
                    setAiMessage('Drawing...');
                    setIsAiDrawing(true);
                    try {
                        if (!turnCanvasSnapshotRef.current) {
                          throw new Error("Missing canvas snapshot for this turn.");
                        }
        
                        const imagePart = {
                            inlineData: {
                                mimeType: 'image/jpeg',
                                data: turnCanvasSnapshotRef.current.split(',')[1],
                            },
                        };

                        const textPart = {
                           text: `You are an Etch A Sketch drawing assistant. The user's current drawing is provided for context. Their request is to add the following to it: '${fc.args.description}'. Generate an image containing ONLY the new drawing element, in a style that matches the existing drawing (a single dark line). The background of the image you generate MUST be transparent.`
                        };
                        
                        const response = await aiRef.current!.models.generateContent({
                            model: 'gemini-2.5-flash-image',
                            contents: { parts: [imagePart, textPart] },
                            config: { responseModalities: [Modality.IMAGE] },
                        });

                        const part = response.candidates?.[0]?.content?.parts?.[0];
                        if (part?.inlineData) {
                            setAiDrawingToLoad(`data:${part.inlineData.mimeType};base64,${part.inlineData.data}`);
                        } else throw new Error("No image data received.");
                    } catch (error) {
                        console.error("Image generation failed:", error);
                        setAiMessage("Sorry, I couldn't edit the drawing.");
                        setIsAiDrawing(false);
                        toolResponseResult = "error";
                    }
                } else if (fc.name === 'clearCanvas') {
                    setIsShaking(true);
                    setTimeout(() => {
                        drawingCanvasRef.current?.clearCanvas();
                        setIsShaking(false);
                    }, 500); // Duration of shake animation
                }
                sessionPromiseRef.current?.then((session) => {
                    session.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: toolResponseResult } } });
                });
            }
        }

        const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
        if (audioData && outputAudioContextRef.current) {
            drawingAudioRef.current?.pause(); // Stop drawing sound if new TTS starts

            if (audioPlaybackSources.current.size === 0 && radioAudioRef.current && !radioAudioRef.current.paused) {
                if (radioVolumeRestoreTimerRef.current) clearTimeout(radioVolumeRestoreTimerRef.current);
                radioAudioRef.current.volume = 0.2;
            }
            if (audioPlaybackSources.current.size === 0) playResponseSound(uiAudioContextRef.current);
            const audioContext = outputAudioContextRef.current;
            nextAudioStartTimeRef.current = Math.max(nextAudioStartTimeRef.current, audioContext.currentTime);
            const audioBuffer = await decodeAudioData(decode(audioData), audioContext, OUTPUT_SAMPLE_RATE, 1);
            const source = audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(audioContext.destination);
            source.addEventListener('ended', () => {
                audioPlaybackSources.current.delete(source);
                // If this was the last audio chunk and we are in a drawing state, play the loop.
                if (audioPlaybackSources.current.size === 0 && isAiDrawingRef.current) {
                    drawingAudioRef.current?.play().catch(e => console.error("Drawing audio play failed:", e));
                }
            });
            source.start(nextAudioStartTimeRef.current);
            nextAudioStartTimeRef.current += audioBuffer.duration;
            audioPlaybackSources.current.add(source);
        }

        if (message.serverContent?.interrupted) {
            audioPlaybackSources.current.forEach(source => source.stop());
            if (radioAudioRef.current && !radioAudioRef.current.paused) radioAudioRef.current.volume = 1.0;
        }

        if (message.serverContent?.outputTranscription) {
            const newTextChunk = message.serverContent.outputTranscription.text;
            if (currentOutputRef.current === '') {
                setAiMessage('');
            }
            currentOutputRef.current += newTextChunk;
            setAiMessage(prevMessage => prevMessage + newTextChunk);
        }
        
        if (message.serverContent?.inputTranscription) {
            setAiMessage('Listening...');
            currentOutputRef.current = '';
        }

        if (message.serverContent?.turnComplete) {
            hasSentCanvasForThisTurnRef.current = false;
            turnCanvasSnapshotRef.current = null;
            if (radioAudioRef.current && !radioAudioRef.current.paused) {
                if (radioVolumeRestoreTimerRef.current) clearTimeout(radioVolumeRestoreTimerRef.current);
                radioVolumeRestoreTimerRef.current = setTimeout(() => { if (radioAudioRef.current) radioAudioRef.current.volume = 1.0; }, 500);
            }
            currentOutputRef.current = '';

             // If the AI is drawing and no TTS is currently playing, start the drawing sound.
            // This covers the case where the AI draws without speaking.
            if (isAiDrawing && audioPlaybackSources.current.size === 0) {
                drawingAudioRef.current?.play().catch(e => console.error("Drawing audio play failed:", e));
            }
            
            if (aiMessage === 'Listening...' && !message.toolCall) {
                setAiMessage('Your turn!');
            }
        }
    };
    
    const handleAiDrawingComplete = useCallback(() => {
        drawingAudioRef.current?.pause();
        if (drawingAudioRef.current) {
            drawingAudioRef.current.currentTime = 0; // Rewind for next time
        }
        setAiDrawingToLoad(null);
        setIsAiDrawing(false);
        setAiMessage('I finished adding to our drawing!');
    }, []);
    
    useEffect(() => () => cleanup(), [cleanup]);
    useEffect(() => {
        const handleVisibilityChange = () => { if (status === 'active' && document.visibilityState === 'visible') requestWakeLock(); };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [status, requestWakeLock]);
    useEffect(() => {
        radioAudioRef.current = new Audio(RADIO_STREAM_URL);
        const radio = radioAudioRef.current;
        const handlePlay = () => setIsRadioPlaying(true);
        const handlePause = () => setIsRadioPlaying(false);
        radio.addEventListener('play', handlePlay);
        radio.addEventListener('pause', handlePause);
        return () => { radio.removeEventListener('play', handlePlay); radio.removeEventListener('pause', handlePause); radio.pause(); }
    }, []);

    return (
        <div className="min-h-screen flex flex-col items-center justify-center p-4 font-sans">
             <audio
                ref={drawingAudioRef}
                src={DRAWING_LOOP_URL}
                loop
                preload="auto"
            />
            <div className="w-full max-w-2xl aspect-[4/3.5] bg-red-600 rounded-2xl shadow-2xl p-4 md:p-6 flex flex-col shadow-[inset_0_0_10px_rgba(0,0,0,0.3)]">
                <header className="flex items-center justify-between text-yellow-400">
                    <div className="flex flex-col">
                      <h1 className="text-2xl md:text-3xl font-pacifico tracking-wider">Bloop Bloop</h1>
                      <p className="text-xl text-yellow-400/80">"Fun Kids" Edition</p>
                    </div>
                    <div className="flex items-center space-x-2 md:space-x-4">
                        <StatusIndicator status={status} />
                        <ThemeToggle />
                    </div>
                </header>

                <main className="flex-1 bg-red-700 rounded-lg my-4 p-2 flex flex-col">
                    <div className={`flex-1 flex flex-col bg-slate-300 dark:bg-slate-400 rounded-md overflow-hidden border-2 border-yellow-500 screen-texture`}>
                         <div className="p-2 text-gray-800 dark:text-gray-900 font-mono h-12 flex items-center overflow-hidden">
                            <Ticker text={aiMessage} />
                         </div>
                         <div className="h-1 w-full bg-gray-900/10">
                            {isAiDrawing && (
                                <div className="h-full w-full animate-progress-shimmer"></div>
                            )}
                         </div>
                         <div className="flex-1 w-full h-full relative">
                            <DrawingCanvas
                                ref={drawingCanvasRef}
                                shake={isShaking}
                                aiDrawingToLoad={aiDrawingToLoad}
                                onAiDrawingComplete={handleAiDrawingComplete}
                            />
                         </div>
                    </div>
                </main>

                <footer className="h-24 flex-shrink-0 flex items-center justify-between px-4 md:px-8">
                    <ControlButton status={status} onStart={handleStart} onStop={handleStop} />
                    <RadioPlayer isPlaying={isRadioPlaying} onToggle={toggleRadio} />
                </footer>
            </div>
        </div>
    );
};

export default App;