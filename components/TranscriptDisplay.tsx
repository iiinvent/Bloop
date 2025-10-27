import React, { useRef, useEffect } from 'react';
import type { Transcript } from '../types';

interface TranscriptDisplayProps {
  transcripts: Transcript[];
}

const LoadingSpinner: React.FC = () => (
    <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin ml-2"></div>
);

const TranscriptDisplay: React.FC<TranscriptDisplayProps> = ({ transcripts }) => {
  const endOfMessagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endOfMessagesRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcripts]);

  return (
    <div className="flex-1 w-full overflow-y-auto p-4 md:p-6 space-y-4 bg-white dark:bg-gray-800 rounded-lg shadow-inner">
      {transcripts.length === 0 ? (
        <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400">
          <p>Press start to begin the conversation.</p>
        </div>
      ) : (
        transcripts.map((item) => (
          <div key={item.id} className={`flex items-start gap-4 ${item.speaker === 'user' ? 'justify-end' : ''}`}>
            {item.speaker === 'ai' && (
              <div className="w-8 h-8 rounded-full bg-orange-500 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">AI</div>
            )}
            <div className={`max-w-xs md:max-w-md lg:max-w-lg p-3 rounded-lg flex items-center ${
                item.speaker === 'user'
                  ? 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100'
                  : 'bg-orange-100 dark:bg-orange-900 text-orange-900 dark:text-orange-100'
              }`}>
                {item.text && <p className="text-sm break-words">{item.text}</p>}
                {item.isLoading && <LoadingSpinner />}
            </div>
            {item.speaker === 'user' && (
              <div className="w-8 h-8 rounded-full bg-gray-500 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">U</div>
            )}
          </div>
        ))
      )}
      <div ref={endOfMessagesRef} />
    </div>
  );
};

export default TranscriptDisplay;