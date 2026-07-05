const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.PORT || 3000;
const TARGET = 'https://m.forzza1.com';

app.use('/', createProxyMiddleware({
  target: TARGET,
  changeOrigin: true,
  secure: false,
  followRedirects: true,
  autoRewrite: true,
  cookieDomainRewrite: '',
  on: {
    proxyReq: (proxyReq, req) => {
      proxyReq.setHeader('Host', 'm.forzza1.com');
      proxyReq.setHeader('Origin', 'https://m.forzza1.com');
      proxyReq.setHeader('Referer', 'https://m.forzza1.com/');
      proxyReq.removeHeader('x-forwarded-for');
      proxyReq.removeHeader('cf-connecting-ip');
      proxyReq.removeHeader('cf-ipcountry');
      proxyReq.removeHeader('cf-ray');
      proxyReq.removeHeader('cf-visitor');
    },
    proxyRes: (proxyRes, req, res) => {
      delete proxyRes.headers['x-frame-options'];
      delete proxyRes.headers['content-security-policy'];
      delete proxyRes.headers['x-xss-protection'];
      proxyRes.headers['access-control-allow-origin'] = '*';
      proxyRes.headers['access-control-allow-credentials'] = 'true';
      proxyRes.headers['access-control-allow-methods'] = 'GET,POST,OPTIONS,PUT,DELETE';
      proxyRes.headers['access-control-allow-headers'] = '*';
    }
  }
}));

app.listen(PORT, () => {
  console.log(`Forzza Proxy → ${TARGET} on port ${PORT}`);
});
