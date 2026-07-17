import assert from "node:assert/strict";
import test from "node:test";

import { buildSignatureCardSharedCss, buildSkinCss } from "../src/skin-css.mjs";

test("builds one fast generic skin from a theme and image data URL", () => {
  const css = buildSkinCss({
    theme: {
      id: "miku-488137",
      colors: { accent: "#19c9e5", secondary: "#ed6ec1", surface: "#f5f6fc", text: "#122c60" },
      copy: { brand: "Miku Codex", headline: "一起创造吧" },
    },
    heroDataUrl: "data:image/webp;base64,AAAA",
  });

  assert.match(css, /HEIGE_CODEX_SKIN:miku-488137/);
  assert.match(css, /data:image\/webp;base64,AAAA/);
  assert.match(css, /\.app-shell-left-panel/);
  assert.match(css, /\.composer-surface-chrome/);
  assert.match(
    css,
    /\[data-local-conversation-final-assistant\]\s*\{[^}]*background:\s*transparent[^}]*box-shadow:\s*none/s,
  );
  assert.match(
    css,
    /\.composer-surface-chrome,[\s\S]*background:\s*color-mix\(in srgb, var\(--heige-surface\) 60%, transparent\)/,
  );
  assert.doesNotMatch(
    css,
    /\.composer-surface-chrome,[\s\S]*\[data-local-conversation-final-assistant\],[\s\S]*var\(--heige-surface\) 88%/,
  );
  assert.match(css, /pointer-events:\s*none/);
  assert.doesNotMatch(css, /https?:\/\//);
});

test("rejects invalid colors instead of emitting arbitrary CSS", () => {
  assert.throws(
    () => buildSkinCss({ theme: { id: "bad", colors: { accent: "red;display:none" } }, heroDataUrl: "data:image/png;base64,AA" }),
    /颜色/,
  );
});

test("rejects 5 and 7 digit hex colors that CSS cannot parse", () => {
  const hero = "data:image/png;base64,iVBORw0KGgo=";
  for (const bad of ["#12345", "#1234567"]) {
    assert.throws(
      () => buildSkinCss({ theme: { id: "t", colors: { accent: bad } }, heroDataUrl: hero }),
      /无效主题颜色/,
      `${bad} 应被拒绝`,
    );
  }
  for (const good of ["#123", "#1234", "#123456", "#12345678"]) {
    assert.doesNotThrow(
      () => buildSkinCss({ theme: { id: "t", colors: { accent: good } }, heroDataUrl: hero }),
      `${good} 应通过`,
    );
  }
});

test("builds a modular signature card without duplicating the hero", () => {
  const hero = "data:image/webp;base64,SEVSTw==";
  const css = buildSkinCss({
    theme: { id: "genshin-night", name: "原神 · 星夜" },
    heroDataUrl: hero,
    signatureCard: true,
  });

  assert.equal(css.split(hero).length - 1, 1);
  assert.match(css, /--heige-hero-image:/);
  assert.match(css, /--heige-card-artwork-image:\s*var\(--heige-hero-image\)/);
  assert.match(css, /body::before/);
  assert.match(css, /body::after/);
  assert.match(css, /content:\s*"原神 · 星夜"\s*"\\A"\s*"By@HeiGe"/);
  assert.match(css, /--heige-signature-card-frame-image/);
  assert.match(css, /pointer-events:\s*none/);
  assert.match(css, /max-width:\s*899px/);
  assert.match(css, /max-height:\s*649px/);
});

test("optional card artwork replaces only the modular card image", () => {
  const css = buildSkinCss({
    theme: { id: "custom-art", name: "独立画芯" },
    heroDataUrl: "data:image/webp;base64,SEVSTw==",
    cardArtworkDataUrl: "data:image/png;base64,Q0FSRA==",
    signatureCard: true,
  });

  assert.match(css, /--heige-card-artwork-image:\s*url\("data:image\/png;base64,Q0FSRA=="\)/);
});

test("legacy polaroid remains the only card path for Miku", () => {
  const css = buildSkinCss({
    theme: { id: "miku-488137", name: "Miku 488137" },
    heroDataUrl: "data:image/webp;base64,SEVSTw==",
    polaroidDataUrl: "data:image/webp;base64,UE9MQVJPSUQ=",
    signatureCard: true,
  });

  assert.doesNotMatch(css, /--heige-card-artwork-image/);
  assert.equal(css.split("UE9MQVJPSUQ=").length - 1, 1);
});

test("builds one strict shared signature-card frame declaration", () => {
  const frame = "data:image/png;base64,RlJBTUU=";
  assert.equal(
    buildSignatureCardSharedCss(frame),
    ':root{--heige-signature-card-frame-image:url("data:image/png;base64,RlJBTUU=");}',
  );
  assert.throws(
    () => buildSignatureCardSharedCss("data:image/webp;base64,RlJBTUU="),
    /PNG/,
  );
});
