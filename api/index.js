const https = require("https");
const http = require("http");
const { URL } = require("url");

const TARGET = "m.forzza1.com";

module.exports = (req, res) => {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS,PUT,DELETE");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  // build target path
  const path = req.url || "/";
  
  const options = {
    hostname: TARGET,
    port: 443,
    path: path,
    method: req.method,
    headers: {
      ...req.headers,
      host: TARGET,
      origin: "https://" + TARGET,
      referer: "https://" + TARGET + "/",
    },
  };

  // remove conflicting headers
  delete options.headers["x-forwarded-for"];
  delete options.headers["x-forwarded-proto"];
  delete options.headers["x-forwarded-host"];
  delete options.headers["cf-connecting-ip"];
  delete options.headers["cf-ipcountry"];
  delete options.headers["cf-ray"];
  delete options.headers["cf-visitor"];

  const proxy = https.request(options, (proxyRes) => {
    // remove security headers
    const headers = { ...proxyRes.headers };
    delete headers["x-frame-options"];
    delete headers["content-security-policy"];
    delete headers["x-xss-protection"];
    headers["access-control-allow-origin"] = "*";
    headers["access-control-allow-credentials"] = "true";

    // fix redirect location
    if (headers["location"] && headers["location"].includes("m.forzza1.com")) {
      headers["location"] = headers["location"].replace("https://m.forzza1.com", "");
    }

    res.writeHead(proxyRes.statusCode, headers);
    proxyRes.pipe(res);
  });

  proxy.on("error", (err) => {
    console.error("Proxy error:", err);
    res.statusCode = 502;
    res.end("Proxy error: " + err.message);
  });

  if (req.method !== "GET" && req.method !== "HEAD") {
    req.pipe(proxy);
  } else {
    proxy.end();
  }
};

