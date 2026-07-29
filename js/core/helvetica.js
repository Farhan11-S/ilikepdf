/* Helvetica metrics, so text can be measured without loading pdf-lib.

   The watermark preview has to know how wide a mark is: that decides how many
   fit across the page, and a preview showing a different number of marks than
   the export is worse than showing none. But the measurement is needed the
   moment a document opens, and pdf-lib is 500 KB that isn't otherwise wanted
   until Export — the whole point of loading it late.

   So the numbers come here instead. They are the Adobe AFM advance widths for
   Helvetica in units of 1/1000 em, for ASCII 32–126, read straight out of
   pdf-lib's own standard-font metrics — which is what makes them agree exactly
   rather than approximately. Anything outside that range falls back to the
   width of "n", close enough for deciding a tile count.

   Regenerate with tests/fixtures/make-metrics.mjs if the pdf-lib pin changes. */

const WIDTHS = [
  278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,
  556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,
  1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,
  667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,
  333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,
  556,556,333,500,278,556,500,722,500,500,500,334,260,334,584
];
const FALLBACK = 556;             // "n"
const HEIGHT = 925;               // ascender 718 − descender −207

export function widthOfText(text, size){
  let units = 0;
  for(const ch of String(text)){
    const c = ch.charCodeAt(0);
    units += (c >= 32 && c <= 126) ? WIDTHS[c - 32] : FALLBACK;
  }
  return units * size / 1000;
}

export function heightOfText(size){
  return HEIGHT * size / 1000;
}
