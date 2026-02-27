/**************************************************************************************************
 * ADOBE SYSTEMS INCORPORATED
 * Copyright 2013 Adobe Systems Incorporated
 * All Rights Reserved.
 *
 * NOTICE:  Adobe permits you to use, modify, and distribute this file in accordance with the
 * terms of the Adobe license agreement accompanying it.  If you have received this file from a
 * source other than Adobe, then your use, modification, or distribution of it requires the prior
 * written permission of Adobe.
 *
 * CSInterface.js - v12.0.0 (minimal shim for MCP Bridge)
 * Download the full version from: https://github.com/nicscott9/CSInterface
 **************************************************************************************************/

/**
 * CSInterface class for Adobe CEP extensions.
 * This is a minimal implementation. For production use, download the full
 * CSInterface.js from Adobe's GitHub repository.
 */
function CSInterface() {}

/**
 * Evaluates an ExtendScript in the host application.
 * @param {string} script - The ExtendScript to evaluate.
 * @param {function} callback - Callback with the result string.
 */
CSInterface.prototype.evalScript = function (script, callback) {
  if (typeof __adobe_cep__ !== "undefined") {
    var result = __adobe_cep__.evalScript(script);
    if (callback) {
      // CSInterface v9+ uses async callback
      if (typeof result === "undefined" || result === "undefined") {
        // v9+ path: callback is registered and called asynchronously
        // The __adobe_cep__.evalScript already handles the callback via internal mechanism
      }
      callback(result);
    }
  } else {
    // Running outside CEP (for testing)
    console.warn("[CSInterface] Not running in CEP environment");
    if (callback) callback("EvalScript Error: Not in CEP environment");
  }
};

/**
 * Get the host environment.
 */
CSInterface.prototype.getHostEnvironment = function () {
  if (typeof __adobe_cep__ !== "undefined") {
    try {
      return JSON.parse(__adobe_cep__.getHostEnvironment());
    } catch (e) {
      return null;
    }
  }
  return null;
};

/**
 * Get the system path.
 * @param {string} pathType - The path type constant.
 */
CSInterface.prototype.getSystemPath = function (pathType) {
  if (typeof __adobe_cep__ !== "undefined") {
    return __adobe_cep__.getSystemPath(pathType);
  }
  return "";
};

// System path constants
CSInterface.prototype.EXTENSION_ID = "extensionId";

// Note: This is a minimal shim. For the full CSInterface.js, download from:
// https://github.com/nicscott9/CSInterface
// and replace this file with the appropriate version for your CEP target.
