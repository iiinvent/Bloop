import React from 'react';
import type { Status } from '../types';

interface StatusIndicatorProps {
  status: Status;
}

const StatusIndicator: React.FC<StatusIndicatorProps> = ({ status }) => {
  const getStatusInfo = () => {
    switch (status) {
      case 'idle':
        return { text: 'Ready', color: 'bg-yellow-400 animate-pulse' };
      case 'connecting':
        return { text: 'Connecting...', color: 'bg-orange-500 animate-pulse' };
      case 'active':
        return { text: 'Listening', color: 'bg-orange-600 animate-pulse' };
      case 'error':
        return { text: 'Error', color: 'bg-red-500' };
      default:
        return { text: 'Unknown', color: 'bg-gray-400' };
    }
  };

  const { text, color } = getStatusInfo();

  return (
    <div className="flex items-center space-x-2">
      <div className={`w-3 h-3 rounded-full ${color}`}></div>
      <span className="text-sm font-medium text-yellow-400">{text}</span>
    </div>
  );
};

export default StatusIndicator;