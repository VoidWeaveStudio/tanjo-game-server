// ttsWorker.js
const path = require('path');
const { parentPort, workerData } = require('worker_threads');

// Inference with onnxruntime blocks the thread it runs on for seconds at a time, so it
// runs here rather than on the server's own thread, where it would stall the world tick
// for every player while a bulletin was being read.
const MODEL = 'onnx-community/Kokoro-82M-ONNX';
const DTYPE = 'q8';
const SAMPLE_RATE_FALLBACK = 24000;

let ready = null;

function load() {
  if (!ready) {
    ready = (async () => {
      const transformers = require('@huggingface/transformers');
      transformers.env.cacheDir = workerData.cacheDir;

      const { KokoroTTS } = require('kokoro-js');
      return KokoroTTS.from_pretrained(MODEL, { dtype: DTYPE, device: 'cpu' });
    })();
  }

  return ready;
}

function encodeWav16(samples, sampleRate) {
  const body = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    body.writeInt16LE(Math.round(clamped * 32767), i * 2);
  }

  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + body.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(body.length, 40);

  return Buffer.concat([header, body]);
}

parentPort.on('message', async (job) => {
  try {
    const tts = await load();
    const audio = await tts.generate(job.text, { voice: job.voice });
    const wav = encodeWav16(audio.audio, audio.sampling_rate || SAMPLE_RATE_FALLBACK);
    parentPort.postMessage({ id: job.id, audioBase64: wav.toString('base64') });
  } catch (err) {
    parentPort.postMessage({ id: job.id, error: err.message });
  }
});
