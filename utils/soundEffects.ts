
// A generic function to play a sound with a given frequency and duration
const playSound = (audioContext: AudioContext, frequency: number, type: OscillatorType, duration: number, volume: number) => {
    if (!audioContext || audioContext.state === 'suspended') {
        audioContext.resume();
    }
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);

    // ADSR-like envelope for a "plucky" sound
    gainNode.gain.setValueAtTime(0, audioContext.currentTime);
    gainNode.gain.linearRampToValueAtTime(volume, audioContext.currentTime + 0.01); // Quick attack
    gainNode.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + duration); // Decay

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + duration);
};

/**
 * Plays a sound for starting the session.
 * @param audioContext The AudioContext to use for playing the sound.
 */
export const playStartSound = (audioContext: AudioContext | null) => {
    if (!audioContext) return;
    // A clear, positive "tick" - A5 note
    playSound(audioContext, 880, 'triangle', 0.1, 0.2);
};

/**
 * Plays a sound for stopping the session.
 * @param audioContext The AudioContext to use for playing the sound.
 */
export const playStopSound = (audioContext: AudioContext | null) => {
    if (!audioContext) return;
    // A lower, more final "tock" - A4 note
    playSound(audioContext, 440, 'triangle', 0.1, 0.2);
};

/**
 * Plays a sound for sending a drawing.
 * @param audioContext The AudioContext to use for playing the sound.
 */
export const playSendSound = (audioContext: AudioContext | null) => {
    if (!audioContext) return;
    // A quick ascending "swoosh" sound
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.type = 'sine';
    const now = audioContext.currentTime;
    oscillator.frequency.setValueAtTime(600, now);
    oscillator.frequency.exponentialRampToValueAtTime(1200, now + 0.1);

    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(0.3, now + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);

    oscillator.start(now);
    oscillator.stop(now + 0.1);
};

/**
 * Plays a sound for receiving an AI response chunk.
 * @param audioContext The AudioContext to use for playing the sound.
 */
export const playResponseSound = (audioContext: AudioContext | null) => {
    if (!audioContext) return;
    // A very subtle, low "bloop" - A3 note
    playSound(audioContext, 220, 'sine', 0.15, 0.1);
};