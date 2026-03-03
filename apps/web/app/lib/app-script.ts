import { appJs } from "../../src/assets.js";

// Patches document.getElementById to return a detached dummy element instead of
// null when the element is not present on the page. This lets the monolithic
// appJs run on sub-pages that only include a subset of the full HTML — buttons
// and text targets that don't exist on the current page become silent no-ops.
const guard = `(function(){
  var _g=document.getElementById.bind(document);
  document.getElementById=function(id){return _g(id)||document.createElement('div');};
})();`;

export function getAppScript(turnstileKey = ""): string {
  return (
    guard +
    appJs.replace(
      "__BURSTFLARE_TURNSTILE_SITE_KEY__",
      JSON.stringify(turnstileKey)
    )
  );
}
