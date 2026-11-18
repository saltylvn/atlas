import { ImageResponse } from "next/og";
import { AppMark } from "@/components/AppMark";

// Home-screen and manifest icons, drawn in code and rendered to PNG at build time.
export function generateImageMetadata() {
  return [
    { id: "small", size: { width: 192, height: 192 }, contentType: "image/png" },
    { id: "large", size: { width: 512, height: 512 }, contentType: "image/png" },
  ];
}

export default async function Icon({ id }: { id: Promise<string | number> }) {
  const size = (await id) === "large" ? 512 : 192;
  return new ImageResponse(<AppMark size={size} />, { width: size, height: size });
}
