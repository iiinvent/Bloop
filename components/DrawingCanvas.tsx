// Fix: Corrected typo in the 'useImperativeHandle' import.
import React, { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';

interface DrawingCanvasProps {
  shake: boolean;
  aiDrawingToLoad: string | null;
  onAiDrawingComplete: () => void;
}

export interface DrawingCanvasRef {
    getImageDataUrl: () => string;
    clearCanvas: () => void;
}

const DRAW_COLOR = '#404040';
const BG_COLOR = '#cbd5e1'; // This is the Etch A Sketch screen color, it should not change with the theme.
const BRUSH_SIZE = 3;

const DrawingCanvas: React.ForwardRefRenderFunction<DrawingCanvasRef, DrawingCanvasProps> = ({ shake, aiDrawingToLoad, onAiDrawingComplete }, ref) => {
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
      image.crossOrigin = 'anonymous'; 
      image.src = aiDrawingToLoad;

      image.onload = () => {
        const mainCanvas = canvasRef.current;
        const mainCtx = getCanvasContext();
        if (!mainCanvas || !mainCtx) return;

        // DO NOT CLEAR THE CANVAS. We are compositing the new drawing on top.
        // clearCanvas();

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = image.width;
        tempCanvas.height = image.height;
        const tempCtx = tempCanvas.getContext('2d');
        if (!tempCtx) return;
        tempCtx.drawImage(image, 0, 0);

        const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
        const data = imageData.data;
        const drawColor = [64, 64, 64]; // #404040

        // Process pixels: make everything that isn't a dark line transparent,
        // and color the dark lines correctly. This ensures style consistency.
        for (let i = 0; i < data.length; i += 4) {
          const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
          const alpha = data[i + 3];

          // A pixel is part of the line if it's dark and not mostly transparent.
          const isLinePixel = alpha > 100 && brightness < 128;

          if (isLinePixel) {
            // It's a line, so color it correctly and make it fully opaque.
            data[i] = drawColor[0];
            data[i + 1] = drawColor[1];
            data[i + 2] = drawColor[2];
            data[i + 3] = 255;
          } else {
            // It's background, so make it fully transparent.
            data[i + 3] = 0;
          }
        }
        tempCtx.putImageData(imageData, 0, 0);

        // Draw the processed addition onto the main canvas.
        mainCtx.drawImage(tempCanvas, 0, 0, mainCanvas.width, mainCanvas.height);

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
  }, [getCanvasContext]);
  
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