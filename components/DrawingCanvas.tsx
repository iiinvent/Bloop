

import React, { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';

interface DrawingCanvasProps {
  shake: boolean;
  aiImageToLoad: string | null;
  onAiDrawingComplete: () => void;
  initialDrawingUrl: string | null;
  onHistoryUpdate: (canUndo: boolean, canRedo: boolean) => void;
}

export interface DrawingCanvasRef {
    getImageDataUrl: () => string;
    clearCanvas: () => void;
    undo: () => void;
    redo: () => void;
}

const BG_COLOR = '#d1d5db'; // Corresponds to Tailwind's gray-300
const DRAW_COLOR = '#404040';
const BRUSH_SIZE = 4;

const DrawingCanvas: React.ForwardRefRenderFunction<DrawingCanvasRef, DrawingCanvasProps> = ({ shake, aiImageToLoad, onAiDrawingComplete, initialDrawingUrl, onHistoryUpdate }, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // History state using data URLs instead of layers
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  
  const isDrawingRef = useRef(false);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);
  
  const isInitializedRef = useRef(false);
  const resizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getCanvasContext = useCallback(() => {
    return canvasRef.current?.getContext('2d');
  }, []);

  const saveState = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dataUrl = canvas.toDataURL('image/png');

    // If we have undone, we need to discard the "future" history
    if (historyIndexRef.current < historyRef.current.length - 1) {
        historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
    }
    
    historyRef.current.push(dataUrl);
    historyIndexRef.current++;
    
    onHistoryUpdate(historyIndexRef.current > 0, false);
  }, [onHistoryUpdate]);

  const restoreState = useCallback((index: number) => {
    const canvas = canvasRef.current;
    const ctx = getCanvasContext();
    if (!canvas || !ctx || !historyRef.current[index]) return;

    const dataUrl = historyRef.current[index];
    const image = new Image();
    image.src = dataUrl;
    image.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // Draw the restored image, scaling it to the current canvas dimensions
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    };
  }, [getCanvasContext]);

  const undo = useCallback(() => {
    if (historyIndexRef.current > 0) {
        historyIndexRef.current--;
        restoreState(historyIndexRef.current);
        onHistoryUpdate(historyIndexRef.current > 0, true);
    }
  }, [restoreState, onHistoryUpdate]);

  const redo = useCallback(() => {
    if (historyIndexRef.current < historyRef.current.length - 1) {
        historyIndexRef.current++;
        restoreState(historyIndexRef.current);
        onHistoryUpdate(true, historyIndexRef.current < historyRef.current.length - 1);
    }
  }, [restoreState, onHistoryUpdate]);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = getCanvasContext();
    if (!canvas || !ctx) return;
    
    // Set initial canvas size on first clear
    if (canvas.width === 0 || canvas.height === 0) {
        const parent = canvas.parentElement;
        if (parent) {
            const { width, height } = parent.getBoundingClientRect();
            canvas.width = width;
            canvas.height = height;
        }
    }
    
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    historyRef.current = [];
    historyIndexRef.current = -1;
    saveState(); // Save the initial blank state
  }, [getCanvasContext, saveState]);


  useImperativeHandle(ref, () => ({
    getImageDataUrl: () => {
        return canvasRef.current ? canvasRef.current.toDataURL('image/png') : '';
    },
    clearCanvas,
    undo,
    redo,
  }));

  // Effect for canvas initialization and debounced resizing
  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;
    
    const handleResize = () => {
        if (resizeTimeoutRef.current) {
            clearTimeout(resizeTimeoutRef.current);
        }
        
        canvas.classList.add('opacity-0');

        resizeTimeoutRef.current = setTimeout(() => {
            const { width, height } = parent.getBoundingClientRect();
            
            if (canvas.width === width && canvas.height === height) {
                canvas.classList.remove('opacity-0');
                return;
            };
            
            const lastStateUrl = historyRef.current[historyIndexRef.current];

            canvas.width = width;
            canvas.height = height;

            if (lastStateUrl) {
                const image = new Image();
                image.src = lastStateUrl;
                image.onload = () => {
                    const ctx = getCanvasContext();
                    ctx?.drawImage(image, 0, 0, width, height);
                    canvas.classList.remove('opacity-0');
                };
                image.onerror = () => {
                    console.error("Failed to reload canvas state on resize.");
                    canvas.classList.remove('opacity-0');
                }
            } else {
                canvas.classList.remove('opacity-0');
            }
        }, 100); // Debounce for 100ms
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(parent);

    // Run initial setup only once
    if (!isInitializedRef.current) {
        isInitializedRef.current = true;
        
        const { width, height } = parent.getBoundingClientRect();
        canvas.width = width;
        canvas.height = height;
        
        if (initialDrawingUrl) {
            const image = new Image();
            image.src = initialDrawingUrl;
            image.onload = () => {
                const ctx = getCanvasContext();
                ctx?.drawImage(image, 0, 0, canvas.width, canvas.height);
                saveState(); // Save initial drawing
            };
        } else {
            clearCanvas();
        }
    }
    
    return () => { 
        resizeObserver.unobserve(parent);
        if (resizeTimeoutRef.current) {
            clearTimeout(resizeTimeoutRef.current);
        }
    };
  }, [getCanvasContext, initialDrawingUrl, saveState, clearCanvas]);

  // Effect to load and render AI drawing
  useEffect(() => {
    if (aiImageToLoad) {
      const canvas = canvasRef.current;
      const ctx = getCanvasContext();
      if (!canvas || !ctx) return;

      const aiImage = new Image();
      aiImage.crossOrigin = 'anonymous';
      aiImage.src = aiImageToLoad;
      
      aiImage.onload = () => {
        // The AI provides the full new image, so we fill the background then draw.
        ctx.fillStyle = BG_COLOR;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(aiImage, 0, 0, canvas.width, canvas.height);
        
        // Save the new state and notify completion.
        saveState();
        onAiDrawingComplete();
      };

      aiImage.onerror = () => {
        console.error('Failed to load AI image.');
        onAiDrawingComplete(); // still need to signal completion to unblock UI
      };
    }
  }, [aiImageToLoad, saveState, getCanvasContext, onAiDrawingComplete]);
  
  // Core drawing logic for user input
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = getCanvasContext();
    if (!canvas || !ctx) return;

    const getCoordinates = (event: MouseEvent | TouchEvent): { x: number; y: number } | null => {
      const rect = canvas.getBoundingClientRect();
      const clientX = 'touches' in event ? event.touches[0].clientX : event.clientX;
      const clientY = 'touches' in event ? event.touches[0].clientY : event.clientY;
      return { x: clientX - rect.left, y: clientY - rect.top };
    };
    
    const handleStart = (event: MouseEvent | TouchEvent) => {
      const coords = getCoordinates(event);
      if (coords) {
        isDrawingRef.current = true;
        lastPosRef.current = coords;
      }
    };

    const handleMove = (event: MouseEvent | TouchEvent) => {
      if (!isDrawingRef.current) return;
      if (event.cancelable) event.preventDefault();

      const coords = getCoordinates(event);
      const lastPos = lastPosRef.current;
      
      if (coords && lastPos) {
          ctx.beginPath();
          ctx.moveTo(lastPos.x, lastPos.y);
          ctx.lineTo(coords.x, coords.y);
          ctx.strokeStyle = DRAW_COLOR;
          ctx.lineWidth = BRUSH_SIZE;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.stroke();
          
          lastPosRef.current = coords;
      }
    };

    const handleEnd = () => {
      if (isDrawingRef.current) {
          saveState();
      }
      isDrawingRef.current = false;
      lastPosRef.current = null;
    };

    canvas.addEventListener('mousedown', handleStart);
    canvas.addEventListener('touchstart', handleStart);
    canvas.addEventListener('mousemove', handleMove);
    canvas.addEventListener('touchmove', handleMove, { passive: false });
    canvas.addEventListener('mouseup', handleEnd);
    canvas.addEventListener('touchend', handleEnd);
    canvas.addEventListener('mouseleave', handleEnd);

    return () => {
      canvas.removeEventListener('mousedown', handleStart);
      canvas.removeEventListener('touchstart', handleStart);
      canvas.removeEventListener('mousemove', handleMove);
      canvas.removeEventListener('touchmove', handleMove);
      canvas.removeEventListener('mouseup', handleEnd);
      canvas.removeEventListener('touchend', handleEnd);
      canvas.removeEventListener('mouseleave', handleEnd);
    };
  }, [getCanvasContext, saveState]);
  
  // Apply shake animation
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas && shake) {
        canvas.parentElement?.classList.add('shake-animation');
        setTimeout(() => {
            canvas.parentElement?.classList.remove('shake-animation');
        }, 500); // Duration matches CSS
    }
  }, [shake])

  return (
    <div className="relative w-full h-full">
        <canvas 
            ref={canvasRef} 
            className="absolute inset-0 w-full h-full touch-none cursor-crosshair transition-opacity duration-200" 
        />
    </div>
  );
};

export default forwardRef(DrawingCanvas);