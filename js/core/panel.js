/* The sticky right-hand action panel: summary, action button, progress, error.
   Knows nothing about any particular tool. */

export function mountPanel(root){
  const summary = root.querySelector(".summary");
  const button  = root.querySelector(".btn-action");
  const bar     = root.querySelector(".bar");
  const error   = root.querySelector(".error");

  return {
    button,

    setSummary(html){
      if(summary) summary.innerHTML = html;
    },

    /* label is optional — pass it to change the button text at the same time. */
    setEnabled(on, label){
      button.disabled = !on;
      if(label !== undefined) button.textContent = label;
    },

    setBusy(on, label){
      button.disabled = on;
      if(label !== undefined) button.textContent = label;
      bar.classList.toggle("on", on);
      if(!on) bar.firstElementChild.style.width = "0";
    },

    /* fraction: 0..1 */
    setProgress(fraction){
      bar.firstElementChild.style.width = Math.round(fraction * 100) + "%";
    },

    setError(msg){
      error.textContent = msg || "";
      error.classList.toggle("on", !!msg);
    },

    onAction(fn){
      button.onclick = fn;
    }
  };
}
