/* Minimal CEP bridge API used by the local After Effects connector. */
function CSInterface() {}
CSInterface.prototype.evalScript = function (script, callback) {
  if (typeof __adobe_cep__ !== "undefined") {
    __adobe_cep__.evalScript(script, callback || function () {});
  } else if (callback) {
    callback("EvalScript Error: Not in CEP environment");
  }
};
