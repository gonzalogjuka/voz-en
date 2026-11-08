# Voz EN: estado y cómo retomar

Repo público: https://github.com/gonzalogjuka/voz-en (rama `master`). Copia local: `D:/Repos/voz-en`.

## Qué hay

| Archivo | Rol |
|---|---|
| `extension/manifest.json` | MV3. Content scripts en Meet, Zoom, Teams, Whereby (`inject.js` en MAIN world, `bridge.js` aislado). |
| `extension/inject.js` | Envuelve `navigator.mediaDevices.getUserMedia`. La reunión recibe un `MediaStreamDestination`: micrófono real (bypass) o voz inglesa (modo traducción). Agenda los buffers de audio y confirma con `played`/`dropped` + espera de cola. |
| `extension/bridge.js` | Relé extensión ↔ página. Modo efectivo = `translate` en `storage.local` **y** latido (`beat`) de menos de 6 s. Decodifica el PCM Int16/base64 que llega por `tabs.sendMessage`. |
| `extension/background.js` | Abre la ventana del traductor al hacer clic en el ícono; registra qué pestañas tienen el micrófono enganchado (`storage.session`). |
| `extension/engine.html` + `src/engine.js` | Ventana del traductor: reconocimiento `es-AR` (Web Speech), traducción (`Translator` API o `Xenova/opus-mt-es-en`), voz (Kokoro-82M, WebGPU fp32 o WASM q8), cola de frases, envío a las pestañas. |
| `src/debug.js` | Panel de debug: tiempos por frase, resumen, eventos, perillas (pausa, mín./máx. palabras), informe JSON. |
| `build.mjs` | esbuild: `src/engine.js` → `extension/engine.js`; copia `ort-wasm-simd-threaded.jsep.{mjs,wasm}` a `extension/ort/`. |

`extension/engine.js` y `extension/ort/` no se versionan: `node build.mjs`.

## Verificado (Edge 156, Windows)

- La extensión carga sin errores (`--load-extension`).
- `inject.js` sobre una página real (whereby.com, micrófono real): envuelve el stream y conserva el `label`.
- `inject.js` con micrófono falso: bypass 0,39 RMS; modo traducción en silencio 0; voz inyectada 0,28; vuelta a bypass 0,40.
- Motor completo con reconocimiento simulado: traducción del navegador + voz en GPU; 1,1 a 1,5 s desde la última palabra hasta que suena.
- Texto de prueba: "Hola, buenas tardes… avance del proyecto" → "Hello, good afternoon everyone. Today I want to show you the progress of the project."

## No verificado

- Reconocimiento con voz humana real (solo se simuló).
- Meet, Zoom web y Teams web (Meet exige login; los otros usan su propio manejo del micrófono).
- Chrome, Brave, Opera, Vivaldi (solo Edge).
- Rendimiento sin WebGPU (camino WASM).
- Reuniones largas: memoria, reinicios del reconocimiento (Chrome corta la sesión tras silencios; se reinicia solo en `onend`).

## Compatibilidad

Solo Chromium con extensiones MV3 (Chrome 113+, Edge). Brave bloquea el reconocimiento de voz de Google. Firefox y Safari no tienen `SpeechRecognition` y Firefox no admite `background.service_worker`. Celulares: sin extensiones. Apps de escritorio de Zoom/Teams: no aplica (solo clientes web).

## Hallazgos de la prueba

- Cortar por cantidad de palabras (`maxWords` 14) parte cláusulas y degrada la traducción ("…falta poco para el final de" → traducción repetida). Cortar por pausa da mejor resultado. Candidatos: subir `maxWords`, o cortar solo en pausa/puntuación.
- La voz es el tramo más lento (~850 ms por frase de ~6 s de audio, ×0,17 tiempo real); la traducción tarda ~45 ms.
- El reconocimiento de Chrome/Edge manda el audio a Google/Microsoft: gratis pero no 100 % local.

## Próximos pasos (por prioridad)

1. Prueba en vivo con voz real en una reunión; copiar el informe del panel de debug y ajustar `pausa`/`maxWords`.
2. Medir Chrome y el camino WASM; decidir si se agrega un modelo local de voz a texto (Whisper) para Firefox/Brave y para no depender del servicio del navegador.
3. Probar Meet y Zoom web; si alguno crea el micrófono fuera de `getUserMedia` (por ejemplo en un iframe aislado), ajustar `matches` y `all_frames`.
4. Streaming de la voz (`tts.stream`) para empezar a sonar antes de terminar la frase.
5. Empaquetar para la Chrome Web Store (ícono, política de privacidad); hoy se instala descomprimida.

## Trampas de entorno (Windows / omp)

- `npm` falla en el shell: `node "C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js"` con el parámetro `cwd` del bash (un `cd` relativo rompe y deja `node_modules` en `D:/Repos`).
- Para probar sin instalar: servir `extension/` por HTTP y simular `chrome.*` con un script de inicio; el puerto 8765 ya estaba ocupado en esta PC, se usó 18765.
- `--load-extension` funciona en Edge 156 con `--disable-features=DisableLoadExtensionCommandLineSwitch` y un `--user-data-dir` propio.
