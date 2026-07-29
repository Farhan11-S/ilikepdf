/* Putting something on a page that carries its own /Rotate.

   pdf-lib draws in the page's *unrotated* coordinate space. A viewer then turns
   the whole page by its /Rotate before showing it. So a page number placed at
   the bottom-right of a page with /Rotate 90 arrives at the reader's top-right,
   lying on its side — the same class of bug the rotate tool had to solve, and
   the reason tests/fixtures/prerotated.pdf exists.

   The fix is to do the arithmetic in *visual* space (what the reader sees) and
   convert at the end. Pure and DOM-free, so it can be unit-tested directly. */

export const norm = deg => ((deg % 360) + 360) % 360;

/* The page as the reader sees it: a quarter-turned page is landscape. */
export function visualSize(width, height, angle){
  return norm(angle) % 180 === 0 ? { w: width, h: height } : { w: height, h: width };
}

/* A point in visual space -> the page's own coordinates.

   Derived from where the corners land. At 90° (clockwise, as viewers apply it)
   the unrotated bottom-left corner appears top-left, so xv = y and yv = W - x;
   these are the inverses of that and its 180/270 equivalents. */
export function toPageSpace(xv, yv, width, height, angle){
  switch(norm(angle)){
    case 90:  return { x: width - yv,  y: xv };
    case 180: return { x: width - xv,  y: height - yv };
    case 270: return { x: yv,          y: height - xv };
    default:  return { x: xv,          y: yv };
  }
}

/* Text drawn with this rotation cancels the page's, so it reads upright.
   pdf-lib rotates counter-clockwise; viewers rotate pages clockwise. */
export const uprightAngle = angle => norm(angle);

/* Where a box of `w`×`h` sits inside a `vw`×`vh` page, `margin` from the edges.
   Anchors are two letters: t/c/b for vertical, l/c/r for horizontal — "bc" is
   bottom-centre. Returns the box's bottom-left corner, which for text is the
   start of the baseline. */
export function anchorPoint(anchor, vw, vh, w, h, margin){
  const [v, hz] = anchor.length === 1 ? ["c", "c"] : anchor.split("");
  const x = hz === "l" ? margin
          : hz === "r" ? vw - margin - w
          : (vw - w) / 2;
  const y = v === "b" ? margin
          : v === "t" ? vh - margin - h
          : (vh - h) / 2;
  return { x, y };
}

/* The same six anchors the position picker offers, in reading order. */
export const ANCHORS = ["tl", "tc", "tr", "bl", "bc", "br"];
