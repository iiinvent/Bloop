// Fix: Corrected typo in the 'useImperativeHandle' import.
import React, { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';

interface DrawingCanvasProps {
  shake: boolean;
  aiDrawingToLoad: string | null;
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

const DRAW_COLOR = '#404040';
const BG_COLOR = '#cbd5e1'; // This is the Etch A Sketch screen color, it should not change with the theme.
const BRUSH_SIZE = 3;

const DrawingCanvas: React.ForwardRefRenderFunction<DrawingCanvasRef, DrawingCanvasProps> = ({ shake, aiDrawingToLoad, onAiDrawingComplete, initialDrawingUrl, onHistoryUpdate }, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);

  // History state
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const isInitializedRef = useRef(false);

  const getCanvasContext = useCallback(() => {
    return canvasRef.current?.getContext('2d', { willReadFrequently: true });
  }, []);

  const saveState = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (historyIndexRef.current < historyRef.current.length - 1) {
        historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
    }
    
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);

    if (historyRef.current[historyIndexRef.current] === dataUrl) {
      return;
    }

    historyRef.current.push(dataUrl);
    historyIndexRef.current = historyRef.current.length - 1;

    onHistoryUpdate(historyIndexRef.current > 0, false);
  }, [onHistoryUpdate]);

  const redrawCanvasFromHistory = useCallback((index: number) => {
    const dataUrl = historyRef.current[index];
    const canvas = canvasRef.current;
    const ctx = getCanvasContext();
    if (!canvas || !ctx || !dataUrl) return;

    const image = new Image();
    image.src = dataUrl;
    image.onload = () => {
        ctx.fillStyle = BG_COLOR;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    };
  }, [getCanvasContext]);

  const undo = useCallback(() => {
    if (historyIndexRef.current > 0) {
        historyIndexRef.current--;
        redrawCanvasFromHistory(historyIndexRef.current);
        onHistoryUpdate(historyIndexRef.current > 0, true);
    }
  }, [redrawCanvasFromHistory, onHistoryUpdate]);

  const redo = useCallback(() => {
    if (historyIndexRef.current < historyRef.current.length - 1) {
        historyIndexRef.current++;
        redrawCanvasFromHistory(historyIndexRef.current);
        onHistoryUpdate(true, historyIndexRef.current < historyRef.current.length - 1);
    }
  }, [redrawCanvasFromHistory, onHistoryUpdate]);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = getCanvasContext();
    if (!canvas || !ctx) return;
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    saveState();
  }, [getCanvasContext, saveState]);

  useImperativeHandle(ref, () => ({
    getImageDataUrl: () => {
        const canvas = canvasRef.current;
        if (canvas) {
            return canvas.toDataURL('image/jpeg', 0.9);
        }
        return '';
    },
    clearCanvas,
    undo,
    redo,
  }));

  // Effect to make the canvas responsive and set initial state
  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!parent) return;

    const resizeObserver = new ResizeObserver(() => {
      if (canvas && parent) {
        const { width, height } = parent.getBoundingClientRect();
        
        if (canvas.width === width && canvas.height === height) return;

        let contentToPreserve: HTMLCanvasElement | null = null;
        if (canvas.width > 0 && canvas.height > 0) {
            contentToPreserve = document.createElement('canvas');
            contentToPreserve.width = canvas.width;
            contentToPreserve.height = canvas.height;
            const tempCtx = contentToPreserve.getContext('2d');
            tempCtx?.drawImage(canvas, 0, 0);
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = getCanvasContext();
        if (!ctx) return;
        
        ctx.fillStyle = BG_COLOR;
        ctx.fillRect(0, 0, width, height);
        
        if (contentToPreserve) {
            ctx.drawImage(contentToPreserve, 0, 0, width, height);
        }

        if (!isInitializedRef.current) {
            isInitializedRef.current = true;
            if (initialDrawingUrl) {
                const image = new Image();
                image.src = initialDrawingUrl;
                image.onload = () => {
                    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
                    saveState();
                };
            } else {
                saveState();
            }
        }
      }
    });

    resizeObserver.observe(parent);
    
    return () => {
      if(parent) {
        resizeObserver.unobserve(parent);
      }
    };
  }, [getCanvasContext, initialDrawingUrl, saveState]);

  // Effect to load and process AI drawing
  useEffect(() => {
    if (aiDrawingToLoad) {
      const image = new Image();
      image.crossOrigin = 'anonymous'; 
      image.src = aiDrawingToLoad;

      image.onload = () => {
        const mainCanvas = canvasRef.current;
        const mainCtx = getCanvasContext();
        if (!mainCanvas || !mainCtx) return;

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = image.width;
        tempCanvas.height = image.height;
        const tempCtx = tempCanvas.getContext('2d');
        if (!tempCtx) return;
        tempCtx.drawImage(image, 0, 0);

        const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
        const data = imageData.data;
        const drawColor = [64, 64, 64]; // #404040

        for (let i = 0; i < data.length; i += 4) {
          const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
          const alpha = data[i + 3];

          const isLinePixel = alpha > 100 && brightness < 128;

          if (isLinePixel) {
            data[i] = drawColor[0];
            data[i + 1] = drawColor[1];
            data[i + 2] = drawColor[2];
            data[i + 3] = 255;
          } else {
            data[i + 3] = 0;
          }
        }
        tempCtx.putImageData(imageData, 0, 0);
        mainCtx.drawImage(tempCanvas, 0, 0, mainCanvas.width, mainCanvas.height);
        
        saveState();
        onAiDrawingComplete();
      };

      image.onerror = () => {
        console.error("Failed to load AI drawing into canvas.");
        onAiDrawingComplete();
      };
    }
  }, [aiDrawingToLoad, getCanvasContext, onAiDrawingComplete, saveState]);

  // Core drawing logic
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

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
        const ctx = getCanvasContext();
        if (!ctx) return;

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
          isDrawingRef.current = false;
          lastPosRef.current = null;
          saveState();
      }
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
            className={`absolute inset-0 w-full h-full touch-none cursor-crosshair`} 
        />
    </div>
  );
};

export default forwardRef(DrawingCanvas);