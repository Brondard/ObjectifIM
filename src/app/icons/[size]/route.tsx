import { ImageResponse } from "next/og";

const SIZES = [192, 512];

export function generateStaticParams() {
  return SIZES.map((size) => ({ size: String(size) }));
}

/** Icône de l'application : fond plein (compatible « maskable »), monogramme centré dans la zone sûre. */
export async function GET(_request: Request, { params }: { params: Promise<{ size: string }> }) {
  const size = SIZES.includes(Number((await params).size)) ? Number((await params).size) : 192;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
          background: "#0a0a0a", color: "#ededed", fontSize: size * 0.34, fontWeight: 700, letterSpacing: -size * 0.01,
        }}
      >
        IM
        <div style={{ position: "absolute", bottom: size * 0.27, width: size * 0.3, height: size * 0.03, background: "#2a78d6", borderRadius: size * 0.02 }} />
      </div>
    ),
    { width: size, height: size },
  );
}
