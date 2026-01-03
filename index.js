import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 10000;

// ---------- CORS ----------
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ---------- PROXY ----------
app.get("/", async (req, res) => {
  const target = req.query.url;
  if (!target) return res.status(400).send("Missing url param");

  // 🔐 Update when expires
  const cookie =
    "Edge-Cache-Cookie=URLPrefix=aHR0cHM6Ly9tcHJvZC1jZG4udG9mZmVlbGl2ZS5jb20:Expires=1767503395:KeyName=prod_live_events:Signature=REPLACE_IF_EXPIRED";

  try {
    const headers = {
      "User-Agent": "Toffee (Linux;Android 14)",
      Referer: "https://toffeelive.com/",
      Origin: "https://toffeelive.com/",
      Cookie: cookie,
    };

    if (req.headers.range) headers.Range = req.headers.range;

    const upstream = await fetch(target, { headers, redirect: "follow" });

    const ct = upstream.headers.get("content-type") || "";
    const isPlaylist = target.endsWith(".m3u8") || ct.includes("mpegurl");

    // ---------- PLAYLIST ----------
    if (isPlaylist) {
      const text = await upstream.text();
      const base = target.substring(0, target.lastIndexOf("/") + 1);
      const proxy = `${req.protocol}://${req.get("host")}`;

      const lines = text.split(/\r?\n/);
      let expectUri = false;

      const rewritten = lines.map((line) => {
        if (!line) return line;
        const l = line.trim();

        if (l.startsWith("#")) {
          if (l.startsWith("#EXT-X-KEY") && l.includes('URI="')) {
            return l.replace(/URI="(.*?)"/, (_, p1) => {
              const resolved = p1.startsWith("http")
                ? p1
                : new URL(p1, base).toString();
              return `URI="${proxy}/?url=${encodeURIComponent(resolved)}"`;
            });
          }
          expectUri =
            l.startsWith("#EXTINF") ||
            l.startsWith("#EXT-X-STREAM-INF") ||
            l.startsWith("#EXT-X-MEDIA");
          return l;
        }

        if (expectUri) {
          expectUri = false;
          const resolved = l.startsWith("http")
            ? l
            : new URL(l, base).toString();
          return `${proxy}/?url=${encodeURIComponent(resolved)}`;
        }
        return line;
      }).join("\n");

      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      return res.send(rewritten);
    }

    // ---------- TS / KEY ----------
    res.status(upstream.status);
    upstream.headers.forEach((v, k) => res.setHeader(k, v));
    if (target.endsWith(".ts")) {
      res.setHeader("Content-Type", "video/mp2t");
      res.setHeader("Accept-Ranges", "bytes");
    }
    if (target.endsWith(".key")) {
      res.setHeader("Content-Type", "application/octet-stream");
    }
    upstream.body.pipe(res);
  } catch (e) {
    res.status(500).send("Proxy error: " + e.message);
  }
});

app.listen(PORT, () => {
  console.log("HLS proxy running on port", PORT);
});
