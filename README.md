# Voz EN

Extensión de Chrome/Edge: hablás en español y la reunión (Meet, Zoom web, Teams web, Whereby) escucha inglés con voz sintetizada. Todo en el navegador, sin drivers ni programas de terceros, costo cero.

## Cómo funciona

```
micrófono → reconocimiento es-AR (Web Speech) → traducción es→en (Translator API / opus-mt local)
          → voz inglesa (Kokoro-82M, WebGPU o WASM) → micrófono virtual que ve la reunión
```

- `extension/inject.js` (MAIN world) envuelve `getUserMedia`: la reunión recibe un `MediaStreamDestination`. Con la traducción apagada pasa tu micrófono real; con ella encendida, solo la voz inglesa.
- `extension/bridge.js` retransmite audio y modo entre la extensión y la página.
- `extension/engine.html` + `src/engine.js` es la ventana del traductor (reconocimiento, traducción, TTS). Tiene que quedar abierta durante la reunión; si se cierra, el micrófono vuelve solo a "normal" en ~6 s.
- Frases: se traducen apenas hay una pausa de 450 ms o 14 palabras, sin esperar al final de la oración.

## Instalar

```
node build.mjs          # genera extension/engine.js y extension/ort/
```

Chrome/Edge → `chrome://extensions` → Modo desarrollador → "Cargar descomprimida" → carpeta `extension/`.

1. Abrí la reunión (después de instalar, recargá la pestaña) y entrá con el micrófono activado.
2. Clic en el ícono de la extensión → "Empezar". La primera vez descarga ~330 MB (voz con GPU) o ~90 MB (CPU) y el traductor; queda en caché.
3. En la reunión elegí el micrófono por defecto (la extensión lo reemplaza internamente).

## Límites conocidos

- El reconocimiento de voz de Chrome/Edge usa el servicio de voz del navegador (audio a Google/Microsoft); es gratis pero no es 100 % local.
- Latencia medida con GPU: ~1,3 s para una frase de 12 palabras (traducción + síntesis). Sin GPU (WASM) es más lenta.
- Verificado con Edge 156 sobre una página real (whereby.com) y un micrófono real; Meet y Zoom no probados (Meet exige login).
- El audio de la reunión se sigue oyendo normal; "Oír el inglés yo también" reproduce localmente lo que sale.

## Debug en vivo

La ventana del traductor trae un panel de debug (abierto por defecto):

- **Tabla por frase**: `pausa` (última palabra → corte), `trad`, `cola`, `voz`, `enviado` (última palabra → audio enviado), `cola reunión` (espera en el micrófono virtual de la página) y `suena` (lo que realmente vive el otro lado).
- **Resumen**: medianas de las últimas 30 frases, factor de tiempo real de la voz, frases fusionadas por atraso, frases descartadas por la reunión o sin confirmación de la página.
- **Eventos**: texto parcial/final del reconocimiento, cortes y su motivo (`pausa`, `palabras`, `final`), reinicios y errores del reconocimiento.
- **Perillas en vivo** (se guardan): pausa para cortar, máximo y mínimo de palabras.
- **Copiar informe**: JSON completo (config, resumen, frases, eventos) para pegarlo y analizarlo.
