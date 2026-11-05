// The image every marketing page shows when its link is shared (WhatsApp,
// X, LinkedIn, Slack, iMessage…). One file, `public/og.png`, 1200×630 —
// the size Open Graph and `summary_large_image` crop to without letterboxing.
// The dimensions travel with the URL so a crawler can lay out the card on the
// first share instead of after fetching the image.
export const OG_IMAGE = {
  url: "/og.png",
  width: 1200,
  height: 630,
  type: "image/png",
  alt: "OpenLen — Len, your own web developer. Open source.",
} as const;
