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
const DRAWING_LOOP_URL = 'https://cdn.buildspace.host/bloopbloop/audio/pencil.mp3';


// --- AI Tool Declarations ---

const editDrawingFunctionDeclaration: FunctionDeclaration = {
    name: 'editDrawing',
    parameters: {
      type: Type.OBJECT,
      description: 'Edits the current drawing by adding, removing, or changing elements based on a textual description. This generates a completely new version of the drawing.',
      properties: {
        description: {
          type: Type.STRING,
          description: 'A detailed description of the edit to make. For example: "add a sun in the sky", "remove the cat", or "make the house bigger".',
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

const UndoIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M7.707 3.293a1 1 0 010 1.414L5.414 7H11a7 7 0 017 7v2a1 1 0 11-2 0v-2a5 5 0 00-5-5H5.414l2.293 2.293a1 1 0 11-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
    </svg>
);
const RedoIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor" style={{ transform: 'scaleX(-1)' }}>
        <path fillRule="evenodd" d="M7.707 3.293a1 1 0 010 1.414L5.414 7H11a7 7 0 017 7v2a1 1 0 11-2 0v-2a5 5 0 00-5-5H5.414l2.293 2.293a1 1 0 11-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
    </svg>
);

const SaveIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
        <path d="M17 3H5a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2zM6 14v-2h8v2H6zm8-4H6V6h8v4z" />
    </svg>
);


const App: React.FC = () => {
    const [status, setStatus] = useState<Status>('idle');
    const [aiMessage, setAiMessage] = useState('Press the left knob to begin!');
    const [isRadioPlaying, setIsRadioPlaying] = useState(false);
    const [aiImageToLoad, setAiImageToLoad] = useState<string | null>(null);
    const [isShaking, setIsShaking] = useState(false);
    const [isAiDrawing, setIsAiDrawing] = useState(false);
    const [initialDrawingUrl, setInitialDrawingUrl] = useState<string | null>(null);
    const [canUndo, setCanUndo] = useState(false);
    const [canRedo, setCanRedo] = useState(false);
    const [isKeySelected, setIsKeySelected] = useState(!!process.env.API_KEY);
    const [isDesktopLayout, setIsDesktopLayout] = useState(window.matchMedia('(min-width: 768px)').matches);
    const [isLandscape, setIsLandscape] = useState(window.matchMedia('(orientation: landscape)').matches);


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
    const pendingDrawStartRef = useRef(false);

    // --- Core App Logic (Wake Lock, Audio Init, etc.) ---

    useEffect(() => {
        const checkApiKey = async () => {
            // This check is for the case where API_KEY env var is not set,
            // but a key has been selected through the aistudio flow.
            if (!process.env.API_KEY) {
                // @ts-ignore
                if (window.aistudio && await window.aistudio.hasSelectedApiKey()) {
                    setIsKeySelected(true);
                }
            }
        };
        checkApiKey();
    }, []);
    
    useEffect(() => {
        const desktopQuery = window.matchMedia('(min-width: 768px)');
        const orientationQuery = window.matchMedia('(orientation: landscape)');

        const handleDesktopChange = () => setIsDesktopLayout(desktopQuery.matches);
        const handleOrientationChange = () => setIsLandscape(orientationQuery.matches);

        desktopQuery.addEventListener('change', handleDesktopChange);
        orientationQuery.addEventListener('change', handleOrientationChange);

        return () => {
            desktopQuery.removeEventListener('change', handleDesktopChange);
            orientationQuery.removeEventListener('change', handleOrientationChange);
        };
    }, []);


    useEffect(() => {
        const savedDrawing = localStorage.getItem('bloop-bloop-saved-drawing');
        if (savedDrawing) {
            setInitialDrawingUrl(savedDrawing);
        }
    }, []);

    useEffect(() => {
        isAiDrawingRef.current = isAiDrawing;
    }, [isAiDrawing]);
    
    // Effect to manage drawing audio loop
    useEffect(() => {
        if (isAiDrawing) {
            // Stop any currently playing TTS
            audioPlaybackSources.current.forEach(source => source.stop());
            audioPlaybackSources.current.clear();
            nextAudioStartTimeRef.current = 0;

            // Play drawing loop
            const drawingAudio = drawingAudioRef.current;
            if (drawingAudio) {
                drawingAudio.currentTime = 0; // Ensure it starts from the beginning
                drawingAudio.play().catch(e => console.error("Drawing audio play failed:", e));
            }
        } else {
            // Stop drawing loop when not drawing
            const drawingAudio = drawingAudioRef.current;
            if (drawingAudio && !drawingAudio.paused) {
                drawingAudio.pause();
            }
        }
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
        setIsAiDrawing(false);
        pendingDrawStartRef.current = false;
    }, [cleanup]);

    const handleSelectKey = async () => {
        // @ts-ignore
        if (window.aistudio) {
            try {
                // @ts-ignore
                await window.aistudio.openSelectKey();
                setIsKeySelected(true); // Optimistically set to true
            } catch (e) {
                console.error("Failed to open key selection:", e);
                setAiMessage("Could not open API key selection.");
            }
        } else {
            setAiMessage("API key selection is not available here.");
        }
    };

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
        pendingDrawStartRef.current = false;

        try {
            aiRef.current = new GoogleGenAI({ apiKey: process.env.API_KEY! });
            
            inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: INPUT_SAMPLE_RATE });
            outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: OUTPUT_SAMPLE_RATE });
            
            const isWideCanvas = isDesktopLayout || (!isDesktopLayout && isLandscape);
            const gridInstruction = isWideCanvas
                ? "You are in a wide layout (like a landscape monitor or tablet). The canvas has a virtual 4x3 grid (4 columns, 3 rows)."
                : "You are in a tall layout (like a portrait tablet or phone). The canvas has a virtual 3x4 grid (3 columns, 4 rows).";


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
                        
                        try {
                            mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true } });
                        } catch (err) {
                            console.error("Microphone access denied:", err);
                            setStatus('error');
                            setAiMessage("Microphone access denied. Please allow microphone permissions and try again.");
                            sessionPromiseRef.current?.then(session => session.close());
                            cleanup();
                            return;
                        }

                        mediaStreamSourceRef.current = inputAudioContextRef.current!.createMediaStreamSource(mediaStreamRef.current);
                        scriptProcessorRef.current = inputAudioContextRef.current!.createScriptProcessor(AUDIO_BUFFER_SIZE, 1, 1);
                        
                        scriptProcessorRef.current.onaudioprocess = (audioProcessingEvent) => {
                            if (isAiDrawingRef.current) {
                                return; // Don't process microphone input while AI is drawing
                            }
                            const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                            const pcmBlob = createBlob(inputData);
                            sessionPromiseRef.current?.then((session) => {
                                if (!hasSentCanvasForThisTurnRef.current) {
                                    hasSentCanvasForThisTurnRef.current = true;
                                    const imageDataUrl = drawingCanvasRef.current?.getImageDataUrl();
                                    if (imageDataUrl) {
                                        turnCanvasSnapshotRef.current = imageDataUrl;
                                        const base64Data = imageDataUrl.split(',')[1];
                                        session.sendRealtimeInput({ media: { data: base64Data, mimeType: 'image/png' } });
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
                        let errorMessage = 'An error occurred. Please try again.';
                        
                        if (e.message.includes('not found') || e.message.includes('API key not valid')) {
                            errorMessage = 'Connection failed. Please select a valid API key and try again.';
                            setIsKeySelected(false);
                        } else if (e.message.includes('Network error')) {
                            errorMessage = 'Network error. Please check your connection and try again.';
                        }
                        
                        setStatus('error');
                        setAiMessage(errorMessage);
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
                    systemInstruction: `You are Bloop Bloop, a fun AI assistant inside an Etch A Sketch.

**GRID RULES:**
*   ${gridInstruction}
*   When you call \`editDrawing\`, you are regenerating the entire image. You must use the virtual grid to plan the layout.
*   When adding new objects, place them in empty grid cells. Start with a size of 1x1, 1x2, or 2x1 cells.
*   Analyze the existing drawing to know which cells are occupied. Do not overlap drawings unless the user asks.
*   Create a balanced, uncluttered drawing. Spread elements out naturally across the grid.

**CONVERSATION FLOW:**
1.  **Look and Comment:** Your first step is to look at the drawing.
    *   **If the user added something new:** Admire their work with a short, specific, and cheerful comment. (e.g., "Ooh, a little boat! I love it!")
    *   **Then, acknowledge their command:** Immediately follow up by confirming what you're about to draw. (e.g., "A fish for the water? You got it!")
    *   **Combine them:** Say your admiration and acknowledgment together in one go. (e.g., "That's a fantastic car you drew! Okay, one big sun for the sky, on it!")
2.  **Draw Immediately:** Right after your comment, you MUST call the \`editDrawing\` tool. Do not say anything else.
3.  **Announce and Ask:** After the drawing is finished, announce it with a fun, relevant comment (e.g., 'All done! The sun is shining bright!'). Then, ask what's next (e.g., 'What should we add now?').
4.  **Wait Silently:** After you speak, wait silently for the user's turn.

Keep all your comments very short (just a few words), cheerful, and encouraging. The drawing is always a single dark line on a gray background.`,
                    tools: [{ functionDeclarations: [editDrawingFunctionDeclaration, clearCanvasFunctionDeclaration] }],
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
                if (fc.name === 'editDrawing') {
                    setAiMessage(`Drawing: ${fc.args.description}...`);
                    
                    pendingDrawStartRef.current = true;
                    // If the AI has already finished speaking, start the drawing sequence.
                    if (audioPlaybackSources.current.size === 0) {
                        setTimeout(() => {
                            if (audioPlaybackSources.current.size === 0 && pendingDrawStartRef.current) {
                                setIsAiDrawing(true);
                                pendingDrawStartRef.current = false;
                            }
                        }, 100);
                    }
                    
                    try {
                        if (!turnCanvasSnapshotRef.current) {
                          throw new Error("Missing canvas snapshot for this turn.");
                        }
        
                        const imagePart = {
                            inlineData: {
                                mimeType: 'image/png',
                                data: turnCanvasSnapshotRef.current.split(',')[1],
                            },
                        };
                        
                        const isWideCanvas = isDesktopLayout || (!isDesktopLayout && isLandscape);
                        const gridContext = isWideCanvas
                            ? "The canvas has a virtual 4x3 grid (4 columns, 3 rows)."
                            : "The canvas has a virtual 3x4 grid (3 columns, 4 rows).";

                        const textPart = {
                           text: `You are an expert Etch A Sketch artist. You will be given an image of the current drawing and a description of how to change it. Your task is to return a completely new image that incorporates the requested change, redrawing the entire scene in the Etch A Sketch style.

**GRID CONTEXT:** ${gridContext} Use this grid to plan the layout of the new image. When adding a new item, place it in an empty area of the grid. Aim for a balanced, natural composition. The new item should initially occupy a small part of the grid (e.g., 1x1 or 1x2 cells).

**USER REQUEST:** '${fc.args.description}'

**CRITICAL RULES FOR YOUR OUTPUT IMAGE:**
1.  **PRESERVE EXISTING ART:** You must perfectly preserve the scale, position, and line style of all art from the original image. Do not change, move, or resize any part of the drawing that was not requested in the user's prompt.
2.  **COMPLETE IMAGE:** Your output MUST be the full, complete drawing with the change applied. It should contain the original art (preserved perfectly) plus only the new art.
3.  **TRANSPARENT BACKGROUND:** This is the most important rule. The background of your output image MUST be fully transparent. The drawing will be placed on a special gray, textured surface, so any non-transparent background in your image (like white or gray) will cover up the texture and ruin the effect.
4.  **LINE ART STYLE:** All art, new and old, MUST be simple line art using a single, slightly bold, dark gray (#404040) line. It must look like it was drawn with a single continuous line on a real Etch A Sketch. Do not use filled shapes or shading.`
                        };
                        
                        const response = await aiRef.current!.models.generateContent({
                            model: 'gemini-2.5-flash-image',
                            contents: { parts: [imagePart, textPart] },
                            config: { responseModalities: [Modality.IMAGE] },
                        });

                        const part = response.candidates?.[0]?.content?.parts?.[0];
                        if (part?.inlineData) {
                            setAiImageToLoad(`data:${part.inlineData.mimeType};base64,${part.inlineData.data}`);
                        } else {
                            throw new Error("No image data received.");
                        }
                    } catch (error) {
                        console.error("Image generation failed:", error);
                        setAiMessage("Sorry, I couldn't edit the drawing.");
                        setIsAiDrawing(false);
                        toolResponseResult = "error";
                    }

                } else if (fc.name === 'clearCanvas') {
                    setIsShaking(true);
                    await new Promise<void>((resolve) => {
                        setTimeout(() => {
                            drawingCanvasRef.current?.clearCanvas();
                            setIsShaking(false);
                            resolve();
                        }, 500);
                    });
                }
                
                try {
                    const session = await sessionPromiseRef.current;
                    session?.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: toolResponseResult } } });
                } catch (e) {
                    console.warn('Could not send tool response, session may have been closed.', e);
                }
            }
        }

        const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
        if (audioData && outputAudioContextRef.current) {
            if (isAiDrawingRef.current) {
                console.log('Suppressing audio because AI is drawing.');
                return;
            }

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
                // When the audio queue is empty, check if we should start drawing.
                if (audioPlaybackSources.current.size === 0 && pendingDrawStartRef.current) {
                    setTimeout(() => {
                        // Re-check after a delay to ensure no new audio has arrived.
                        if (audioPlaybackSources.current.size === 0 && pendingDrawStartRef.current) {
                            setIsAiDrawing(true);
                            pendingDrawStartRef.current = false;
                        }
                    }, 100); // 100ms of silence
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
            
            if (aiMessage === 'Listening...' && !message.toolCall) {
                setAiMessage('Your turn!');
            }
        }
    };
    
    const handleAiDrawingComplete = useCallback(() => {
        setAiImageToLoad(null);
        setIsAiDrawing(false);
    }, []);

    const handleSaveDrawing = () => {
        const imageDataUrl = drawingCanvasRef.current?.getImageDataUrl();
        if (imageDataUrl) {
            localStorage.setItem('bloop-bloop-saved-drawing', imageDataUrl);
            const currentMessage = aiMessage;
            setAiMessage('Drawing saved!');
            setTimeout(() => {
                setAiMessage(prev => (prev === 'Drawing saved!' ? currentMessage : prev));
            }, 2500);
        }
    };
    
    const handleUndo = () => {
        drawingCanvasRef.current?.undo();
    };

    const handleRedo = () => {
        drawingCanvasRef.current?.redo();
    };

    const handleHistoryUpdate = useCallback((undo: boolean, redo: boolean) => {
        setCanUndo(undo);
        setCanRedo(redo);
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

    const controlButton = (
        <ControlButton
            status={status}
            isKeySelected={isKeySelected}
            onStart={handleStart}
            onStop={handleStop}
            onSelectKey={handleSelectKey}
        />
    );

    const radioPlayer = <RadioPlayer isPlaying={isRadioPlaying} onToggle={toggleRadio} />;


    return (
        <div className="h-full w-full safe-area-padding font-sans box-border flex items-center justify-center">
             <audio
                ref={drawingAudioRef}
                src={DRAWING_LOOP_URL}
                loop
                preload="auto"
            />
            <div className="relative w-full h-full max-w-[1024px] max-h-[768px] aspect-[4/3] bg-red-600 rounded-2xl shadow-2xl p-4 md:p-6 flex flex-col shadow-[inset_0_0_10px_rgba(0,0,0,0.3)]">
                <header className="flex items-center justify-between text-yellow-400">
                    <h1 className="text-2xl md:text-3xl font-pacifico tracking-wider">
                        {(!isDesktopLayout && !isLandscape) ? (
                            <span className="leading-tight">Bloop<br />Bloop</span>
                        ) : (
                            'Bloop Bloop'
                        )}
                    </h1>
                    <div className="flex items-center space-x-2">
                        <button
                            onClick={handleUndo}
                            disabled={!canUndo}
                            className="p-2 rounded-full text-yellow-400 ring-yellow-400 ring-offset-red-600 ring-offset-2 focus:outline-none hover:ring-2 focus:ring-2 disabled:opacity-50 disabled:cursor-not-allowed"
                            aria-label="Undo drawing"
                        >
                            <UndoIcon />
                        </button>
                        <button
                            onClick={handleRedo}
                            disabled={!canRedo}
                            className="p-2 rounded-full text-yellow-400 ring-yellow-400 ring-offset-red-600 ring-offset-2 focus:outline-none hover:ring-2 focus:ring-2 disabled:opacity-50 disabled:cursor-not-allowed"
                            aria-label="Redo drawing"
                        >
                            <RedoIcon />
                        </button>
                         <button
                            onClick={handleSaveDrawing}
                            className="p-2 rounded-full text-yellow-400 ring-yellow-400 ring-offset-red-600 ring-offset-2 focus:outline-none hover:ring-2 focus:ring-2 disabled:opacity-50"
                            aria-label="Save drawing"
                        >
                            <SaveIcon />
                        </button>
                        
                        <StatusIndicator status={status} />

                        <ThemeToggle />
                    </div>
                </header>

                <div className={`flex-1 flex min-h-0 ${!isDesktopLayout && isLandscape ? 'flex-row items-stretch my-4 gap-4' : 'flex-col'}`}>
                    <main className={`bg-red-700 rounded-lg p-2 flex flex-col flex-1 ${!isDesktopLayout && isLandscape ? 'min-w-0' : 'my-4 w-full'}`}>
                        <div className={`flex-1 flex flex-col bg-gray-300 rounded-md overflow-hidden border-2 border-yellow-500 screen-texture`}>
                             <div className="bg-gray-200 p-2 text-gray-800 dark:text-gray-900 font-mono h-12 flex items-center overflow-hidden">
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
                                    aiImageToLoad={aiImageToLoad}
                                    onAiDrawingComplete={handleAiDrawingComplete}
                                    initialDrawingUrl={initialDrawingUrl}
                                    onHistoryUpdate={handleHistoryUpdate}
                                />
                             </div>
                        </div>
                    </main>

                    <footer className={`flex-shrink-0 flex ${!isDesktopLayout && isLandscape ? 'flex-col justify-between items-center w-24 py-2' : 'flex-row w-full justify-between items-center h-24 px-4 md:px-8'}`}>
                        {(!isDesktopLayout && isLandscape) ? (
                            <>
                                {radioPlayer}
                                {controlButton}
                            </>
                        ) : (
                             <>
                                {controlButton}
                                {radioPlayer}
                            </>
                        )}
                    </footer>
                </div>

            </div>
        </div>
    );
};

export default App;