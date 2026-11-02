import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// The favicon mark, full-bleed: iOS applies its own rounded mask.
export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        backgroundColor: "#0f1218",
      }}
    >
      <svg viewBox="0 0 64 64" width="180" height="180">
        <polyline
          points="10,46 24,34 34,39 54,18"
          fill="none"
          stroke="#6ee7b7"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="54" cy="18" r="5" fill="#6ee7b7" />
      </svg>
    </div>,
    size,
  );
}
