// Keep upstream sources intact; apply this auditable TV-only build transform.
export function optimizeDisplay(source) {
  function replaceOnce(from,to) {
    if(!source.includes(from))throw new Error('Display optimization anchor changed');
    source=source.replace(from,to);
  }
  replaceOnce('var flashPhase = 0;',`var flashPhase = 0;
  var cachePixels = !border && opts.cachePixels !== false;
  var cellCache = new Int32Array(6144);
  for (var cacheIndex=0;cacheIndex<6144;cacheIndex++)cellCache[cacheIndex]=-1;`);
  replaceOnce('var inkColor, paperColor;',`var cellIndex = imageDataPos >> 3;
      var cellKey = pixelByte | (attributeByte << 8) | (((attributeByte & 128) && (flashPhase & 16)) ? 65536 : 0);
      if (cachePixels && cellCache[cellIndex] === cellKey) {
        imageDataPos += 8;
      } else {
      if (cachePixels) cellCache[cellIndex] = cellKey;
      var inkColor, paperColor;`);
  replaceOnce('pixels[imageDataPos++] = (pixelByte & 0x01) ? inkColor : paperColor;',
    'pixels[imageDataPos++] = (pixelByte & 0x01) ? inkColor : paperColor;\n      }');
  return source;
}
