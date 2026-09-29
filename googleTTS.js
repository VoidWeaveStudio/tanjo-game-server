// googleTTS.js
const ENDPOINT = 'https://texttospeech.googleapis.com/v1/text:synthesize';
const DEFAULT_VOICE = 'en-US-Neural2-D';
const MAX_TEXT_LENGTH = 500;

// "en-US-Neural2-D" -> "en-US". Google wants the language code alongside the voice
// name, so one env var is enough to switch the anchor to another language.
function languageOf(voiceName) {
  const parts = voiceName.split('-');
  return parts.length >= 2 ? `${parts[0]}-${parts[1]}` : 'en-US';
}

async function synthesize({ apiKey, text, voiceName = DEFAULT_VOICE, speakingRate = 1 }) {
  if (!apiKey) throw new Error('GOOGLE_TTS_API_KEY not set');

  const input = text.slice(0, MAX_TEXT_LENGTH);

  const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      input: { text: input },
      voice: { languageCode: languageOf(voiceName), name: voiceName },
      audioConfig: { audioEncoding: 'MP3', speakingRate },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Google TTS ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  if (typeof data.audioContent !== 'string' || data.audioContent.length === 0) {
    throw new Error('Google TTS returned no audio');
  }

  return { audioBase64: data.audioContent, mimeType: 'audio/mpeg' };
}

module.exports = { synthesize, DEFAULT_VOICE, MAX_TEXT_LENGTH };
