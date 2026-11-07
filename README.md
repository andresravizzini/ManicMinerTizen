# Manic Miner para Samsung Tizen TV

Manic Miner original de ZX Spectrum en 2D, empaquetado como aplicación web
para Samsung TV con Tizen 3.0 o posterior. Funciona sin PC ni Internet después
de instalarlo. Usa JavaScript ES5, Canvas 2D y Web Audio, sin WebAssembly ni XR.

## Origen

- Desensamblado Z80 de William Humphreys, con aportes de Simon Brattel:
  [WHumphreys/Manic-Miner-Source-Code](https://github.com/WHumphreys/Manic-Miner-Source-Code).
- `ManicMiner.asm` y `ManicMiner.bin` proceden de
  [IxxyXR/Manic-Miner-XR](https://github.com/IxxyXR/Manic-Miner-XR/tree/84f7020f63260675e306146ccdab3ebbf03a9b86).
  Ambos archivos se conservan sin modificar.
- Emulador: [JSSpeccy 2.2.1](https://github.com/gasman/jsspeccy2/tree/488f8ccc394f2af84cf90baa50dd321c80636b25).

La partida mantiene las cavernas, nombres, colores, vidas y reglas originales.
Los controles del televisor traducen una tecla a dirección y salto cuando el
mando no permite pulsaciones simultáneas. El dibujo reutiliza bloques de píxeles
idénticos sin cambiar los tiempos de la CPU emulada.

## Compilar y probar

Requiere Node.js 22 o posterior.

```sh
npm ci
npm run build
npm test
npm run test:browser
npm start
```

La previsualización está en `http://127.0.0.1:8093`. La prueba de navegador
utiliza Google Chrome instalado. La aplicación que se firma está en `tizen/`.
Para generar el WGT y desplegarlo, consultar [INSTALL.md](INSTALL.md).

## Controles

| Acción | Teclas |
|---|---|
| Empezar desde el título | OK / Enter |
| Caminar | Izquierda y derecha / 4 y 6 / Q y P |
| Saltar a izquierda, recto y derecha | 1, 2 y 3 / 7, 8 y 9 |
| Saltar recto | Arriba / espacio / OK |
| Pausa y continuar | Abajo / Play-Pause |
| Salir | Back / Escape |

El sonido se regula con el volumen del televisor. La pantalla conserva 4:3
dentro de la superficie 16:9. El rendimiento y las combinaciones del mando
dependen del modelo de TV.

Manic Miner y la ROM conservan sus derechos originales. La licencia GPL del
emulador y del adaptador no cambia los derechos del juego. Ver
[THIRD-PARTY.md](THIRD-PARTY.md) y `UPSTREAM-NOTICE.txt`.
