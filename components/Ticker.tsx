
import React from 'react';

interface TickerProps {
  text: string;
}

const Ticker: React.FC<TickerProps> = ({ text }) => {
  // To avoid jarring animation for short text, display it statically.
  // A simple character count is a good proxy for width.
  if (text.length < 40) {
    return (
      <div className="w-full text-center">
        <span>{text}</span>
      </div>
    );
  }

  // Calculate a dynamic duration to maintain a consistent scroll speed (e.g., 15 chars/sec).
  const duration = text.length / 15;
  const animationStyle = {
    animationDuration: `${duration}s`,
  };

  // Add spacing with a visual separator for a clean loop.
  const spacedText = `${text} \u00A0\u00A0\u00A0|\u00A0\u00A0\u00A0 `;

  return (
    <div className="w-full overflow-hidden whitespace-nowrap">
      <span
        className="inline-block animate-scroll-left"
        style={animationStyle}
      >
        {spacedText.repeat(2)}
      </span>
    </div>
  );
};

export default Ticker;
