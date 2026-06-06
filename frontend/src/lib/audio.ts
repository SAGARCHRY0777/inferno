/**
 * Browser-side audio → 16 kHz mono WAV (base64).
 *
 * The backend Whisper model decodes WAV with `soundfile` (no ffmpeg). So we do
 * all decoding/resampling here using the Web Audio API: decode whatever the mic
 * or an uploaded file gives us, downmix to mono, resample to 16 kHz, and encode
 * PCM16 WAV. Works identically for recorded (webm/opus) and uploaded audio.
 */

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

export async function toWav16k(blob: Blob): Promise<{ b64: string; url: string; seconds: number }> {
  const arrayBuf = await blob.arrayBuffer();
  const AC: typeof AudioContext =
    window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AC();
  const decoded = await ctx.decodeAudioData(arrayBuf.slice(0));
  await ctx.close();

  const targetSr = 16000;
  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * targetSr), targetSr);
  const src = offline.createBufferSource();
  src.buffer = decoded; // connecting to a 1-channel destination downmixes to mono
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();

  const pcm = rendered.getChannelData(0);
  const wav = encodeWav(pcm, targetSr);
  return {
    b64: arrayBufferToBase64(wav),
    url: URL.createObjectURL(new Blob([wav], { type: "audio/wav" })),
    seconds: decoded.duration,
  };
}
