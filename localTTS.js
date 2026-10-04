// localTTS.js
const path = require('path');
const { Worker } = require('worker_threads');

// The voice model runs locally because every hosted option wanted a payment card even
// for its free tier. It lives in a worker thread: inference blocks its thread for
// seconds, and on the server's own thread that would freeze the world for everyone.
const DEFAULT_VOICE = 'af_nicole';
const MAX_TEXT_LENGTH = 500;
const JOB_TIMEOUT_MS = 60000;

// Shared with the site's offline generator, so the weights are downloaded once for both.
const CACHE_DIR = process.env.TTS_CACHE_DIR || path.join(__dirname, '..', '.model-cache');

const pending = new Map();
let worker = null;
let nextId = 1;

function settleAll(error) {
  for (const job of pending.values()) {
    clearTimeout(job.timer);
    job.reject(error);
  }
  pending.clear();
}

function ensureWorker() {
  if (worker) return worker;

  worker = new Worker(path.join(__dirname, 'ttsWorker.js'), { workerData: { cacheDir: CACHE_DIR } });

  worker.on('message', (result) => {
    const job = pending.get(result.id);
    if (!job) return;

    clearTimeout(job.timer);
    pending.delete(result.id);

    if (result.error) job.reject(new Error(result.error));
    else job.resolve({ audioBase64: result.audioBase64, mimeType: 'audio/wav' });
  });

  // A dead worker is replaced on the next request rather than wedging the feature for
  // the rest of the server's life.
  worker.on('error', (err) => {
    console.error('[TTS] worker error:', err.message);
    worker = null;
    settleAll(err);
  });

  worker.on('exit', () => {
    worker = null;
    settleAll(new Error('voice worker stopped'));
  });

  return worker;
}

function synthesize({ text, voiceName = DEFAULT_VOICE }) {
  const input = text.slice(0, MAX_TEXT_LENGTH);
  const id = nextId++;
  const target = ensureWorker();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('voice synthesis timed out'));
    }, JOB_TIMEOUT_MS);

    pending.set(id, { resolve, reject, timer });
    target.postMessage({ id, text: input, voice: voiceName });
  });
}

// Loads the model ahead of the first bulletin, so an admin does not pay for the load on
// top of the synthesis. Harmless if it fails — the next request retries.
function warm(voiceName = DEFAULT_VOICE) {
  synthesize({ text: 'System check.', voiceName }).catch((err) => {
    console.error('[TTS] warm-up failed:', err.message);
  });
}

module.exports = { synthesize, warm, DEFAULT_VOICE, MAX_TEXT_LENGTH, CACHE_DIR };
