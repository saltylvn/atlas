// Atlas Autofill on a job site's page after you submit: if the page says the application went
// in, the extension marks it so its popup can offer "Mark submitted" for that job. It reads the
// page's text only, once, and sends only the page's address to the extension's own background.
(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  const DONE = /thank(s| you) for (applying|your (application|interest))|application (has been |was )?(submitted|received|sent|complete)|we('ve| have) received your application|your application (is|has been) (in|on its way)|successfully applied/i;
  const check = () => {
    const text = String((document.body && document.body.innerText) || "").slice(0, 20000);
    if (DONE.test(text)) api.runtime.sendMessage({ type: "submitted-page", url: location.href }).catch(() => undefined);
    return DONE.test(text);
  };
  if (!check()) setTimeout(check, 2500);
})();
