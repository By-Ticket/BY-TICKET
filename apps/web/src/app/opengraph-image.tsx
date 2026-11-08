import { ImageResponse } from "next/og";

export const alt = "BY Tickets — Buy. Attend. Earn. Connect.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: 72,
          background: "#1a1220",
          color: "#fff7f0",
        }}
      >
        <div
          style={{
            display: "flex",
            width: 112,
            height: 112,
            borderRadius: 28,
            background: "linear-gradient(135deg, #ffc83d 0%, #f0782a 48%, #e2366b 100%)",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 44,
            fontWeight: 800,
            color: "#1a1220",
          }}
        >
          BY
        </div>
        <div style={{ marginTop: 36, fontSize: 64, fontWeight: 800, letterSpacing: -2 }}>BY Tickets</div>
        <div style={{ marginTop: 12, fontSize: 32, color: "#ffc83d" }}>Buy. Attend. Earn. Connect.</div>
        <div style={{ marginTop: 28, fontSize: 24, color: "#d7b8c4" }}>Tickets for the culture — on Stellar.</div>
      </div>
    ),
    { ...size },
  );
}
