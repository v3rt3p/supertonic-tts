import express, { Request, Response } from 'express'
import { spawn } from 'node:child_process'
import { LRUCache } from 'lru-cache'
import { loadTextToSpeech, loadVoiceStyle, writeWavFile } from './supertonic.js'
import { z } from 'zod'

const port = Number(process.env.PORT ?? 9150)
const assetsPath = process.env.ASSETS_PATH ?? '/app/assets'
const defaultVoice = process.env.DEFAULT_VOICE ?? 'M1'
const defaultLanguage = 'ru'
const defaultSpeed = Number(process.env.DEFAULT_SPEED ?? 1.05)
const maxTextLength = Number(process.env.MAX_TEXT_LENGTH ?? 12000)

const requestSchema = z.object({
  input: z.string().trim().min(1).max(maxTextLength),
  model: z.string().optional(),
  voice: z.string().trim().min(1).optional(),
  response_format: z.enum(['wav', 'opus', 'mp3', 'aac', 'flac', 'pcm']).default('opus'),
  speed: z.number().finite().min(0.25).max(4).default(defaultSpeed),
  language: z.string().trim().min(2).optional(),
}).passthrough().superRefine((value, context) => {
  if (value.language && value.language.toLowerCase() !== 'ru') {
    context.addIssue({ code: 'custom', path: ['language'], message: 'Only Russian (ru) is supported' })
  }
})

const onnxDir = `${assetsPath}/onnx`
const voiceStylesDir = `${assetsPath}/voice_styles`
let textToSpeech: any
let voiceStyleCache = new Map<string, any>()
let initPromise: Promise<void> | undefined

const cache = new LRUCache<string, Buffer>({
  max: Number(process.env.CACHE_SIZE ?? 256),
})

function ensureInitialized (): Promise<void> {
  initPromise ??= loadTextToSpeech(onnxDir, false).then((loaded: any) => {
    textToSpeech = loaded
  }).catch(error => {
    initPromise = undefined
    throw error
  })
  return initPromise
}

async function convert (wav: Buffer, format: string): Promise<Buffer> {
  if (format === 'wav') return wav

  const codec = format === 'opus'
    ? ['-c:a', 'libopus', '-f', 'ogg']
    : format === 'mp3'
      ? ['-c:a', 'libmp3lame', '-f', 'mp3']
      : format === 'aac'
        ? ['-c:a', 'aac', '-f', 'adts']
        : format === 'flac'
          ? ['-c:a', 'flac', '-f', 'flac']
          : ['-f', 's16le', '-acodec', 'pcm_s16le']

  return await new Promise<Buffer>((resolve, reject) => {
    const child = spawn('ffmpeg', [
      '-nostdin', '-hide_banner', '-loglevel', 'error', '-i', 'pipe:0',
      '-ac', '1', '-ar', '44100', ...codec, 'pipe:1',
    ])
    const chunks: Buffer[] = []
    const errors: Buffer[] = []
    child.stdout.on('data', chunk => chunks.push(Buffer.from(chunk)))
    child.stderr.on('data', chunk => errors.push(Buffer.from(chunk)))
    child.once('error', reject)
    child.once('close', code => {
      if (code === 0) resolve(Buffer.concat(chunks))
      else reject(new Error(Buffer.concat(errors).toString('utf8') || `ffmpeg exited with ${code}`))
    })
    child.stdin.end(wav)
  })
}

function contentType (format: string): string {
  if (format === 'opus') return 'audio/ogg; codecs=opus'
  if (format === 'pcm') return 'audio/pcm; rate=44100'
  return `audio/${format}`
}

async function handler (request: Request, response: Response): Promise<void> {
  const parsed = requestSchema.safeParse(request.body)
  if (!parsed.success) {
    response.status(400).json({ error: { message: parsed.error.message, type: 'invalid_request_error' } })
    return
  }

  const data = parsed.data
  const voice = data.voice ?? defaultVoice
  const language = defaultLanguage
  const key = JSON.stringify([data.input, voice, language, data.response_format, data.speed])

  try {
    await ensureInitialized()
    let audio = cache.get(key)
    if (!audio) {
      const style = voiceStyleCache.get(voice) ?? loadVoiceStyle([`${voiceStylesDir}/${voice}.json`])
      voiceStyleCache.set(voice, style)
      const result = await textToSpeech.call(data.input, language, style, 8, data.speed)
      const wavPath = `/tmp/supertonic-${process.pid}-${Date.now()}.wav`
      writeWavFile(wavPath, result.wav.slice(0, Math.floor(textToSpeech.sampleRate * result.duration[0])), textToSpeech.sampleRate)
      const wav = await import('node:fs/promises').then(fs => fs.readFile(wavPath))
      await import('node:fs/promises').then(fs => fs.unlink(wavPath))
      audio = await convert(wav, data.response_format)
      cache.set(key, audio)
    }
    response.status(200).type(contentType(data.response_format)).send(audio)
  } catch (error) {
    console.error('TTS request failed:', error)
    response.status(500).json({ error: { message: 'Speech synthesis failed', type: 'server_error' } })
  }
}

const app = express()
app.use(express.json({ limit: '1mb' }))
app.get('/health', (_request, response) => response.json({ status: 'ok' }))
app.post('/v1/audio/speech', handler)
app.post('/audio/speech', handler)

app.listen(port, () => {
  console.log(`Supertonic TTS listening on :${port}`)
  ensureInitialized().then(() => console.log('Supertonic model initialized')).catch(error => console.error('Model initialization failed:', error))
})
