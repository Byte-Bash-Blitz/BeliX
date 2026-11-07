/**
 * audioProcessor.js
 * Handles Opus decoding, PCM resampling (48kHz stereo -> 16kHz mono),
 * WAV header encapsulation, and audio energy / silence calculations.
 */

const prism = require('prism-media');

/**
 * Creates an Opus Decoder stream that outputs raw 48kHz 16-bit stereo PCM.
 * @returns {prism.opus.Decoder}
 */
function createOpusDecoder() {
    return new prism.opus.Decoder({
        rate: 48000,
        channels: 2,
        frameSize: 960
    });
}

/**
 * Resamples 48kHz 16-bit LE stereo PCM to 16kHz 16-bit LE mono PCM.
 * Standard integer downsampling by 3 (48000 / 3 = 16000) and channel averaging.
 * Zero external binary dependencies, high speed, in-memory.
 *
 * @param {Buffer} pcm48kStereo
 * @returns {Buffer} 16kHz 16-bit LE mono PCM
 */
function resample48kStereoTo16kMono(pcm48kStereo) {
    if (!pcm48kStereo || pcm48kStereo.length === 0) {
        return Buffer.alloc(0);
    }

    // 2 bytes per sample * 2 channels = 4 bytes per frame at 48kHz
    const totalFrames48k = Math.floor(pcm48kStereo.length / 4);
    const targetFrames16k = Math.floor(totalFrames48k / 3);
    const outBuffer = Buffer.alloc(targetFrames16k * 2); // 16-bit mono = 2 bytes per sample

    for (let i = 0; i < targetFrames16k; i++) {
        const srcOffset = i * 3 * 4;
        const left = pcm48kStereo.readInt16LE(srcOffset);
        const right = pcm48kStereo.readInt16LE(srcOffset + 2);
        const monoSample = Math.round((left + right) / 2);
        // Clamp to 16-bit signed integer range
        const clamped = Math.max(-32768, Math.min(32767, monoSample));
        outBuffer.writeInt16LE(clamped, i * 2);
    }

    return outBuffer;
}

/**
 * Attaches a standard 44-byte RIFF/WAV header to raw PCM buffer.
 *
 * @param {Buffer} pcmBuffer Raw PCM bytes
 * @param {number} sampleRate e.g. 16000 or 48000
 * @param {number} channels e.g. 1 (mono) or 2 (stereo)
 * @param {number} bitDepth e.g. 16
 * @returns {Buffer} Complete WAV file buffer
 */
function pcmToWav(pcmBuffer, sampleRate = 16000, channels = 1, bitDepth = 16) {
    if (!pcmBuffer) pcmBuffer = Buffer.alloc(0);

    const byteRate = (sampleRate * channels * bitDepth) / 8;
    const blockAlign = (channels * bitDepth) / 8;
    const wavHeader = Buffer.alloc(44);

    // RIFF chunk descriptor
    wavHeader.write('RIFF', 0);
    wavHeader.writeUInt32LE(36 + pcmBuffer.length, 4); // ChunkSize
    wavHeader.write('WAVE', 8);

    // "fmt " sub-chunk
    wavHeader.write('fmt ', 12);
    wavHeader.writeUInt32LE(16, 16);             // Subchunk1Size (16 for PCM)
    wavHeader.writeUInt16LE(1, 20);              // AudioFormat (1 = PCM)
    wavHeader.writeUInt16LE(channels, 22);       // NumChannels
    wavHeader.writeUInt32LE(sampleRate, 24);     // SampleRate
    wavHeader.writeUInt32LE(byteRate, 28);       // ByteRate
    wavHeader.writeUInt16LE(blockAlign, 32);     // BlockAlign
    wavHeader.writeUInt16LE(bitDepth, 34);       // BitsPerSample

    // "data" sub-chunk
    wavHeader.write('data', 36);
    wavHeader.writeUInt32LE(pcmBuffer.length, 40); // Subchunk2Size

    return Buffer.concat([wavHeader, pcmBuffer]);
}

/**
 * Calculates the Root-Mean-Square (RMS) amplitude of 16-bit PCM audio.
 * Useful to distinguish real speech from silence or line noise.
 *
 * @param {Buffer} pcmBuffer 16-bit PCM buffer
 * @returns {number} Normalized RMS value between 0.0 and 1.0
 */
function calculateRms(pcmBuffer) {
    if (!pcmBuffer || pcmBuffer.length < 2) return 0;

    let sumSquares = 0;
    const sampleCount = Math.floor(pcmBuffer.length / 2);

    for (let i = 0; i < sampleCount; i++) {
        const sample = pcmBuffer.readInt16LE(i * 2);
        sumSquares += sample * sample;
    }

    const mean = sumSquares / sampleCount;
    return Math.sqrt(mean) / 32768; // normalize against max 16-bit amplitude
}

/**
 * Checks whether audio is considered silence.
 *
 * @param {Buffer} pcmBuffer
 * @param {number} threshold Default 0.01
 * @returns {boolean}
 */
function isSilence(pcmBuffer, threshold = 0.012) {
    const rms = calculateRms(pcmBuffer);
    return rms < threshold;
}

/**
 * Estimates duration in milliseconds of a PCM buffer given its sample rate and channels.
 *
 * @param {number} bufferLength
 * @param {number} sampleRate
 * @param {number} channels
 * @param {number} bitDepth
 * @returns {number}
 */
function getDurationMs(bufferLength, sampleRate = 16000, channels = 1, bitDepth = 16) {
    const bytesPerSecond = (sampleRate * channels * bitDepth) / 8;
    return (bufferLength / bytesPerSecond) * 1000;
}

module.exports = {
    createOpusDecoder,
    resample48kStereoTo16kMono,
    pcmToWav,
    calculateRms,
    isSilence,
    getDurationMs,
};

