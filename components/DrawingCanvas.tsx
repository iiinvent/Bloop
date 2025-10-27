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
// The background color is now set by the parent element in App.tsx. The canvas is made transparent
// to ensure that saved/loaded drawings are treated as layers without an opaque background.
const BRUSH_SIZE = 4;


const DrawingCanvas: React.ForwardRefRenderFunction<DrawingCanvasRef, DrawingCanvasProps> = ({ shake, aiDrawingToLoad, onAiDrawingComplete, initialDrawingUrl, onHistoryUpdate }, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null); // The visible canvas
  
  // State for layer-based history
  const layersRef = useRef<HTMLCanvasElement[]>([]); // Array of offscreen canvases, each is a layer
  const historyIndexRef = useRef(-1); // Points to the top-most visible layer in layersRef
  
  // State for live user drawing
  const isDrawingRef = useRef(false);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);
  
  const isInitializedRef = useRef(false);

  const getCanvasContext = useCallback(() => {
    return canvasRef.current?.getContext('2d');
  }, []);

  // Renders all visible layers onto the main canvas
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = getCanvasContext();
    if (!canvas || !ctx) return;

    // 1. Clear the canvas to be transparent. The background color is shown from the parent div.
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 2. Draw all visible layers from history
    for (let i = 0; i <= historyIndexRef.current; i++) {
        const layer = layersRef.current[i];
        if (layer) {
            ctx.drawImage(layer, 0, 0);
        }
    }
  }, [getCanvasContext]);

  const addLayer = useCallback((newLayer: HTMLCanvasElement) => {
    // If we have undone, we need to discard the "future" layers
    if (historyIndexRef.current < layersRef.current.length - 1) {
        layersRef.current = layersRef.current.slice(0, historyIndexRef.current + 1);
    }
    
    layersRef.current.push(newLayer);
    historyIndexRef.current++;
    
    // The new layer is drawn on top of the existing canvas content for immediate feedback
    const mainCtx = getCanvasContext();
    if (mainCtx) {
        mainCtx.drawImage(newLayer, 0, 0);
    }

    onHistoryUpdate(historyIndexRef.current > -1, false);
  }, [getCanvasContext, onHistoryUpdate]);

  const undo = useCallback(() => {
    if (historyIndexRef.current > -1) {
        historyIndexRef.current--;
        renderCanvas();
        onHistoryUpdate(historyIndexRef.current > -1, true);
    }
  }, [renderCanvas, onHistoryUpdate]);

  const redo = useCallback(() => {
    if (historyIndexRef.current < layersRef.current.length - 1) {
        historyIndexRef.current++;
        renderCanvas();
        onHistoryUpdate(true, historyIndexRef.current < layersRef.current.length - 1);
    }
  }, [renderCanvas, onHistoryUpdate]);

  const clearCanvas = useCallback(() => {
    layersRef.current = [];
    historyIndexRef.current = -1;
    renderCanvas();
    onHistoryUpdate(false, false);
  }, [renderCanvas, onHistoryUpdate]);

  useImperativeHandle(ref, () => ({
    getImageDataUrl: () => {
        const canvas = canvasRef.current;
        // The visible canvas is kept up-to-date, so we can export it directly.
        // Since the canvas is now transparent, this will be a transparent PNG of the lines.
        return canvas ? canvas.toDataURL('image/png') : '';
    },
    clearCanvas,
    undo,
    redo,
  }));

  // Effect to make the canvas responsive and set initial state
  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;

    const resizeObserver = new ResizeObserver(() => {
        const { width, height } = parent.getBoundingClientRect();
        
        if (canvas.width === width && canvas.height === height) return;

        // Resize all offscreen layer canvases, preserving their content
        const newLayers: HTMLCanvasElement[] = layersRef.current.map(oldLayer => {
            const newLayer = document.createElement('canvas');
            newLayer.width = width;
            newLayer.height = height;
            const ctx = newLayer.getContext('2d');
            ctx?.drawImage(oldLayer, 0, 0, width, height);
            return newLayer;
        });
        layersRef.current = newLayers;

        // Resize the main visible canvas
        canvas.width = width;
        canvas.height = height;
        
        // Rerender everything at the new size
        renderCanvas();

        if (!isInitializedRef.current) {
            isInitializedRef.current = true;
            if (initialDrawingUrl) {
                const image = new Image();
                image.src = initialDrawingUrl;
                image.onload = () => {
                    const initialLayer = document.createElement('canvas');
                    initialLayer.width = canvas.width;
                    initialLayer.height = canvas.height;
                    const ctx = initialLayer.getContext('2d');
                    ctx?.drawImage(image, 0, 0, canvas.width, canvas.height);
                    addLayer(initialLayer);
                };
            } else {
              // Start with a clean slate
              clearCanvas();
            }
        }
    });

    resizeObserver.observe(parent);
    
    return () => { if(parent) resizeObserver.unobserve(parent); };
  }, [renderCanvas, initialDrawingUrl, addLayer, clearCanvas]);

  // Effect to load and render AI drawing as a new layer
  useEffect(() => {
    if (aiDrawingToLoad) {
      const mainCanvas = canvasRef.current;
      if (!mainCanvas) return;

      const aiImage = new Image();
      aiImage.crossOrigin = 'anonymous';
      aiImage.src = aiDrawingToLoad;

      aiImage.onload = () => {
        const newLayer = document.createElement('canvas');
        newLayer.width = mainCanvas.width;
        newLayer.height = mainCanvas.height;
        const ctx = newLayer.getContext('2d');
        if (!ctx) return;
        
        ctx.drawImage(aiImage, 0, 0, mainCanvas.width, mainCanvas.height);
        
        addLayer(newLayer);
        onAiDrawingComplete();
      };

      aiImage.onerror = () => {
        console.error('Failed to load AI image layer.');
        onAiDrawingComplete();
      };
    }
  }, [aiDrawingToLoad, addLayer, onAiDrawingComplete]);

  // Core drawing logic for user input
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let currentStrokeLayer: HTMLCanvasElement | null = null;

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

        // Create a new transparent layer for this drawing stroke
        currentStrokeLayer = document.createElement('canvas');
        currentStrokeLayer.width = canvas.width;
        currentStrokeLayer.height = canvas.height;
      }
    };

    const handleMove = (event: MouseEvent | TouchEvent) => {
      if (!isDrawingRef.current) return;
      if (event.cancelable) event.preventDefault();

      const coords = getCoordinates(event);
      const lastPos = lastPosRef.current;
      
      if (coords && lastPos && currentStrokeLayer) {
        const tempCtx = currentStrokeLayer.getContext('2d');
        const mainCtx = getCanvasContext();
        if (!tempCtx || !mainCtx) return;

        // Common draw function
        const drawSegment = (ctx: CanvasRenderingContext2D) => {
          ctx.beginPath();
          ctx.moveTo(lastPos.x, lastPos.y);
          ctx.lineTo(coords.x, coords.y);
          ctx.strokeStyle = DRAW_COLOR;
          ctx.lineWidth = BRUSH_SIZE;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.stroke();
        };

        // Draw on the temporary offscreen layer (to capture the full stroke)
        drawSegment(tempCtx);
        // And draw on the main canvas for immediate feedback
        drawSegment(mainCtx);
        
        lastPosRef.current = coords;
      }
    };

    const handleEnd = () => {
      if (isDrawingRef.current && currentStrokeLayer) {
          // The main canvas already has the visual of the stroke from handleMove.
          // We now add the isolated stroke layer to our history stack.
          addLayer(currentStrokeLayer);
      }
      isDrawingRef.current = false;
      lastPosRef.current = null;
      currentStrokeLayer = null; // Clear temp layer
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
  }, [getCanvasContext, addLayer]);
  
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