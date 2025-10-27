import React from 'react';

// Icons
const PlayIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
    </svg>
);

const StopIcon: React.FC = () => (
     <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clipRule="evenodd" />
    </svg>
);

interface RadioPlayerProps {
    isPlaying: boolean;
    onToggle: () => void;
}

const RadioPlayer: React.FC<RadioPlayerProps> = ({ isPlaying, onToggle }) => {
    return (
        <button
            onClick={onToggle}
            className="w-16 h-16 md:w-20 md:h-20 rounded-full flex items-center justify-center transition-all duration-150 ease-in-out focus:outline-none focus:ring-4 focus:ring-red-300 bg-slate-200 text-gray-700 border-4 border-yellow-500 shadow-lg shadow-[inset_0_4px_6px_rgba(0,0,0,0.2)] active:shadow-inner active:translate-y-1"
            aria-label={isPlaying ? "Stop kids radio" : "Play kids radio"}
        >
            {isPlaying ? <StopIcon /> : <PlayIcon />}
        </button>
    );
};

export default RadioPlayer;