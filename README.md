# supertonic-tts

OpenAI-compatible HTTP service backed by **Supertonic 3**. This service is Russian-only: every request is synthesized with `lang: "ru"` and requests using another language are rejected. The model runs locally through ONNX Runtime; no external TTS API is used.

## Model files

The service expects the Supertonic 3 assets in `ASSETS_PATH` (default `/app/assets`):

```text
assets/
├── onnx/
│   ├── duration_predictor.onnx
│   ├── text_encoder.onnx
│   ├── vector_estimator.onnx
│   ├── vocoder.onnx
│   ├── tts.json
│   └── unicode_indexer.json
└── voice_styles/
    ├── M1.json
    └── ...
```

Download the Russian-capable Supertonic 3 model before starting the container:

```bash
hf download supertone-oss-archive/supertonic-3 \
  --revision aafc6e32416a594460b32413efc49d7fe4ce6d46 \
  --local-dir ./supertonic-tts/assets
```

When running Compose, mount the downloaded directory or copy it into the persistent `supertonic-assets` volume. The Dockerfile also includes `assets/` when that directory exists in the build context.

## API

`POST /v1/audio/speech` and `/audio/speech` accept the OpenAI speech request shape:

```json
{
  "model": "supertonic",
  "input": "Привет от Supertonic",
  "voice": "M1",
  "response_format": "opus",
  "speed": 1.05
}
```

Supported voices are `M1`-`M5` and `F1`-`F5`. Russian is the only supported language and is selected automatically. The default response is Ogg Opus, matching the existing Quasar OpenAI backend.

```bash
curl http://localhost:9150/v1/audio/speech \
  -H 'content-type: application/json' \
  -d '{"model":"supertonic","input":"Привет","voice":"M1","response_format":"opus"}' \
  --output answer.ogg
```

Environment: `PORT`, `ASSETS_PATH`, `DEFAULT_VOICE`, `DEFAULT_SPEED`, `CACHE_SIZE`, and `MAX_TEXT_LENGTH`.
