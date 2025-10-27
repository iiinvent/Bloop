import React, { useRef, useEffect, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { useTheme } from '../contexts/ThemeContext';

interface DrawingCanvasProps {
  disabled: boolean;
  aiDrawingToLoad: string | null;
  onAiDrawingComplete: () => void;
}

export interface DrawingCanvasRef {
    getImageDataUrl: () => string;
    clearCanvas: () => void;
}

// Icon components for the toolbar
const PenIcon = () => (
    <svg xmlns="http://www.w.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828z" /><path fillRule="evenodd" d="M2 6a2 2 0 012-2h4a1 1 0 010 2H4v10h10v-4a1 1 0 112 0v4a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clipRule="evenodd" /></svg>
);
const EraserIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" /></svg>
);
const UndoIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor"><path d="M12.5 8C9.81 8 7.45 8.99 5.6 10.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/></svg>
);
const RedoIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor"><path d="M18.4 10.6C16.55 8.99 14.19 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.96 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z"/></svg>
);


const DrawingCanvas: React.ForwardRefRenderFunction<DrawingCanvasRef, DrawingCanvasProps> = ({ disabled, aiDrawingToLoad, onAiDrawingComplete }, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { theme } = useTheme();
  
  // Drawing tool state
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const [color, setColor] = useState(theme === 'dark' ? '#FFFFFF' : '#000000');
  const [brushSize, setBrushSize] = useState(5);

  // State for undo/redo
  const [history, setHistory] = useState<ImageData[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

  // Refs for event handlers to avoid stale closures
  const isDrawingRef = useRef(false);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);

  // Update default pen color when theme changes
  useEffect(() => {
    setColor(theme === 'dark' ? '#FFFFFF' : '#000000');
  }, [theme]);

  const getCanvasContext = useCallback(() => {
    return canvasRef.current?.getContext('2d', { willReadFrequently: true });
  }, []);

  const clearAndSaveInitialState = useCallback((initialImage: HTMLImageElement | null = null) => {
    const canvas = canvasRef.current;
    const ctx = getCanvasContext();
    if (!canvas || !ctx) return;

    ctx.fillStyle = theme === 'dark' ? '#374151' : '#F9FAFB'; // gray-700 dark, gray-50 light
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (initialImage) {
        const hRatio = canvas.width / initialImage.width;
        const vRatio = canvas.height / initialImage.height;
        const ratio = Math.min(hRatio, vRatio, 1); // Ensure we don't scale up
        const centerShift_x = (canvas.width - initialImage.width * ratio) / 2;
        const centerShift_y = (canvas.height - initialImage.height * ratio) / 2;
        ctx.drawImage(initialImage, 0, 0, initialImage.width, initialImage.height,
                      centerShift_x, centerShift_y, initialImage.width * ratio, initialImage.height * ratio);
    }

    const initialImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    setHistory([initialImageData]);
    setHistoryIndex(0);
  }, [getCanvasContext, theme]);

    useImperativeHandle(ref, () => ({
        getImageDataUrl: () => {
            const canvas = canvasRef.current;
            if (canvas) {
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = canvas.width;
                tempCanvas.height = canvas.height;
                const tempCtx = tempCanvas.getContext('2d');
                if (tempCtx) {
                    tempCtx.fillStyle = theme === 'dark' ? '#1f2937' : '#ffffff';
                    tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
                    tempCtx.drawImage(canvas, 0, 0);
                }
                return tempCanvas.toDataURL('image/jpeg', 0.9);
            }
            return '';
        },
        clearCanvas: () => {
            clearAndSaveInitialState();
        }
    }));


  // Effect to make the canvas responsive and initialize history
  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!parent) return;

    const resizeObserver = new ResizeObserver(() => {
      if (canvas && parent) {
        const { width, height } = parent.getBoundingClientRect();
        canvas.width = width;
        canvas.height = height;
        clearAndSaveInitialState();
      }
    });
    resizeObserver.observe(parent);
    return () => resizeObserver.unobserve(parent);
  }, [clearAndSaveInitialState]);
  
  // Effect to load AI drawing onto canvas
  useEffect(() => {
    if (aiDrawingToLoad) {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.src = aiDrawingToLoad;
      image.onload = () => {
        clearAndSaveInitialState(image);
        onAiDrawingComplete();
      };
      image.onerror = () => {
        console.error("Failed to load AI drawing into canvas.");
        onAiDrawingComplete(); // Still need to signal completion
      };
    }
  }, [aiDrawingToLoad, clearAndSaveInitialState, onAiDrawingComplete]);

  // The core drawing logic, using direct event listeners for better mobile performance
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || disabled) return;

    const getCoordinates = (event: MouseEvent | TouchEvent): { x: number; y: number } | null => {
      const rect = canvas.getBoundingClientRect();
      const clientX = 'touches' in event ? event.touches[0].clientX : event.clientX;
      const clientY = 'touches' in event ? event.touches[0].clientY : event.clientY;
      return { x: clientX - rect.left, y: clientY - rect.top };
    };
    
    const saveState = () => {
        const ctx = getCanvasContext();
        if(!ctx) return;
        
        const imageData = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
        const newHistory = history.slice(0, historyIndex + 1);
        newHistory.push(imageData);

        setHistory(newHistory);
        setHistoryIndex(newHistory.length - 1);
    }

    const handleStart = (event: MouseEvent | TouchEvent) => {
      const coords = getCoordinates(event);
      if (coords) {
        isDrawingRef.current = true;
        lastPosRef.current = coords;
        const ctx = getCanvasContext();
        if(!ctx) return;
        
        // Draw a dot on tap/click
        ctx.beginPath();
        ctx.arc(coords.x, coords.y, brushSize / 2, 0, 2 * Math.PI);
        ctx.fillStyle = tool === 'pen' ? color : (theme === 'dark' ? '#374151' : '#F9FAFB');
        ctx.fill();
      }
    };

    const handleMove = (event: MouseEvent | TouchEvent) => {
      if (!isDrawingRef.current) return;
      if (event.cancelable) event.preventDefault(); // Prevent scrolling on mobile

      const coords = getCoordinates(event);
      const lastPos = lastPosRef.current;
      if (coords && lastPos) {
        const ctx = getCanvasContext();
        if (!ctx) return;

        ctx.beginPath();
        ctx.moveTo(lastPos.x, lastPos.y);
        ctx.lineTo(coords.x, coords.y);
        
        ctx.strokeStyle = tool === 'pen' ? color : (theme === 'dark' ? '#374151' : '#F9FAFB');
        ctx.lineWidth = brushSize;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
        
        lastPosRef.current = coords;
      }
    };

    const handleEnd = () => {
      if (!isDrawingRef.current) return;
      isDrawingRef.current = false;
      lastPosRef.current = null;
      saveState();
    };

    canvas.addEventListener('mousedown', handleStart);
    canvas.addEventListener('touchstart', handleStart);
    canvas.addEventListener('mousemove', handleMove);
    canvas.addEventListener('touchmove', handleMove, { passive: false }); // Critical for mobile
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
  }, [disabled, tool, color, brushSize, theme, getCanvasContext, history, historyIndex]);
  
  const handleUndo = useCallback(() => {
    if (!canUndo) return;
    const newIndex = historyIndex - 1;
    setHistoryIndex(newIndex);
    const ctx = getCanvasContext();
    if(ctx) {
        ctx.putImageData(history[newIndex], 0, 0);
    }
  }, [canUndo, history, historyIndex, getCanvasContext]);

  const handleRedo = useCallback(() => {
    if (!canRedo) return;
    const newIndex = historyIndex + 1;
    setHistoryIndex(newIndex);
    const ctx = getCanvasContext();
    if(ctx) {
        ctx.putImageData(history[newIndex], 0, 0);
    }
  }, [canRedo, history, historyIndex, getCanvasContext]);

  return (
    <div className="flex flex-col h-full w-full bg-gray-50 dark:bg-gray-700 rounded-lg shadow-inner overflow-hidden">
      <div className="relative flex-1 w-full h-full">
        <canvas ref={canvasRef} className={`absolute inset-0 w-full h-full touch-none ${disabled ? 'cursor-not-allowed' : 'cursor-crosshair'}`} />
        {disabled && (
          <div className="absolute inset-0 bg-gray-400 bg-opacity-50 flex items-center justify-center text-white font-bold cursor-not-allowed">
            <p className="bg-black bg-opacity-50 px-4 py-2 rounded-md">Press Start to Draw</p>
          </div>
        )}
      </div>
      <div className="p-2 border-t border-gray-200 dark:border-gray-600 flex items-center justify-between flex-wrap gap-2">
         <div className="flex items-center gap-2">
            <button onClick={() => setTool('pen')} disabled={disabled} className={`p-2 rounded-md ${tool === 'pen' ? 'bg-orange-500 text-white' : 'bg-gray-200 dark:bg-gray-600'} disabled:opacity-50`} title="Pen"><PenIcon /></button>
            <button onClick={() => setTool('eraser')} disabled={disabled} className={`p-2 rounded-md ${tool === 'eraser' ? 'bg-orange-500 text-white' : 'bg-gray-200 dark:bg-gray-600'} disabled:opacity-50`} title="Eraser"><EraserIcon /></button>
            <button onClick={handleUndo} disabled={disabled || !canUndo} className="p-2 rounded-md bg-gray-200 dark:bg-gray-600 disabled:opacity-50" title="Undo"><UndoIcon /></button>
            <button onClick={handleRedo} disabled={disabled || !canRedo} className="p-2 rounded-md bg-gray-200 dark:bg-gray-600 disabled:opacity-50" title="Redo"><RedoIcon /></button>
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} disabled={disabled || tool === 'eraser'} className="w-8 h-8 p-0 border-none rounded-md bg-transparent cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed" title="Color"/>
            <input type="range" min="1" max="50" value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} disabled={disabled} className="w-24 cursor-pointer disabled:opacity-50" title="Brush Size"/>
         </div>
         <div className="flex items-center gap-2">
            <button onClick={() => clearAndSaveInitialState()} disabled={disabled} className="px-3 py-2 text-sm font-medium text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300 disabled:opacity-50 dark:bg-gray-600 dark:text-gray-200 dark:hover:bg-gray-500">Clear</button>
         </div>
      </div>
    </div>
  );
};

export default forwardRef(DrawingCanvas);