import React from 'react';
import type { Status } from '../types';

const MicIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 md:h-8 md:w-8" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8h-1a6 6 0 11-12 0H3a7.001 7.001 0 006 6.93V17H7v1h6v-1h-2v-2.07z" clipRule="evenodd" />
    </svg>
);

const StopIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 md:h-8 md:w-8" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clipRule="evenodd" />
    </svg>
);

const SpinnerIcon: React.FC = () => (
    <svg className="animate-spin h-6 w-6 md:h-8 md:w-8 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
);


interface ControlButtonProps {
  status: Status;
  onStart: () => void;
  onStop: () => void;
}

const ControlButton: React.FC<ControlButtonProps> = ({ status, onStart, onStop }) => {
  const isDisabled = status === 'connecting';
  const isActive = status === 'active';

  const getButtonContent = () => {
    switch (status) {
      case 'connecting':
        return { icon: <SpinnerIcon />, text: 'Connecting' };
      case 'active':
        return { icon: <StopIcon />, text: 'Stop' };
      case 'error':
        return { icon: <MicIcon />, text: 'Retry' };
      case 'idle':
      default:
        return { icon: <MicIcon />, text: 'Start' };
    }
  };

  const { icon, text } = getButtonContent();

  const baseClasses = 'w-16 h-16 md:w-20 md:h-20 rounded-full flex items-center justify-center transition-all duration-300 ease-in-out focus:outline-none focus:ring-4 shadow-lg';
  const colorClasses = isActive 
    ? 'bg-red-600 hover:bg-red-700 focus:ring-red-400' 
    : 'bg-orange-600 hover:bg-orange-700 focus:ring-orange-400';
  const disabledClasses = isDisabled ? 'opacity-50 cursor-not-allowed' : '';
  
  return (
    <button
      onClick={isActive ? onStop : onStart}
      disabled={isDisabled}
      className={`${baseClasses} ${colorClasses} ${disabledClasses} text-white`}
      aria-label={`${text} Conversation`}
    >
      {icon}
    </button>
  );
};

export default ControlButton;