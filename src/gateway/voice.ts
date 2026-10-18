const MIME_FILENAMES: Record<string, string> = {
  "audio/webm": "audio.webm",
  "audio/ogg": "audio.ogg",
  "audio/mpeg": "audio.mp3",
  "audio/mp3": "audio.mp3",
  "audio/wav": "audio.wav",
  "audio/x-wav": "audio.wav",
  "audio/mp4": "audio.m4a",
  "audio/aac": "audio.aac",
  "audio/flac": "audio.flac",
};

export const TTS_MAX_CHARS = 4000;
export const STT_MAX_BASE64_CHARS = 800_000;

export function audioFilenameFor(mimeType: string): string {
  const normalized = String(mimeType || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  return MIME_FILENAMES[normalized] || "audio.webm";
}

export function clampTtsText(text: string): string {
  const trimmed = String(text || "").trim();
  return trimmed.length > TTS_MAX_CHARS ? trimmed.slice(0, TTS_MAX_CHARS) : trimmed;
}

export function voiceAudioError(audio: string, mimeType: string): string | null {
  if (!audio) return "No audio received.";
  if (audio.length > STT_MAX_BASE64_CHARS) return "Audio clip is too long — try a shorter message.";
  if (mimeType && !mimeType.startsWith("audio/")) return "Unsupported audio format.";
  return null;
}
