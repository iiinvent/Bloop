// Fix: Added missing Status type definition to resolve import errors across components.
export type Status = 'idle' | 'connecting' | 'active' | 'error';

// Fix: Added missing Transcript type definition to resolve import errors across components.
export type Transcript = {
  id: string;
  speaker: 'user' | 'ai';
  text?: string;
  image?: string;
  isLoading?: boolean;
};
