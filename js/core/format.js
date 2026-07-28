/* Small formatters shared across tools. */

export function fileSize(bytes){
  return bytes < 1048576
    ? Math.max(1, Math.round(bytes / 1024)) + " KB"
    : (bytes / 1048576).toFixed(1) + " MB";
}

export function plural(n, word){
  return n + " " + word + (n === 1 ? "" : "s");
}

/* Turns "report.pdf" into "report" so outputs can be named after their source. */
export function baseName(filename){
  return filename.replace(/\.pdf$/i, "") || "document";
}
