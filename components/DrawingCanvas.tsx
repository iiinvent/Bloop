import React, { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';

interface DrawingCanvasProps {
  disabled: boolean;
  aiDrawingToLoad: string | null;
  onAiDrawingComplete: () => void;
}

export interface DrawingCanvasRef {
    getImageDataUrl: () => string;
    clearCanvas: () => void;
}

const DRAW_COLOR = '#404040'; // A dark gray
const BG_COLOR = '#cbd5e1'; // slate-300
const BRUSH_SIZE = 3;

const DrawingCanvas: React.ForwardRefRenderFunction<DrawingCanvasRef, DrawingCanvasProps> = ({ disabled, aiDrawingToLoad, onAiDrawingComplete }, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);

  const getCanvasContext = useCallback(() => {
    return canvasRef.current?.getContext('2d', { willReadFrequently: true });
  }, []);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = getCanvasContext();
    if (!canvas || !ctx) return;
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, [getCanvasContext]);

  useImperativeHandle(ref, () => ({
    getImageDataUrl: () => {
        const canvas = canvasRef.current;
        if (canvas) {
            return canvas.toDataURL('image/jpeg', 0.9);
        }
        return '';
    },
    clearCanvas: () => {
        clearCanvas();
    }
  }));

  // Effect to make the canvas responsive, preserving content
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

        clearCanvas();

        if (contentToPreserve) {
            getCanvasContext()?.drawImage(contentToPreserve, 0, 0, width, height);
        }
      }
    });

    resizeObserver.observe(parent);
    
    return () => {
      if(parent) {
        resizeObserver.unobserve(parent);
      }
    };
  }, [clearCanvas, getCanvasContext]);
  
  // Effect to load and process AI drawing
  useEffect(() => {
    if (aiDrawingToLoad) {
      const image = new Image();
      image.crossOrigin = 'anonymous'; // Necessary for canvas security with external images
      image.src = aiDrawingToLoad;

      image.onload = () => {
        const mainCanvas = canvasRef.current;
        const mainCtx = getCanvasContext();
        if (!mainCanvas || !mainCtx) return;

        // The AI image is processed and drawn on top of the existing canvas content.
        // We do NOT clear the canvas, to allow for collaboration.

        // Create an off-screen canvas for processing the image
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = image.width;
        tempCanvas.height = image.height;
        const tempCtx = tempCanvas.getContext('2d');
        if (!tempCtx) return;

        // 1. Draw the loaded image to the temp canvas
        tempCtx.drawImage(image, 0, 0);

        // 2. Get the pixel data from the temp canvas
        const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
        const data = imageData.data;
        const drawColorR = 64, drawColorG = 64, drawColorB = 64; // #404040

        // 3. Process every pixel
        for (let i = 0; i < data.length; i += 4) {
          const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
          // If the pixel is light (like a white background), make it transparent
          if (brightness > 220) {
            data[i + 3] = 0; // Set alpha to 0
          } else {
            // If the pixel is dark (the line art), set it to the Etch A Sketch draw color
            data[i] = drawColorR;
            data[i + 1] = drawColorG;
            data[i + 2] = drawColorB;
            data[i + 3] = 255; // Ensure it's fully opaque
          }
        }
        
        // 4. Put the modified pixel data back onto the temp canvas
        tempCtx.putImageData(imageData, 0, 0);

        // 5. Draw the processed image from the temp canvas to the main, visible canvas
        const hRatio = mainCanvas.width / tempCanvas.width;
        const vRatio = mainCanvas.height / tempCanvas.height;
        const ratio = Math.min(hRatio, vRatio, 0.95); // Use 0.95 to add a little padding
        const centerShiftX = (mainCanvas.width - tempCanvas.width * ratio) / 2;
        const centerShiftY = (mainCanvas.height - tempCanvas.height * ratio) / 2;
        mainCtx.drawImage(tempCanvas, centerShiftX, centerShiftY, tempCanvas.width * ratio, tempCanvas.height * ratio);

        onAiDrawingComplete();
      };

      image.onerror = () => {
        console.error("Failed to load AI drawing into canvas.");
        onAiDrawingComplete();
      };
    }
  }, [aiDrawingToLoad, getCanvasContext, onAiDrawingComplete]);

  // Core drawing logic
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || disabled) return;

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
  }, [disabled, getCanvasContext]);

  return (
    <div className="relative w-full h-full">
        <canvas 
            ref={canvasRef} 
            className={`absolute inset-0 w-full h-full touch-none ${disabled ? 'cursor-not-allowed' : 'cursor-crosshair'}`} 
        />
        {disabled && (
            <div className="absolute inset-0 bg-gray-500 bg-opacity-20 flex items-center justify-center text-gray-800 font-bold cursor-not-allowed">
            </div>
        )}
    </div>
  );
};

export default forwardRef(DrawingCanvas);